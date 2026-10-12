import { spawn } from 'node:child_process';
import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Claude Agent SDK 按平台拆出的可选包。包里不带这些二进制，改用本机 claude。 */
const PLATFORM_SDK = /claude-agent-sdk-(?:darwin|linux|win32|android)-[a-z0-9]+/;

export function platformSdkHits(entries: readonly string[]): string[] {
  return entries.filter((entry) => PLATFORM_SDK.test(entry.replaceAll('\\', '/')));
}

export function packagedPaths(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      found.push(path);
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      walk(path);
    }
  };
  walk(root);
  return found;
}

/** 拷进 resources 之后删掉平台包，避免打进 .app。 */
export function removePlatformSdkPackages(root: string): string[] {
  const removed: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      if (PLATFORM_SDK.test(name)) {
        rmSync(path, { recursive: true, force: true });
        removed.push(path);
        continue;
      }
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      walk(path);
    }
  };
  walk(root);
  return removed;
}

function asarCli(repoRoot: string): string {
  const fromApp = createRequire(join(repoRoot, 'packages/app/package.json'));
  const builderJson = fromApp.resolve('electron-builder/package.json');
  const appBuilderJson = createRequire(builderJson).resolve('app-builder-lib/package.json');
  const asarJson = createRequire(appBuilderJson).resolve('@electron/asar/package.json');
  return join(dirname(asarJson), 'bin/asar.js');
}

function outputOf(repoRoot: string, command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(' ')} 退出 ${code ?? 1}\n${stderr}`));
    });
  });
}

/** asar 和包内目录都不能出现 SDK 的平台二进制。 */
export async function assertPackageOmitsPlatformSdk(repoRoot: string, asarPath: string, tree: string): Promise<void> {
  const listed = await outputOf(repoRoot, process.execPath, [asarCli(repoRoot), 'list', asarPath]);
  const hits = platformSdkHits([...listed.split('\n'), ...packagedPaths(tree)]);
  if (hits.length > 0) {
    throw new Error(`安装包里有 Claude SDK 的平台二进制：${hits.slice(0, 8).join('、')}`);
  }
}
