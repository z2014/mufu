import { describe, expect, it } from 'vitest';

import { SubscriptionRefused, type AgentEvent } from '@mufu/core';

import { LineQueue } from '../line-queue.ts';
import { createCodexAdapter } from './adapter.ts';
import type { CodexTransport } from './transport.ts';

type Script = {
  account?: unknown;
  resumeError?: string;
  turnId?: string | null;
  approval?: Record<string, unknown> | null;
  foreignThread?: boolean;
};

function scripted(script: Script) {
  const sent: Array<Record<string, unknown>> = [];
  const incoming = new LineQueue();
  const transport: CodexTransport = {
    argv: [],
    spawnEnv: {},
    incoming,
    send(line: string) {
      const message = JSON.parse(line) as Record<string, unknown>;
      sent.push(message);
      const id = message.id;
      if (message.method === 'initialize') {
        incoming.push(JSON.stringify({ id, result: { userAgent: 'test', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'linux' } }));
      } else if (message.method === 'account/read') {
        incoming.push(JSON.stringify({ id, result: script.account ?? { account: { type: 'chatgpt', planType: 'plus' }, requiresOpenaiAuth: true } }));
      } else if (message.method === 'thread/resume' && script.resumeError) {
        incoming.push(JSON.stringify({ id, error: { message: script.resumeError } }));
      } else if (message.method === 'thread/start' || message.method === 'thread/resume') {
        incoming.push(JSON.stringify({ id, result: { thread: { id: 'thr_real', sessionId: 'thr_real' } } }));
      } else if (message.method === 'turn/start') {
        const turnId = script.turnId === undefined ? 'turn_1' : script.turnId;
        incoming.push(JSON.stringify({ id, result: { turn: turnId ? { id: turnId } : {} } }));
        if (script.approval) {
          incoming.push(JSON.stringify(script.approval));
        }
        if (script.foreignThread) {
          incoming.push(JSON.stringify({ method: 'item/completed', params: { threadId: 'other', item: { type: 'agentMessage', text: 'child' } } }));
          incoming.push(JSON.stringify({ method: 'item/completed', params: { threadId: 'thr_real', item: { type: 'agentMessage', text: 'ours' } } }));
        }
      } else if (message.method === 'turn/interrupt') {
        incoming.push(JSON.stringify({ id, result: {} }));
      } else if (script.approval && id === script.approval.id) {
        incoming.push(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thr_real', turn: { id: 'turn_1', status: 'completed' } } }));
      }
    },
    close() {
      incoming.close();
    },
  };
  return { sent, transport };
}

function methods(sent: Array<Record<string, unknown>>): string[] {
  return sent.map((message) => String(message.method ?? ''));
}

describe('codex adapter sequencing', () => {
  it('apiKey 账号在 thread/start 和 turn/start 之前就被拒绝，且不会发起登录', async () => {
    const { sent, transport } = scripted({ account: { account: { type: 'apiKey' }, requiresOpenaiAuth: true } });
    let argv: string[] = [];
    const adapter = createCodexAdapter({
      env: { OPENAI_API_KEY: 'sk-should-not-pass', PATH: '/usr/bin' },
      spawn: (nextArgv, env) => {
        expect(env.OPENAI_API_KEY).toBeUndefined();
        argv = nextArgv;
        return transport;
      },
    });
    await expect(adapter.startSession({ taskId: 't', workspacePath: '/work', prompt: 'fix' })).rejects.toBeInstanceOf(SubscriptionRefused);
    expect(methods(sent)).toEqual(['initialize', 'initialized', 'account/read']);
    expect(methods(sent)).not.toContain('account/login/start');
    expect(methods(sent)).not.toContain('turn/start');
    expect(argv).toEqual(['codex', '--config', 'forced_login_method="chatgpt"', 'app-server', '--listen', 'stdio://']);
  });

  it('resume 失败时不退回 thread/start', async () => {
    const { sent, transport } = scripted({ resumeError: 'missing rollout' });
    const adapter = createCodexAdapter({ spawn: () => transport });
    await expect(
      adapter.startSession({ taskId: 't', workspacePath: '/work', prompt: 'again', resumeSessionId: 'thr_old' }),
    ).rejects.toThrow(/missing rollout/);
    expect(methods(sent)).toContain('thread/resume');
    expect(methods(sent)).not.toContain('thread/start');
    const resume = sent.find((message) => message.method === 'thread/resume');
    expect(resume?.params).toMatchObject({ threadId: 'thr_old', cwd: '/work', approvalPolicy: 'onRequest' });
  });

  it('审批比 item/started 先到也能回复 accept，且丢掉别的 thread', async () => {
    const approval = {
      method: 'item/commandExecution/requestApproval',
      id: 90,
      params: { itemId: 'item_early', threadId: 'thr_real', turnId: 'turn_1', command: 'echo probe', cwd: '/work' },
    };
    const { sent, transport } = scripted({ approval, foreignThread: true });
    const adapter = createCodexAdapter({ spawn: () => transport });
    const session = await adapter.startSession({ taskId: 't', workspacePath: '/work', prompt: 'fix' });
    expect(session.sessionId).toBe('thr_real');
    const collected: AgentEvent[] = [];
    const done = (async () => {
      for await (const event of session.events) {
        collected.push(event);
        if (event.type === 'approval_request') await session.decide(event.requestId, 'approve');
        if (event.type === 'completed') break;
      }
    })();
    await done;
    expect(collected.some((event) => event.type === 'message' && event.text === 'child')).toBe(false);
    expect(collected.some((event) => event.type === 'message' && event.text === 'ours')).toBe(true);
    const reply = sent.find((message) => message.id === 90);
    expect(reply?.result).toEqual({ decision: 'accept' });
    expect(collected.find((event) => event.type === 'approval_request')).toMatchObject({ requestId: '90', operation: 'shell' });
  });

  it('还没有 turnId 时 interrupt 不发请求', async () => {
    const { sent, transport } = scripted({ turnId: null });
    const adapter = createCodexAdapter({ spawn: () => transport });
    const session = await adapter.startSession({ taskId: 't', workspacePath: '/work', prompt: 'fix' });
    await session.interrupt();
    expect(methods(sent)).not.toContain('turn/interrupt');
  });

  it('有 turnId 时 interrupt 同时带 threadId 和 turnId', async () => {
    const { sent, transport } = scripted({});
    const adapter = createCodexAdapter({ spawn: () => transport });
    const session = await adapter.startSession({ taskId: 't', workspacePath: '/work', prompt: 'fix' });
    await session.interrupt();
    const interrupt = sent.find((message) => message.method === 'turn/interrupt');
    expect(interrupt?.params).toEqual({ threadId: 'thr_real', turnId: 'turn_1' });
  });
});
