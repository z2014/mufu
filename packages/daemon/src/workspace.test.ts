import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { clearResolvedCli } from '@mufu/adapters';

import { checkWorkdir } from './workspace.ts';

describe('工作目录', () => {
  it('用登录 shell 解析出的 git，并在本进程里记住', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-git-'));
    const calls = join(dir, 'calls');
    const git = join(dir, 'git');
    writeFileSync(git, '#!/bin/sh\nif [ "$1" = rev-parse ]; then echo true; exit 0; fi\nexit 1\n');
    chmodSync(git, 0o755);
    const shell = join(dir, 'shell');
    writeFileSync(
      shell,
      `#!/bin/sh
printf '%s\\n' "$2" >> ${JSON.stringify(calls)}
name=\${2##* }
if [ "$name" = git ]; then printf '%s\\n' ${JSON.stringify(git)}; exit 0; fi
exit 1
`,
    );
    chmodSync(shell, 0o755);
    const env = { SHELL: shell, HOME: dir, PATH: '/empty' };
    try {
      await expect(checkWorkdir(dir, env)).resolves.toBeUndefined();
      await expect(checkWorkdir(dir, env)).resolves.toBeUndefined();
      const lines = (await import('node:fs')).readFileSync(calls, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
      const missing = { SHELL: shell, HOME: join(dir, 'other'), PATH: '/empty' };
      writeFileSync(shell, '#!/bin/sh\nexit 1\n');
      await expect(checkWorkdir(dir, missing)).rejects.toThrow('找不到本机的 git');
    } finally {
      clearResolvedCli();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
