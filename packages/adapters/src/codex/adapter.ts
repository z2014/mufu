import { PRODUCT_VERSION, SubscriptionRefused, type AgentAdapter, type AgentEvent, type AgentSession, type GateDecision, type StartSession } from '@mufu/core';

import { scrubEnv } from '../env.ts';
import { EventQueue } from '../line-queue.ts';
import {
  approvalEvent,
  approvalResult,
  codexLaunchArgs,
  isApprovalMethod,
  isForeignThread,
  isServerRequest,
  normalizeCodexNotification,
  subscriptionFromCodexAccount,
  threadParams,
  turnInterruptParams,
  type CodexAccountRead,
} from './protocol.ts';
import { spawnCodexTransport, type CodexTransport } from './transport.ts';

type Spawn = (argv: string[], env: NodeJS.ProcessEnv) => CodexTransport;

type Json = Record<string, unknown>;

function parseLine(line: string): Json | null {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === 'object' ? (value as Json) : null;
  } catch {
    return null;
  }
}

export function createCodexAdapter(options?: {
  bin?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: Spawn;
  /** 原样收下 app-server 的每一行。verify:mac 用来落盘，适配器自己不改这些字符串。 */
  onRaw?: (line: string) => void;
}): AgentAdapter {
  const spawnTransport = options?.spawn ?? spawnCodexTransport;
  return {
    kind: 'codex',
    async startSession(input: StartSession): Promise<AgentSession> {
      const bin = options?.bin ?? 'codex';
      const spawnEnv = scrubEnv(options?.env ?? process.env);
      const argv = codexLaunchArgs(bin);
      const transport = spawnTransport(argv, spawnEnv);
      const incoming = wrapRaw(transport.incoming, options?.onRaw);
      const events = new EventQueue<AgentEvent>();
      const pending = new Map<number, (message: Json) => void>();
      const decisions = new Map<string, (decision: GateDecision) => void>();
      let nextId = 1;
      let threadId: string | null = input.resumeSessionId ?? null;
      let turnId: string | null = null;
      let closed = false;

      const fail = (error: Error) => {
        if (!closed) events.push({ type: 'environment_failure', message: error.message, tool: 'codex', source: error.message, failure: 'auth' });
      };

      const send = (method: string, params: Json, expectReply: boolean): Promise<Json> => {
        const id = nextId;
        nextId += 1;
        const message = expectReply ? { method, id, params } : { method, params };
        if (!expectReply) {
          transport.send(JSON.stringify(message));
          return Promise.resolve({});
        }
        return new Promise((resolve, reject) => {
          pending.set(id, (reply) => {
            if (reply.error) {
              const error = reply.error as { message?: string };
              reject(new Error(error.message ?? `${method} 失败`));
              return;
            }
            resolve(reply);
          });
          transport.send(JSON.stringify(message));
        });
      };

      const reader = (async () => {
        for await (const line of incoming) {
          const message = parseLine(line);
          if (!message) continue;
          if (isServerRequest(message)) {
            const request = { id: message.id, method: String(message.method), params: (message.params as Json) ?? {} };
            if (isForeignThread(message, threadId)) continue;
            if (isApprovalMethod(request.method)) {
              const event = approvalEvent(request);
              events.push(event);
              const decision = await new Promise<GateDecision>((resolve) => {
                decisions.set(event.requestId, resolve);
              });
              transport.send(JSON.stringify({ id: request.id, result: approvalResult(request.method, decision, request.params) }));
              continue;
            }
            transport.send(JSON.stringify({ id: request.id, result: { decision: 'decline' } }));
            continue;
          }
          if (typeof message.id === 'number' && pending.has(message.id)) {
            const resolve = pending.get(message.id);
            pending.delete(message.id);
            resolve?.(message);
            continue;
          }
          if (typeof message.method === 'string') {
            if (isForeignThread(message, threadId)) continue;
            const event = normalizeCodexNotification(message, threadId);
            if (event) events.push(event);
            if (event?.type === 'completed' || event?.type === 'interrupted') {
              events.close();
              transport.close();
            }
          }
        }
        events.close();
      })();
      void reader;

      try {
        await send('initialize', { clientInfo: { name: 'mufu', title: 'mufu', version: PRODUCT_VERSION } }, true);
        await send('initialized', {}, false);
        const accountReply = await send('account/read', { refreshToken: false }, true);
        const account = (accountReply.result ?? {}) as CodexAccountRead;
        const subscription = subscriptionFromCodexAccount(account);
        if (!subscription.ok) {
          closed = true;
          transport.close();
          throw new SubscriptionRefused('codex', subscription.source);
        }

        const params = threadParams({ threadId: input.resumeSessionId, cwd: input.workspacePath });
        const method = input.resumeSessionId ? 'thread/resume' : 'thread/start';
        let started: Json;
        try {
          started = await send(method, params, true);
        } catch (error) {
          closed = true;
          transport.close();
          throw error;
        }
        const result = (started.result ?? {}) as { thread?: { id?: string } };
        threadId = result.thread?.id ?? input.resumeSessionId ?? null;
        if (!threadId) throw new Error('thread 没有 id');

        const turn = await send(
          'turn/start',
          { threadId, input: [{ type: 'text', text: input.prompt }] },
          true,
        );
        const turnResult = (turn.result ?? {}) as { turn?: { id?: string } };
        turnId = turnResult.turn?.id ?? null;

        const sessionId = threadId;
        return {
          sessionId,
          events,
          async decide(requestId: string, decision: GateDecision) {
            const resolve = decisions.get(requestId);
            if (!resolve) throw new Error(`没有待处理的审批 ${requestId}`);
            decisions.delete(requestId);
            resolve(decision);
          },
          async interrupt() {
            const interrupt = turnInterruptParams(threadId, turnId);
            if (interrupt) await send('turn/interrupt', interrupt, true).catch(() => undefined);
            transport.close();
          },
        };
      } catch (error) {
        if (!(error instanceof SubscriptionRefused)) fail(error instanceof Error ? error : new Error(String(error)));
        transport.close();
        events.close();
        throw error;
      }
    },
  };
}

async function* wrapRaw(incoming: AsyncIterable<string>, onRaw?: (line: string) => void): AsyncGenerator<string> {
  for await (const line of incoming) {
    onRaw?.(line);
    yield line;
  }
}
