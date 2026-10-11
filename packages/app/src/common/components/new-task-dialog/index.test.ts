import { describe, expect, it } from 'vitest';

import { stageAgentLine } from './index.tsx';

describe('stageAgentLine', () => {
  it('把每个阶段收成一行', () => {
    expect(
      stageAgentLine(
        [
          { id: 'reproduce', title: '复现' },
          { id: 'fix', title: '修复' },
          { id: 'pr', title: 'PR 与 CI' },
          { id: 'accept', title: '验收' },
        ],
        { reproduce: 'claude', fix: 'codex', pr: 'codex', accept: 'claude' },
      ),
    ).toBe('复现 Claude · 修复 Codex · PR 与 CI Codex · 验收 Claude');
  });
});
