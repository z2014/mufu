import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AgentStartupError } from '@mufu/core';

import { clearResolvedCli } from '../env.ts';
import { createClaudeAdapter } from './adapter.ts';
import type { ClaudeAccount } from './protocol.ts';

function shellThatPrints(dir: string, line: string, ok = true): string {
  const path = join(dir, 'shell');
  writeFileSync(path, `#!/bin/sh\n${ok ? `printf '%s\\n' ${JSON.stringify(line)}` : 'exit 1'}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe('claude adapter', () => {
  it.each([
    { subscriptionType: 'Claude Max', apiProvider: 'firstParty' },
    { apiKeySource: 'apiKeyHelper', apiProvider: 'firstParty' },
  ] satisfies ClaudeAccount[])('先核对 account，订阅才发送任务，之后才收到 system/init：%j', async (account) => {
    let checked = false;
    let sent = false;
    let closed = false;
    const adapter = createClaudeAdapter({
      bin: '/opt/bin/claude',
      query: ({ prompt }) => ({
        accountInfo: () => {
          checked = true;
          return Promise.resolve(account);
        },
        close: () => {
          closed = true;
        },
        async *[Symbol.asyncIterator]() {
          const first = await prompt[Symbol.asyncIterator]().next();
          if (first.done) return;
          expect(checked).toBe(true);
          sent = true;
          yield { type: 'system', subtype: 'init', apiKeySource: 'none', session_id: 'session-1' };
          yield { type: 'result', subtype: 'success' };
        },
      }),
    });
    const started = adapter.startSession({ taskId: 't', workspacePath: '/work', prompt: 'fix' });
    if (account.subscriptionType) {
      const session = await started;
      expect(session.sessionId).toBe('session-1');
      const events = [];
      for await (const event of session.events) events.push(event);
      expect(events).toEqual([{ type: 'completed', ok: true }]);
      expect(sent).toBe(true);
    } else {
      await expect(started).rejects.toMatchObject({ tool: 'claude', source: expect.stringContaining('apiKeyHelper') });
      expect(sent).toBe(false);
      expect(closed).toBe(true);
    }
  });

  it('把登录 shell 里的 claude 交给 pathToClaudeCodeExecutable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-claude-bin-'));
    const shell = shellThatPrints(dir, '/opt/bin/claude');
    let executable = '';
    const adapter = createClaudeAdapter({
      env: { SHELL: shell, HOME: dir, PATH: '/empty' },
      query: (params) => {
        executable = String(params.options.pathToClaudeCodeExecutable);
        throw new Error('Native CLI binary for darwin-arm64 not found');
      },
    });
    try {
      await expect(adapter.startSession({ taskId: 't', workspacePath: '/work', prompt: 'fix' })).rejects.toMatchObject({
        kind: 'cli_not_found',
        tool: 'claude',
        raw: 'Native CLI binary for darwin-arm64 not found',
      });
      expect(executable).toBe('/opt/bin/claude');
    } finally {
      clearResolvedCli();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('登录 shell 里没有 claude 时不启动 SDK', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-claude-miss-'));
    const shell = shellThatPrints(dir, '', false);
    let called = false;
    const adapter = createClaudeAdapter({
      env: { SHELL: shell, HOME: dir, PATH: '/empty' },
      query: () => {
        called = true;
        throw new Error('should not run');
      },
    });
    try {
      await expect(adapter.startSession({ taskId: 't', workspacePath: '/work', prompt: 'fix' })).rejects.toBeInstanceOf(
        AgentStartupError,
      );
      expect(called).toBe(false);
    } finally {
      clearResolvedCli();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
