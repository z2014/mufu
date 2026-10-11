import { join } from 'node:path';

import { WebSocket } from 'ws';

import { createClaudeAdapter, createCodexAdapter, createFakeAdapter } from '@mufu/adapters';
import type { AgentAdapter, AgentKind, GitHub, SecretStore } from '@mufu/core';
import { DAEMON_WS_PORT } from '@mufu/schema';

import { doctor, type DoctorReport } from './doctor.ts';
import { createTaskEngine } from './engine.ts';
import { createGhClient } from './gh.ts';
import { createRpc } from './rpc.ts';
import { createDefaultSecretStore } from './secrets.ts';
import { SqliteEventLog } from './store.ts';
import { listen } from './transport.ts';
import { loadWorkflows } from './workflows.ts';

export type DaemonOptions = {
  home: string;
  socketPath: string;
  wsPort?: number;
  workflowsDir: string;
  agent?: AgentKind;
  /** 测试和 `MUFU_AGENT=fake` 才打开。夹具路径本身不代表要走夹具。 */
  useFixture?: boolean;
  adapters?: Partial<Record<AgentKind, AgentAdapter>>;
  fixturePath?: string;
  codexBin?: string;
  claudeBin?: string;
  github?: GitHub;
  /** 测试注入。缺省时 macOS 用钥匙串，其它系统用进程内内存。 */
  secrets?: SecretStore;
};

export type RunningDaemon = {
  socketPath: string;
  wsPort: number;
  close: () => Promise<void>;
  report: () => DoctorReport | null;
};

export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const log = new SqliteEventLog(join(options.home, 'events.sqlite'));
  const subscribers = new Set<WebSocket>();
  const events = {
    append(event: { taskId: string | null; type: string; payload: Record<string, unknown> }) {
      const row = log.append(event);
      const frame = JSON.stringify({ method: 'event', params: row });
      for (const client of subscribers) {
        if (client.readyState === WebSocket.OPEN) client.send(frame);
      }
    },
    readAll: () => log.readAll(),
    close: () => log.close(),
  };
  const workflows = loadWorkflows(options.workflowsDir);
  const fixturePath = options.fixturePath ?? process.env.MUFU_FIXTURE;
  if (options.useFixture && !fixturePath) {
    log.close();
    throw new Error('夹具模式需要 MUFU_FIXTURE');
  }
  const engine = createTaskEngine({
    home: options.home,
    log: events,
    workflows,
    adapters: buildAdapters(options),
    fixture: options.useFixture ? createFakeAdapter(fixturePath ?? '') : null,
    github: options.github ?? createGhClient(),
    agent: options.agent,
  });
  const secrets = options.secrets ?? createDefaultSecretStore();
  let doctorReport: DoctorReport | null = null;
  const handle = createRpc({
    engine,
    secrets,
    loadDoctor: async () => {
      doctorReport = await doctor();
      return doctorReport;
    },
  });
  let transport: Awaited<ReturnType<typeof listen>>;
  try {
    transport = await listen({
      socketPath: options.socketPath,
      wsPort: options.wsPort ?? DAEMON_WS_PORT,
      handle,
      subscribers,
    });
  } catch (error) {
    log.close();
    throw error;
  }
  void doctor()
    .then((report) => {
      doctorReport = report;
    })
    .catch(() => undefined);

  return {
    socketPath: options.socketPath,
    wsPort: transport.wsPort,
    report: () => doctorReport,
    async close() {
      engine.shutdown();
      await transport.close();
      log.close();
    },
  };
}

function buildAdapters(options: DaemonOptions): Record<AgentKind, AgentAdapter> {
  return {
    codex: options.adapters?.codex ?? createCodexAdapter({ bin: options.codexBin }),
    claude: options.adapters?.claude ?? createClaudeAdapter({ bin: options.claudeBin }),
  };
}
