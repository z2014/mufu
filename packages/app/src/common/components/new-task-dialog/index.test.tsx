import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkdirAlert, stageAgentLine } from './index.tsx';

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

describe('工作目录的具体原因', () => {
  it.each(['找不到本机的 git', '这个目录不存在', '这个目录不是 git 仓库'])('原样显示「%s」', (message) => {
    const html = renderToStaticMarkup(<WorkdirAlert message={message} />);
    expect(html).toContain(message);
    expect(html).toContain('!');
  });
});
