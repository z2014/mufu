export type AgentKind = 'codex' | 'claude' | 'fake';

export type OperationKind = 'shell' | 'file_edit' | 'network' | 'mcp' | 'final' | 'other';

export type AgentEvent =
  | { type: 'message'; author: string; text: string; pinReason?: string }
  | { type: 'system'; text: string }
  | { type: 'stage'; stageId: string }
  | { type: 'pin'; message: string; reason: string; author: string }
  | { type: 'artifact'; title: string; detail: string }
  | {
      type: 'approval_request';
      requestId: string;
      operation: OperationKind;
      summary: string;
      detail: string;
      gate: 'stage' | 'final';
    }
  | { type: 'completed'; ok: boolean; reason?: string }
  | { type: 'interrupted' }
  | {
      type: 'environment_failure';
      message: string;
      tool?: string;
      source?: string;
      failure: 'rate_limit' | 'auth' | 'network';
    };

export type StartSession = {
  taskId: string;
  workspacePath: string;
  prompt: string;
  resumeSessionId?: string;
};

export type GateDecision = 'approve' | 'reject';

/**
 * 调用方只调用 startSession。订阅检查、环境变量清理、二进制路径和按 id 恢复都在实现里面。
 * 不是订阅登录时，在任务提示送出之前抛 SubscriptionRefused。
 */
export interface AgentAdapter {
  readonly kind: AgentKind;
  startSession(input: StartSession): Promise<AgentSession>;
}

export interface AgentSession {
  readonly sessionId: string;
  readonly events: AsyncIterable<AgentEvent>;
  decide(requestId: string, decision: GateDecision): Promise<void>;
  interrupt(): Promise<void>;
}

export class SubscriptionRefused extends Error {
  readonly failure = 'auth' as const;

  constructor(
    readonly tool: 'codex' | 'claude',
    readonly source: string,
  ) {
    super(`${tool} 不是订阅登录（${source}）`);
    this.name = 'SubscriptionRefused';
  }
}

export function leadIntro(workflowTitle: string, stageTitles: string[]): string {
  const steps = stageTitles.join('、');
  return `用「${workflowTitle}」流程处理：${steps}。`;
}
