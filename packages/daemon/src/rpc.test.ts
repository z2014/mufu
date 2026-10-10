import { describe, expect, it } from 'vitest';

import type { TaskEngine } from './engine.ts';
import { createRpc } from './rpc.ts';

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
      loadDoctor: () => Promise.resolve({ tools: [], configKeys: [], note: '' }),
    });
    await expect(handle({ id: 1, method: 'workflows.list' })).resolves.toMatchObject([{ id: 'fix-bug', default: true }]);
    await expect(handle({ id: 2, method: 'workflow.list' })).resolves.toMatchObject([{ name: '修 bug' }]);
    await expect(handle({ id: 3, method: 'task.merge' })).rejects.toThrow(/未知方法/);
  });
});
