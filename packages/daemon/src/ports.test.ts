import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { get as httpGetRequest } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { startDaemon } from './daemon.ts';
import { DAEMON_WS_PORT, DEV_PORT } from './runtime.ts';

const repoRoot = new URL('../../../', import.meta.url).pathname;

const portLiterals = [String(DEV_PORT), String(DAEMON_WS_PORT)];
const singleSource = [
  'packages/daemon/src/bin.ts',
  'packages/daemon/src/daemon.ts',
  'packages/cli/src/main.ts',
  'packages/app/vite.config.ts',
  'packages/app/package.json',
  'packages/app/src/api/client/index.ts',
];

function text(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function httpGet(port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpGetRequest(`http://127.0.0.1:${port}/`, { timeout: 2000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout http://127.0.0.1:${port}`));
    });
    req.on('error', reject);
  });
}

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function spawnPnpm(script: string, home: string): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, MUFU_HOME: home };
  delete env.MUFU_WS_PORT;
  delete env.PORT;
  delete env.VITE_MUFU_WS_PORT;
  return spawn('pnpm', [script], {
    cwd: repoRoot,
    detached: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitFor(label: string, probe: () => Promise<boolean>): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`超时：${label}`);
}

describe('board and daemon ports', () => {
  it('refuses to bind the board port', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-port-'));
    await expect(
      startDaemon({
        home,
        socketPath: join(home, 'daemon.sock'),
        wsPort: DEV_PORT,
        workflowsDir: join(repoRoot, 'packages/daemon/workflows'),
        fixturePath: join(repoRoot, 'fixtures/handwritten/fix-bug.fake.jsonl'),
      }),
    ).rejects.toThrow(/看板端口/);
    rmSync(home, { recursive: true, force: true });
  });

  it('keeps the port numbers in one module', () => {
    for (const path of singleSource) {
      const source = text(path);
      for (const literal of portLiterals) {
        expect(source, path).not.toContain(literal);
      }
    }
    const daemonRuntime = text('packages/daemon/src/runtime.ts');
    const appRuntime = text('packages/app/src/runtime.ts');
    expect(daemonRuntime).toContain(String(DEV_PORT));
    expect(daemonRuntime).toContain(String(DAEMON_WS_PORT));
    expect(appRuntime).toContain(String(DEV_PORT));
    expect(appRuntime).toContain(String(DAEMON_WS_PORT));
    expect(text('packages/core/src/product.ts')).not.toContain(String(DEV_PORT));
    expect(text('packages/core/src/product.ts')).not.toContain(String(DAEMON_WS_PORT));
    const readme = text('README.md');
    expect(readme).toContain(`http://127.0.0.1:${DEV_PORT}`);
    expect(readme).toContain(`127.0.0.1:${DAEMON_WS_PORT}`);
    expect(readme).toContain('pnpm daemon');
    expect(readme).toContain('pnpm dev:app');
  });

  it('serves the board only after dev:app, on the documented url', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-readme-'));
    const daemon = spawnPnpm('daemon', home);
    let vite: ChildProcess | null = null;
    let daemonLog = '';
    let daemonErr = '';
    let appLog = '';
    daemon.stdout?.setEncoding('utf8');
    daemon.stderr?.setEncoding('utf8');
    daemon.stdout?.on('data', (chunk: string) => {
      daemonLog += chunk;
    });
    daemon.stderr?.on('data', (chunk: string) => {
      daemonErr += chunk;
    });
    try {
      await waitFor('daemon websocket', async () => canConnect(DAEMON_WS_PORT));
      expect(await canConnect(DEV_PORT), `看板端口被占用。\n${daemonLog}\n${daemonErr}`).toBe(false);
      const hint = await httpGet(DAEMON_WS_PORT);
      expect(hint.status).toBe(200);
      expect(hint.body).toContain('pnpm dev:app');
      expect(hint.body).not.toContain('<div id="root">');
      await waitFor('daemon log', async () => daemonLog.includes(`ws 127.0.0.1:${DAEMON_WS_PORT}`));

      vite = spawnPnpm('dev:app', home);
      vite.stdout?.setEncoding('utf8');
      vite.stderr?.setEncoding('utf8');
      vite.stdout?.on('data', (chunk: string) => {
        appLog += chunk;
      });
      vite.stderr?.on('data', (chunk: string) => {
        appLog += chunk;
      });
      await waitFor('board html', async () => {
        if (!(await canConnect(DEV_PORT))) return false;
        try {
          const page = await httpGet(DEV_PORT);
          return (
            page.status === 200 && page.body.includes('<div id="root">') && page.body.includes('<title>mufu</title>')
          );
        } catch {
          return false;
        }
      });
      const page = await httpGet(DEV_PORT);
      expect(page.body).toContain('<title>mufu</title>');
      expect(page.body).toContain('<div id="root">');
      const stillHint = await httpGet(DAEMON_WS_PORT);
      expect(stillHint.body).not.toContain('<div id="root">');
      expect(appLog).toContain(String(DEV_PORT));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${detail}\n--- daemon ---\n${daemonLog}\n${daemonErr}\n--- app ---\n${appLog}`);
    } finally {
      if (vite) killGroup(vite);
      killGroup(daemon);
      await new Promise((resolve) => setTimeout(resolve, 300));
      rmSync(home, { recursive: true, force: true });
    }
  }, 45000);

  it('pnpm start serves the board and keeps the daemon off that port', async () => {
    await waitFor('ports free', async () => !(await canConnect(DEV_PORT)) && !(await canConnect(DAEMON_WS_PORT)));
    const home = mkdtempSync(join(tmpdir(), 'mufu-start-'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MUFU_HOME: home,
      MUFU_AGENT: 'fake',
      MUFU_ELECTRON_CMD: 'node -e "setInterval(() => {}, 1000)"',
    };
    delete env.MUFU_WS_PORT;
    delete env.PORT;
    delete env.VITE_MUFU_WS_PORT;
    const child = spawn('pnpm', ['start'], {
      cwd: repoRoot,
      detached: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      log += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      log += chunk;
    });
    try {
      await waitFor('start board', async () => {
        if (!(await canConnect(DEV_PORT))) return false;
        try {
          const page = await httpGet(DEV_PORT);
          return page.status === 200 && page.body.includes('<title>mufu</title>');
        } catch {
          return false;
        }
      });
      const hint = await httpGet(DAEMON_WS_PORT);
      expect(hint.body).toContain('pnpm dev:app');
      expect(hint.body).not.toContain('<div id="root">');
      const page = await httpGet(DEV_PORT);
      expect(page.body).toContain('<div id="root">');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${detail}\n--- start ---\n${log}`);
    } finally {
      killGroup(child);
      await new Promise((resolve) => setTimeout(resolve, 400));
      rmSync(home, { recursive: true, force: true });
    }
  }, 60000);
});
