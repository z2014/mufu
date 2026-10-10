import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

import {
  BLOCKED_ENV_KEYS,
  detectConfigKeySources,
  readClaudeSubscription,
  readCodexSubscription,
  type ConfigKeyFinding,
  type LoginVerdict,
} from '@mufu/adapters';

const exec = promisify(execFile);

type CheckItem = {
  name: 'installed' | 'logged_in' | 'subscription';
  ok: boolean;
  detail: string;
  fix: string | null;
};

export type ToolCheck = {
  name: 'codex' | 'claude' | 'gh';
  path: string | null;
  installed: boolean;
  loggedIn: boolean;
  subscription: boolean | null;
  items: CheckItem[];
};

export type DoctorReport = {
  tools: ToolCheck[];
  /** 变量名。不含值。 */
  ignoredEnvKeys: string[];
  configKeys: ConfigKeyFinding[];
  note: string;
};

type SubscriptionProbe = {
  codex: (bin: string) => Promise<LoginVerdict>;
  claude: (bin: string) => Promise<LoginVerdict>;
};

const FIX = {
  codex: '运行 codex login',
  claude: '运行 claude，然后输入 /login',
  gh: '运行 gh auth login',
} as const;

async function loginShellPath(name: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const shell = env.SHELL && env.SHELL.length > 0 ? env.SHELL : 'bash';
  try {
    const { stdout } = await exec(shell, ['-lc', `command -v ${name}`], { env });
    const path = stdout.trim().split('\n').at(-1)?.trim() ?? '';
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

async function ghLoggedIn(bin: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    await exec(bin, ['auth', 'status'], { env });
    return true;
  } catch {
    return false;
  }
}

function refused(source: string): LoginVerdict {
  return { loggedIn: false, subscription: false, source };
}

async function probeOrFail(run: () => Promise<LoginVerdict>): Promise<LoginVerdict> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : '检查失败';
    return refused(message);
  }
}

function codexItems(path: string | null, verdict: LoginVerdict | null): CheckItem[] {
  const installed = path !== null;
  return [
    {
      name: 'installed',
      ok: installed,
      detail: path ?? '未安装',
      fix: installed ? null : '安装 codex',
    },
    {
      name: 'logged_in',
      ok: verdict?.loggedIn === true,
      detail: verdict?.loggedIn ? '已登录' : (verdict?.source ?? '未登录'),
      fix: verdict?.loggedIn ? null : FIX.codex,
    },
    {
      name: 'subscription',
      ok: verdict?.subscription === true,
      detail: verdict?.subscription ? 'account.type=chatgpt' : (verdict?.source ?? '不是订阅'),
      fix: verdict?.subscription ? null : FIX.codex,
    },
  ];
}

function claudeItems(path: string | null, verdict: LoginVerdict | null): CheckItem[] {
  const installed = path !== null;
  return [
    {
      name: 'installed',
      ok: installed,
      detail: path ?? '未安装',
      fix: installed ? null : '安装 claude',
    },
    {
      name: 'logged_in',
      ok: verdict?.loggedIn === true,
      detail: verdict?.loggedIn ? '已登录' : (verdict?.source ?? '未登录'),
      fix: verdict?.loggedIn ? null : FIX.claude,
    },
    {
      name: 'subscription',
      ok: verdict?.subscription === true,
      detail: verdict?.subscription ? 'apiKeySource=none' : (verdict?.source ?? '不是订阅'),
      fix: verdict?.subscription ? null : FIX.claude,
    },
  ];
}

function ghItems(path: string | null, loggedIn: boolean): CheckItem[] {
  const installed = path !== null;
  return [
    {
      name: 'installed',
      ok: installed,
      detail: path ?? '未安装',
      fix: installed ? null : '安装 gh',
    },
    {
      name: 'logged_in',
      ok: installed && loggedIn,
      detail: installed && loggedIn ? '已登录' : '未登录',
      fix: installed && loggedIn ? null : FIX.gh,
    },
  ];
}

function ignoredEnvKeyNames(env: NodeJS.ProcessEnv): string[] {
  return BLOCKED_ENV_KEYS.filter((key) => {
    const value = env[key];
    return typeof value === 'string' && value.length > 0;
  });
}

const defaultProbe: SubscriptionProbe = {
  codex: (bin) => readCodexSubscription({ bin }),
  claude: (bin) => readClaudeSubscription({ bin }),
};

/**
 * 绝对路径来自登录 shell。订阅结论来自 Codex account/read 和 Claude system/init，
 * 不读取、不返回任何 key。环境里那三把变量只报告名字。
 */
export async function doctor(input?: {
  userHome?: string;
  env?: NodeJS.ProcessEnv;
  probe?: SubscriptionProbe;
  which?: (name: string) => Promise<string | null>;
  ghAuth?: (bin: string) => Promise<boolean>;
}): Promise<DoctorReport> {
  const env = input?.env ?? process.env;
  const userHome = input?.userHome ?? homedir();
  const probe = input?.probe ?? defaultProbe;
  const which = input?.which ?? ((name: string) => loginShellPath(name, env));
  const ghAuth = input?.ghAuth ?? ((bin: string) => ghLoggedIn(bin, env));
  const [codexPath, claudePath, ghPath] = await Promise.all([which('codex'), which('claude'), which('gh')]);
  const [codexVerdict, claudeVerdict, ghOk] = await Promise.all([
    codexPath ? probeOrFail(() => probe.codex(codexPath)) : Promise.resolve(null),
    claudePath ? probeOrFail(() => probe.claude(claudePath)) : Promise.resolve(null),
    ghPath ? ghAuth(ghPath) : Promise.resolve(false),
  ]);
  const codex = codexItems(codexPath, codexVerdict);
  const claude = claudeItems(claudePath, claudeVerdict);
  const gh = ghItems(ghPath, ghOk);
  return {
    tools: [tool('codex', codexPath, codex), tool('claude', claudePath, claude), tool('gh', ghPath, gh)],
    ignoredEnvKeys: ignoredEnvKeyNames(env),
    configKeys: detectConfigKeySources(userHome),
    note: 'Codex 和 Claude 的 key 不读取、不保存、不显示。环境里如果已经有 key，子进程会丢掉，改走订阅登录。OpenRouter 的钥匙只进钥匙串，适配器还不用。',
  };
}

function tool(name: ToolCheck['name'], path: string | null, items: CheckItem[]): ToolCheck {
  const installed = items.find((item) => item.name === 'installed')?.ok === true;
  const loggedIn = items.find((item) => item.name === 'logged_in')?.ok === true;
  const subscriptionItem = items.find((item) => item.name === 'subscription');
  return {
    name,
    path,
    installed,
    loggedIn,
    subscription: subscriptionItem ? subscriptionItem.ok : null,
    items,
  };
}
