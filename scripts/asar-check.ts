import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** 通用 Mac 包里的 app.asar。Linux 目录包不走这条路径。 */
export function macUniversalAsarPath(repoRoot: string): string {
  return join(repoRoot, 'release/mac-universal/mufu.app/Contents/Resources/app.asar');
}

function asarCli(repoRoot: string): string {
  const fromApp = createRequire(join(repoRoot, 'packages/app/package.json'));
  const builderJson = fromApp.resolve('electron-builder/package.json');
  const appBuilderJson = createRequire(builderJson).resolve('app-builder-lib/package.json');
  const asarJson = createRequire(appBuilderJson).resolve('@electron/asar/package.json');
  return join(dirname(asarJson), 'bin/asar.js');
}

function outputOf(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
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

function distElectronFiles(repoRoot: string): string[] {
  return readdirSync(join(repoRoot, 'packages/app/dist-electron')).filter((name) => name.endsWith('.js'));
}

/**
 * `asar list` 的行要包含 dist-electron 里的每个编译结果。
 * 漏掉 plist.js 时主进程会 ERR_MODULE_NOT_FOUND。
 */
export function missingDistElectron(listed: string, distFiles: readonly string[]): string[] {
  const packed = new Set(listed.split('\n').map((line) => line.trim()));
  return distFiles.filter((name) => !packed.has(`/dist-electron/${name}`));
}

export async function assertAsarHasDistElectron(repoRoot: string, asarPath: string): Promise<void> {
  const listed = await outputOf(process.execPath, [asarCli(repoRoot), 'list', asarPath], repoRoot);
  const missing = missingDistElectron(listed, distElectronFiles(repoRoot));
  if (missing.length > 0) {
    throw new Error(`app.asar 缺少 dist-electron 文件：${missing.join('、')}`);
  }
}
