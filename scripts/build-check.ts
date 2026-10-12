import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundleDaemon } from './bundle-daemon.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 退出 ${code ?? 1}`));
    });
  });
}

/**
 * Linux 上能做的打包：编译看板和 Electron 主进程，再把守护进程打成 CommonJS。
 * 不跑 electron-builder。mufu.app 仍要在 Mac 上用 `pnpm build:mac`。
 */
async function main(): Promise<void> {
  await run('pnpm', ['-r', '--if-present', 'build']);
  await bundleDaemon(repoRoot);
  process.stdout.write(
    'Linux 上的打包检查过了：看板、Electron 主进程、守护进程 CommonJS。mufu.app 仍要在 Mac 上用 pnpm build:mac。\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
