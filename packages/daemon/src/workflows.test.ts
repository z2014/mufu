import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadWorkflows } from './workflows.ts';

const repoRoot = new URL('../../../', import.meta.url).pathname;
const workflowsDir = join(repoRoot, 'packages/daemon/workflows');

describe('loadWorkflows', () => {
  it('scans every yaml and uses the flagged default', () => {
    const catalog = loadWorkflows(workflowsDir);
    expect([...catalog.byId.keys()].sort()).toEqual(['fix-bug', 'new-feature']);
    expect(catalog.defaultWorkflowId).toBe('fix-bug');
    expect(catalog.list.find((item) => item.id === 'fix-bug')).toMatchObject({
      name: '修 bug',
      default: true,
      doneWhen: 'pr_merged',
    });
    expect(catalog.list.find((item) => item.id === 'new-feature')?.default).toBe(false);
    expect(catalog.list.find((item) => item.id === 'fix-bug')?.stages.find((stage) => stage.id === 'fix')?.agent).toBe(
      'codex',
    );
  });

  it('rejects two defaults and otherwise picks the first file name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-wf-'));
    const body = (id: string, flagged: boolean) =>
      `id: ${id}\ntitle: ${id}\n${flagged ? 'default: true\n' : ''}done_when: pr_merged\nstages:\n  - id: a\n    title: A\n    agent: codex\n`;
    try {
      writeFileSync(join(dir, 'b.yaml'), body('b', true));
      writeFileSync(join(dir, 'a.yaml'), body('a', true));
      expect(() => loadWorkflows(dir)).toThrow(/只能有一个默认流程/);
      writeFileSync(join(dir, 'b.yaml'), body('b', false));
      writeFileSync(join(dir, 'a.yaml'), body('a', false));
      expect(loadWorkflows(dir).defaultWorkflowId).toBe('a');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an empty directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-wf-empty-'));
    mkdirSync(dir, { recursive: true });
    try {
      expect(() => loadWorkflows(dir)).toThrow(/空的/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
