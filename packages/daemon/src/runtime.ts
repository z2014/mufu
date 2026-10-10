import { homedir } from 'node:os';
import { join } from 'node:path';

import { PRODUCT_NAME } from '@mufu/core';
import { DAEMON_WS_PORT, DEV_PORT } from '@mufu/schema';

/**
 * 守护进程实际要绑的端口。环境变量可以改它，但不能改成看板端口。
 * 不读 PORT，避免和 Vite 抢同一个数。
 */
export function resolveDaemonPort(env: Record<string, string | undefined>): number {
  const raw = env.MUFU_WS_PORT;
  const port = raw !== undefined && raw.length > 0 ? Number(raw) : DAEMON_WS_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`MUFU_WS_PORT 不是可用端口：${raw ?? ''}`);
  }
  if (port === DEV_PORT) {
    throw new Error(`MUFU_WS_PORT 不能是看板端口 ${DEV_PORT}。守护进程用 ${DAEMON_WS_PORT}，看板用 pnpm dev:app。`);
  }
  return port;
}

export function dataDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.MUFU_HOME) return env.MUFU_HOME;
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', PRODUCT_NAME);
  const xdg = env.XDG_DATA_HOME ?? join(home, '.local', 'share');
  return join(xdg, PRODUCT_NAME);
}

export function socketPath(dir: string = dataDir()): string {
  return join(dir, 'daemon.sock');
}
