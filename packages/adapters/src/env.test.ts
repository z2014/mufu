import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AgentStartupError } from '@mufu/core';

import { clearResolvedCli, localCli, resolveCli } from './env.ts';

function fakeShell(dir: string, body: string): string {
  const path = join(dir, 'shell');
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

describe('resolveCli', () => {
  it('记住登录 shell 给出的绝对路径，相对路径当成没有', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-cli-'));
    const calls = join(dir, 'calls');
    const shell = fakeShell(
      dir,
      `#!/bin/sh
printf '%s\\n' "$2" >> ${JSON.stringify(calls)}
name=\${2##* }
case "$name" in
  claude) printf '%s\\n' '/opt/bin/claude' ;;
  git) printf '%s\\n' 'git' ;;
  *) exit 1 ;;
esac
`,
    );
    const env = { SHELL: shell, HOME: dir, PATH: '/empty' };
    try {
      expect(await resolveCli('claude', env)).toBe('/opt/bin/claude');
      expect(await resolveCli('claude', env)).toBe('/opt/bin/claude');
      expect(await resolveCli('git', env)).toBeNull();
      expect(await resolveCli('codex', env)).toBeNull();
      const lines = (await import('node:fs')).readFileSync(calls, 'utf8').trim().split('\n');
      expect(lines.filter((line) => line.includes('claude'))).toHaveLength(1);
      await expect(localCli('codex', undefined, env)).rejects.toMatchObject({
        kind: 'cli_not_found',
        tool: 'codex',
      });
      await expect(localCli('codex', undefined, env)).rejects.toBeInstanceOf(AgentStartupError);
      expect(await localCli('claude', '/usr/bin/claude', env)).toBe('/usr/bin/claude');
    } finally {
      clearResolvedCli();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
