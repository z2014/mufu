import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChangeWorkflowButton } from './index.tsx';

describe('换一个', () => {
  it('第一阶段还没有产出时可以换', () => {
    const html = renderToStaticMarkup(<ChangeWorkflowButton enabled pending={false} onChange={() => undefined} />);
    expect(html).toContain('换一个');
    expect(html).not.toContain('disabled=""');
  });

  it('已经有产出之后按钮停用', () => {
    const html = renderToStaticMarkup(
      <ChangeWorkflowButton enabled={false} pending={false} onChange={() => undefined} />,
    );
    expect(html).toContain('换一个');
    expect(html).toContain('disabled=""');
  });
});
