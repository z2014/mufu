import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { clearResolvedCli } from '@mufu/adapters';

import { checkWorkdir } from './workspace.ts';

const exec = promisify(execFile);

function loginShell(dir: string, git: string, found: boolean): string {
  const shell = join(dir, 'shell');
  const calls = join(dir, 'calls');
  const body = found
    ? `#!/bin/sh
printf '%s\\n' "$2" >> ${JSON.stringify(calls)}
name=\${2##* }
if [ "$name" = git ]; then printf '%s\\n' ${JSON.stringify(git)}; exit 0; fi
exit 1
`
    : `#!/bin/sh
printf '%s\\n' "$2" >> ${JSON.stringify(calls)}
exit 1
`;
  writeFileSync(shell, body);
  chmodSync(shell, 0o755);
  return shell;
}

function fakeGit(dir: string, inside: boolean): string {
  const git = join(dir, 'git');
  writeFileSync(git, inside ? '#!/bin/sh\necho true\n' : '#!/bin/sh\necho false\nexit 1\n');
  chmodSync(git, 0o755);
  return git;
}

describe('工作目录', () => {
  it('PATH 很短时仍用登录 shell 里的 git，并在本进程里记住', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-git-'));
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const git = fakeGit(dir, true);
    const shell = loginShell(dir, git, true);
    const env = { SHELL: shell, HOME: dir, PATH: '/usr/bin:/bin' };
    try {
      await expect(checkWorkdir(repo, env)).resolves.toBe(repo);
      await expect(checkWorkdir(repo, env)).resolves.toBe(repo);
      const lines = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
    } finally {
      clearResolvedCli();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('空 PATH 也能用登录 shell 里的 git，换了 HOME 就重新找', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-git-empty-path-'));
    const git = fakeGit(dir, true);
    const shell = loginShell(dir, git, true);
    const env = { SHELL: shell, HOME: dir, PATH: '/empty' };
    try {
      await expect(checkWorkdir(dir, env)).resolves.toBe(dir);
      await expect(checkWorkdir(dir, env)).resolves.toBe(dir);
      const lines = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
      writeFileSync(shell, '#!/bin/sh\nexit 1\n');
      const missing = { SHELL: shell, HOME: join(dir, 'other'), PATH: '/empty' };
      await expect(checkWorkdir(dir, missing)).rejects.toThrow('找不到本机的 git');
    } finally {
      clearResolvedCli();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('登录 shell 找不到 git 时，即使本机 PATH 上有 git 也说明找不到', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-git-missing-'));
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const env = {
      ...process.env,
      SHELL: loginShell(dir, join(dir, 'git'), false),
      HOME: dir,
    };
    try {
      await exec('git', ['init'], { cwd: repo, env });
      await expect(checkWorkdir(repo, env)).rejects.toThrow('找不到本机的 git');
    } finally {
      clearResolvedCli();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('目录不存在', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-git-absent-'));
    const git = fakeGit(dir, true);
    const env = { SHELL: loginShell(dir, git, true), HOME: dir, PATH: '/usr/bin:/bin' };
    try {
      await expect(checkWorkdir(join(dir, 'nope'), env)).rejects.toThrow('这个目录不存在');
    } finally {
      clearResolvedCli();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('目录在，但不是 git 仓库', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-git-plain-'));
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const git = fakeGit(dir, false);
    const env = { SHELL: loginShell(dir, git, true), HOME: dir, PATH: '/usr/bin:/bin' };
    try {
      await expect(checkWorkdir(repo, env)).rejects.toThrow('这个目录不是 git 仓库');
    } finally {
      clearResolvedCli();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('展开 ~', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-git-tilde-'));
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const git = fakeGit(dir, true);
    const env = { SHELL: loginShell(dir, git, true), HOME: dir, PATH: '/usr/bin:/bin' };
    try {
      await expect(checkWorkdir('~/repo', env)).resolves.toBe(repo);
    } finally {
      clearResolvedCli();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
