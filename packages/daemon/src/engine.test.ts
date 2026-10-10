import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LEAD_PIN_AUTHOR,
  MergeFailure,
  STAGE_DONE_PIN,
  type AgentAdapter,
  type AgentSession,
  type GitHub,
  type TaskView,
} from '@mufu/core';

import { createTaskEngine, type TaskEngine } from './engine.ts';
import { SqliteEventLog } from './store.ts';
import { loadWorkflows } from './workflows.ts';

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
      if (behavior === 'ci_failed') return Promise.resolve({ pr: 9, ci: 'failed' as const });
      return Promise.resolve({ pr: 9, ci: 'passed' as const });
    },
    merge() {
      this.merges += 1;
      if (behavior === 'conflict') return Promise.reject(new MergeFailure('conflict', 'cannot be cleanly created'));
      if (behavior === 'environment') return Promise.reject(new MergeFailure('environment', 'gh auth login'));
      return Promise.resolve();
    },
  };
}

async function boot(behavior: 'ok' | 'conflict' | 'ci_failed' | 'environment'): Promise<{
  engine: TaskEngine;
  gh: ReturnType<typeof github>;
  close: () => void;
}> {
  const home = mkdtempSync(join(tmpdir(), 'mufu-engine-'));
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
    adapters: { codex: adapter(), claude: adapter() },
    fixture: null,
    github: gh,
    agent: 'codex',
  });
  return {
    engine,
    gh,
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
    const { engine, gh, close } = await boot('ok');
    try {
      const created = await engine.createTask({ title: '合并', prompt: '过' });
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
      ).toEqual([{ message: STAGE_DONE_PIN, reason: STAGE_DONE_PIN, author: LEAD_PIN_AUTHOR, stageId: 'accept' }]);
      expect(done.attempts).toBe(0);
      expect(gh.merges).toBe(1);
      expect(engine.events(created.id).map((event) => event.type)).toContain('merge_succeeded');
      expect(engine.listTasks().some((task) => task.id === created.id)).toBe(false);
    } finally {
      close();
    }
  });

  it('counts a conflict and returns the card to 等你', async () => {
    const { engine, close } = await boot('conflict');
    try {
      const created = await engine.createTask({ title: '冲突', prompt: '过' });
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
    const { engine, gh, close } = await boot('ci_failed');
    try {
      const created = await engine.createTask({ title: 'CI', prompt: '过' });
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
    const { engine, close } = await boot('environment');
    try {
      const created = await engine.createTask({ title: '环境', prompt: '过' });
      const waiting = await until(engine, created.id, (task) => task.pendingGate !== null);
      engine.resolveGate(waiting.pendingGate!.id, 'approve');
      const stuck = await until(engine, created.id, (task) => task.status === 'needs_you' && task.attention !== null);
      expect(stuck.attempts).toBe(0);
      expect(stuck.attention?.message).toContain('gh auth login');
      expect(engine.events(created.id).some((event) => event.type === 'attempt.counted')).toBe(false);
    } finally {
      close();
    }
  });
});
