import type { TaskStatus } from '@mufu/schema';

import type { CiState, Mergeability } from './github.ts';

export type { TaskStatus };
export type { CiState };

export type Column = 'needs_you' | 'running' | 'to_review';

export type StageAgent = 'codex' | 'claude';

export type WorkflowStage = {
  id: string;
  title: string;
  gate?: 'final' | 'stage';
  /** 打回最终门禁时回到的阶段。缺省时用门禁前面最近一个没有门禁的阶段。 */
  rejectTo?: string;
  /** 这一阶段用哪个代理。任务创建时可以盖掉模板。 */
  agent?: StageAgent;
};

export type Workflow = {
  id: string;
  title: string;
  doneWhen: 'pr_merged';
  stages: WorkflowStage[];
};

export type Attention = {
  message: string;
  tool?: string;
  source?: string;
};

export type GateView = {
  id: string;
  requestId: string;
  kind: 'stage' | 'final';
  operation: string;
  summary: string;
  detail: string;
};

export type PinView = {
  id: string;
  message: string;
  reason: string;
  author: string;
  stageId: string;
  read: boolean;
  /** 钉住时最近的一条非用户消息，点重点时滚到它。 */
  messageId?: string;
};

export type DiffFileView = {
  path: string;
  additions: number;
  deletions: number;
};

/** PR 阶段结束时写下的改动。数字只来自这一条事件。 */
export type DiffView = {
  pr: number | null;
  fileCount: number;
  additions: number;
  deletions: number;
  files: DiffFileView[];
};

export type ArtifactView = {
  id: string;
  title: string;
  detail: string;
  kind?: 'diff';
};

export type MessageView = {
  id: string;
  role: 'user' | 'lead' | 'agent' | 'system';
  author: string;
  text: string;
};

export type TaskView = {
  id: string;
  seq: number;
  title: string;
  prompt: string;
  workflow: Workflow;
  status: TaskStatus;
  stageId: string;
  attention: Attention | null;
  pendingGate: GateView | null;
  sessionId: string | null;
  agentKind: string | null;
  /** 每个代理最近一次会话 id，恢复时用它，不用任务 id。 */
  sessions: Partial<Record<StageAgent, string>>;
  pins: PinView[];
  artifacts: ArtifactView[];
  messages: MessageView[];
  attempts: number;
  runs: number;
  workspacePath: string | null;
  /** `merge_requested` 已写下，还没有成功或失败。重启后仍然成立。 */
  merging: boolean;
  /** PR 阶段结束时的文件列表。没有这条事件就是 null。 */
  diff: DiffView | null;
  /** 待验收卡片上的 PR。只来自守护进程写下的事件。 */
  ci: {
    pr: number;
    state: CiState;
    mergeable: Mergeability;
    additions: number | null;
    deletions: number | null;
  } | null;
  /** 最近一次运行开始的时间，进行中卡片用来显示已经跑了多久。 */
  runStartedAt: string | null;
  updatedAt: string;
};

export type DomainEvent = {
  /** 缺省是 1。见 EVENT_SCHEMA_VERSION。 */
  schemaVersion?: number;
  id: string;
  taskId: string | null;
  at: string;
  type: string;
  payload: Record<string, unknown>;
};

export const MAX_ATTEMPTS = 3;
export const MAX_PINS_PER_STAGE = 5;

export type FailureKind = 'rate_limit' | 'auth' | 'network' | 'task' | 'conflict' | 'ci_failed' | 'environment';

export type FailureReason = {
  kind: FailureKind;
  detail: string;
};

/**
 * 限流、登录过期、断网，以及 gh 没登录或网络导致的合并失败，都不算尝试。
 * 任务本身失败、合并冲突、CI 失败算尝试。
 */
export function countsAsAttempt(reason: FailureReason): boolean {
  return reason.kind === 'task' || reason.kind === 'conflict' || reason.kind === 'ci_failed';
}

export function columnOf(task: TaskView): Column | null {
  if (task.status === 'done') return null;
  if (task.status === 'needs_you') return 'needs_you';
  if (task.status === 'to_review') return 'to_review';
  return 'running';
}

/** 带「!」的环境/尝试失败排在列首。 */
export function sortInColumn(tasks: TaskView[]): TaskView[] {
  return [...tasks].sort((a, b) => {
    const rank = (task: TaskView) => (task.attention ? 0 : 1);
    const byAttention = rank(a) - rank(b);
    if (byAttention !== 0) return byAttention;
    return a.seq - b.seq;
  });
}

const allowed: Record<TaskStatus, TaskStatus[]> = {
  running: ['needs_you', 'to_review', 'done'],
  needs_you: ['running', 'to_review', 'done'],
  to_review: ['done', 'running', 'needs_you'],
  done: [],
};

/**
 * 打回之后任务回到的阶段。模板写了 rejectTo 就用它；否则用当前阶段前面最近一个没有门禁的阶段。
 */
export function stageAfterReject(workflow: Workflow, stageId: string): string {
  const index = workflow.stages.findIndex((stage) => stage.id === stageId);
  const current = index >= 0 ? workflow.stages[index] : undefined;
  if (current?.rejectTo) {
    const named = workflow.stages.find((stage) => stage.id === current.rejectTo);
    if (named) return named.id;
  }
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const stage = workflow.stages[cursor];
    if (stage && !stage.gate) return stage.id;
  }
  return current?.id ?? workflow.stages[0]?.id ?? stageId;
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) return;
  if (!allowed[from].includes(to)) {
    throw new Error(`任务不能从 ${from} 进入 ${to}`);
  }
}
