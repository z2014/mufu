import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundleDaemon } from './bundle-daemon.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 在 Linux 上打不出 mufu.app，也不去跑 electron-builder。
 * 真的 .app、双击、LaunchAgent 要在 Mac 上验证。
 */
function macBuildUnavailableMessage(platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') return null;
  return [
    `pnpm build:mac 只能在 macOS 上打出未签名的 mufu.app。当前是 ${platform}。`,
    '在 Mac 上：pnpm install && pnpm build:mac',
    '本机打出的 mufu.app 没有隔离属性，双击即可。下载的副本第一次要右键打开，或 xattr -dr com.apple.quarantine mufu.app',
  ].join('\n');
}

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

async function main(): Promise<void> {
  const blocked = macBuildUnavailableMessage(process.platform);
  if (blocked) {
    process.stderr.write(`${blocked}\n`);
    process.exit(1);
  }
  await run('pnpm', ['--filter', '@mufu/app', 'build']);
  await bundleDaemon(repoRoot);
  await run('pnpm', ['--filter', '@mufu/app', 'exec', 'electron-builder', '--mac', '--config', 'electron-builder.yml']);
  process.stdout.write('打好了：release/mac-universal/mufu.app（未签名）。\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
