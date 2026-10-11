import { describe, expect, it } from 'vitest';

import { agentIdentity } from './index.ts';

describe('agentIdentity', () => {
  it('把 codex 和 claude 映成全名和能区分的缩写', () => {
    expect(agentIdentity('codex')).toEqual({ displayName: 'Codex', initials: 'Cx' });
    expect(agentIdentity('claude')).toEqual({ displayName: 'Claude', initials: 'Cl' });
  });
});
