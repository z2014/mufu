import { tmpdir } from 'node:os';

import type { LoginVerdict } from '../login.ts';
import { buildClaudeLaunchOptions } from './options.ts';
import { createPromptGate, subscriptionFromClaudeInit } from './protocol.ts';

type QueryHandle = AsyncIterable<unknown> & {
  interrupt?: () => Promise<unknown>;
  close?: () => void;
};

/**
 * 等 system/init 的 apiKeySource，然后立刻中断。
 * prompt 迭代器一直不放行，任务文本不会送出去。
 */
export async function readClaudeSubscription(options?: {
  bin?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): Promise<LoginVerdict> {
  const sdk = (await import('@anthropic-ai/claude-agent-sdk')) as {
    query: (params: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => QueryHandle;
  };
  const gate = createPromptGate('');
  const launch = buildClaudeLaunchOptions({
    cwd: options?.cwd ?? tmpdir(),
    bin: options?.bin,
    env: options?.env,
  });
  const query = sdk.query({
    prompt: gate.iterable,
    options: {
      ...launch,
      canUseTool: async () => ({ behavior: 'deny' as const, message: '连接检查不执行工具' }),
    },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const verdict = await new Promise<LoginVerdict>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('claude 订阅检查超时')), 8000);
      void (async () => {
        try {
          for await (const message of query) {
            const row = message as { type?: string; subtype?: string; apiKeySource?: string };
            if (row.type !== 'system' || row.subtype !== 'init') continue;
            const subscription = subscriptionFromClaudeInit(row.apiKeySource);
            const named = typeof row.apiKeySource === 'string' && row.apiKeySource.length > 0;
            resolve({
              loggedIn: subscription.ok || named,
              subscription: subscription.ok,
              source: subscription.ok ? 'apiKeySource=none' : subscription.source,
            });
            return;
          }
          resolve({ loggedIn: false, subscription: false, source: 'no-init' });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
    return verdict;
  } finally {
    if (timer) clearTimeout(timer);
    gate.block();
    await query.interrupt?.().catch(() => undefined);
    query.close?.();
  }
}
