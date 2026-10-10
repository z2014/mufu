export type TaskStatus = 'queued' | 'running' | 'needs_you' | 'to_review' | 'done';

export type Column = 'needs_you' | 'running' | 'to_review';

export type WorkflowStage = {
  id: string;
  title: string;
  gate?: 'final' | 'stage';
};

export type Workflow = {
  id: string;
  title: string;
  doneWhen: 'pr_merged' | 'final_gate_approved';
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
};

export type ArtifactView = {
  id: string;
  title: string;
  detail: string;
};

export type MessageView = {
  id: string;
  role: 'user' | 'lead' | 'agent' | 'system';
  author: string;
  text: string;
  pinReason?: string;
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
  pins: PinView[];
  artifacts: ArtifactView[];
  messages: MessageView[];
  attempts: number;
  runs: number;
  workspacePath: string | null;
  updatedAt: string;
};

export type DomainEvent = {
  id: string;
  taskId: string | null;
  at: string;
  type: string;
  payload: Record<string, unknown>;
};

export const MAX_ATTEMPTS = 3;
export const MAX_PINS_PER_STAGE = 5;

export type FailureKind = 'rate_limit' | 'auth' | 'network' | 'task';

export type FailureReason = {
  kind: FailureKind;
  detail: string;
};

/** 限流、登录过期、断网是环境失败，不算尝试。 */
export function countsAsAttempt(reason: FailureReason): boolean {
  return reason.kind === 'task';
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
  queued: ['running', 'needs_you'],
  running: ['needs_you', 'to_review', 'queued', 'done'],
  needs_you: ['running', 'to_review', 'done'],
  to_review: ['done', 'running', 'needs_you'],
  done: [],
};

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) return;
  if (!allowed[from].includes(to)) {
    throw new Error(`任务不能从 ${from} 进入 ${to}`);
  }
}
