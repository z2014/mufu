import { EVENT_SCHEMA_VERSION } from '@mufu/schema';

import { assertTransition, type DomainEvent, type TaskStatus, type TaskView, type Workflow } from './model.ts';

export function eventSchemaVersion(event: DomainEvent): number {
  return event.schemaVersion ?? EVENT_SCHEMA_VERSION;
}

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`事件缺少字符串字段 ${key}`);
  }
  return value;
}

function workflowOf(payload: Record<string, unknown>): Workflow {
  const value = payload.workflow;
  if (!value || typeof value !== 'object') throw new Error('事件缺少 workflow');
  return value as Workflow;
}

export function foldTasks(events: DomainEvent[]): TaskView[] {
  const map = new Map<string, TaskView>();
  for (const event of events) apply(map, event);
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

export function foldTask(events: DomainEvent[], taskId: string): TaskView | null {
  return foldTasks(events).find((task) => task.id === taskId) ?? null;
}

function apply(map: Map<string, TaskView>, event: DomainEvent): void {
  const version = eventSchemaVersion(event);
  if (version !== EVENT_SCHEMA_VERSION) {
    throw new Error(`不认识的事件版本 ${version}`);
  }
  if (event.type === 'task.created') {
    if (!event.taskId) throw new Error('task.created 缺少 taskId');
    const workflow = workflowOf(event.payload);
    const first = workflow.stages[0];
    map.set(event.taskId, {
      id: event.taskId,
      seq: Number(event.payload.seq),
      title: str(event.payload, 'title'),
      prompt: str(event.payload, 'prompt'),
      workflow,
      status: 'queued',
      stageId: first?.id ?? '',
      attention: null,
      pendingGate: null,
      sessionId: null,
      agentKind: null,
      sessions: {},
      pins: [],
      artifacts: [],
      messages: [{ id: event.id, role: 'user', author: '你', text: str(event.payload, 'prompt') }],
      attempts: 0,
      runs: 0,
      workspacePath: null,
      updatedAt: event.at,
    });
    return;
  }

  if (!event.taskId) return;
  const task = map.get(event.taskId);
  if (!task) return;
  task.updatedAt = event.at;
  const { payload } = event;

  switch (event.type) {
    case 'task.status': {
      const next = str(payload, 'status') as TaskStatus;
      assertTransition(task.status, next);
      task.status = next;
      if (next === 'running' || next === 'done' || next === 'queued') task.attention = null;
      if (next !== 'needs_you' && next !== 'to_review') task.pendingGate = null;
      break;
    }
    case 'stage.entered':
      task.stageId = str(payload, 'stageId');
      break;
    case 'workspace.created':
      task.workspacePath = str(payload, 'path');
      break;
    case 'run.started':
      task.runs += 1;
      break;
    case 'attempt.counted':
      task.attempts = Number(payload.attempt);
      break;
    case 'agent.session': {
      const kind = str(payload, 'kind');
      const sessionId = str(payload, 'sessionId');
      task.sessionId = sessionId;
      task.agentKind = kind;
      if (kind === 'codex' || kind === 'claude' || kind === 'fake') task.sessions[kind] = sessionId;
      break;
    }
    case 'agent.message':
      task.messages.push({
        id: event.id,
        role: payload.role === 'lead' || payload.role === 'system' || payload.role === 'user' ? payload.role : 'agent',
        author: str(payload, 'author'),
        text: str(payload, 'text'),
        pinReason: typeof payload.pinReason === 'string' ? payload.pinReason : undefined,
      });
      break;
    case 'gate.opened':
      task.pendingGate = {
        id: str(payload, 'gateId'),
        requestId: str(payload, 'requestId'),
        kind: payload.kind === 'final' ? 'final' : 'stage',
        operation: str(payload, 'operation'),
        summary: str(payload, 'summary'),
        detail: typeof payload.detail === 'string' ? payload.detail : '',
      };
      break;
    case 'gate.resolved':
      if (task.pendingGate?.id === payload.gateId) task.pendingGate = null;
      break;
    case 'pin.added':
      task.pins.push({
        id: str(payload, 'pinId'),
        message: str(payload, 'message'),
        reason: str(payload, 'reason'),
        author: str(payload, 'author'),
        stageId: str(payload, 'stageId'),
        read: false,
      });
      break;
    case 'pin.read':
      for (const pin of task.pins) {
        if (payload.pinId === undefined || pin.id === payload.pinId) pin.read = true;
      }
      break;
    case 'artifact.added':
      task.artifacts.push({
        id: str(payload, 'artifactId'),
        title: str(payload, 'title'),
        detail: typeof payload.detail === 'string' ? payload.detail : '',
      });
      break;
    case 'environment.failed':
      task.attention = {
        message: str(payload, 'message'),
        tool: typeof payload.tool === 'string' ? payload.tool : undefined,
        source: typeof payload.source === 'string' ? payload.source : undefined,
      };
      break;
    default:
      break;
  }
}
