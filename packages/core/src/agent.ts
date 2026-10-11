import type { GateDecision } from '@mufu/schema';

export type { GateDecision };

export type AgentKind = 'codex' | 'claude';

export type OperationKind = 'shell' | 'file_edit' | 'network' | 'mcp' | 'final' | 'other';

export type AgentEvent =
  | { type: 'message'; author: string; text: string }
  | { type: 'system'; text: string }
  | { type: 'stage'; stageId: string }
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
  /** 团队模式一次只跑一个阶段。不传则由夹具自己走完整个流程。 */
  stageId?: string;
};

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
  /**
   * 任务还在跑时，人从任务页补的一句话。
   * 返回字符串时，守护进程立刻把它写进日志（门禁等待期间事件循环进不来）。
   */
  followUp?(text: string): string | void;
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

/** 日志里 pin 的 author。fold 丢掉任何不是这个作者的重点。 */
export const LEAD_PIN_AUTHOR = 'lead';

/** 阶段 1 的桩给每个完成阶段钉的正文前缀。 */
export const STAGE_DONE_PIN = '阶段完成';

/** 事件里的作者写成 codex 或 claude。已经是这两个词时保持原样。 */
export function concreteAuthor(author: string): string {
  if (author === 'codex' || author === 'Codex') return 'codex';
  if (author === 'claude' || author === 'Claude') return 'claude';
  return author;
}

/** 桩钉在重点条上的句子：阶段名，加上被钉消息开头大约 30 个字。 */
export function stageDoneText(stageTitle: string, messageText: string): string {
  const opening = Array.from(messageText).slice(0, 30).join('').trim();
  if (opening.length === 0) return `${STAGE_DONE_PIN}：${stageTitle}`;
  return `${STAGE_DONE_PIN}：${stageTitle} — ${opening}`;
}

export function leadIntro(workflowTitle: string, stageTitles: string[]): string {
  const steps = stageTitles.join('、');
  return `用「${workflowTitle}」流程处理：${steps}。`;
}
