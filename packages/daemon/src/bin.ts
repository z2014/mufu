import { mkdirSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dataDir, DEV_PORT, resolveDaemonPort, socketPath } from '@mufu/core';

import { startDaemon } from './daemon.ts';

const here = dirname(fileURLToPath(import.meta.url));

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
  agent: (process.env.MUFU_AGENT as 'fake' | 'codex' | 'claude' | undefined) ?? 'fake',
  maxConcurrent: process.env.MUFU_MAX_CONCURRENT ? Number(process.env.MUFU_MAX_CONCURRENT) : undefined,
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
