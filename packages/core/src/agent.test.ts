import { describe, expect, it } from 'vitest';

import { concreteAuthor } from './agent.ts';

describe('concreteAuthor', () => {
  it('不把大写显示名改成小写', () => {
    expect(concreteAuthor('Codex')).toBe('Codex');
    expect(concreteAuthor('Claude')).toBe('Claude');
    expect(concreteAuthor('codex')).toBe('codex');
    expect(concreteAuthor('claude')).toBe('claude');
    expect(concreteAuthor('lead')).toBe('lead');
    expect(concreteAuthor('你')).toBe('你');
  });
});
