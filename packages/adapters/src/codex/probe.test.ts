import { describe, expect, it } from 'vitest';

import { LineQueue } from '../line-queue.ts';
import { readCodexSubscription } from './probe.ts';
import type { CodexTransport } from './transport.ts';

function scripted(account: unknown) {
  const sent: string[] = [];
  const incoming = new LineQueue();
  const transport: CodexTransport = {
    argv: [],
    spawnEnv: {},
    incoming,
    send(line: string) {
      const message = JSON.parse(line) as { id?: number; method?: string };
      sent.push(message.method ?? '');
      if (message.method === 'initialize') {
        incoming.push(JSON.stringify({ id: message.id, result: { userAgent: 'test' } }));
      } else if (message.method === 'account/read') {
        incoming.push(JSON.stringify({ id: message.id, result: account }));
      }
    },
    close() {
      incoming.close();
    },
  };
  return { sent, transport };
}

describe('codex subscription probe', () => {
  it('chatgpt 账号算订阅，并且不会开 thread', async () => {
    const { sent, transport } = scripted({ account: { type: 'chatgpt' }, requiresOpenaiAuth: true });
    const verdict = await readCodexSubscription({ spawn: () => transport });
    expect(verdict).toEqual({ loggedIn: true, subscription: true, source: 'account.type=chatgpt' });
    expect(sent).toEqual(['initialize', 'initialized', 'account/read']);
  });

  it('有账号但不是 chatgpt 时算登录了，但不是订阅', async () => {
    const { transport } = scripted({ account: { type: 'apiKey' }, requiresOpenaiAuth: false });
    const verdict = await readCodexSubscription({ spawn: () => transport });
    expect(verdict.loggedIn).toBe(true);
    expect(verdict.subscription).toBe(false);
    expect(verdict.source).toContain('apiKey');
  });

  it('没有账号就不算登录', async () => {
    const { transport } = scripted({ account: null, requiresOpenaiAuth: true });
    const verdict = await readCodexSubscription({ spawn: () => transport });
    expect(verdict.loggedIn).toBe(false);
    expect(verdict.subscription).toBe(false);
  });
});
