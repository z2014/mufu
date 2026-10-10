import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    '第一次打开未签名的包：右键 mufu.app → 打开，或 xattr -dr com.apple.quarantine /path/to/mufu.app',
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

async function bundleDaemon(): Promise<void> {
  const resources = join(repoRoot, 'packages/app/resources');
  mkdirSync(resources, { recursive: true });
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [join(repoRoot, 'packages/daemon/src/bin.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: join(resources, 'daemon.cjs'),
    external: ['@anthropic-ai/claude-agent-sdk'],
  });
  const workflows = join(resources, 'workflows');
  rmSync(workflows, { recursive: true, force: true });
  cpSync(join(repoRoot, 'packages/daemon/workflows'), workflows, { recursive: true });
  const require = createRequire(join(repoRoot, 'packages/adapters/package.json'));
  const sdkJson = require.resolve('@anthropic-ai/claude-agent-sdk/package.json');
  const sdkDest = join(resources, 'node_modules/@anthropic-ai/claude-agent-sdk');
  rmSync(join(resources, 'node_modules'), { recursive: true, force: true });
  mkdirSync(dirname(sdkDest), { recursive: true });
  cpSync(dirname(sdkJson), sdkDest, { recursive: true });
}

async function main(): Promise<void> {
  const blocked = macBuildUnavailableMessage(process.platform);
  if (blocked) {
    process.stderr.write(`${blocked}\n`);
    process.exit(1);
  }
  await run('pnpm', ['--filter', '@mufu/app', 'build']);
  await bundleDaemon();
  await run('pnpm', ['--filter', '@mufu/app', 'exec', 'electron-builder', '--mac', '--config', 'electron-builder.yml']);
  process.stdout.write('打好了：release/mac-universal/mufu.app（未签名）。\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
