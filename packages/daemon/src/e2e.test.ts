import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import type { GitHub, TaskView } from '@mufu/core';

import { startDaemon } from './daemon.ts';
import { socketPath } from './runtime.ts';

const exec = promisify(execFile);
const repoRoot = new URL('../../../', import.meta.url).pathname;
const cli = join(repoRoot, 'packages/cli/src/main.ts');
const workflowsDir = join(repoRoot, 'packages/daemon/workflows');
const fixturePath = join(repoRoot, 'fixtures/handwritten/fix-bug.fake.jsonl');

const github: GitHub = {
  inspect: () => Promise.resolve({ pr: 50, ci: 'passed' }),
  merge: () => Promise.resolve(),
};

async function gitRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'mufu-repo-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'mufu',
    GIT_AUTHOR_EMAIL: 'mufu@localhost',
    GIT_COMMITTER_NAME: 'mufu',
    GIT_COMMITTER_EMAIL: 'mufu@localhost',
  };
  await exec('git', ['init'], { cwd: dir, env });
  await exec('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, env });
  return dir;
}

function cliRun(args: string[], home: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', cli, ...args], {
      cwd: repoRoot,
      env: { ...process.env, MUFU_HOME: home },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function waitFor(home: string, taskId: string, ready: (task: TaskView) => boolean): Promise<TaskView> {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const status = await cliRun(['task', 'status', taskId], home);
    if (status.code === 0 && readyText(status.stdout, ready)) {
      const idLine = status.stdout;
      if (readyText(idLine, ready)) {
        const task = await readTask(home, taskId);
        if (task && ready(task)) return task;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`任务 ${taskId} 没有进入期望状态`);
}

function readyText(_stdout: string, _ready: (task: TaskView) => boolean): boolean {
  return true;
}

async function readTask(home: string, taskId: string): Promise<TaskView | null> {
  const { connect } = await import('node:net');
  const response = await new Promise<string>((resolve, reject) => {
    const socket = connect(socketPath(home));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', reject);
    socket.on('connect', () => socket.write(`${JSON.stringify({ id: 1, method: 'task.get', params: { taskId } })}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.includes('\n')) {
        socket.end();
        resolve(buffer);
      }
    });
  });
  const parsed = JSON.parse(response.split('\n')[0] ?? '{}') as { result?: TaskView | null };
  return parsed.result ?? null;
}

describe('fix bug tracer', () => {
  it('命令行创建任务，批准门禁，日志里能看到完成', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-home-'));
    const repo = await gitRepo();
    const daemon = await startDaemon({
      home,
      socketPath: socketPath(home),
      wsPort: 0,
      workflowsDir,
      fixturePath,
      useFixture: true,
      github,
    });
    try {
      const created = await cliRun(
        ['task', 'create', '--title', 'js error 修复', '--prompt', '空列表崩了', '--repo', repo],
        home,
      );
      expect(created.code, created.stderr).toBe(0);
      const taskId = (await listIds(home))[0];
      expect(taskId).toBeTruthy();
      const waiting = await waitFor(home, taskId!, (task) => task.pendingGate !== null);
      expect(waiting.status).toBe('to_review');
      expect(waiting.pendingGate?.summary).toContain('验收');
      const approved = await cliRun(['gate', 'approve', waiting.pendingGate!.id], home);
      expect(approved.code, approved.stderr).toBe(0);
      const done = await waitFor(home, taskId!, (task) => task.status === 'done');
      expect(done.attempts).toBe(0);
      expect(done.runs).toBe(1);
      const events = await cliRun(['task', 'events', taskId!], home);
      expect(events.stdout).toContain('task.created');
      expect(events.stdout).toContain('gate.resolved');
      expect(events.stdout).toContain('merge_succeeded');
      const status = await cliRun(['task', 'status', taskId!], home);
      expect(status.stdout).toContain('done');
    } finally {
      await daemon.close();
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('打回要写一句，任务回到进行中，不算完成', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-home-'));
    const daemon = await startDaemon({
      home,
      socketPath: socketPath(home),
      wsPort: 0,
      workflowsDir,
      fixturePath,
      useFixture: true,
      github,
    });
    try {
      const created = await cliRun(['task', 'create', '--title', '再看一眼', '--prompt', '先别过'], home);
      expect(created.code, created.stderr).toBe(0);
      const taskId = (await listIds(home))[0]!;
      const waiting = await waitFor(home, taskId, (task) => task.pendingGate !== null);
      const missing = await cliRun(['gate', 'reject', waiting.pendingGate!.id], home);
      expect(missing.code).not.toBe(0);
      const rejected = await cliRun(['gate', 'reject', waiting.pendingGate!.id, '--comment', '边界还没盖住'], home);
      expect(rejected.code, rejected.stderr).toBe(0);
      const after = await waitFor(home, taskId, (task) => task.pendingGate === null && task.status === 'running');
      expect(after.status).toBe('running');
      expect(after.attempts).toBe(0);
      expect(after.messages.some((message) => message.text.includes('边界还没盖住'))).toBe(true);
    } finally {
      await daemon.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});

async function listIds(home: string): Promise<string[]> {
  const { connect } = await import('node:net');
  const response = await new Promise<string>((resolve, reject) => {
    const socket = connect(socketPath(home));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', reject);
    socket.on('connect', () => socket.write(`${JSON.stringify({ id: 1, method: 'task.list' })}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.includes('\n')) {
        socket.end();
        resolve(buffer);
      }
    });
  });
  const parsed = JSON.parse(response.split('\n')[0] ?? '{}') as { result?: TaskView[] };
  return (parsed.result ?? []).map((task) => task.id);
}
