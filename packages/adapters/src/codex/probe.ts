import { PRODUCT_VERSION } from '@mufu/core';

import { scrubEnv } from '../env.ts';
import type { LoginVerdict } from '../login.ts';
import { codexLaunchArgs, subscriptionFromCodexAccount, type CodexAccountRead } from './protocol.ts';
import { spawnCodexTransport, type CodexTransport } from './transport.ts';

type Spawn = (argv: string[], env: NodeJS.ProcessEnv) => CodexTransport;

type Json = Record<string, unknown>;

/**
 * 只做到 account/read 就关掉。不发 thread/start，不把任务提示送出去。
 * 和 startSession 用同一条订阅规则（subscriptionFromCodexAccount）。
 */
export async function readCodexSubscription(options?: {
  bin?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: Spawn;
}): Promise<LoginVerdict> {
  const bin = options?.bin ?? 'codex';
  const transport = (options?.spawn ?? spawnCodexTransport)(
    codexLaunchArgs(bin),
    scrubEnv(options?.env ?? process.env),
  );
  const pending = new Map<number, (message: Json) => void>();
  let nextId = 1;

  const reader = (async () => {
    for await (const line of transport.incoming) {
      let message: Json;
      try {
        message = JSON.parse(line) as Json;
      } catch {
        continue;
      }
      if (typeof message.id !== 'number') continue;
      const resolve = pending.get(message.id);
      if (!resolve) continue;
      pending.delete(message.id);
      resolve(message);
    }
  })();
  void reader;

  const send = (method: string, params: Json): Promise<Json> => {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, (reply) => {
        if (reply.error) {
          const error = reply.error as { message?: string };
          reject(new Error(error.message ?? `${method} 失败`));
          return;
        }
        resolve(reply);
      });
      transport.send(JSON.stringify({ method, id, params }));
    });
  };

  try {
    await send('initialize', { clientInfo: { name: 'mufu', title: 'mufu', version: PRODUCT_VERSION } });
    transport.send(JSON.stringify({ method: 'initialized', params: {} }));
    const accountReply = await send('account/read', { refreshToken: false });
    const account = (accountReply.result ?? {}) as CodexAccountRead;
    const subscription = subscriptionFromCodexAccount(account);
    const loggedIn = account.account !== null && account.account !== undefined;
    return {
      loggedIn,
      subscription: subscription.ok,
      source: subscription.ok ? 'account.type=chatgpt' : subscription.source,
    };
  } finally {
    transport.close();
  }
}
