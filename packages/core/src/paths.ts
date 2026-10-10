import { homedir } from 'node:os';
import { join } from 'node:path';

import { PRODUCT_NAME } from './product.ts';

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
