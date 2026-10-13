import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { fixtureMessages } from '../jsonl.ts';
import { detectConfigKeySources, fileStamp } from '../env.ts';
import {
  approvalResult,
  classifyCodexError,
  isForeignThread,
  normalizeCodexNotification,
  subscriptionFromCodexAccount,
  threadParams,
  turnInterruptParams,
} from './protocol.ts';

const handwritten = fileURLToPath(new URL('../../../../fixtures/handwritten/codex.jsonl', import.meta.url));

describe('codex account', () => {
  it('只有 chatgpt 算订阅，空账号和 apiKey 都拒绝', () => {
    expect(
      subscriptionFromCodexAccount({ account: { type: 'chatgpt', planType: 'plus' }, requiresOpenaiAuth: true }).ok,
    ).toBe(true);
    const missing = subscriptionFromCodexAccount({ account: null, requiresOpenaiAuth: true });
    expect(missing.ok).toBe(false);
    const key = subscriptionFromCodexAccount({ account: { type: 'apiKey' }, requiresOpenaiAuth: true });
    expect(key.ok).toBe(false);
    if (!key.ok) expect(key.source).toContain('apiKey');
  });
});

describe('codex pitfalls from other apps', () => {
  it('没有 turnId 时不发 interrupt', () => {
    expect(turnInterruptParams('thr_1', null)).toBeNull();
    expect(turnInterruptParams('thr_1', 'turn_1')).toEqual({ threadId: 'thr_1', turnId: 'turn_1' });
  });

  it.each([undefined, 'thr_1'])('启动和恢复使用协议规定的审批与沙盒值：%s', (threadId) => {
    expect(threadParams({ threadId, cwd: '/work' })).toMatchObject({
      ...(threadId ? { threadId } : {}),
      cwd: '/work',
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    });
  });

  it('审批回复不是 null，也不是 denied', () => {
    expect(approvalResult('item/commandExecution/requestApproval', 'approve', {})).toEqual({ decision: 'accept' });
    expect(approvalResult('item/fileChange/requestApproval', 'reject', {})).toEqual({ decision: 'decline' });
    expect(approvalResult('execCommandApproval', 'approve', {})).toEqual({ decision: 'accept' });
    const elicitation = approvalResult('mcpServer/elicitation/request', 'approve', {});
    expect(elicitation).toEqual({ action: 'accept', content: {} });
    expect(elicitation).not.toBeNull();
  });

  it('别的 thread 的通知丢掉', () => {
    const foreign = {
      method: 'item/completed',
      params: { threadId: 'other', item: { type: 'agentMessage', text: 'nope' } },
    };
    expect(isForeignThread(foreign, 'thr_1')).toBe(true);
    expect(normalizeCodexNotification(foreign, 'thr_1')).toBeNull();
  });

  it('限流看 codexErrorInfo，不看正文里的 rate limit 三个词', () => {
    expect(classifyCodexError({ type: 'UsageLimitExceeded' }).kind).toBe('rate_limit');
    expect(classifyCodexError({ httpStatusCode: 401 }).kind).toBe('auth');
    expect(classifyCodexError({ type: 'Other' }).kind).toBe('task');
    const prose = normalizeCodexNotification(
      {
        method: 'item/completed',
        params: { threadId: 'thr_1', item: { type: 'agentMessage', text: 'the docs mention rate limit' } },
      },
      'thr_1',
    );
    expect(prose).toMatchObject({ type: 'message', author: 'codex', text: 'the docs mention rate limit' });
    expect(
      normalizeCodexNotification({ method: 'item/agentMessage/delta', params: { delta: 'hi' } }, null),
    ).toMatchObject({ type: 'message', author: 'codex', text: 'hi' });
  });

  it('手写夹具里审批可以早于 item/started，四种操作都能认出来', () => {
    const messages = fixtureMessages(handwritten);
    const methods = messages
      .filter((row) => typeof (row as { method?: string }).method === 'string')
      .map((row) => (row as { method: string }).method);
    const approvalAt = methods.indexOf('item/commandExecution/requestApproval');
    const startedAt = methods.indexOf('item/started');
    expect(approvalAt).toBeGreaterThanOrEqual(0);
    expect(startedAt).toBeGreaterThan(approvalAt);
    expect(methods).toEqual(
      expect.arrayContaining([
        'item/fileChange/requestApproval',
        'item/permissions/requestApproval',
        'mcpServer/elicitation/request',
        'execCommandApproval',
      ]),
    );
  });
});

describe('config files are only read', () => {
  it('发现 config.toml 里的 api_key 时不把值带回，也不改文件', () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-home-'));
    const codex = join(home, '.codex');
    const claude = join(home, '.claude');
    mkdirSync(codex, { recursive: true });
    mkdirSync(claude, { recursive: true });
    const configPath = join(codex, 'config.toml');
    writeFileSync(configPath, 'api_key = "sk-test-secret-value"\n');
    writeFileSync(join(claude, 'settings.json'), JSON.stringify({ apiKeyHelper: 'echo sk-helper-secret' }));
    const before = fileStamp(configPath);
    const found = detectConfigKeySources(home);
    const after = fileStamp(configPath);
    expect(after).toEqual(before);
    expect(JSON.stringify(found)).not.toContain('sk-test-secret-value');
    expect(JSON.stringify(found)).not.toContain('sk-helper-secret');
    expect(found.map((item) => item.key)).toEqual(expect.arrayContaining(['api_key', 'apiKeyHelper']));
    expect(readFileSync(configPath, 'utf8')).toContain('api_key');
  });
});
