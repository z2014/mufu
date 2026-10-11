import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { LAUNCH_AGENT_LABEL, launchAgentPlist } from './plist.js';

const exec = promisify(execFile);

type LaunchSpec = {
  program: string;
  args: string[];
  env: Record<string, string>;
};

export function shouldInstallLaunchAgent(packaged: boolean, platform: NodeJS.Platform): boolean {
  return packaged && platform === 'darwin';
}

/** Electron 当 Node 用，跑打包进去的守护进程。路径都是绝对路径。 */
export function packagedDaemonLaunch(execPath: string, resourcesPath: string): LaunchSpec {
  return {
    program: execPath,
    args: [join(resourcesPath, 'daemon.cjs')],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      MUFU_WORKFLOWS: join(resourcesPath, 'workflows'),
    },
  };
}

function launchAgentPlistPath(home: string): string {
  return join(home, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
}

/**
 * 写成用户级 LaunchAgent。只有 darwin 才调用 launchctl。
 * 先 bootout 再 bootstrap，这样重复打开会刷新 plist。
 */
export async function refreshLaunchAgent(input: {
  home: string;
  platform: NodeJS.Platform;
  program: string;
  args: string[];
  env: Record<string, string>;
  uid?: number;
  run?: (file: string, args: string[]) => Promise<void>;
}): Promise<{ plistPath: string }> {
  const plistPath = launchAgentPlistPath(input.home);
  mkdirSync(join(input.home, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(plistPath, launchAgentPlist(input.program, input.args, input.env), 'utf8');
  if (input.platform !== 'darwin') return { plistPath };
  const run =
    input.run ??
    (async (file, args) => {
      await exec(file, args);
    });
  const uid = input.uid ?? process.getuid?.() ?? 0;
  const domain = `gui/${uid}`;
  await run('launchctl', ['bootout', `${domain}/${LAUNCH_AGENT_LABEL}`]).catch(() => undefined);
  await run('launchctl', ['bootstrap', domain, plistPath]);
  return { plistPath };
}
