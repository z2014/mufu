import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

import { detectConfigKeySources, type ConfigKeyFinding } from '@mufu/adapters';

const exec = promisify(execFile);

export type ToolCheck = {
  name: 'codex' | 'claude' | 'gh';
  path: string | null;
  installed: boolean;
  loginHint: string;
};

export type DoctorReport = {
  tools: ToolCheck[];
  configKeys: ConfigKeyFinding[];
  note: string;
};

async function loginShellPath(name: string): Promise<string | null> {
  const shell = process.env.SHELL && process.env.SHELL.length > 0 ? process.env.SHELL : 'bash';
  try {
    const { stdout } = await exec(shell, ['-lc', `command -v ${name}`]);
    const path = stdout.trim().split('\n').at(-1)?.trim() ?? '';
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

async function hint(bin: string | null, args: string[]): Promise<string> {
  if (!bin) return '未安装';
  try {
    const { stdout, stderr } = await exec(bin, args);
    const text = `${stdout}\n${stderr}`.trim();
    return text.split('\n')[0] ?? '已安装';
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const line = stderr.trim().split('\n')[0];
    return line && line.length > 0 ? line : '已安装，登录状态未知';
  }
}

/**
 * 第一次检查从守护进程自己跑。绝对路径来自登录 shell，因为 launchd 没有终端 PATH。
 * 配置文件按用户主目录读，不按数据目录。只读，不改文件。
 */
export async function doctor(userHome: string = homedir()): Promise<DoctorReport> {
  const names = ['codex', 'claude', 'gh'] as const;
  const tools: ToolCheck[] = [];
  for (const name of names) {
    const path = await loginShellPath(name);
    const loginHint =
      name === 'gh'
        ? await hint(path, ['auth', 'status'])
        : await hint(path, name === 'codex' ? ['login', 'status'] : ['--version']);
    tools.push({ name, path, installed: path != null, loginHint });
  }
  return {
    tools,
    configKeys: detectConfigKeySources(userHome),
    note: 'codex login status 看不到 config.toml 里的 key。真正开跑之前以 app-server 的 account/read 和 Claude system/init 的 apiKeySource 为准。',
  };
}
