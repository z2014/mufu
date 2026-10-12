import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { AgentStartupError } from '@mufu/core';

const execFileAsync = promisify(execFile);

export type CliName = 'claude' | 'codex' | 'git' | 'gh';

const resolved = new Map<string, string | null>();

function cacheKey(name: CliName, env: NodeJS.ProcessEnv): string {
  return `${name}\0${env.SHELL ?? ''}\0${env.HOME ?? ''}\0${env.PATH ?? ''}`;
}

/** 测试换了 shell 之后清掉本进程里记住的路径。 */
export function clearResolvedCli(): void {
  resolved.clear();
}

/**
 * 登录 shell 的 `command -v`。结果在这个守护进程里按名字记住。
 * 只接受绝对路径。GUI 启动时没有终端 PATH，打包后的应用 PATH 也很短，不能直接用 `claude`、`git` 或 `gh`。
 */
export async function resolveCli(name: CliName, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const key = cacheKey(name, env);
  const cached = resolved.get(key);
  if (cached !== undefined) return cached;
  const shell = env.SHELL && env.SHELL.length > 0 ? env.SHELL : 'bash';
  let path: string | null = null;
  try {
    const { stdout } = await execFileAsync(shell, ['-lc', `command -v ${name}`], {
      env,
      timeout: 5000,
      killSignal: 'SIGKILL',
    });
    const line = stdout.trim().split('\n').at(-1)?.trim() ?? '';
    path = line.startsWith('/') ? line : null;
  } catch {
    path = null;
  }
  resolved.set(key, path);
  return path;
}

/** 显式路径优先。否则用 resolveCli，找不到就抛 cli_not_found。 */
export async function localCli(
  name: 'claude' | 'codex',
  explicit: string | undefined,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  if (explicit && explicit.length > 0) return explicit;
  const path = await resolveCli(name, env);
  if (!path) throw new AgentStartupError('cli_not_found', name, `${name} 不在登录 shell 的 PATH 里`);
  return path;
}

export const BLOCKED_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY'] as const;

/** 子进程环境里去掉这三把 key。不改用户的配置文件。 */
export function scrubEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...source };
  for (const key of BLOCKED_ENV_KEYS) delete next[key];
  return next;
}

export type ConfigKeyFinding = {
  tool: 'codex' | 'claude';
  file: string;
  key: string;
};

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 只报告「文件里有 key」，不返回 key 的内容。
 * 调用前后文件字节数不变由测试守着。
 */
export function detectConfigKeySources(home: string = homedir()): ConfigKeyFinding[] {
  const found: ConfigKeyFinding[] = [];
  const codexConfig = join(home, '.codex', 'config.toml');
  const toml = readText(codexConfig);
  if (toml && /^\s*api_key\s*=/m.test(toml)) {
    found.push({ tool: 'codex', file: codexConfig, key: 'api_key' });
  }
  const authPath = join(home, '.codex', 'auth.json');
  const authRaw = readText(authPath);
  if (authRaw) {
    try {
      const auth = JSON.parse(authRaw) as Record<string, unknown>;
      const mode = typeof auth.auth_mode === 'string' ? auth.auth_mode : '';
      const { tokens } = auth;
      const hasApiKey =
        mode === 'apikey' ||
        (tokens && typeof tokens === 'object' && 'api_key' in (tokens as Record<string, unknown>)) ||
        typeof auth.OPENAI_API_KEY === 'string';
      if (hasApiKey) found.push({ tool: 'codex', file: authPath, key: 'auth_mode' });
    } catch {
      found.push({ tool: 'codex', file: authPath, key: 'unreadable' });
    }
  }

  for (const relative of [join('.claude', 'settings.json'), join('.claude', 'settings.local.json')]) {
    const path = join(home, relative);
    const raw = readText(path);
    if (!raw) continue;
    try {
      const json = JSON.parse(raw) as { apiKeyHelper?: unknown; env?: Record<string, unknown> };
      if (typeof json.apiKeyHelper === 'string' && json.apiKeyHelper.length > 0) {
        found.push({ tool: 'claude', file: path, key: 'apiKeyHelper' });
      }
      const env = json.env ?? {};
      if (typeof env.ANTHROPIC_API_KEY === 'string')
        found.push({ tool: 'claude', file: path, key: 'env.ANTHROPIC_API_KEY' });
      if (typeof env.ANTHROPIC_AUTH_TOKEN === 'string') {
        found.push({ tool: 'claude', file: path, key: 'env.ANTHROPIC_AUTH_TOKEN' });
      }
    } catch {
      found.push({ tool: 'claude', file: path, key: 'unreadable' });
    }
  }
  return found;
}

export function fileStamp(path: string): { size: number; mtimeMs: number } | null {
  try {
    const stat = statSync(path);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}
