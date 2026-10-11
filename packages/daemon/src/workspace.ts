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

/** 工作目录必须已经是 git 仓库。界面只显示这里抛出的那句。 */
export async function assertGitRepo(repoPath: string): Promise<void> {
  try {
    const { stdout } = await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoPath, env: gitEnv });
    if (stdout.trim() !== 'true') throw new Error('这个目录不是 git 仓库');
  } catch (error) {
    if (error instanceof Error && error.message === '这个目录不是 git 仓库') throw error;
    throw new Error('这个目录不是 git 仓库');
  }
}

/** 一个开发任务一个 worktree，挂在调用方给出的 git 仓库上。 */
export async function createWorkspace(repoPath: string, taskId: string, dataDir: string): Promise<string> {
  await assertGitRepo(repoPath);
  const dest = join(dataDir, 'worktrees', taskId);
  await mkdir(join(dataDir, 'worktrees'), { recursive: true });
  await git(['worktree', 'add', '--detach', dest, 'HEAD'], repoPath);
  return dest;
}
