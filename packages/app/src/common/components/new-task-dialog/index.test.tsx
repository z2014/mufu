import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkdirAlert } from './index.tsx';

describe('工作目录的具体原因', () => {
  it.each(['找不到本机的 git', '这个目录不存在', '这个目录不是 git 仓库'])('原样显示「%s」', (message) => {
    const html = renderToStaticMarkup(<WorkdirAlert message={message} />);
    expect(html).toContain(message);
    expect(html).toContain('!');
  });
});
