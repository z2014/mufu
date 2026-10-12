import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AgentStartupError } from '@mufu/core';

import { clearResolvedCli } from '../env.ts';
import { createClaudeAdapter } from './adapter.ts';

function shellThatPrints(dir: string, line: string, ok = true): string {
  const path = join(dir, 'shell');
  writeFileSync(path, `#!/bin/sh\n${ok ? `printf '%s\\n' ${JSON.stringify(line)}` : 'exit 1'}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe('claude adapter', () => {
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
