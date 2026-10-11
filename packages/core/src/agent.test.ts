import { describe, expect, it } from 'vitest';

import { concreteAuthor } from './agent.ts';

describe('concreteAuthor', () => {
  it('写入事件前把显示名收成小写种类', () => {
    expect(concreteAuthor('Codex')).toBe('codex');
    expect(concreteAuthor('Claude')).toBe('claude');
    expect(concreteAuthor('codex')).toBe('codex');
    expect(concreteAuthor('claude')).toBe('claude');
    expect(concreteAuthor('lead')).toBe('lead');
    expect(concreteAuthor('你')).toBe('你');
  });
});
