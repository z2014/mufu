import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'mufu',
  GIT_AUTHOR_EMAIL: 'mufu@localhost',
  GIT_COMMITTER_NAME: 'mufu',
  GIT_COMMITTER_EMAIL: 'mufu@localhost',
};

async function git(args: string[], cwd?: string): Promise<void> {
  await exec('git', args, { cwd, env: gitEnv });
}

/** 一个开发任务一个 worktree。没有仓库时先做一个空仓库，再挂 worktree。 */
export async function createWorkspace(repoPath: string | undefined, taskId: string, dataDir: string): Promise<string> {
  const root = repoPath ?? (await initScratch(dataDir, taskId));
  const dest = join(dataDir, 'worktrees', taskId);
  await mkdir(join(dataDir, 'worktrees'), { recursive: true });
  await git(['worktree', 'add', '--detach', dest, 'HEAD'], root);
  return dest;
}

async function initScratch(dataDir: string, taskId: string): Promise<string> {
  const root = join(dataDir, 'scratches', taskId);
  await mkdir(root, { recursive: true });
  await git(['init'], root);
  await git(['commit', '--allow-empty', '-m', 'init'], root);
  return root;
}
