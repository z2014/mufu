import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DAEMON_WS_PORT, DEV_PORT } from '@mufu/daemon';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const children: ChildProcess[] = [];
let stopping = false;

function run(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  children.push(child);
  return child;
}

function shutdown(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 100);
}

function exitCode(child: ChildProcess): Promise<number> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
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

async function waitPort(port: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (await portOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等不到 127.0.0.1:${port}`);
}

function httpOk(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest(`http://127.0.0.1:${port}/`, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitHttp(port: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (await httpOk(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`看板没有起来：http://127.0.0.1:${port}`);
}

async function main(): Promise<void> {
  const env = { ...process.env };
  const compile = run('pnpm', ['--filter', '@mufu/app', 'exec', 'tsc', '-p', 'tsconfig.electron.json'], env);
  if ((await exitCode(compile)) !== 0) throw new Error('Electron 主进程没有编译成功');

  const daemon = run('pnpm', ['daemon'], env);
  daemon.once('exit', (code) => {
    if (!stopping && code !== 0 && code !== null) shutdown(code);
  });
  await waitPort(DAEMON_WS_PORT);

  run('pnpm', ['dev:app'], env);
  await waitHttp(DEV_PORT);

  const electronEnv = { ...env, MUFU_RENDERER_URL: `http://127.0.0.1:${DEV_PORT}` };
  const custom = env.MUFU_ELECTRON_CMD;
  const electron = custom
    ? spawn(custom, { cwd: root, env: electronEnv, stdio: 'inherit', shell: true })
    : spawn('pnpm', ['--filter', '@mufu/app', 'exec', 'electron', 'dist-electron/main.js'], {
        cwd: root,
        env: electronEnv,
        stdio: 'inherit',
      });
  children.push(electron);

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  electron.once('exit', () => shutdown(0));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  shutdown(1);
});
