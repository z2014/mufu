import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import type { TaskEngine } from './engine.ts';
import { createRpc } from './rpc.ts';
import { createMemorySecretStore } from './secrets.ts';

const exec = promisify(execFile);

function engine(): TaskEngine {
  return {
    createTask: () => Promise.reject(new Error('unused')),
    listTasks: () => [],
    getTask: () => null,
    events: () => [],
    note: () => {
      throw new Error('unused');
    },
    resolveGate: () => {
      throw new Error('unused');
    },
    requestMerge: () => Promise.reject(new Error('unused')),
    readPins: () => {
      throw new Error('unused');
    },
    workflows: () => [
      {
        id: 'fix-bug',
        name: '修 bug',
        title: '修 bug',
        default: true,
        doneWhen: 'pr_merged',
        stages: [{ id: 'fix', title: '修复', agent: 'codex' }],
      },
    ],
    shutdown() {
      return undefined;
    },
  };
}

describe('rpc', () => {
  it('lists workflows and rejects an unknown method', async () => {
    const handle = createRpc({
      engine: engine(),
      secrets: createMemorySecretStore(),
      loadDoctor: () => Promise.resolve({ tools: [], ignoredEnvKeys: [], configKeys: [], note: '' }),
    });
    await expect(handle({ id: 1, method: 'workflows.list' })).resolves.toMatchObject([
      { id: 'fix-bug', default: true },
    ]);
    await expect(handle({ id: 2, method: 'workflow.list' })).resolves.toMatchObject([{ name: '修 bug' }]);
    await expect(handle({ id: 3, method: 'task.merge' })).rejects.toThrow(/未知方法/);
  });

  it('pin.read 和 pin.readAll 都把重点 id 交给引擎', async () => {
    const seen: string[][] = [];
    const handle = createRpc({
      engine: {
        ...engine(),
        readPins(_taskId: string, pinIds: string[]): never {
          seen.push(pinIds);
          throw new Error('recorded');
        },
      },
      secrets: createMemorySecretStore(),
      loadDoctor: () => Promise.resolve({ tools: [], ignoredEnvKeys: [], configKeys: [], note: '' }),
    });
    await expect(handle({ id: 1, method: 'pin.read', params: { taskId: 't', pinIds: ['p1'] } })).rejects.toThrow(
      'recorded',
    );
    await expect(
      handle({ id: 2, method: 'pin.readAll', params: { taskId: 't', pinIds: ['p1', 'p2'] } }),
    ).rejects.toThrow('recorded');
    expect(seen).toEqual([['p1'], ['p1', 'p2']]);
  });

  it('workdir.check 和创建任务用同一套拒绝', async () => {
    const handle = createRpc({
      engine: engine(),
      secrets: createMemorySecretStore(),
      loadDoctor: () => Promise.resolve({ tools: [], ignoredEnvKeys: [], configKeys: [], note: '' }),
    });
    await expect(handle({ id: 1, method: 'workdir.check', params: { repoPath: '  ' } })).rejects.toThrow(
      '先选择工作目录',
    );
    const home = mkdtempSync(join(tmpdir(), 'mufu-workdir-'));
    try {
      await expect(handle({ id: 2, method: 'workdir.check', params: { repoPath: home } })).rejects.toThrow(
        '这个目录不是 git 仓库',
      );
      const repo = join(home, 'repo');
      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: 'mufu',
        GIT_AUTHOR_EMAIL: 'mufu@localhost',
        GIT_COMMITTER_NAME: 'mufu',
        GIT_COMMITTER_EMAIL: 'mufu@localhost',
      };
      await exec('git', ['init', repo], { env });
      await exec('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: repo, env });
      await expect(handle({ id: 3, method: 'workdir.check', params: { repoPath: repo } })).resolves.toEqual({
        ok: true,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
