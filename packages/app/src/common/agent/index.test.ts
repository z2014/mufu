import { describe, expect, it } from 'vitest';

import { agentIdentity, agentLabel } from './index.ts';

describe('agentIdentity', () => {
  it('把 codex 和 claude 映成全名和能区分的缩写', () => {
    expect(agentIdentity('codex')).toEqual({ displayName: 'Codex', initials: 'Cx' });
    expect(agentIdentity('claude')).toEqual({ displayName: 'Claude', initials: 'Cl' });
  });

  it('只把小写种类映成显示名', () => {
    expect(agentLabel('codex')).toBe('Codex');
    expect(agentLabel('claude')).toBe('Claude');
    expect(agentLabel('Codex')).toBeNull();
    expect(agentLabel('Claude')).toBeNull();
    expect(agentLabel('lead')).toBeNull();
  });
});
