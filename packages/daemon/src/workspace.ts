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

/**
 * 工作目录必须是非空路径，并且已经是 git 仓库。
 * `workdir.check` 和创建任务都只走这里，界面只显示抛出的那句。
 */
export async function checkWorkdir(repoPath: string | undefined | null): Promise<void> {
  const path = typeof repoPath === 'string' ? repoPath.trim() : '';
  if (!path) throw new Error('先选择工作目录');
  try {
    const { stdout } = await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: path, env: gitEnv });
    if (stdout.trim() !== 'true') throw new Error('这个目录不是 git 仓库');
  } catch (error) {
    if (error instanceof Error && error.message === '这个目录不是 git 仓库') throw error;
    throw new Error('这个目录不是 git 仓库');
  }
}

/** 一个开发任务一个 worktree，挂在调用方给出的 git 仓库上。 */
export async function createWorkspace(repoPath: string, taskId: string, dataDir: string): Promise<string> {
  await checkWorkdir(repoPath);
  const dest = join(dataDir, 'worktrees', taskId);
  await mkdir(join(dataDir, 'worktrees'), { recursive: true });
  await git(['worktree', 'add', '--detach', dest, 'HEAD'], repoPath);
  return dest;
}
