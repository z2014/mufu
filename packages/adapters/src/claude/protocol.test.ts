import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { fixtureMarker, fixtureMessages } from '../jsonl.ts';
import { buildClaudeLaunchOptions } from './options.ts';
import {
  claudeCliFallbackArgs,
  createPromptGate,
  normalizeClaudeMessage,
  subscriptionFromClaudeAccount,
  subscriptionFromClaudeInit,
} from './protocol.ts';

const handwritten = fileURLToPath(new URL('../../../../fixtures/handwritten/claude.jsonl', import.meta.url));

describe('claude subscription gate', () => {
  it('initialize account 只放行第一方订阅，API key 和缺失字段仍拒绝', () => {
    const subscribed = { subscriptionType: 'Claude Max', apiProvider: 'firstParty' };
    expect(subscriptionFromClaudeAccount(subscribed).ok).toBe(true);
    for (const account of [
      {},
      { apiKeySource: 'none', apiProvider: 'firstParty' },
      { ...subscribed, apiProvider: 'bedrock' },
      { ...subscribed, subscriptionType: 'Claude Console' },
      { ...subscribed, apiKeySource: 'apiKeyHelper' },
      { ...subscribed, apiKeySource: 'ANTHROPIC_API_KEY' },
      { ...subscribed, apiKeySource: '/login managed key' },
    ]) {
      expect(subscriptionFromClaudeAccount(account).ok).toBe(false);
    }
  });

  it('只有 apiKeySource=none 放行', () => {
    expect(subscriptionFromClaudeInit('none').ok).toBe(true);
    for (const source of ['ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key', 'oauth', undefined]) {
      const result = subscriptionFromClaudeInit(source);
      expect(result.ok).toBe(false);
    }
  });

  it('提示在 allow 之前不会从迭代器里出来', async () => {
    const gate = createPromptGate('修这个 bug');
    const iterator = gate.iterable[Symbol.asyncIterator]();
    let settled = false;
    const pending = iterator.next().then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    gate.allow();
    const first = await pending;
    expect(first.value?.message.content).toBe('修这个 bug');
  });

  it('block 之后迭代器为空', async () => {
    const gate = createPromptGate('不要发送');
    const iterator = gate.iterable[Symbol.asyncIterator]();
    gate.block();
    const first = await iterator.next();
    expect(first.done).toBe(true);
  });
});

describe('claude launch options', () => {
  it('不放行全部工具，恢复不 fork，entrypoint 默认 cli，key 被剥掉', () => {
    const options = buildClaudeLaunchOptions({
      cwd: '/work',
      bin: '/usr/local/bin/claude',
      resumeSessionId: 'sess-1',
      env: { ANTHROPIC_API_KEY: 'sk-nope', ANTHROPIC_AUTH_TOKEN: 'tok', PATH: '/usr/bin' },
    });
    expect(options.permissionMode).toBe('default');
    expect(options).not.toHaveProperty('allowedTools');
    expect(options.settings).toEqual({ forceLoginMethod: 'claudeai' });
    expect(options.resume).toBe('sess-1');
    expect(options).not.toHaveProperty('forkSession');
    expect(options.pathToClaudeCodeExecutable).toBe('/usr/local/bin/claude');
    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(options.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(options.env.CLAUDE_CODE_ENTRYPOINT).toBe('cli');
    expect(options.hooks.PreToolUse[0]?.hooks).toHaveLength(1);
  });

  it('用户自己设了 entrypoint 就不覆盖', () => {
    const options = buildClaudeLaunchOptions({ cwd: '/work', env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' } });
    expect(options.env.CLAUDE_CODE_ENTRYPOINT).toBe('sdk-ts');
  });
});

describe('claude stream', () => {
  it('回放消息丢掉；限流只有 rejected 才算环境失败；正文里的 rate limit 仍是消息', () => {
    expect(
      normalizeClaudeMessage({ type: 'user', isReplay: true, message: { role: 'user', content: 'old' } }),
    ).toBeNull();
    expect(
      normalizeClaudeMessage({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } }),
    ).toBeNull();
    expect(
      normalizeClaudeMessage({
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' },
      }),
    ).toMatchObject({
      type: 'environment_failure',
      failure: 'rate_limit',
    });
    expect(
      normalizeClaudeMessage({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'docs say rate limit' }] },
      }),
    ).toMatchObject({
      type: 'message',
      author: 'claude',
      text: 'docs say rate limit',
    });
  });

  it('手写流里的 can_use_tool 覆盖 shell、改文件、网络和 MCP', () => {
    const marker = fixtureMarker(handwritten);
    expect(marker?.origin).toBe('handwritten');
    const events = fixtureMessages(handwritten)
      .map((message) => normalizeClaudeMessage(message))
      .filter(Boolean);
    const approvals = events.filter((event) => event?.type === 'approval_request');
    expect(approvals.map((event) => (event?.type === 'approval_request' ? event.operation : ''))).toEqual([
      'shell',
      'file_edit',
      'network',
      'mcp',
    ]);
  });

  it('CLI 退路使用 stream-json 和 permission-prompt-tool', () => {
    expect(claudeCliFallbackArgs('probe', 'mcp_auth_tool')).toEqual([
      '-p',
      '--verbose',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--permission-prompt-tool',
      'mcp_auth_tool',
      '--permission-mode',
      'default',
      'probe',
    ]);
  });
});
