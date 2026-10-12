import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

import { platformSdkHits, removePlatformSdkPackages } from './platform-sdk.ts';

/** 和 `pnpm build:mac` 同一条：把守护进程打成 CommonJS，给 Electron 当 Node 跑。 */
export async function bundleDaemon(repoRoot: string): Promise<void> {
  const resources = join(repoRoot, 'packages/app/resources');
  mkdirSync(resources, { recursive: true });
  const esbuild = await import('esbuild');
  const built = await esbuild.build({
    entryPoints: [join(repoRoot, 'packages/daemon/src/bin.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: join(resources, 'daemon.cjs'),
    external: ['@anthropic-ai/claude-agent-sdk'],
  });
  const broken = built.warnings.filter(
    (warning) => warning.id === 'empty-import-meta' || warning.text.includes('Top-level await'),
  );
  if (broken.length > 0) {
    throw new Error(`守护进程打成 CommonJS 失败：\n${broken.map((warning) => warning.text).join('\n')}`);
  }
  const workflows = join(resources, 'workflows');
  rmSync(workflows, { recursive: true, force: true });
  cpSync(join(repoRoot, 'packages/daemon/workflows'), workflows, { recursive: true });
  const require = createRequire(join(repoRoot, 'packages/adapters/package.json'));
  const sdkEntry = require.resolve('@anthropic-ai/claude-agent-sdk');
  const sdkDest = join(resources, 'node_modules/@anthropic-ai/claude-agent-sdk');
  rmSync(join(resources, 'node_modules'), { recursive: true, force: true });
  mkdirSync(dirname(sdkDest), { recursive: true });
  cpSync(dirname(sdkEntry), sdkDest, {
    recursive: true,
    filter: (source) => platformSdkHits([basename(source)]).length === 0,
  });
  removePlatformSdkPackages(join(resources, 'node_modules'));
}
