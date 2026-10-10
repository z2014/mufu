import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dataDir, socketPath } from '@mufu/core';

import { startDaemon } from './daemon.ts';

const here = dirname(fileURLToPath(import.meta.url));

const home = dataDir();
mkdirSync(home, { recursive: true });
const workflowsDir = process.env.MUFU_WORKFLOWS ?? join(here, '../workflows');
const fixturePath = process.env.MUFU_FIXTURE ?? join(here, '../../../fixtures/handwritten/fix-bug.fake.jsonl');

const daemon = await startDaemon({
  home,
  socketPath: socketPath(home),
  wsPort: process.env.MUFU_WS_PORT ? Number(process.env.MUFU_WS_PORT) : 43124,
  workflowsDir,
  fixturePath,
  agent: (process.env.MUFU_AGENT as 'fake' | 'codex' | 'claude' | undefined) ?? 'fake',
  maxConcurrent: process.env.MUFU_MAX_CONCURRENT ? Number(process.env.MUFU_MAX_CONCURRENT) : undefined,
});

process.stdout.write(`mufu daemon listening ${daemon.socketPath} ws ${daemon.wsPort}\n`);

const shutdown = () => {
  void daemon.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
