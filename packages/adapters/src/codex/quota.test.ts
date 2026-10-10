import { describe, expect, it } from 'vitest';

import { classifyCodexQuotaWindow } from './quota.ts';

describe('quota windows', () => {
  it('每周额度放在 primary 时仍按秒数认成 weekly', () => {
    expect(classifyCodexQuotaWindow({ seconds: 604800 })).toBe('weekly');
    expect(classifyCodexQuotaWindow({ minutes: 10080 })).toBe('weekly');
    expect(classifyCodexQuotaWindow({ seconds: 18000 })).toBe('session');
    expect(classifyCodexQuotaWindow({})).toBe('unknown');
  });
});
