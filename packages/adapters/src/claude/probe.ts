import { tmpdir } from 'node:os';

import type { LoginVerdict } from '../login.ts';
import { buildClaudeLaunchOptions } from './options.ts';
import { createPromptGate, subscriptionFromClaudeAccount, type ClaudeAccount } from './protocol.ts';

type QueryHandle = {
  accountInfo: () => Promise<ClaudeAccount>;
  close?: () => void;
};

/**
 * 读取 initialize 的 account，然后关闭进程。
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
    const account = await Promise.race([
      query.accountInfo(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('claude 订阅检查超时')), 8000);
      }),
    ]);
    const subscription = subscriptionFromClaudeAccount(account);
    return {
      loggedIn: Boolean(
        account.subscriptionType || account.tokenSource || (account.apiKeySource && account.apiKeySource !== 'none'),
      ),
      subscription: subscription.ok,
      source: subscription.ok ? `account.subscriptionType=${account.subscriptionType}` : subscription.source,
    };
  } finally {
    if (timer) clearTimeout(timer);
    gate.block();
    gate.close();
    query.close?.();
  }
}
