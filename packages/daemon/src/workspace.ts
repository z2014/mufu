import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { resolveCli } from '@mufu/adapters';

const exec = promisify(execFile);

function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    GIT_AUTHOR_NAME: 'mufu',
    GIT_AUTHOR_EMAIL: 'mufu@localhost',
    GIT_COMMITTER_NAME: 'mufu',
    GIT_COMMITTER_EMAIL: 'mufu@localhost',
  };
}

async function gitBin(env: NodeJS.ProcessEnv): Promise<string> {
  const bin = await resolveCli('git', env);
  if (!bin) throw new Error('找不到本机的 git');
  return bin;
}

async function git(args: string[], cwd: string | undefined, env: NodeJS.ProcessEnv): Promise<void> {
  await exec(await gitBin(env), args, { cwd, env: gitEnv(env) });
}

/**
 * 工作目录必须是非空路径，并且已经是 git 仓库。
 * git 用登录 shell 里的绝对路径。`workdir.check` 和创建任务都只走这里，界面只显示抛出的那句。
 */
export async function checkWorkdir(
  repoPath: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = typeof repoPath === 'string' ? repoPath.trim() : '';
  if (!path) throw new Error('先选择工作目录');
  const bin = await gitBin(env);
  try {
    const { stdout } = await exec(bin, ['rev-parse', '--is-inside-work-tree'], { cwd: path, env: gitEnv(env) });
    if (stdout.trim() !== 'true') throw new Error('这个目录不是 git 仓库');
  } catch (error) {
    if (error instanceof Error && error.message === '这个目录不是 git 仓库') throw error;
    if (error instanceof Error && error.message === '找不到本机的 git') throw error;
    throw new Error('这个目录不是 git 仓库');
  }
}

/** 一个开发任务一个 worktree，挂在调用方给出的 git 仓库上。 */
export async function createWorkspace(repoPath: string, taskId: string, dataDir: string): Promise<string> {
  await checkWorkdir(repoPath);
  const dest = join(dataDir, 'worktrees', taskId);
  await mkdir(join(dataDir, 'worktrees'), { recursive: true });
  await git(['worktree', 'add', '--detach', dest, 'HEAD'], repoPath, process.env);
  return dest;
}
