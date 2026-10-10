import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { MergeFailure, type CiState, type GitHub, type MergeFailureReason } from '@mufu/core';

const execFileAsync = promisify(execFile);

type GhExec = (
  file: string,
  args: string[],
  options: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

/** CI 字样先于笼统的 not mergeable。认不出来的都算环境问题，不计入尝试。 */
export function classifyMergeFailure(text: string): MergeFailureReason {
  const sample = text.toLowerCase();
  if (sample.includes('failing check') || sample.includes('status check')) return 'ci_failed';
  if (sample.includes('conflict') || sample.includes('cleanly created') || sample.includes('not mergeable')) {
    return 'conflict';
  }
  return 'environment';
}

export function ciStateFromRollup(rollup: unknown): CiState {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'pending';
  const states = rollup.map((item) => {
    if (!item || typeof item !== 'object') return 'pending' as const;
    const record = item as { conclusion?: unknown; state?: unknown; status?: unknown };
    const conclusion = typeof record.conclusion === 'string' ? record.conclusion.toUpperCase() : '';
    const state = typeof record.state === 'string' ? record.state.toUpperCase() : '';
    const status = typeof record.status === 'string' ? record.status.toUpperCase() : '';
    if (
      conclusion === 'FAILURE' ||
      conclusion === 'CANCELLED' ||
      conclusion === 'TIMED_OUT' ||
      conclusion === 'STARTUP_FAILURE' ||
      state === 'FAILURE' ||
      state === 'ERROR'
    ) {
      return 'failed' as const;
    }
    if (
      conclusion === 'SUCCESS' ||
      conclusion === 'NEUTRAL' ||
      conclusion === 'SKIPPED' ||
      state === 'SUCCESS' ||
      status === 'SUCCESS'
    ) {
      return 'passed' as const;
    }
    return 'pending' as const;
  });
  if (states.some((item) => item === 'failed')) return 'failed';
  if (states.every((item) => item === 'passed')) return 'passed';
  return 'pending';
}

async function whichGh(): Promise<string | null> {
  const shell = process.env.SHELL && process.env.SHELL.length > 0 ? process.env.SHELL : 'bash';
  try {
    const { stdout } = await execFileAsync(shell, ['-lc', 'command -v gh'], { timeout: 5000 });
    const path = stdout.trim().split('\n').at(-1)?.trim() ?? '';
    return path.startsWith('/') ? path : null;
  } catch {
    return null;
  }
}

function textOf(error: unknown): string {
  if (error instanceof Error) {
    const { stderr } = error as { stderr?: unknown };
    return `${error.message}\n${typeof stderr === 'string' ? stderr : ''}`;
  }
  return String(error);
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  );
}

/** 真实 gh。二进制必须是登录 shell 给出的绝对路径。测试注入 which 和 exec。 */
export function createGhClient(deps?: { which?: () => Promise<string | null>; exec?: GhExec }): GitHub {
  const which = deps?.which ?? whichGh;
  const run: GhExec =
    deps?.exec ??
    (async (file, args, options) => {
      const result = await execFileAsync(file, args, { cwd: options.cwd, timeout: 20000 });
      return { stdout: result.stdout, stderr: result.stderr };
    });
  return {
    async inspect(repoPath) {
      const bin = await which();
      if (!bin) return { pr: null, ci: 'pending' };
      try {
        const { stdout } = await run(bin, ['pr', 'view', '--json', 'number,statusCheckRollup'], { cwd: repoPath });
        const parsed = JSON.parse(stdout) as { number?: unknown; statusCheckRollup?: unknown };
        const pr = typeof parsed.number === 'number' ? parsed.number : null;
        return { pr, ci: ciStateFromRollup(parsed.statusCheckRollup) };
      } catch {
        return { pr: null, ci: 'pending' };
      }
    },
    async merge({ repoPath, pr }) {
      const bin = await which();
      if (!bin) throw new MergeFailure('environment', '没有找到 gh');
      try {
        await run(bin, ['pr', 'merge', String(pr), '--merge'], { cwd: repoPath });
      } catch (error) {
        const text = textOf(error);
        throw new MergeFailure(classifyMergeFailure(text), firstLine(text) || '合并失败');
      }
    },
  };
}
