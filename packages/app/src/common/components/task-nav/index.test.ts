import type { TaskView } from '@mufu/core/view';
import { describe, expect, it } from 'vitest';

import { sidebarGroups } from './index.tsx';

function named(title: string, status: TaskView['status']): TaskView {
  return {
    id: title,
    seq: 1,
    title,
    prompt: '',
    workflow: {
      id: 'fix-bug',
      title: '修 bug',
      doneWhen: 'pr_merged',
      stages: [{ id: 'reproduce', title: '复现' }],
    },
    status,
    stageId: 'reproduce',
    attention: null,
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
    ci: null,
    runStartedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('sidebarGroups', () => {
  it('只有一张待验收时，需要你有这一条，进行中为空', () => {
    const groups = sidebarGroups([named('空列表崩了', 'to_review')]);
    expect(groups.needsYou.map((task) => task.title)).toEqual(['空列表崩了']);
    expect(groups.running).toEqual([]);
  });

  it('同一份列表里，需要你是待验收和需要你，进行中只有正在跑的', () => {
    const groups = sidebarGroups([
      named('空列表崩了', 'to_review'),
      named('导出周报', 'running'),
      named('登录偶发超时', 'to_review'),
      named('合并撞车', 'needs_you'),
    ]);
    expect(groups.needsYou.map((task) => task.title)).toEqual(['空列表崩了', '登录偶发超时', '合并撞车']);
    expect(groups.running.map((task) => task.title)).toEqual(['导出周报']);
  });
});
