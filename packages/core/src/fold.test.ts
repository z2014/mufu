import { describe, expect, it } from 'vitest';

import { EVENT_SCHEMA_VERSION } from '@mufu/schema';

import { LEAD_PIN_AUTHOR, STAGE_DONE_PIN } from './agent.ts';
import { eventSchemaVersion, foldTasks } from './fold.ts';
import { stageAfterReject } from './model.ts';
import type { DomainEvent, Workflow } from './model.ts';

const workflow: Workflow = {
  id: 'fix-bug',
  title: '修 bug',
  doneWhen: 'pr_merged',
  stages: [
    { id: 'reproduce', title: '复现' },
    { id: 'accept', title: '验收', gate: 'final' },
  ],
};

function ev(partial: Partial<DomainEvent> & Pick<DomainEvent, 'type' | 'payload'>): DomainEvent {
  return {
    schemaVersion: partial.schemaVersion,
    id: partial.id ?? partial.type,
    taskId: partial.taskId ?? 't1',
    at: partial.at ?? '2026-10-10T00:00:00.000Z',
    type: partial.type,
    payload: partial.payload,
  };
}

describe('fold', () => {
  it('最终门禁通过后任务完成', () => {
    const tasks = foldTasks([
      ev({
        type: 'task.created',
        payload: { seq: 1, title: '空列表', prompt: '修一下', workflow },
      }),
      ev({ type: 'task.status', payload: { status: 'running' } }),
      ev({ type: 'run.started', payload: {} }),
      ev({
        type: 'gate.opened',
        payload: {
          gateId: 'g1',
          requestId: 'r1',
          kind: 'final',
          operation: 'final',
          summary: '验收',
          detail: '',
        },
      }),
      ev({ type: 'task.status', payload: { status: 'to_review' } }),
      ev({ type: 'gate.resolved', payload: { gateId: 'g1', decision: 'approve' } }),
      ev({ type: 'task.status', payload: { status: 'done' } }),
    ]);
    expect(tasks[0]?.status).toBe('done');
    expect(tasks[0]?.pendingGate).toBeNull();
    expect(tasks[0]?.runs).toBe(1);
    expect(tasks[0]?.messages[0]?.text).toBe('修一下');
  });

  it('环境失败带 ! 且不增加尝试', () => {
    const tasks = foldTasks([
      ev({ type: 'task.created', payload: { seq: 1, title: 'x', prompt: 'y', workflow } }),
      ev({ type: 'task.status', payload: { status: 'running' } }),
      ev({ type: 'environment.failed', payload: { message: 'Codex 不是订阅登录', tool: 'codex', source: 'apiKey' } }),
      ev({ type: 'task.status', payload: { status: 'needs_you' } }),
    ]);
    expect(tasks[0]?.attempts).toBe(0);
    expect(tasks[0]?.attention?.tool).toBe('codex');
    expect(tasks[0]?.status).toBe('needs_you');
  });

  it('CI 和合并失败都从事件折出来', () => {
    const tasks = foldTasks([
      ev({ type: 'task.created', payload: { seq: 1, title: 'x', prompt: 'y', workflow } }),
      ev({ type: 'ci.reported', payload: { pr: 50, state: 'failed' } }),
      ev({ type: 'merge_failed', payload: { pr: 50, reason: 'ci_failed', message: 'CI 没过' } }),
      ev({ type: 'task.status', payload: { status: 'needs_you' } }),
    ]);
    expect(tasks[0]?.ci).toEqual({
      pr: 50,
      state: 'failed',
      mergeable: 'unknown',
      additions: null,
      deletions: null,
    });
    expect(tasks[0]?.attention?.message).toBe('CI 没过');
    expect(tasks[0]?.attention?.source).toBe('ci_failed');
    expect(tasks[0]?.attempts).toBe(0);
  });

  it('丢掉不是协调 Agent 写的重点', () => {
    const tasks = foldTasks([
      ev({ type: 'task.created', payload: { seq: 1, title: 'x', prompt: 'y', workflow } }),
      ev({
        type: 'pin.added',
        payload: { pinId: 'claude', message: '根因', reason: '根因', author: 'Claude', stageId: 'reproduce' },
      }),
      ev({
        type: 'pin.added',
        payload: {
          pinId: 'lead',
          message: STAGE_DONE_PIN,
          reason: STAGE_DONE_PIN,
          author: LEAD_PIN_AUTHOR,
          stageId: 'reproduce',
        },
      }),
      ev({
        type: 'pin.added',
        payload: { pinId: 'codex', message: '改动', reason: '改动', author: 'Codex', stageId: 'fix' },
      }),
    ]);
    expect(tasks[0]?.pins.map((pin) => pin.author)).toEqual([LEAD_PIN_AUTHOR]);
    expect(tasks[0]?.pins[0]?.message).toBe(STAGE_DONE_PIN);
    expect(tasks[0]?.pins[0]?.reason).toBe(STAGE_DONE_PIN);
  });

  it('打回按 reject_to 回到指定阶段，没写时回到门禁前最近的工作阶段', () => {
    const named: Workflow = {
      ...workflow,
      stages: [
        { id: 'reproduce', title: '复现' },
        { id: 'fix', title: '修复' },
        { id: 'pr', title: 'PR 与 CI' },
        { id: 'accept', title: '验收', gate: 'final', rejectTo: 'fix' },
      ],
    };
    const tasks = foldTasks([
      ev({ type: 'task.created', payload: { seq: 1, title: 'x', prompt: 'y', workflow: named } }),
      ev({ type: 'stage.entered', payload: { stageId: 'accept' } }),
      ev({ type: 'gate.resolved', payload: { gateId: 'g1', decision: 'reject' } }),
    ]);
    expect(tasks[0]?.stageId).toBe('fix');
    const fallback: Workflow = {
      ...workflow,
      stages: [
        { id: 'implement', title: '实现' },
        { id: 'accept', title: '验收', gate: 'final' },
      ],
    };
    expect(stageAfterReject(fallback, 'accept')).toBe('implement');
    expect(stageAfterReject(named, 'accept')).toBe('fix');
  });

  it('消息作者从事件里的 codex / claude 取名字', () => {
    const tasks = foldTasks([
      ev({ type: 'task.created', payload: { seq: 1, title: 'x', prompt: 'y', workflow } }),
      ev({ type: 'agent.message', payload: { role: 'agent', author: 'claude', text: '已复现' } }),
      ev({ type: 'agent.message', payload: { role: 'agent', author: 'codex', text: '已修复' } }),
    ]);
    expect(tasks[0]?.messages.map((message) => message.author)).toEqual(['你', 'claude', 'codex']);
    expect(tasks[0]?.agentKind).toBe('codex');
  });

  it('缺省事件版本是 1，别的版本不折叠', () => {
    expect(eventSchemaVersion(ev({ type: 'task.status', payload: { status: 'running' } }))).toBe(EVENT_SCHEMA_VERSION);
    expect(() =>
      foldTasks([
        ev({ type: 'task.created', schemaVersion: 2, payload: { seq: 1, title: 'x', prompt: 'y', workflow } }),
      ]),
    ).toThrow(/事件版本/);
  });
});
