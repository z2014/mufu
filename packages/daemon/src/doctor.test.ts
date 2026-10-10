import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('二进制不存在时每一项都给修复提示，并且不调用探针', async () => {
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
      expect(codex?.installed).toBe(false);
      expect(codex?.items.every((item) => item.ok === false && item.fix)).toBe(true);
      expect(codex?.items.find((item) => item.name === 'logged_in')?.fix).toBe('运行 codex login');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
