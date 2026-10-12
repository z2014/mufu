import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

import {
  BLOCKED_ENV_KEYS,
  detectConfigKeySources,
  readClaudeSubscription,
  readCodexSubscription,
  resolveCli,
  type CliName,
  type ConfigKeyFinding,
  type LoginVerdict,
} from '@mufu/adapters';

const exec = promisify(execFile);

type CheckName = 'installed' | 'logged_in' | 'subscription';
type CheckStatus = 'ok' | 'failed' | 'skipped';

type CheckItem = {
  name: CheckName;
  /** 前置检查。前置不是 ok 时，这一项变成 skipped。 */
  dependsOn: CheckName | null;
  status: CheckStatus;
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

/** 官方安装方式。Claude Code 的 npm 包装已弃用，改用官方安装脚本。 */
const INSTALL = {
  codex: 'npm install -g @openai/codex',
  claude: 'curl -fsSL https://claude.ai/install.sh | bash',
  gh: 'brew install gh',
} as const;

function check(name: CheckName, dependsOn: CheckName | null, passed: boolean, detail: string, fix: string): CheckItem {
  return {
    name,
    dependsOn,
    status: passed ? 'ok' : 'failed',
    ok: passed,
    detail,
    fix: passed ? null : fix,
  };
}

/** 前置失败或被跳过时，依赖它的检查不再报 ✗，也不再重复修复提示。 */
function applyDependencies(items: CheckItem[]): CheckItem[] {
  const byName = new Map(items.map((item) => [item.name, item]));
  return items.map((item) => {
    if (!item.dependsOn) return item;
    const parent = byName.get(item.dependsOn);
    if (!parent || parent.status === 'ok') return item;
    const skipped: CheckItem = { ...item, status: 'skipped', ok: false, detail: '', fix: null };
    byName.set(item.name, skipped);
    return skipped;
  });
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
  const loggedIn = verdict?.loggedIn === true;
  const subscription = verdict?.subscription === true;
  return applyDependencies([
    check('installed', null, installed, path ?? '未安装', INSTALL.codex),
    check('logged_in', 'installed', loggedIn, loggedIn ? '已登录' : (verdict?.source ?? '未登录'), FIX.codex),
    check(
      'subscription',
      'logged_in',
      subscription,
      subscription ? 'account.type=chatgpt' : (verdict?.source ?? '不是订阅'),
      FIX.codex,
    ),
  ]);
}

function claudeItems(path: string | null, verdict: LoginVerdict | null): CheckItem[] {
  const installed = path !== null;
  const loggedIn = verdict?.loggedIn === true;
  const subscription = verdict?.subscription === true;
  return applyDependencies([
    check('installed', null, installed, path ?? '未安装', INSTALL.claude),
    check('logged_in', 'installed', loggedIn, loggedIn ? '已登录' : (verdict?.source ?? '未登录'), FIX.claude),
    check(
      'subscription',
      'logged_in',
      subscription,
      subscription ? 'apiKeySource=none' : (verdict?.source ?? '不是订阅'),
      FIX.claude,
    ),
  ]);
}

function ghItems(path: string | null, loggedIn: boolean): CheckItem[] {
  const installed = path !== null;
  return applyDependencies([
    check('installed', null, installed, path ?? '未安装', INSTALL.gh),
    check('logged_in', 'installed', installed && loggedIn, installed && loggedIn ? '已登录' : '未登录', FIX.gh),
  ]);
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
  const which =
    input?.which ??
    ((name: string) => {
      if (name !== 'codex' && name !== 'claude' && name !== 'gh') return Promise.resolve(null);
      const cli: CliName = name;
      return resolveCli(cli, env);
    });
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
    note: 'Codex 和 Claude 的密钥不会读取、保存或显示。环境里如果已经有密钥，会忽略，改用订阅登录。OpenRouter 的钥匙只保存在钥匙串里，现在还不会用到。',
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
