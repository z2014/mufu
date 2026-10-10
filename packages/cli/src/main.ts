#!/usr/bin/env tsx
import { mkdirSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dataDir, DEV_PORT, resolveDaemonPort, socketPath, type DomainEvent, type TaskView } from '@mufu/core';
import { startDaemon } from '@mufu/daemon';

import { callDaemon } from './client.ts';

const here = dirname(fileURLToPath(import.meta.url));

function usage(): void {
  process.stderr.write(`用法：
  mufu daemon
  mufu doctor
  mufu task create --title 标题 --prompt 描述 [--repo 路径] [--workflow fix-bug] [--agent 阶段=codex]
  mufu task status <taskId>
  mufu task events <taskId>
  mufu task list
  mufu gate approve <gateId>
  mufu gate reject <gateId>
`);
}

function envAgent(value: string | undefined): 'fake' | 'codex' | 'claude' | undefined {
  if (value === 'fake' || value === 'codex' || value === 'claude') return value;
  return undefined;
}

function agentFlags(): Record<string, 'codex' | 'claude'> | undefined {
  const map: Record<string, 'codex' | 'claude'> = {};
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== '--agent') continue;
    const value = process.argv[index + 1] ?? '';
    const eq = value.indexOf('=');
    const stage = eq > 0 ? value.slice(0, eq) : '';
    const kind = eq > 0 ? value.slice(eq + 1) : '';
    if ((kind !== 'codex' && kind !== 'claude') || stage.length === 0) {
      throw new Error('--agent 要写成 阶段=codex 或 阶段=claude');
    }
    map[stage] = kind;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function printTask(task: TaskView): void {
  const gate = task.pendingGate ? `${task.pendingGate.summary}（${task.pendingGate.id}）` : '无';
  const stage = task.workflow.stages.find((item) => item.id === task.stageId);
  const agent = stage?.agent ?? task.agentKind ?? '未定';
  process.stdout.write(
    `${[`任务 #${task.seq} ${task.title}`, `状态：${task.status}`, `阶段：${task.stageId}（${agent}）`, `门禁：${gate}`, `尝试：${task.attempts}  运行：${task.runs}`, `会话：${task.sessionId ?? '无'}`].join('\n')}\n`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const [command, sub, extra] = args;
  if (command === 'daemon') {
    const home = dataDir();
    mkdirSync(home, { recursive: true });
    const daemon = await startDaemon({
      home,
      socketPath: socketPath(home),
      wsPort: resolveDaemonPort(process.env),
      workflowsDir: process.env.MUFU_WORKFLOWS ?? join(here, '../../daemon/workflows'),
      fixturePath: process.env.MUFU_FIXTURE ?? join(here, '../../../fixtures/handwritten/fix-bug.fake.jsonl'),
      agent: envAgent(process.env.MUFU_AGENT),
    });
    writeSync(
      1,
      `mufu daemon listening ${daemon.socketPath} ws 127.0.0.1:${daemon.wsPort}\n看板 http://127.0.0.1:${DEV_PORT} （另一个终端：pnpm dev:app）\n`,
    );
    await new Promise<void>((resolve) => {
      const stop = () => {
        void daemon.close().then(() => resolve());
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    });
    return;
  }
  if (!command || command === 'help' || command === '--help') {
    usage();
    return;
  }
  if (command === 'doctor') {
    process.stdout.write(`${JSON.stringify(await callDaemon('doctor'), null, 2)}\n`);
    return;
  }
  if (command === 'task' && sub === 'create') {
    const title = flag('--title');
    const prompt = flag('--prompt');
    if (!title || !prompt) throw new Error('需要 --title 和 --prompt');
    const task = (await callDaemon('task.create', {
      title,
      prompt,
      workflowId: flag('--workflow') ?? 'fix-bug',
      repoPath: flag('--repo'),
      agents: agentFlags(),
    })) as TaskView;
    printTask(task);
    return;
  }
  if (command === 'task' && sub === 'list') {
    const tasks = (await callDaemon('task.list')) as TaskView[];
    for (const task of tasks) printTask(task);
    if (tasks.length === 0) process.stdout.write('看板上没有任务。\n');
    return;
  }
  if (command === 'task' && sub === 'status') {
    if (!extra) throw new Error('需要 taskId');
    const task = (await callDaemon('task.get', { taskId: extra })) as TaskView | null;
    if (!task) throw new Error('没有这个任务');
    printTask(task);
    return;
  }
  if (command === 'task' && sub === 'events') {
    if (!extra) throw new Error('需要 taskId');
    const events = (await callDaemon('task.events', { taskId: extra })) as DomainEvent[];
    for (const event of events) {
      process.stdout.write(`${event.at}  ${event.type}  ${JSON.stringify(event.payload)}\n`);
    }
    return;
  }
  if (command === 'gate' && (sub === 'approve' || sub === 'reject')) {
    if (!extra) throw new Error('需要 gateId');
    await callDaemon('gate.resolve', { gateId: extra, decision: sub === 'approve' ? 'approve' : 'reject' });
    process.stdout.write(sub === 'approve' ? `已通过门禁 ${extra}\n` : `已打回门禁 ${extra}\n`);
    return;
  }
  usage();
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
