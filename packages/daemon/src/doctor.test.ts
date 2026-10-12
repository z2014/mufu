import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { clearResolvedCli } from '@mufu/adapters';

import { doctor } from './doctor.ts';

describe('doctor', () => {
  it('报告订阅结论和被忽略的环境变量名，不带值', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-doctor-'));
    const secret = 'sk-should-not-appear';
    try {
      const report = await doctor({
        userHome: home,
        env: {
          PATH: process.env.PATH,
          SHELL: process.env.SHELL ?? 'bash',
          ANTHROPIC_API_KEY: secret,
          OPENAI_API_KEY: '',
        },
        which: async (name) => `/usr/local/bin/${name}`,
        ghAuth: async () => true,
        probe: {
          codex: async () => ({ loggedIn: true, subscription: true, source: 'account.type=chatgpt' }),
          claude: async () => ({ loggedIn: true, subscription: false, source: 'apiKeySource=apiKey' }),
        },
      });
      const codex = report.tools.find((tool) => tool.name === 'codex');
      const claude = report.tools.find((tool) => tool.name === 'claude');
      const gh = report.tools.find((tool) => tool.name === 'gh');
      expect(codex?.items.find((item) => item.name === 'subscription')?.fix).toBeNull();
      expect(claude?.items.find((item) => item.name === 'subscription')?.fix).toContain('/login');
      expect(gh?.items.some((item) => item.name === 'subscription')).toBe(false);
      expect(report.ignoredEnvKeys).toEqual(['ANTHROPIC_API_KEY']);
      expect(JSON.stringify(report)).not.toContain(secret);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('没装上时登录和订阅记为跳过，并给出官方安装命令', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-doctor-miss-'));
    writeFileSync(join(home, 'marker'), 'x');
    let probed = false;
    try {
      const report = await doctor({
        userHome: home,
        env: { PATH: '', SHELL: 'bash' },
        which: async () => null,
        probe: {
          codex: async () => {
            probed = true;
            return { loggedIn: true, subscription: true, source: 'nope' };
          },
          claude: async () => {
            probed = true;
            return { loggedIn: true, subscription: true, source: 'nope' };
          },
        },
      });
      expect(probed).toBe(false);
      const codex = report.tools.find((tool) => tool.name === 'codex');
      const claude = report.tools.find((tool) => tool.name === 'claude');
      const gh = report.tools.find((tool) => tool.name === 'gh');
      expect(codex?.installed).toBe(false);
      expect(codex?.items.find((item) => item.name === 'installed')).toMatchObject({
        status: 'failed',
        fix: 'npm install -g @openai/codex',
      });
      expect(codex?.items.find((item) => item.name === 'logged_in')?.status).toBe('skipped');
      expect(codex?.items.find((item) => item.name === 'subscription')).toMatchObject({
        status: 'skipped',
        dependsOn: 'logged_in',
        fix: null,
      });
      expect(claude?.items.find((item) => item.name === 'installed')?.fix).toBe(
        'curl -fsSL https://claude.ai/install.sh | bash',
      );
      expect(gh?.items.find((item) => item.name === 'installed')?.fix).toBe('brew install gh');
      expect(gh?.items.find((item) => item.name === 'logged_in')?.status).toBe('skipped');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('装上了但没登录时，订阅检查跳过，不再重复登录提示', async () => {
    const report = await doctor({
      userHome: tmpdir(),
      env: { PATH: '', SHELL: 'bash' },
      which: async (name) => `/usr/local/bin/${name}`,
      ghAuth: async () => false,
      probe: {
        codex: async () => ({ loggedIn: false, subscription: false, source: '未登录' }),
        claude: async () => ({ loggedIn: false, subscription: false, source: '未登录' }),
      },
    });
    const codex = report.tools.find((tool) => tool.name === 'codex');
    expect(codex?.items.find((item) => item.name === 'installed')?.status).toBe('ok');
    expect(codex?.items.find((item) => item.name === 'logged_in')).toMatchObject({
      status: 'failed',
      fix: '运行 codex login',
    });
    expect(codex?.items.find((item) => item.name === 'subscription')?.status).toBe('skipped');
    expect(codex?.items.find((item) => item.name === 'subscription')?.fix).toBeNull();
  });

  it('默认用登录 shell 解析 codex、claude、gh', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-doctor-path-'));
    const shell = join(dir, 'shell');
    writeFileSync(
      shell,
      `#!/bin/sh
name=\${2##* }
printf '%s\\n' "/opt/bin/$name"
`,
    );
    chmodSync(shell, 0o755);
    try {
      const report = await doctor({
        userHome: dir,
        env: { SHELL: shell, HOME: dir, PATH: '/empty' },
        ghAuth: async () => true,
        probe: {
          codex: async (bin) => {
            expect(bin).toBe('/opt/bin/codex');
            return { loggedIn: true, subscription: true, source: 'account.type=chatgpt' };
          },
          claude: async (bin) => {
            expect(bin).toBe('/opt/bin/claude');
            return { loggedIn: true, subscription: true, source: 'apiKeySource=none' };
          },
        },
      });
      expect(report.tools.find((tool) => tool.name === 'gh')?.path).toBe('/opt/bin/gh');
    } finally {
      clearResolvedCli();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
