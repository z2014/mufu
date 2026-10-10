import {
  SubscriptionRefused,
  type AgentAdapter,
  type AgentEvent,
  type AgentSession,
  type GateDecision,
  type StartSession,
} from '@mufu/core';

import { EventQueue } from '../line-queue.ts';
import { buildClaudeLaunchOptions } from './options.ts';
import { createPromptGate, normalizeClaudeMessage, operationForTool, subscriptionFromClaudeInit } from './protocol.ts';

type QueryHandle = AsyncIterable<unknown> & {
  interrupt?: () => Promise<unknown>;
  close?: () => void;
};

/**
 * 深模块：调用方只看到 startSession。
 * SDK 在运行时加载。确认 system/init 的 apiKeySource 之前，prompt 迭代器不吐出任务。
 */
export function createClaudeAdapter(options?: {
  bin?: string;
  env?: NodeJS.ProcessEnv;
  /** SDK 消息原样交给调用方。verify:mac 用来落盘。 */
  onRaw?: (message: unknown) => void;
}): AgentAdapter {
  return {
    kind: 'claude',
    async startSession(input: StartSession): Promise<AgentSession> {
      const sdk = (await import('@anthropic-ai/claude-agent-sdk')) as {
        query: (params: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => QueryHandle;
      };
      const gate = createPromptGate(input.prompt);
      const launch = buildClaudeLaunchOptions({
        cwd: input.workspacePath,
        bin: options?.bin,
        env: options?.env,
        resumeSessionId: input.resumeSessionId,
      });
      const decisions = new Map<string, (decision: GateDecision) => void>();
      let requestSerial = 0;
      const events = new EventQueue<AgentEvent>();
      let sessionId = input.resumeSessionId ?? '';
      let checked = false;
      let verdict: { ok: true; sessionId: string } | { ok: false; source: string } | null = null;
      let resolveVerdict: (value: { ok: true; sessionId: string } | { ok: false; source: string }) => void = () =>
        undefined;
      const verdictReady = new Promise<{ ok: true; sessionId: string } | { ok: false; source: string }>((resolve) => {
        resolveVerdict = resolve;
      });
      const finishVerdict = (value: { ok: true; sessionId: string } | { ok: false; source: string }) => {
        if (verdict) return;
        verdict = value;
        resolveVerdict(value);
      };

      const query = sdk.query({
        prompt: gate.iterable,
        options: {
          ...launch,
          canUseTool: async (toolName: string, toolInput: Record<string, unknown>) => {
            const requestId = `claude-${requestSerial}`;
            requestSerial += 1;
            const operation = operationForTool(toolName);
            const command = typeof toolInput.command === 'string' ? toolInput.command : '';
            events.push({
              type: 'approval_request',
              requestId,
              operation,
              summary: command || toolName,
              detail: toolName,
              gate: 'stage',
            });
            const decision = await new Promise<GateDecision>((resolve) => decisions.set(requestId, resolve));
            if (decision === 'approve') return { behavior: 'allow' as const };
            return { behavior: 'deny' as const, message: '幕府门禁打回了这次操作' };
          },
        },
      });

      const pump = (async () => {
        try {
          for await (const message of query) {
            options?.onRaw?.(message);
            const row = message as { type?: string; subtype?: string; apiKeySource?: string; session_id?: string };
            if (row.type === 'system' && row.subtype === 'init' && !checked) {
              checked = true;
              sessionId = row.session_id ?? sessionId;
              const subscription = subscriptionFromClaudeInit(row.apiKeySource);
              if (!subscription.ok) {
                gate.block();
                finishVerdict({ ok: false, source: subscription.source });
                await query.interrupt?.();
                query.close?.();
                return;
              }
              finishVerdict({ ok: true, sessionId });
              gate.allow();
            }
            const event = normalizeClaudeMessage(message);
            if (event) events.push(event);
            if (event?.type === 'completed' || event?.type === 'interrupted') {
              events.close();
              return;
            }
          }
        } catch (error) {
          events.push({
            type: 'environment_failure',
            message: error instanceof Error ? error.message : String(error),
            tool: 'claude',
            source: 'sdk',
            failure: 'network',
          });
        } finally {
          if (!checked) {
            gate.block();
            finishVerdict({ ok: false, source: 'apiKeySource=missing' });
          }
          events.close();
        }
      })();
      void pump;

      const decision = await Promise.race([
        verdictReady,
        new Promise<{ ok: false; source: string }>((resolve) => {
          setTimeout(() => resolve({ ok: false, source: 'apiKeySource=missing(init timeout)' }), 45_000);
        }),
      ]);
      if (!decision.ok) {
        throw new SubscriptionRefused('claude', decision.source);
      }

      return {
        sessionId: decision.sessionId,
        events,
        async decide(requestId, decision) {
          const resolve = decisions.get(requestId);
          if (!resolve) throw new Error(`没有待处理的审批 ${requestId}`);
          decisions.delete(requestId);
          resolve(decision);
        },
        async interrupt() {
          gate.block();
          await query.interrupt?.();
          events.push({ type: 'interrupted' });
          events.close();
        },
      };
    },
  };
}

export function refuseClaudeBeforePrompt(apiKeySource: string | undefined): SubscriptionRefused | null {
  const subscription = subscriptionFromClaudeInit(apiKeySource);
  if (subscription.ok) return null;
  return new SubscriptionRefused('claude', subscription.source);
}
