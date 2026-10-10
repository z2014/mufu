import type { AgentEvent, OperationKind } from '@mufu/core';

import { EventQueue } from '../line-queue.ts';

/**
 * 只有 apiKeySource === 'none' 算订阅（claude.ai / 没有 API key）。
 * ANTHROPIC_API_KEY、apiKeyHelper、/login managed key 都拒绝。
 * 旧值 oauth 当前 CLI 不再发；没见到录音之前不放行。
 */
export function subscriptionFromClaudeInit(
  apiKeySource: string | undefined,
): { ok: true } | { ok: false; source: string } {
  if (apiKeySource === 'none') return { ok: true };
  return { ok: false, source: `apiKeySource=${apiKeySource ?? 'missing'}` };
}

export function operationForTool(toolName: string): OperationKind {
  const name = toolName.toLowerCase();
  if (name === 'bash' || name === 'shell') return 'shell';
  if (name === 'edit' || name === 'write' || name === 'multiedit' || name === 'notebookedit') return 'file_edit';
  if (name === 'webfetch' || name === 'websearch') return 'network';
  if (name.startsWith('mcp__') || name.startsWith('mcp_')) return 'mcp';
  return 'other';
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return value && typeof value === 'object' ? (value as Json) : null;
}

/** 历史回放不是新消息。Vibe Kanban 漏掉 isReplay 时，恢复后的界面会把旧话再显示一遍。 */
export function isReplayMessage(message: Json): boolean {
  return message.isReplay === true || message.is_replay === true;
}

export function normalizeClaudeMessage(message: unknown): AgentEvent | null {
  const row = record(message);
  if (!row || typeof row.type !== 'string') return null;
  if (isReplayMessage(row)) return null;

  if (row.type === 'rate_limit_event') {
    const info = record(row.rate_limit_info);
    if (info?.status === 'rejected') {
      return {
        type: 'environment_failure',
        message: `Claude 限流（${typeof info.rateLimitType === 'string' ? info.rateLimitType : 'rejected'}）`,
        tool: 'claude',
        source: 'rate_limit_event',
        failure: 'rate_limit',
      };
    }
    return null;
  }

  if (row.type === 'system' && row.subtype === 'init') return null;

  if (row.type === 'assistant') {
    const content = record(row.message)?.content;
    const text = textFromContent(content);
    if (!text) return null;
    return { type: 'message', author: 'Claude', text };
  }

  if (row.type === 'control_request') {
    const request = record(row.request);
    if (request?.subtype !== 'can_use_tool') return null;
    const toolName = typeof request.tool_name === 'string' ? request.tool_name : 'tool';
    const input = record(request.input);
    const command = typeof input?.command === 'string' ? input.command : '';
    const description = typeof input?.description === 'string' ? input.description : '';
    return {
      type: 'approval_request',
      requestId: typeof row.request_id === 'string' ? row.request_id : toolName,
      operation: operationForTool(toolName),
      summary: command || description || toolName,
      detail: toolName,
      gate: 'stage',
    };
  }

  if (row.type === 'result') {
    if (row.subtype === 'success' || row.is_error === false) return { type: 'completed', ok: true };
    if (row.subtype === 'error_max_turns') return { type: 'completed', ok: false, reason: 'error_max_turns' };
    return { type: 'completed', ok: false, reason: typeof row.subtype === 'string' ? row.subtype : 'error' };
  }

  return null;
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      const row = record(block);
      if (row?.type === 'text' && typeof row.text === 'string') return row.text;
      return '';
    })
    .filter(Boolean)
    .join('');
}

export type SdkUserMessage = {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
};

/**
 * 任务提示留在迭代器里，等 system/init 确认是订阅登录再吐出。
 * 用 AsyncIterable 而不是字符串，避免 SDK 在 result 时关掉 stdin。
 */
export function createPromptGate(prompt: string): {
  iterable: AsyncIterable<SdkUserMessage>;
  allow(): void;
  block(): void;
  push(text: string): void;
  close(): void;
} {
  let settle: (ok: boolean) => void = () => undefined;
  const ready = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  let settled = false;
  const finish = (ok: boolean) => {
    if (settled) return;
    settled = true;
    settle(ok);
  };
  const more = new EventQueue<string>();
  const user = (content: string): SdkUserMessage => ({
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  });
  return {
    allow: () => finish(true),
    block: () => finish(false),
    push: (text) => more.push(text),
    close: () => more.close(),
    iterable: {
      async *[Symbol.asyncIterator]() {
        const ok = await ready;
        if (!ok) return;
        yield user(prompt);
        for await (const text of more) yield user(text);
      },
    },
  };
}

/** 文档里的 CLI 退路。主路径是 Agent SDK，这条只在 SDK 不可用时手工对照。 */
export function claudeCliFallbackArgs(prompt: string, permissionTool: string): string[] {
  return [
    '-p',
    '--verbose',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--permission-prompt-tool',
    permissionTool,
    '--permission-mode',
    'default',
    prompt,
  ];
}
