import { join } from 'node:path';

import { createClaudeAdapter, createCodexAdapter, createFakeAdapter } from '@mufu/adapters';
import type { AgentAdapter, AgentKind, GitHub } from '@mufu/core';

import { doctor, type DoctorReport } from './doctor.ts';
import { createTaskEngine } from './engine.ts';
import { createGhClient } from './gh.ts';
import { createRpc } from './rpc.ts';
import { DAEMON_WS_PORT } from './runtime.ts';
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
};

export type RunningDaemon = {
  socketPath: string;
  wsPort: number;
  close: () => Promise<void>;
  report: () => DoctorReport | null;
};

export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const log = new SqliteEventLog(join(options.home, 'events.sqlite'));
  const workflows = loadWorkflows(options.workflowsDir);
  const fixturePath = options.fixturePath ?? process.env.MUFU_FIXTURE;
  if (options.useFixture && !fixturePath) {
    log.close();
    throw new Error('夹具模式需要 MUFU_FIXTURE');
  }
  const engine = createTaskEngine({
    home: options.home,
    log,
    workflows,
    adapters: buildAdapters(options),
    fixture: options.useFixture ? createFakeAdapter(fixturePath ?? '') : null,
    github: options.github ?? createGhClient(),
    agent: options.agent,
  });
  let doctorReport: DoctorReport | null = null;
  const handle = createRpc({
    engine,
    loadDoctor: async () => {
      doctorReport ??= await doctor();
      return doctorReport;
    },
  });
  let transport: Awaited<ReturnType<typeof listen>>;
  try {
    transport = await listen({
      socketPath: options.socketPath,
      wsPort: options.wsPort ?? DAEMON_WS_PORT,
      handle,
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
