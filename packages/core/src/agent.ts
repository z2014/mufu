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
      /** 给人看的句子。 */
      message: string;
      /** SDK 或进程原文。只写入事件日志，界面不读。 */
      raw?: string;
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

/** 适配器启动失败的种类。界面只认这个，不认 SDK 原文。 */
export type AgentStartupKind =
  'cli_not_found' | 'not_logged_in' | 'not_subscription' | 'rate_limit' | 'network' | 'launch_failed';

const STARTUP_KINDS: readonly AgentStartupKind[] = [
  'cli_not_found',
  'not_logged_in',
  'not_subscription',
  'rate_limit',
  'network',
  'launch_failed',
];

export function isStartupKind(source: string | undefined): source is AgentStartupKind {
  return STARTUP_KINDS.some((kind) => kind === source);
}

/** 这类失败的卡片动作去设置页。合并失败仍留在任务上。 */
export function attentionSettingsPath(source: string | undefined): '/settings' | null {
  return isStartupKind(source) ? '/settings' : null;
}

const TOOL_NAME = { codex: 'Codex', claude: 'Claude' } as const;

/** 给人看的句子。原始错误只进事件日志。 */
export function startupCopy(kind: AgentStartupKind, tool: 'codex' | 'claude'): string {
  const name = TOOL_NAME[tool];
  switch (kind) {
    case 'cli_not_found':
      return `找不到本机的 ${name}，去设置页检测`;
    case 'not_logged_in':
      return `${name} 还没登录，去设置页检测`;
    case 'not_subscription':
      return `${name} 不是订阅登录，去设置页检测`;
    case 'rate_limit':
      return `${name} 被限流了，去设置页检测`;
    case 'network':
      return `连不上本机的 ${name}，去设置页检测`;
    case 'launch_failed':
      return `${name} 没有启动，去设置页检测`;
  }
}

export class AgentStartupError extends Error {
  constructor(
    readonly kind: AgentStartupKind,
    readonly tool: 'codex' | 'claude',
    readonly raw: string,
  ) {
    super(raw);
    this.name = 'AgentStartupError';
  }
}

/** 日志里 pin 的 author。fold 丢掉任何不是这个作者的重点。 */
export const LEAD_PIN_AUTHOR = 'lead';

/** 阶段 1 的桩给每个完成阶段钉的正文前缀。 */
export const STAGE_DONE_PIN = '阶段完成';

/**
 * 写进日志前的作者。不把 Codex / Claude 改成小写。
 * 旧日志要换形状时走 `upgradeEvent`，不在这里打补丁。
 */
export function concreteAuthor(author: string): string {
  return author;
}

/** 桩钉在重点条上的句子：阶段名，加上被钉消息开头大约 30 个字。 */
export function stageDoneText(stageTitle: string, messageText: string): string {
  const opening = Array.from(messageText).slice(0, 30).join('').trim();
  if (opening.length === 0) return `${STAGE_DONE_PIN}：${stageTitle}`;
  return `${STAGE_DONE_PIN}：${stageTitle} — ${opening}`;
}

export function leadIntro(workflowTitle: string, stageTitles: string[], reason?: string): string {
  const steps = stageTitles.join('、');
  const because = reason && reason.length > 0 ? `${reason}。` : '';
  return `${because}用「${workflowTitle}」流程处理：${steps}。`;
}
