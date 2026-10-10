import { connect } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { OPENROUTER_ACCOUNT } from '@mufu/core';

import { startDaemon } from './daemon.ts';
import { socketPath } from './runtime.ts';
import { createMemorySecretStore } from './secrets.ts';

const repoRoot = new URL('../../../', import.meta.url).pathname;

function call(home: string, method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath(home));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', reject);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id: 1, method, params })}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      socket.end();
      const parsed = JSON.parse(buffer.split('\n')[0] ?? '{}') as { result?: unknown; error?: { message: string } };
      if (parsed.error) reject(new Error(parsed.error.message));
      else resolve(parsed.result);
    });
  });
}

describe('openrouter secret rpc', () => {
  it('只告诉有没有，不把值返回来', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-secret-'));
    const secret = 'sk-openrouter-test';
    const daemon = await startDaemon({
      home,
      socketPath: socketPath(home),
      wsPort: 0,
      workflowsDir: join(repoRoot, 'packages/daemon/workflows'),
      fixturePath: join(repoRoot, 'fixtures/handwritten/fix-bug.fake.jsonl'),
      useFixture: true,
      secrets: createMemorySecretStore(),
    });
    try {
      expect(await call(home, 'secret.status')).toEqual({ openrouter: false });
      const set = await call(home, 'secret.set', { account: OPENROUTER_ACCOUNT, value: secret });
      expect(set).toEqual({ account: OPENROUTER_ACCOUNT, set: true });
      expect(JSON.stringify(set)).not.toContain(secret);
      expect(await call(home, 'secret.status')).toEqual({ openrouter: true });
      expect(await call(home, 'secret.remove', { account: OPENROUTER_ACCOUNT })).toEqual({
        account: OPENROUTER_ACCOUNT,
        set: false,
      });
      expect(await call(home, 'secret.status')).toEqual({ openrouter: false });
      await expect(call(home, 'secret.set', { account: 'codex', value: secret })).rejects.toThrow(/openrouter/);
    } finally {
      await daemon.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
