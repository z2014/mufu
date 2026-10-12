import { mkdirSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { DEV_PORT } from '@mufu/schema';

import { startDaemon } from './daemon.ts';
import { dataDir, resolveDaemonPort, socketPath } from './runtime.ts';

/** 源码用 tsx 跑时这是 bin.ts 所在目录；打成 CommonJS 后这是 daemon.cjs 所在目录。不用 import.meta，那个在 cjs 产物里是空的。 */
function entryDir(): string {
  const entry = process.argv[1];
  if (!entry) throw new Error('找不到守护进程入口');
  return dirname(entry);
}

const here = entryDir();

function envAgent(value: string | undefined): 'codex' | 'claude' | undefined {
  if (value === 'codex' || value === 'claude') return value;
  return undefined;
}

async function main(): Promise<void> {
  const home = dataDir();
  mkdirSync(home, { recursive: true });
  const workflowsDir = process.env.MUFU_WORKFLOWS ?? join(here, '../workflows');
  const fixturePath = process.env.MUFU_FIXTURE ?? join(here, '../../../fixtures/handwritten/fix-bug.fake.jsonl');
  const daemon = await startDaemon({
    home,
    socketPath: socketPath(home),
    wsPort: resolveDaemonPort(process.env),
    workflowsDir,
    fixturePath,
    useFixture: process.env.MUFU_AGENT === 'fake',
    agent: envAgent(process.env.MUFU_AGENT),
  });

  writeSync(
    1,
    `mufu daemon listening ${daemon.socketPath} ws 127.0.0.1:${daemon.wsPort}\n看板 http://127.0.0.1:${DEV_PORT} （另一个终端：pnpm dev:app）\n`,
  );

  const shutdown = () => {
    void daemon.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
