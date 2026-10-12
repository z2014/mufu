import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
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

function homeOf(env: NodeJS.ProcessEnv): string {
  return env.HOME && env.HOME.length > 0 ? env.HOME : homedir();
}

/** `~` 和 `~/...` 按 HOME 展开。`~其他用户` 不展开。 */
function expandHome(path: string, env: NodeJS.ProcessEnv = process.env): string {
  if (path === '~') return homeOf(env);
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homeOf(env), path.slice(2));
  return path;
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
 * `~` 在这里展开。git 用登录 shell 里的绝对路径，和 gh 共用 `resolveCli`，不另写一套查找。
 * 找不到 git、目录不存在、不是仓库，是三句不同的错误。界面只显示抛出的那句。
 * 返回展开后的路径。
 */
export async function checkWorkdir(
  repoPath: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const raw = typeof repoPath === 'string' ? repoPath.trim() : '';
  if (!raw) throw new Error('先选择工作目录');
  const path = expandHome(raw, env);
  const bin = await gitBin(env);
  try {
    const info = await stat(path);
    if (!info.isDirectory()) throw new Error('这个目录不是 git 仓库');
  } catch (error) {
    if (error instanceof Error && error.message === '这个目录不是 git 仓库') throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('这个目录不存在');
    throw new Error('这个目录不是 git 仓库');
  }
  try {
    const { stdout } = await exec(bin, ['rev-parse', '--is-inside-work-tree'], { cwd: path, env: gitEnv(env) });
    if (stdout.trim() !== 'true') throw new Error('这个目录不是 git 仓库');
  } catch (error) {
    if (error instanceof Error && error.message === '这个目录不是 git 仓库') throw error;
    throw new Error('这个目录不是 git 仓库');
  }
  return path;
}

/** 一个开发任务一个 worktree，挂在调用方给出的 git 仓库上。 */
export async function createWorkspace(repoPath: string, taskId: string, dataDir: string): Promise<string> {
  const repo = await checkWorkdir(repoPath);
  const dest = join(dataDir, 'worktrees', taskId);
  await mkdir(join(dataDir, 'worktrees'), { recursive: true });
  await git(['worktree', 'add', '--detach', dest, 'HEAD'], repo, process.env);
  return dest;
}
