import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';

import { startDaemon } from './daemon.ts';
import { socketPath } from './runtime.ts';

const exec = promisify(execFile);
const repoRoot = new URL('../../../', import.meta.url).pathname;

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

describe('live events', () => {
  it('新建任务会从 WebSocket 推出来', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-live-'));
    const daemon = await startDaemon({
      home,
      socketPath: socketPath(home),
      wsPort: 0,
      workflowsDir: join(repoRoot, 'packages/daemon/workflows'),
      fixturePath: join(repoRoot, 'fixtures/handwritten/fix-bug.fake.jsonl'),
      useFixture: true,
    });
    const repo = await gitRepo();
    const frames: Array<{ method?: string; params?: { type?: string } }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.wsPort}`);
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });
      ws.on('message', (data) => {
        frames.push(JSON.parse(String(data)) as { method?: string; params?: { type?: string } });
      });
      const { connect } = await import('node:net');
      await new Promise<void>((resolve, reject) => {
        const socket = connect(socketPath(home));
        socket.on('error', reject);
        socket.on('connect', () => {
          socket.write(
            `${JSON.stringify({ id: 1, method: 'task.create', params: { title: '推送', prompt: '看得到吗', repoPath: repo } })}\n`,
          );
        });
        socket.on('data', () => {
          socket.end();
          resolve();
        });
      });
      const started = Date.now();
      while (!frames.some((frame) => frame.method === 'event' && frame.params?.type === 'task.created')) {
        if (Date.now() - started > 2000) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(frames.some((frame) => frame.method === 'event' && frame.params?.type === 'task.created')).toBe(true);
    } finally {
      ws.close();
      await daemon.close();
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
