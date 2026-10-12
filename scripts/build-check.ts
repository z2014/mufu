import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DAEMON_WS_PORT } from '@mufu/schema';

import { bundleDaemon } from './bundle-daemon.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const unpackedDir = join(repoRoot, 'release/linux-unpacked');
const asarPath = join(unpackedDir, 'resources/app.asar');
const crashPattern = /ERR_MODULE_NOT_FOUND|Uncaught Exception|uncaughtException|UnhandledPromiseRejection/;

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

function asarCli(): string {
  const fromApp = createRequire(join(repoRoot, 'packages/app/package.json'));
  const builderJson = fromApp.resolve('electron-builder/package.json');
  const appBuilderJson = createRequire(builderJson).resolve('app-builder-lib/package.json');
  const asarJson = createRequire(appBuilderJson).resolve('@electron/asar/package.json');
  return join(dirname(asarJson), 'bin/asar.js');
}

function outputOf(command: string, args: string[]): Promise<string> {
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

function distElectronFiles(): string[] {
  return readdirSync(join(repoRoot, 'packages/app/dist-electron')).filter((name) => name.endsWith('.js'));
}

/** `asar list` 必须包含 dist-electron 里的每个编译结果。漏掉 plist.js 时主进程会 ERR_MODULE_NOT_FOUND。 */
async function assertAsarHasDistElectron(): Promise<void> {
  const listed = await outputOf(process.execPath, [asarCli(), 'list', asarPath]);
  const packed = new Set(listed.split('\n').map((line) => line.trim()));
  const missing = distElectronFiles().filter((name) => !packed.has(`/dist-electron/${name}`));
  if (missing.length > 0) {
    throw new Error(`app.asar 缺少 dist-electron 文件：${missing.join('、')}`);
  }
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function linuxExecutable(): string {
  for (const name of ['mufu', '@mufuapp']) {
    const path = join(unpackedDir, name);
    if (existsSync(path)) return path;
  }
  throw new Error(`找不到 Linux 可执行文件：${unpackedDir}`);
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

/**
 * 在 xvfb 里启动打好的 Linux 目录包。
 * 主进程不能有未捕获异常；打包后的壳会拉起守护进程，必须听 43124。
 */
async function smokePackagedApp(): Promise<void> {
  if (await portOpen(DAEMON_WS_PORT)) {
    throw new Error(`127.0.0.1:${DAEMON_WS_PORT} 已被占用，先停掉再做启动检查`);
  }
  const home = mkdtempSync(join(tmpdir(), 'mufu-linux-app-'));
  const child = spawn('xvfb-run', ['-a', linuxExecutable(), '--no-sandbox', '--disable-gpu'], {
    cwd: unpackedDir,
    detached: true,
    env: {
      ...process.env,
      MUFU_HOME: home,
      MUFU_AGENT: 'fake',
      MUFU_FIXTURE: join(repoRoot, 'fixtures/handwritten/fix-bug.fake.jsonl'),
      ELECTRON_DISABLE_SANDBOX: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  try {
    const start = Date.now();
    let listening = false;
    while (Date.now() - start < 20000) {
      if (crashPattern.test(output)) {
        throw new Error(`主进程有未捕获异常：\n${output.slice(-2000)}`);
      }
      if (child.exitCode !== null) {
        throw new Error(`主进程退出 ${child.exitCode}\n${output.slice(-2000)}`);
      }
      if (await portOpen(DAEMON_WS_PORT)) {
        listening = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!listening) throw new Error(`守护进程没有听 127.0.0.1:${DAEMON_WS_PORT}\n${output.slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (crashPattern.test(output)) {
      throw new Error(`主进程有未捕获异常：\n${output.slice(-2000)}`);
    }
    if (child.exitCode !== null) throw new Error(`主进程退出 ${child.exitCode}\n${output.slice(-2000)}`);
  } finally {
    killTree(child);
    rmSync(home, { recursive: true, force: true });
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && (await portOpen(DAEMON_WS_PORT))) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

async function main(): Promise<void> {
  await run('pnpm', ['-r', '--if-present', 'build']);
  await bundleDaemon(repoRoot);
  await run('pnpm', ['--filter', '@mufu/app', 'exec', 'electron-builder', '--linux', '--dir', '--config', 'electron-builder.yml']);
  const problems: string[] = [];
  try {
    await assertAsarHasDistElectron();
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  try {
    await smokePackagedApp();
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));
  process.stdout.write(
    'Linux 上的打包检查过了：asar 含全部 dist-electron，主进程没有未捕获异常，守护进程在听 43124。mufu.app 仍要在 Mac 上用 pnpm build:mac。\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
