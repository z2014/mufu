import { describe, expect, it } from 'vitest';

import { KEYCHAIN_SERVICE, OPENROUTER_ACCOUNT } from '@mufu/core';

import { createKeychainSecretStore, createMemorySecretStore, type SecretRunner } from './secrets.ts';

describe('secret store', () => {
  it('内存实现能设置、查询、删除，查询不返回值', async () => {
    const store = createMemorySecretStore();
    expect(await store.has(OPENROUTER_ACCOUNT)).toBe(false);
    await store.set(OPENROUTER_ACCOUNT, 'sk-test-value');
    expect(await store.has(OPENROUTER_ACCOUNT)).toBe(true);
    await store.remove(OPENROUTER_ACCOUNT);
    expect(await store.has(OPENROUTER_ACCOUNT)).toBe(false);
  });

  it('钥匙串命令用产品名当服务名，错误信息里不带值', async () => {
    const calls: string[][] = [];
    const run: SecretRunner = async (_file, args) => {
      calls.push(args);
      if (args[0] === 'add-generic-password') throw new Error(`failed ${args.join(' ')}`);
      throw new Error('missing');
    };
    const store = createKeychainSecretStore({ run, service: KEYCHAIN_SERVICE });
    expect(await store.has(OPENROUTER_ACCOUNT)).toBe(false);
    expect(calls[0]?.slice(0, 3)).toEqual(['find-generic-password', '-s', 'mufu']);
    await expect(store.set(OPENROUTER_ACCOUNT, 'sk-super-secret')).rejects.toThrow(/\[redacted\]/);
    const setArgs = calls[1] ?? [];
    expect(setArgs[0]).toBe('add-generic-password');
    expect(setArgs).toContain('-s');
    expect(setArgs).toContain('mufu');
    expect(setArgs).toContain('-U');
    expect(setArgs).not.toContain('-g');
  });
});
