import { describe, expect, it } from 'vitest';

import {
  LAUNCH_AGENT_LABEL,
  PRODUCT_NAME,
  classifyCodexQuotaWindow,
  countsAsAttempt,
  launchAgentPlist,
} from './index.ts';
import { assertTransition, columnOf, sortInColumn, type TaskStatus, type TaskView } from './model.ts';

function task(status: TaskStatus, seq: number, attention: TaskView['attention']): TaskView {
  return {
    id: 't',
    seq,
    title: 't',
    prompt: 'p',
    workflow: {
      id: 'fix-bug',
      title: '修 bug',
      doneWhen: 'final_gate_approved',
      stages: [{ id: 'reproduce', title: '复现' }],
    },
    status,
    stageId: 'reproduce',
    attention,
    pendingGate: null,
    sessionId: null,
    agentKind: null,
    sessions: {},
    pins: [],
    artifacts: [],
    messages: [],
    attempts: 0,
    runs: 0,
    workspacePath: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('product name', () => {
  it('派生名都来自同一个常量', () => {
    expect(PRODUCT_NAME).toBe('mufu');
    expect(LAUNCH_AGENT_LABEL).toBe('com.mufu.daemon');
    expect(launchAgentPlist('/usr/local/bin/mufu')).toContain(LAUNCH_AGENT_LABEL);
  });
});

describe('attempt vs run', () => {
  it('环境失败不算尝试', () => {
    expect(countsAsAttempt({ kind: 'rate_limit', detail: 'rejected' })).toBe(false);
    expect(countsAsAttempt({ kind: 'auth', detail: 'expired' })).toBe(false);
    expect(countsAsAttempt({ kind: 'network', detail: 'reset' })).toBe(false);
    expect(countsAsAttempt({ kind: 'task', detail: 'tests failed' })).toBe(true);
  });
});

describe('quota windows', () => {
  it('每周额度放在 primary 时仍按秒数认成 weekly', () => {
    expect(classifyCodexQuotaWindow({ seconds: 604800 })).toBe('weekly');
    expect(classifyCodexQuotaWindow({ minutes: 10080 })).toBe('weekly');
    expect(classifyCodexQuotaWindow({ seconds: 18000 })).toBe('session');
    expect(classifyCodexQuotaWindow({})).toBe('unknown');
  });
});

describe('columns', () => {
  it('完成的任务离开看板，带 ! 的排在前面', () => {
    expect(columnOf(task('done', 2, null))).toBeNull();
    expect(columnOf(task('queued', 2, null))).toBe('running');
    const sorted = sortInColumn([task('needs_you', 2, null), task('needs_you', 1, { message: '登录过期' })]);
    expect(sorted[0]?.seq).toBe(1);
  });

  it('拒绝非法状态跳转', () => {
    expect(() => assertTransition('done', 'running')).toThrow(/不能从/);
  });
});
