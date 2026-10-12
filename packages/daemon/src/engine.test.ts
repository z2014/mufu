import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  AgentStartupError,
  LEAD_PIN_AUTHOR,
  MergeFailure,
  mergeFailureCopy,
  stageDoneText,
  startupCopy,
  type AgentAdapter,
  type AgentSession,
  type GitHub,
  type PullInspect,
  type TaskView,
} from '@mufu/core';

import { createTaskEngine, type TaskEngine } from './engine.ts';
import { SqliteEventLog } from './store.ts';
import { loadWorkflows } from './workflows.ts';

const exec = promisify(execFile);

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

const inspected = (pr: number, ci: PullInspect['ci']): PullInspect => ({
  pr,
  ci,
  mergeable: 'clean',
  additions: 38,
  deletions: 12,
});

function adapter(): AgentAdapter {
  return {
    kind: 'codex',
    startSession(): Promise<AgentSession> {
      return Promise.resolve({
        sessionId: 'codex-session',
        events: (async function* events() {
          yield { type: 'completed' as const, ok: true };
        })(),
        decide() {
          return Promise.resolve();
        },
        interrupt() {
          return Promise.resolve();
        },
      });
    },
  };
}

function github(behavior: 'ok' | 'conflict' | 'ci_failed' | 'environment'): GitHub & { merges: number } {
  return {
    merges: 0,
    inspect() {
      if (behavior === 'ci_failed') return Promise.resolve(inspected(9, 'failed'));
      return Promise.resolve(inspected(9, 'passed'));
    },
    diffStat() {
      return Promise.resolve({
        files: [{ path: 'src/a.ts', additions: 4, deletions: 1 }],
        additions: 4,
        deletions: 1,
      });
    },
    merge() {
      this.merges += 1;
      if (behavior === 'conflict') return Promise.reject(new MergeFailure('conflict', 'cannot be cleanly created'));
      if (behavior === 'environment') return Promise.reject(new MergeFailure('environment', 'gh auth login'));
      return Promise.resolve();
    },
  };
}

async function boot(
  behavior: 'ok' | 'conflict' | 'ci_failed' | 'environment',
  codex: AgentAdapter = adapter(),
): Promise<{
  engine: TaskEngine;
  gh: ReturnType<typeof github>;
  repo: string;
  home: string;
  close: () => void;
}> {
  const home = mkdtempSync(join(tmpdir(), 'mufu-engine-'));
  const repo = await initRepo(home);
  const dir = join(home, 'workflows');
  mkdirSync(dir);
  const log = new SqliteEventLog(join(home, 'events.sqlite'));
  writeFileSync(
    join(dir, 'only.yaml'),
    'id: only\ntitle: 只验收\ndefault: true\ndone_when: pr_merged\nstages:\n  - id: accept\n    title: 验收\n    gate: final\n    agent: codex\n',
  );
  const gh = github(behavior);
  const engine = createTaskEngine({
    home,
    log,
    workflows: loadWorkflows(dir),
    adapters: { codex, claude: adapter() },
    fixture: null,
    github: gh,
    agent: 'codex',
  });
  return {
    engine,
    gh,
    repo,
    home,
    close() {
      engine.shutdown();
      log.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

async function until(engine: TaskEngine, taskId: string, ready: (task: TaskView) => boolean): Promise<TaskView> {
  const started = Date.now();
  while (Date.now() - started < 4000) {
    const task = engine.getTask(taskId);
    if (task && ready(task)) return task;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('任务没有进入期望状态');
}

describe('merge completes the task', () => {
  it('writes done only after merge succeeds', async () => {
    const { engine, gh, repo, close } = await boot('ok');
    try {
      const created = await engine.createTask({ title: '合并', prompt: '过', repoPath: repo });
      const waiting = await until(
        engine,
        created.id,
        (task) => task.status === 'to_review' && task.ci?.state === 'passed',
      );
      expect(waiting.pendingGate).not.toBeNull();
      expect(waiting.pins).toEqual([]);
      engine.resolveGate(waiting.pendingGate!.id, 'approve');
      const done = await until(engine, created.id, (task) => task.status === 'done');
      expect(
        done.pins.map((pin) => ({
          message: pin.message,
          reason: pin.reason,
          author: pin.author,
          stageId: pin.stageId,
        })),
      ).toEqual([
        {
          message: stageDoneText('验收', '用「只验收」流程处理：验收。'),
          reason: stageDoneText('验收', '用「只验收」流程处理：验收。'),
          author: LEAD_PIN_AUTHOR,
          stageId: 'accept',
        },
      ]);
      expect(done.attempts).toBe(0);
      expect(gh.merges).toBe(1);
      expect(engine.events(created.id).map((event) => event.type)).toContain('merge_succeeded');
      expect(engine.listTasks().some((task) => task.id === created.id)).toBe(false);
    } finally {
      close();
    }
  });

  it('counts a conflict and returns the card to 等你', async () => {
    const { engine, repo, close } = await boot('conflict');
    try {
      const created = await engine.createTask({ title: '冲突', prompt: '过', repoPath: repo });
      const waiting = await until(engine, created.id, (task) => task.pendingGate !== null);
      engine.resolveGate(waiting.pendingGate!.id, 'approve');
      const stuck = await until(engine, created.id, (task) => task.status === 'needs_you' && task.attention !== null);
      expect(stuck.attempts).toBe(1);
      expect(stuck.attention?.source).toBe('conflict');
      const failed = engine.events(created.id).find((event) => event.type === 'merge_failed');
      expect(failed?.payload.reason).toBe('conflict');
    } finally {
      close();
    }
  });

  it('does not call merge when CI failed, and still counts the attempt', async () => {
    const { engine, gh, repo, close } = await boot('ci_failed');
    try {
      const created = await engine.createTask({ title: 'CI', prompt: '过', repoPath: repo });
      const waiting = await until(engine, created.id, (task) => task.ci?.state === 'failed');
      expect(waiting.status).toBe('to_review');
      engine.resolveGate(waiting.pendingGate!.id, 'approve');
      const stuck = await until(engine, created.id, (task) => task.status === 'needs_you');
      expect(stuck.attempts).toBe(1);
      expect(gh.merges).toBe(0);
      expect(
        engine
          .events(created.id)
          .some((event) => event.type === 'merge_failed' && event.payload.reason === 'ci_failed'),
      ).toBe(true);
    } finally {
      close();
    }
  });

  it('does not count an environment failure', async () => {
    const { engine, repo, close } = await boot('environment');
    try {
      const created = await engine.createTask({ title: '环境', prompt: '过', repoPath: repo });
      const waiting = await until(engine, created.id, (task) => task.pendingGate !== null);
      engine.resolveGate(waiting.pendingGate!.id, 'approve');
      const stuck = await until(engine, created.id, (task) => task.status === 'needs_you' && task.attention !== null);
      expect(stuck.attempts).toBe(0);
      expect(stuck.attention?.message).toBe(mergeFailureCopy('environment'));
      expect(stuck.attention?.message).not.toContain('Command failed');
      expect(engine.events(created.id).some((event) => event.type === 'attempt.counted')).toBe(false);
    } finally {
      close();
    }
  });

  it('refuses a missing directory and a directory that is not a git repo', async () => {
    const { engine, home, close } = await boot('ok');
    try {
      await expect(engine.createTask({ title: '空', prompt: '过', repoPath: '   ' })).rejects.toThrow('先选择工作目录');
      await expect(engine.createTask({ title: '不是仓库', prompt: '过', repoPath: home })).rejects.toThrow(
        '这个目录不是 git 仓库',
      );
      expect(engine.listTasks()).toEqual([]);
    } finally {
      close();
    }
  });

  it('打回最终门禁时按 reject_to 回到修复', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-reject-'));
    const repo = await initRepo(home);
    const dir = join(home, 'workflows');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'bug.yaml'),
      [
        'id: bug',
        'title: 修 bug',
        'default: true',
        'done_when: pr_merged',
        'stages:',
        '  - id: fix',
        '    title: 修复',
        '    agent: codex',
        '  - id: accept',
        '    title: 验收',
        '    gate: final',
        '    reject_to: fix',
        '    agent: claude',
        '',
      ].join('\n'),
    );
    const log = new SqliteEventLog(join(home, 'events.sqlite'));
    const gh = github('ok');
    const engine = createTaskEngine({
      home,
      log,
      workflows: loadWorkflows(dir),
      adapters: { codex: adapter(), claude: adapter() },
      fixture: null,
      github: gh,
      agent: 'codex',
    });
    try {
      const created = await engine.createTask({ title: '打回', prompt: '过', repoPath: repo });
      const waiting = await until(engine, created.id, (task) => task.stageId === 'accept' && task.pendingGate !== null);
      expect(waiting.stageId).toBe('accept');
      engine.resolveGate(waiting.pendingGate!.id, 'reject', '再改一下');
      const rolled = await until(engine, created.id, (task) => task.pendingGate === null);
      expect(rolled.stageId).toBe('fix');
      expect(rolled.workflow.stages.find((stage) => stage.id === 'accept')?.rejectTo).toBe('fix');
    } finally {
      engine.shutdown();
      log.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('已经在合并时拒绝再来一次', async () => {
    const { engine, gh, repo, close } = await boot('ok');
    let release: () => void = () => undefined;
    gh.merge = () => {
      gh.merges += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    try {
      const created = await engine.createTask({ title: '合并中', prompt: '过', repoPath: repo });
      const waiting = await until(engine, created.id, (task) => task.pendingGate !== null);
      engine.resolveGate(waiting.pendingGate!.id, 'approve');
      const pending = await until(engine, created.id, (task) => task.merging);
      expect(pending.merging).toBe(true);
      await expect(engine.requestMerge(created.id)).rejects.toThrow('已经在合并');
      expect(gh.merges).toBe(1);
      release();
      const done = await until(engine, created.id, (task) => task.status === 'done');
      expect(done.merging).toBe(false);
    } finally {
      close();
    }
  });

  it('PR 阶段结束时把 gh pr diff --stat 写成改动', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-diff-'));
    const repo = await initRepo(home);
    const dir = join(home, 'workflows');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'pr.yaml'),
      [
        'id: pr',
        'title: 改动',
        'default: true',
        'done_when: pr_merged',
        'stages:',
        '  - id: pr',
        '    title: PR 与 CI',
        '    agent: codex',
        '  - id: accept',
        '    title: 验收',
        '    gate: final',
        '    agent: claude',
        '',
      ].join('\n'),
    );
    const log = new SqliteEventLog(join(home, 'events.sqlite'));
    const gh = github('ok');
    let calls = 0;
    const diffStat = gh.diffStat.bind(gh);
    gh.diffStat = (repoPath) => {
      calls += 1;
      return diffStat(repoPath);
    };
    const engine = createTaskEngine({
      home,
      log,
      workflows: loadWorkflows(dir),
      adapters: {
        codex: {
          kind: 'codex',
          startSession(input) {
            return Promise.resolve({
              sessionId: 'codex-session',
              events: (async function* events() {
                if (input.stageId === 'pr') yield { type: 'artifact' as const, title: 'PR #50', detail: '3 个文件' };
                yield { type: 'completed' as const, ok: true };
              })(),
              decide() {
                return Promise.resolve();
              },
              interrupt() {
                return Promise.resolve();
              },
            });
          },
        },
        claude: adapter(),
      },
      fixture: null,
      github: gh,
      agent: 'codex',
    });
    try {
      const created = await engine.createTask({ title: '看改动', prompt: '过', repoPath: repo });
      const waiting = await until(engine, created.id, (task) => task.diff !== null && task.pendingGate !== null);
      expect(calls).toBe(1);
      expect(waiting.diff).toEqual({
        pr: 50,
        fileCount: 1,
        additions: 4,
        deletions: 1,
        files: [{ path: 'src/a.ts', additions: 4, deletions: 1 }],
      });
      const again = await until(engine, created.id, (task) => task.stageId === 'accept');
      expect(again.diff?.fileCount).toBe(1);
      expect(calls).toBe(1);
    } finally {
      engine.shutdown();
      log.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('启动失败进等你，原始错误只留在日志里，不计入尝试', async () => {
    const raw = 'Native CLI binary for darwin-arm64 not found';
    const { engine, repo, close } = await boot('ok', {
      kind: 'codex',
      startSession() {
        return Promise.reject(new AgentStartupError('cli_not_found', 'codex', raw));
      },
    });
    try {
      const created = await engine.createTask({ title: '没有命令', prompt: '过', repoPath: repo });
      const stuck = await until(engine, created.id, (task) => task.status === 'needs_you' && task.attention !== null);
      expect(stuck.attention?.message).toBe(startupCopy('cli_not_found', 'codex'));
      expect(stuck.attention?.source).toBe('cli_not_found');
      expect(stuck.attempts).toBe(0);
      expect(JSON.stringify(stuck)).not.toContain(raw);
      const failed = engine.events(created.id).find((event) => event.type === 'environment.failed');
      expect(failed?.payload.raw).toBe(raw);
      expect(failed?.payload.message).toBe('找不到本机的 Codex，去设置页检测');
    } finally {
      close();
    }
  });

  it('运行中的环境失败也用类型对应的句子，不把 SDK 原文放进卡片', async () => {
    const raw = 'Native CLI binary for darwin-arm64 not found';
    const { engine, repo, close } = await boot('ok', {
      kind: 'codex',
      startSession() {
        return Promise.resolve({
          sessionId: 'codex-session',
          events: (async function* events() {
            yield {
              type: 'environment_failure' as const,
              message: raw,
              raw,
              tool: 'codex',
              source: 'cli_not_found',
              failure: 'auth' as const,
            };
          })(),
          decide() {
            return Promise.resolve();
          },
          interrupt() {
            return Promise.resolve();
          },
        });
      },
    });
    try {
      const created = await engine.createTask({ title: '跑起来才失败', prompt: '过', repoPath: repo });
      const stuck = await until(engine, created.id, (task) => task.status === 'needs_you' && task.attention !== null);
      expect(stuck.attention?.message).toBe('找不到本机的 Codex，去设置页检测');
      expect(stuck.attempts).toBe(0);
      expect(JSON.stringify(stuck)).not.toContain('darwin-arm64');
      expect(engine.events(created.id).find((event) => event.type === 'environment.failed')?.payload.raw).toBe(raw);
    } finally {
      close();
    }
  });
});
