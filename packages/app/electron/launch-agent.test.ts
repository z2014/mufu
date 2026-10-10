import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LAUNCH_AGENT_LABEL } from '@mufu/core';
import { launchAgentPlist } from './plist.ts';

import { packagedDaemonLaunch, refreshLaunchAgent, shouldInstallLaunchAgent } from './launch-agent.ts';

describe('launch agent', () => {
  it('plist 带产品名、绝对路径参数，并且转义环境变量', () => {
    const env = { ELECTRON_RUN_AS_NODE: '1', MUFU_WORKFLOWS: '/Applications/mufu.app/Contents/Resources/workflows' };
    const text = launchAgentPlist('/bin/mufu', ['/abs/daemon.cjs'], env);
    expect(text).toContain(LAUNCH_AGENT_LABEL);
    expect(text).toContain('<string>/bin/mufu</string>');
    expect(text).toContain('<string>/abs/daemon.cjs</string>');
    expect(text).toContain('ELECTRON_RUN_AS_NODE');
    expect(text).toContain('MUFU_WORKFLOWS');
    expect(text).not.toContain('LaunchDaemons');
    const escaped = launchAgentPlist('/bin/mufu', ['a&b'], { 'X"Y': '1<2' });
    expect(escaped).toContain('a&amp;b');
    expect(escaped).toContain('X&quot;Y');
    expect(escaped).toContain('1&lt;2');
  });

  it('只有打好的 macOS 应用才安装', () => {
    expect(shouldInstallLaunchAgent(true, 'darwin')).toBe(true);
    expect(shouldInstallLaunchAgent(false, 'darwin')).toBe(false);
    expect(shouldInstallLaunchAgent(true, 'linux')).toBe(false);
  });

  it('plist 用绝对路径，并且不是 LaunchDaemon', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-agent-'));
    const calls: string[][] = [];
    try {
      const launch = packagedDaemonLaunch(
        '/Applications/mufu.app/Contents/MacOS/mufu',
        '/Applications/mufu.app/Contents/Resources',
      );
      const { plistPath } = await refreshLaunchAgent({
        home,
        platform: 'darwin',
        program: launch.program,
        args: launch.args,
        env: launch.env,
        uid: 501,
        run: async (_file, args) => {
          calls.push(args);
        },
      });
      const text = readFileSync(plistPath, 'utf8');
      expect(plistPath).toBe(join(home, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`));
      expect(text).toContain(LAUNCH_AGENT_LABEL);
      expect(text).toContain('/Applications/mufu.app/Contents/MacOS/mufu');
      expect(text).toContain('/Applications/mufu.app/Contents/Resources/daemon.cjs');
      expect(text).toContain('ELECTRON_RUN_AS_NODE');
      expect(text).toContain('MUFU_WORKFLOWS');
      expect(text).not.toContain('LaunchDaemon');
      expect(calls[0]).toEqual(['bootout', `gui/501/${LAUNCH_AGENT_LABEL}`]);
      expect(calls[1]?.[0]).toBe('bootstrap');
      expect(calls[1]?.[2]).toBe(plistPath);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('不是 darwin 时只写文件，不调用 launchctl', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-agent-linux-'));
    let called = false;
    try {
      await refreshLaunchAgent({
        home,
        platform: 'linux',
        program: '/usr/bin/node',
        args: ['/opt/daemon.cjs'],
        env: {},
        run: async () => {
          called = true;
        },
      });
      expect(called).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
