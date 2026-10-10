import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { KEYCHAIN_SERVICE, OPENROUTER_ACCOUNT, type SecretStore } from '@mufu/core';

const exec = promisify(execFile);

export type SecretRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: SecretRunner = async (file, args) => {
  try {
    const result = await exec(file, args);
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string };
    const wrapped = new Error(failed.stderr?.trim() || failed.message || '钥匙串失败');
    throw wrapped;
  }
};

function hide(text: string, secret: string | undefined): string {
  if (!secret || secret.length === 0) return text;
  return text.split(secret).join('[redacted]');
}

/**
 * macOS 登录钥匙串。find 不加 -w / -g，所以成功时也不打印值。
 * 服务名是产品名常量。
 */
export function createKeychainSecretStore(options?: { run?: SecretRunner; service?: string }): SecretStore {
  const run = options?.run ?? defaultRunner;
  const service = options?.service ?? KEYCHAIN_SERVICE;
  return {
    async has(account) {
      try {
        await run('security', ['find-generic-password', '-s', service, '-a', account]);
        return true;
      } catch {
        return false;
      }
    },
    async set(account, value) {
      try {
        await run('security', ['add-generic-password', '-s', service, '-a', account, '-w', value, '-U']);
      } catch (error) {
        const message = error instanceof Error ? error.message : '钥匙串失败';
        throw new Error(hide(message, value));
      }
    },
    async remove(account) {
      await run('security', ['delete-generic-password', '-s', service, '-a', account]);
    },
  };
}

export function createMemorySecretStore(): SecretStore {
  const values = new Map<string, string>();
  return {
    async has(account) {
      return values.has(account);
    },
    async set(account, value) {
      values.set(account, value);
    },
    async remove(account) {
      values.delete(account);
    },
  };
}

export function createDefaultSecretStore(): SecretStore {
  return process.platform === 'darwin' ? createKeychainSecretStore() : createMemorySecretStore();
}

export function assertOpenRouterAccount(account: string): string {
  if (account !== OPENROUTER_ACCOUNT) throw new Error('只接受 openrouter');
  return account;
}
