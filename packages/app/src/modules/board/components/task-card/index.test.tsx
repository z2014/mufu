import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { TaskView } from '@mufu/core/view';

import { TaskCard } from './index.tsx';

function task(stageAgent: 'codex' | 'claude'): TaskView {
  return {
    id: 't',
    seq: 7,
    title: '空列表崩了',
    prompt: '接口返回空列表时崩了',
    workflow: {
      id: 'fix-bug',
      title: '修 bug',
      doneWhen: 'pr_merged',
      stages: [
        { id: 'fix', title: '修复', agent: 'codex' },
        { id: 'accept', title: '验收', agent: stageAgent },
      ],
    },
    status: 'to_review',
    stageId: 'accept',
    attention: null,
    pendingGate: null,
    sessionId: null,
    agentKind: stageAgent === 'codex' ? 'claude' : 'codex',
    sessions: {},
    pins: [],
    artifacts: [],
    messages: [],
    attempts: 0,
    runs: 0,
    workspacePath: null,
    merging: false,
    diff: null,
    ci: null,
    runStartedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function html(stageAgent: 'codex' | 'claude'): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <TaskCard task={task(stageAgent)} />
    </MemoryRouter>,
  );
}

describe('TaskCard avatar', () => {
  it('用当前阶段的代理缩写，不跟最近一条消息的作者走', () => {
    const claude = html('claude');
    expect(claude).toContain('>Cl<');
    expect(claude).toContain('title="Claude"');
    expect(claude).not.toContain('>Cx<');

    const codex = html('codex');
    expect(codex).toContain('>Cx<');
    expect(codex).toContain('title="Codex"');
    expect(codex).not.toContain('>Cl<');
  });

  it('合并中时按钮禁用并写着合并中', () => {
    const view = task('codex');
    view.status = 'running';
    view.merging = true;
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TaskCard task={view} />
      </MemoryRouter>,
    );
    expect(html).toContain('合并中');
    expect(html).toContain('disabled');
    expect(html).toContain('aria-busy="true"');
  });
});
