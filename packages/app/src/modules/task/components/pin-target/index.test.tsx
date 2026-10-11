import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PinTarget, pinAnchor } from './index.tsx';

describe('PinTarget', () => {
  it('用事件 id 当锚点，高亮时带上标记', () => {
    const id = 'evt-message-1';
    const html = renderToStaticMarkup(
      <PinTarget messageId={id} highlighted>
        已修复
      </PinTarget>,
    );
    expect(pinAnchor(id)).toBe('msg-evt-message-1');
    expect(html).toContain('id="msg-evt-message-1"');
    expect(html).toContain('data-highlighted="true"');
    expect(html).toContain('bg-accent');
    expect(html).toContain('已修复');
  });

  it('没被点开时不高亮', () => {
    const html = renderToStaticMarkup(
      <PinTarget messageId="evt-2" highlighted={false}>
        已复现
      </PinTarget>,
    );
    expect(html).toContain('data-highlighted="false"');
    expect(html).not.toContain('bg-accent');
  });
});
