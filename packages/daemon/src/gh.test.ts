import { MergeFailure } from '@mufu/core';
import { describe, expect, it } from 'vitest';

import { ciStateFromRollup, classifyMergeFailure, createGhClient, parseDiffStat } from './gh.ts';

describe('classifyMergeFailure', () => {
  it('reads CI before a generic not-mergeable line, and leaves auth as environment', () => {
    expect(classifyMergeFailure('Pull request is not mergeable: failing checks')).toBe('ci_failed');
    expect(classifyMergeFailure('required status checks have not succeeded')).toBe('ci_failed');
    expect(classifyMergeFailure('merge conflict in src/a.ts')).toBe('conflict');
    expect(classifyMergeFailure('cannot be cleanly created')).toBe('conflict');
    expect(classifyMergeFailure('Pull request is not mergeable')).toBe('conflict');
    expect(classifyMergeFailure('HTTP 401 Bad credentials')).toBe('environment');
    expect(classifyMergeFailure('connect ETIMEDOUT')).toBe('environment');
    expect(classifyMergeFailure('gh: command not found')).toBe('environment');
  });
});

describe('ciStateFromRollup', () => {
  it('fails closed on a failed check and stays pending while any check is running', () => {
    expect(ciStateFromRollup([])).toBe('pending');
    expect(ciStateFromRollup(null)).toBe('pending');
    expect(ciStateFromRollup([{ conclusion: 'SUCCESS' }, { conclusion: 'SUCCESS' }])).toBe('passed');
    expect(ciStateFromRollup([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }])).toBe('failed');
    expect(ciStateFromRollup([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toBe('pending');
  });
});

describe('parseDiffStat', () => {
  it('读出文件列表和汇总的增减', () => {
    const stat = parseDiffStat(
      [
        ' src/items.ts       | 10 ++++++----',
        ' src/items.test.ts  |  8 ++++++++',
        ' 2 files changed, 14 insertions(+), 4 deletions(-)',
      ].join('\n'),
    );
    expect(stat.files).toEqual([
      { path: 'src/items.ts', additions: 6, deletions: 4 },
      { path: 'src/items.test.ts', additions: 8, deletions: 0 },
    ]);
    expect(stat.additions).toBe(14);
    expect(stat.deletions).toBe(4);
  });
});

describe('createGhClient', () => {
  it('does not throw when gh is missing, and classifies merge stderr', async () => {
    const missing = createGhClient({ which: () => Promise.resolve(null) });
    await expect(missing.inspect('/tmp/repo')).resolves.toEqual({
      pr: null,
      ci: 'pending',
      mergeable: 'unknown',
      additions: null,
      deletions: null,
    });
    await expect(missing.merge({ repoPath: '/tmp/repo', pr: 1 })).rejects.toBeInstanceOf(MergeFailure);

    const calls: string[][] = [];
    const client = createGhClient({
      which: () => Promise.resolve('/usr/bin/gh'),
      exec: (file, args) => {
        calls.push([file, ...args]);
        if (args[0] === 'pr' && args[1] === 'view') {
          return Promise.resolve({
            stdout: JSON.stringify({ number: 12, statusCheckRollup: [{ conclusion: 'SUCCESS' }] }),
            stderr: '',
          });
        }
        return Promise.reject(Object.assign(new Error('merge failed'), { stderr: 'failing checks' }));
      },
    });
    await expect(client.inspect('/work')).resolves.toEqual({
      pr: 12,
      ci: 'passed',
      mergeable: 'unknown',
      additions: null,
      deletions: null,
    });
    await expect(client.merge({ repoPath: '/work', pr: 12 })).rejects.toMatchObject({ reason: 'ci_failed' });
    await expect(client.merge({ repoPath: '/work', pr: 12 })).rejects.toThrow(/验收并合并/);
    await client.merge({ repoPath: '/work', pr: 12 }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      expect(message).not.toContain('Command failed');
      expect(message).not.toContain('/usr/bin/gh');
    });
    expect(calls[0]?.[0]).toBe('/usr/bin/gh');
    expect(calls[1]).toEqual(['/usr/bin/gh', 'pr', 'merge', '12', '--merge']);

    const diff = createGhClient({
      which: () => Promise.resolve('/usr/bin/gh'),
      exec: (_file, args) => {
        expect(args).toEqual(['pr', 'diff', '--stat']);
        return Promise.resolve({
          stdout: ' src/a.ts | 2 ++\n 1 file changed, 2 insertions(+)\n',
          stderr: '',
        });
      },
    });
    await expect(diff.diffStat('/work')).resolves.toEqual({
      files: [{ path: 'src/a.ts', additions: 2, deletions: 0 }],
      additions: 2,
      deletions: 0,
    });
  });
});
