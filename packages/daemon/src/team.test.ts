import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  SubscriptionRefused,
  type AgentAdapter,
  type AgentSession,
  type StartSession,
  type TaskView,
} from '@mufu/core';

import { startDaemon } from './daemon.ts';
import { socketPath } from './runtime.ts';

const exec = promisify(execFile);
const repoRoot = new URL('../../../', import.meta.url).pathname;

async function initRepo(parent: string): Promise<string> {
  const dir = join(parent, 'repo');
  mkdirSync(dir);
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
const workflowsDir = join(repoRoot, 'packages/daemon/workflows');
const fixturePath = join(repoRoot, 'fixtures/handwritten/fix-bug.fake.jsonl');

function rpc(home: string, method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath(home));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', reject);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id: 1, method, params })}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      socket.end();
      const parsed = JSON.parse(buffer.split('\n')[0] ?? '{}') as { result?: unknown; error?: { message: string } };
      if (parsed.error) reject(new Error(parsed.error.message));
      else resolve(parsed.result);
    });
  });
}

async function waitFor(home: string, taskId: string, ready: (task: TaskView) => boolean): Promise<TaskView> {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const task = (await rpc(home, 'task.get', { taskId })) as TaskView | null;
    if (task && ready(task)) return task;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`任务 ${taskId} 没有进入期望状态`);
}

function scripted(
  kind: 'codex' | 'claude',
  calls: string[],
  options?: { refuse?: boolean; waitNote?: boolean },
): AgentAdapter {
  return {
    kind,
    async startSession(input: StartSession): Promise<AgentSession> {
      calls.push(`${kind}:${input.stageId ?? ''}:${input.resumeSessionId ?? ''}`);
      if (options?.refuse) throw new SubscriptionRefused(kind, 'test');
      let resolveNote: (text: string) => void = () => undefined;
      const note = new Promise<string>((resolve) => {
        resolveNote = resolve;
      });
      return {
        sessionId: `${kind}-session`,
        events: (async function* events() {
          if (options?.waitNote && input.stageId === 'reproduce') {
            yield { type: 'message' as const, author: kind === 'claude' ? 'claude' : 'codex', text: '等你补充' };
            const text = await note;
            yield {
              type: 'message' as const,
              author: kind === 'claude' ? 'claude' : 'codex',
              text: `阶段里看到 ${text}`,
            };
          } else {
            yield {
              type: 'message' as const,
              author: kind === 'claude' ? 'claude' : 'codex',
              text: `${kind} 做完 ${input.stageId ?? ''}`,
            };
          }
          yield { type: 'completed' as const, ok: true };
        })(),
        async decide() {
          return undefined;
        },
        async interrupt() {
          resolveNote('');
        },
        followUp(text: string) {
          resolveNote(text);
          return `收到：${text}`;
        },
      };
    },
  };
}

const codexOnly = {
  reproduce: 'codex',
  fix: 'codex',
  pr: 'codex',
  accept: 'codex',
} as const;

describe('codex and claude together', () => {
  it('修 bug 按阶段换代理，同一个代理会带着会话 id 回来', async () => {
    const previous = process.env.MUFU_AGENT;
    delete process.env.MUFU_AGENT;
    const calls: string[] = [];
    const home = mkdtempSync(join(tmpdir(), 'mufu-team-'));
    const repo = await initRepo(home);
    const daemon = await startDaemon({
      home,
      socketPath: socketPath(home),
      wsPort: 0,
      workflowsDir,
      fixturePath,
      adapters: { codex: scripted('codex', calls), claude: scripted('claude', calls) },
    });
    try {
      const workflows = (await rpc(home, 'workflows.list')) as {
        id: string;
        stages: { id: string; agent?: string }[];
      }[];
      const fix = workflows.find((item) => item.id === 'fix-bug');
      expect(fix?.stages.find((stage) => stage.id === 'fix')?.agent).toBe('codex');
      expect(fix?.stages.find((stage) => stage.id === 'accept')?.agent).toBe('claude');
      const created = (await rpc(home, 'task.create', {
        title: '空列表',
        prompt: '修一下',
        workflowId: 'fix-bug',
        repoPath: repo,
      })) as TaskView;
      const waiting = await waitFor(home, created.id, (task) => task.status === 'to_review');
      expect(waiting.pendingGate?.summary).toContain('验收');
      expect(calls).toEqual([
        'claude:reproduce:',
        'codex:fix:',
        'codex:pr:codex-session',
        'claude:accept:claude-session',
      ]);
      expect(waiting.sessions.claude).toBe('claude-session');
      expect(waiting.sessions.codex).toBe('codex-session');
      expect(waiting.attempts).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.MUFU_AGENT;
      else process.env.MUFU_AGENT = previous;
      await daemon.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('一边没登录只挡住用到它的任务，另一边继续', async () => {
    const previous = process.env.MUFU_AGENT;
    delete process.env.MUFU_AGENT;
    const calls: string[] = [];
    const home = mkdtempSync(join(tmpdir(), 'mufu-team-'));
    const repo = await initRepo(home);
    const daemon = await startDaemon({
      home,
      socketPath: socketPath(home),
      wsPort: 0,
      workflowsDir,
      fixturePath,
      adapters: {
        codex: scripted('codex', calls),
        claude: scripted('claude', calls, { refuse: true }),
      },
    });
    try {
      const blocked = (await rpc(home, 'task.create', {
        title: '要 Claude',
        prompt: '先复现',
        workflowId: 'fix-bug',
        repoPath: repo,
      })) as TaskView;
      const stuck = await waitFor(home, blocked.id, (task) => task.status === 'needs_you' && task.attention !== null);
      expect(stuck.attention?.tool).toBe('claude');
      expect(stuck.attention?.source).toBe('not_subscription');
      expect(stuck.attention?.message).toBe('Claude 不是订阅登录，去设置页检测');
      expect(stuck.attention?.message).not.toContain('test');
      expect(stuck.attempts).toBe(0);
      const moving = (await rpc(home, 'task.create', {
        title: '只走 Codex',
        prompt: '换人',
        workflowId: 'fix-bug',
        agents: codexOnly,
        repoPath: repo,
      })) as TaskView;
      const review = await waitFor(home, moving.id, (task) => task.status === 'to_review');
      expect(review.agentKind).toBe('codex');
      expect(calls.filter((call) => call.startsWith('claude:'))).toEqual(['claude:reproduce:']);
      expect(calls.filter((call) => call.startsWith('codex:')).map((call) => call.split(':')[1])).toEqual([
        'reproduce',
        'fix',
        'pr',
        'accept',
      ]);
      const still = (await rpc(home, 'task.get', { taskId: blocked.id })) as TaskView;
      expect(still.status).toBe('needs_you');
      expect(still.attention?.message).toBe('Claude 不是订阅登录，去设置页检测');
    } finally {
      if (previous === undefined) delete process.env.MUFU_AGENT;
      else process.env.MUFU_AGENT = previous;
      await daemon.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('任务页补的一句话会进日志，并交给正在跑的代理', async () => {
    const previous = process.env.MUFU_AGENT;
    delete process.env.MUFU_AGENT;
    const calls: string[] = [];
    const home = mkdtempSync(join(tmpdir(), 'mufu-note-'));
    const repo = await initRepo(home);
    const daemon = await startDaemon({
      home,
      socketPath: socketPath(home),
      wsPort: 0,
      workflowsDir,
      fixturePath,
      adapters: {
        codex: scripted('codex', calls, { waitNote: true }),
        claude: scripted('claude', calls, { waitNote: true }),
      },
    });
    try {
      const created = (await rpc(home, 'task.create', {
        title: '补充',
        prompt: '先看一眼',
        workflowId: 'fix-bug',
        repoPath: repo,
      })) as TaskView;
      await waitFor(home, created.id, (task) => task.messages.some((message) => message.text === '等你补充'));
      await rpc(home, 'task.note', { taskId: created.id, text: '再看边界' });
      const noted = await waitFor(home, created.id, (task) =>
        task.messages.some((message) => message.text.includes('阶段里看到 再看边界')),
      );
      expect(noted.messages.some((message) => message.role === 'user' && message.text === '再看边界')).toBe(true);
      expect(noted.messages.some((message) => message.text === '收到：再看边界')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.MUFU_AGENT;
      else process.env.MUFU_AGENT = previous;
      await daemon.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
