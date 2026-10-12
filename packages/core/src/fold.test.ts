import { describe, expect, it } from 'vitest';

import { EVENT_SCHEMA_VERSION } from '@mufu/schema';

import { LEAD_PIN_AUTHOR, STAGE_DONE_PIN } from './agent.ts';
import { eventSchemaVersion, foldTasks, upgradeEvent } from './fold.ts';
import { mergingCopy } from './github.ts';
import { stageAfterReject, unreadPinCount } from './model.ts';
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

  it('合并请求还没结果时，重放仍是合并中', () => {
    const tasks = foldTasks([
      ev({ type: 'task.created', payload: { seq: 1, title: 'x', prompt: 'y', workflow } }),
      ev({ type: 'task.status', payload: { status: 'running' } }),
      ev({ type: 'merge_requested', payload: { pr: 50 } }),
    ]);
    expect(tasks[0]?.merging).toBe(true);
    expect(tasks[0]?.mergePr).toBe(50);
    expect(tasks[0] && mergingCopy(tasks[0].mergePr ?? 0)).toBe('正在合并 PR #50');
    expect(tasks[0]?.status).toBe('running');
    const finished = foldTasks([
      ev({ type: 'task.created', payload: { seq: 1, title: 'x', prompt: 'y', workflow } }),
      ev({ type: 'merge_requested', payload: { pr: 50 } }),
      ev({ type: 'merge_succeeded', payload: { pr: 50 } }),
    ]);
    expect(finished[0]?.merging).toBe(false);
    expect(finished[0]?.mergePr).toBeNull();
  });

  it('pin.read 只标事件里列出的重点，未读条数由折叠得出', () => {
    const pins = (ids: string[]) =>
      ids.map((pinId) =>
        ev({
          id: pinId,
          type: 'pin.added',
          payload: {
            pinId,
            message: pinId,
            reason: pinId,
            author: LEAD_PIN_AUTHOR,
            stageId: 'reproduce',
          },
        }),
      );
    const tasks = foldTasks([
      ev({ type: 'task.created', payload: { seq: 1, title: 'x', prompt: 'y', workflow } }),
      ...pins(['p1', 'p2', 'p3']),
      ev({ type: 'pin.read', payload: { pinIds: ['p1'] } }),
    ]);
    expect(tasks[0]?.pins.map((pin) => pin.read)).toEqual([true, false, false]);
    expect(unreadPinCount(tasks[0]?.pins ?? [])).toBe(2);
    const all = foldTasks([
      ev({ type: 'task.created', payload: { seq: 1, title: 'x', prompt: 'y', workflow } }),
      ...pins(['p1', 'p2', 'p3']),
      ev({ type: 'pin.read', payload: { pinIds: ['p1', 'p2', 'p3'] } }),
    ]);
    expect(unreadPinCount(all[0]?.pins ?? [])).toBe(0);
    const untouched = foldTasks([
      ev({ type: 'task.created', payload: { seq: 1, title: 'x', prompt: 'y', workflow } }),
      ...pins(['p1']),
      ev({ type: 'pin.read', payload: {} }),
    ]);
    expect(untouched[0]?.pins[0]?.read).toBe(false);
  });

  it('改动产物折成文件列表', () => {
    const tasks = foldTasks([
      ev({ type: 'task.created', payload: { seq: 1, title: 'x', prompt: 'y', workflow } }),
      ev({
        type: 'artifact.added',
        payload: {
          artifactId: 'd1',
          title: '改动',
          detail: 'src/a.ts  +4 −1',
          kind: 'diff',
          pr: 50,
          files: [{ path: 'src/a.ts', additions: 4, deletions: 1 }],
          additions: 4,
          deletions: 1,
        },
      }),
    ]);
    expect(tasks[0]?.diff).toEqual({
      pr: 50,
      fileCount: 1,
      additions: 4,
      deletions: 1,
      files: [{ path: 'src/a.ts', additions: 4, deletions: 1 }],
    });
  });

  it('选用和换流程可以重放，第一阶段有产出之后不能再换', () => {
    const feature: Workflow = {
      id: 'new-feature',
      title: '新功能',
      doneWhen: 'pr_merged',
      stages: [{ id: 'spec', title: '方案', agent: 'claude' }],
    };
    const chosen = [
      ev({ type: 'task.created', payload: { seq: 1, title: 'x', prompt: '崩了', workflow } }),
      ev({ type: 'template.chosen', payload: { workflowId: 'fix-bug', reason: '需求里有「崩」' } }),
      ev({ type: 'agent.message', payload: { role: 'lead', author: '协调 Agent', text: '开场' } }),
    ];
    const open = foldTasks(chosen)[0];
    expect(open?.workflowReason).toBe('需求里有「崩」');
    expect(open?.canChangeWorkflow).toBe(true);

    const locked = foldTasks([
      ...chosen,
      ev({ type: 'agent.message', id: 'said', payload: { role: 'agent', author: 'claude', text: '已复现' } }),
    ])[0];
    expect(locked?.canChangeWorkflow).toBe(false);

    const switched = foldTasks([
      ...chosen,
      ev({
        type: 'template.changed',
        payload: { workflowId: 'new-feature', reason: '换成「新功能」', workflow: feature },
      }),
      ev({ type: 'stage.entered', payload: { stageId: 'spec' } }),
    ])[0];
    expect(switched?.workflow.id).toBe('new-feature');
    expect(switched?.stageId).toBe('spec');
    expect(switched?.workflowReason).toBe('换成「新功能」');
    expect(switched?.canChangeWorkflow).toBe(true);
    expect(switched?.sessionId).toBeNull();

    const lockedAgain = foldTasks([
      ...chosen,
      ev({
        type: 'template.changed',
        payload: { workflowId: 'new-feature', reason: '换成「新功能」', workflow: feature },
      }),
      ev({ type: 'artifact.added', payload: { artifactId: 'a', title: '方案', detail: '一页' } }),
    ])[0];
    expect(lockedAgain?.canChangeWorkflow).toBe(false);

    const edited = foldTasks([
      ...chosen,
      ev({ type: 'stage.agent', payload: { stageId: 'reproduce', agent: 'codex' } }),
    ])[0];
    expect(edited?.workflow.stages.find((stage) => stage.id === 'reproduce')?.agent).toBe('codex');
  });

  it('缺省事件版本是 1，别的版本交给 upgradeEvent 拒绝', () => {
    const missing = ev({ type: 'task.status', payload: { status: 'running' } });
    expect(eventSchemaVersion(missing)).toBe(EVENT_SCHEMA_VERSION);
    expect(upgradeEvent(missing).schemaVersion).toBe(EVENT_SCHEMA_VERSION);
    expect(() => upgradeEvent({ ...missing, schemaVersion: 2 })).toThrow(/事件版本/);
    expect(() =>
      foldTasks([
        ev({ type: 'task.created', schemaVersion: 2, payload: { seq: 1, title: 'x', prompt: 'y', workflow } }),
      ]),
    ).toThrow(/事件版本/);
  });
});
