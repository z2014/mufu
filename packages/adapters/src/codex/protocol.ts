import type { AgentEvent, FailureReason, OperationKind } from '@mufu/core';

export type CodexAccount = {
  type?: string;
  email?: string | null;
  planType?: string;
};

export type CodexAccountRead = {
  account: CodexAccount | null;
  requiresOpenaiAuth?: boolean;
};

/** 订阅才放行。apiKey、空账号、Bedrock 都拒绝。不看 `codex login status`。 */
export function subscriptionFromCodexAccount(result: CodexAccountRead): { ok: true } | { ok: false; source: string } {
  const type = result.account?.type;
  if (type === 'chatgpt') return { ok: true };
  if (!result.account)
    return { ok: false, source: result.requiresOpenaiAuth ? 'account=null' : 'account=null,requiresOpenaiAuth=false' };
  return { ok: false, source: `account.type=${type ?? 'missing'}` };
}

export function codexLaunchArgs(bin: string): string[] {
  return [bin, '--config', 'forced_login_method="chatgpt"', 'app-server', '--listen', 'stdio://'];
}

/** 没有 turnId 就不发 interrupt。Codex 会回 -32600，回合继续跑。 */
export function turnInterruptParams(
  threadId: string | null,
  turnId: string | null,
): { threadId: string; turnId: string } | null {
  if (!threadId || !turnId) return null;
  return { threadId, turnId };
}

export function threadParams(input: { threadId?: string; cwd: string; model?: string }): Record<string, unknown> {
  return {
    ...(input.threadId ? { threadId: input.threadId } : {}),
    cwd: input.cwd,
    approvalPolicy: 'onRequest',
    sandbox: 'workspaceWrite',
    serviceName: 'mufu',
    ...(input.model ? { model: input.model } : {}),
  };
}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return value && typeof value === 'object' ? (value as Json) : null;
}

function messageThreadId(message: Json): string | null {
  const params = asRecord(message.params);
  if (!params) return null;
  if (typeof params.threadId === 'string') return params.threadId;
  const thread = asRecord(params.thread);
  if (thread && typeof thread.id === 'string') return thread.id;
  return null;
}

export function isForeignThread(message: Json, ownThreadId: string | null): boolean {
  if (!ownThreadId) return false;
  const threadId = messageThreadId(message);
  return threadId !== null && threadId !== ownThreadId;
}

const ENVIRONMENT_CODEX = new Set([
  'UsageLimitExceeded',
  'Unauthorized',
  'HttpConnectionFailed',
  'ResponseStreamConnectionFailed',
  'ResponseStreamDisconnected',
]);

export function classifyCodexError(info: { type?: string; httpStatusCode?: number } | undefined): FailureReason {
  const type = info?.type;
  const status = info?.httpStatusCode;
  if (type === 'UsageLimitExceeded' || status === 429) return { kind: 'rate_limit', detail: type ?? '429' };
  if (type === 'Unauthorized' || status === 401 || status === 403)
    return { kind: 'auth', detail: type ?? String(status) };
  if (type && ENVIRONMENT_CODEX.has(type)) return { kind: 'network', detail: type };
  return { kind: 'task', detail: type ?? 'codex failed' };
}

type CodexServerRequest = {
  id: number;
  method: string;
  params: Json;
};

export function isServerRequest(message: Json): message is Json & { id: number; method: string } {
  return typeof message.method === 'string' && typeof message.id === 'number';
}

/**
 * 审批回复用文档里的 accept/decline。
 * 不用 null，也不用 Nimbalyst 试过的 denied。
 * MCP elicitation 必须是 { action, content }。
 */
export function approvalResult(method: string, decision: 'approve' | 'reject', params: Json): Json {
  const accept = decision === 'approve';
  if (method === 'mcpServer/elicitation/request') {
    return accept ? { action: 'accept', content: {} } : { action: 'decline', content: null };
  }
  if (method === 'item/permissions/requestApproval') {
    return accept ? { permissions: params.permissions ?? {}, scope: 'turn' } : { permissions: {}, scope: 'turn' };
  }
  if (method === 'item/tool/requestUserInput') {
    return { answers: {} };
  }
  return { decision: accept ? 'accept' : 'decline' };
}

const APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'mcpServer/elicitation/request',
  'item/tool/requestUserInput',
  'applyPatchApproval',
  'execCommandApproval',
]);

export function isApprovalMethod(method: string): boolean {
  return APPROVAL_METHODS.has(method);
}

function operationForCodexMethod(method: string, params: Json): OperationKind {
  if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') return 'file_edit';
  if (method === 'mcpServer/elicitation/request') return 'mcp';
  if (method === 'item/permissions/requestApproval') {
    return params.network ? 'network' : 'other';
  }
  if (asRecord(params.networkApprovalContext)) return 'network';
  if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') return 'shell';
  return 'other';
}

export function approvalEvent(request: CodexServerRequest): Extract<AgentEvent, { type: 'approval_request' }> {
  const { params } = request;
  const itemId = typeof params.itemId === 'string' ? params.itemId : String(request.id);
  const command = typeof params.command === 'string' ? params.command : '';
  const reason = typeof params.reason === 'string' ? params.reason : '';
  const operation = operationForCodexMethod(request.method, params);
  const summary = command || reason || request.method;
  return {
    type: 'approval_request',
    requestId: String(request.id),
    operation,
    summary,
    detail: itemId,
    gate: 'stage',
  };
}

export function normalizeCodexNotification(message: Json, ownThreadId: string | null): AgentEvent | null {
  if (isForeignThread(message, ownThreadId)) return null;
  const { method } = message;
  const params = asRecord(message.params) ?? {};
  if (method === 'item/agentMessage/delta') {
    const delta = typeof params.delta === 'string' ? params.delta : '';
    if (!delta) return null;
    return { type: 'message', author: 'Codex', text: delta };
  }
  if (method === 'error') {
    const error = asRecord(params.error) ?? params;
    const info = asRecord(error.codexErrorInfo) ?? asRecord(params.codexErrorInfo);
    const errorType = typeof error.type === 'string' ? error.type : undefined;
    const failure = classifyCodexError({
      type: typeof info?.type === 'string' ? info.type : errorType,
      httpStatusCode: typeof info?.httpStatusCode === 'number' ? info.httpStatusCode : undefined,
    });
    if (failure.kind === 'task') return null;
    return {
      type: 'environment_failure',
      message: failure.detail,
      tool: 'codex',
      source: failure.detail,
      failure: failure.kind,
    };
  }
  if (method === 'turn/completed') {
    const turn = asRecord(params.turn);
    const status = typeof turn?.status === 'string' ? turn.status : '';
    if (status === 'interrupted') return { type: 'interrupted' };
    if (status === 'failed') {
      const error = asRecord(turn?.error);
      const info = asRecord(error?.codexErrorInfo);
      const failure = classifyCodexError({
        type: typeof info?.type === 'string' ? info.type : undefined,
        httpStatusCode: typeof info?.httpStatusCode === 'number' ? info.httpStatusCode : undefined,
      });
      if (failure.kind !== 'task') {
        return {
          type: 'environment_failure',
          message: failure.detail,
          tool: 'codex',
          source: failure.detail,
          failure: failure.kind,
        };
      }
      return { type: 'completed', ok: false, reason: failure.detail };
    }
    if (status === 'completed') return { type: 'completed', ok: true };
  }
  const item = asRecord(params.item);
  if (method === 'item/completed' && item?.type === 'agentMessage' && typeof item.text === 'string') {
    return { type: 'message', author: 'Codex', text: item.text };
  }
  return null;
}
