import { describe, expect, it } from 'vitest';

import { AgentStartupError } from '@mufu/core';

import { classifyLaunchError, kindFromLaunchText } from './startup.ts';

describe('启动失败分类', () => {
  it('SDK 找不到平台二进制时是 cli_not_found，原文留在 raw', () => {
    const raw = 'Native CLI binary for darwin-arm64 not found';
    const error = classifyLaunchError('claude', new Error(raw));
    expect(error).toBeInstanceOf(AgentStartupError);
    expect(error.kind).toBe('cli_not_found');
    expect(error.tool).toBe('claude');
    expect(error.raw).toBe(raw);
    expect(error.message).toBe(raw);
  });

  it('登录、限流、断网和其余失败各归一类', () => {
    expect(kindFromLaunchText('not logged in')).toBe('not_logged_in');
    expect(kindFromLaunchText('please run /login')).toBe('not_logged_in');
    expect(kindFromLaunchText('429')).toBe('rate_limit');
    expect(kindFromLaunchText('connect ETIMEDOUT')).toBe('network');
    expect(kindFromLaunchText('missing rollout')).toBe('launch_failed');
  });

  it('已经分好类的错误不再改写', () => {
    const error = new AgentStartupError('not_logged_in', 'codex', 'account=null');
    expect(classifyLaunchError('claude', error)).toBe(error);
  });
});
