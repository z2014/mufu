import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { fixtureMarker, fixtureMessages } from './jsonl.ts';
import { normalizeClaudeMessage, subscriptionFromClaudeInit } from './claude/protocol.ts';
import { normalizeCodexNotification, subscriptionFromCodexAccount, type CodexAccountRead } from './codex/protocol.ts';

const root = new URL('../../../fixtures/', import.meta.url);

function dir(name: string): string {
  return new URL(name, root).pathname;
}

function threadIdFrom(messages: unknown[]): string | null {
  for (const row of messages) {
    const id = (row as { result?: { thread?: { id?: string } } }).result?.thread?.id;
    if (typeof id === 'string') return id;
  }
  return null;
}

function assertCodex(path: string): void {
  const marker = fixtureMarker(path);
  expect(marker?.protocol).toBe('codex-app-server');
  const messages = fixtureMessages(path);
  expect(messages.length).toBeGreaterThan(0);
  const account = messages.find((row) => {
    const { result } = row as { result?: CodexAccountRead };
    return result !== undefined && result !== null && 'account' in result;
  }) as { result?: CodexAccountRead } | undefined;
  if (account?.result) expect(subscriptionFromCodexAccount(account.result).ok).toBe(true);
  const threadId = threadIdFrom(messages);
  const events = messages
    .filter((row) => typeof (row as { method?: string }).method === 'string')
    .map((row) => normalizeCodexNotification(row as Record<string, unknown>, threadId));
  expect(events.some((event) => event !== null) || messages.length > 0).toBe(true);
}

function assertClaude(path: string): void {
  const marker = fixtureMarker(path);
  expect(marker?.protocol).toBe('claude-agent-sdk');
  const messages = fixtureMessages(path);
  expect(messages.length).toBeGreaterThan(0);
  const init = messages.find((row) => (row as { type?: string; subtype?: string }).type === 'system') as
    { apiKeySource?: string } | undefined;
  if (init?.apiKeySource) expect(subscriptionFromClaudeInit(init.apiKeySource).ok).toBe(true);
  const events = messages.map((message) => normalizeClaudeMessage(message));
  expect(events.length).toBe(messages.length);
}

describe('handwritten fixtures', () => {
  it('codex', () => {
    assertCodex(join(dir('handwritten/'), 'codex.jsonl'));
  });

  it('claude', () => {
    assertClaude(join(dir('handwritten/'), 'claude.jsonl'));
  });
});

describe('recorded fixtures', () => {
  const required = process.env.MUFU_REQUIRE_RECORDED === '1';
  const files = existsSync(dir('recorded/'))
    ? readdirSync(dir('recorded/')).filter((name) => name.endsWith('.jsonl'))
    : [];

  if (!required && files.length === 0) {
    it('还没有录音，路径不算验证过', () => {
      expect(files).toEqual([]);
    });
  } else {
    it('codex 录音能被同一套解析器读完', () => {
      const path = join(dir('recorded/'), 'codex.jsonl');
      expect(existsSync(path), 'fixtures/recorded/codex.jsonl 不存在').toBe(true);
      assertCodex(path);
    });

    it('claude 录音能被同一套解析器读完', () => {
      const path = join(dir('recorded/'), 'claude.jsonl');
      expect(existsSync(path), 'fixtures/recorded/claude.jsonl 不存在').toBe(true);
      assertClaude(path);
    });
  }
});
