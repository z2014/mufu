import { EVENT_SCHEMA_VERSION } from '@mufu/schema';

import { LEAD_PIN_AUTHOR } from './agent.ts';
import type { Mergeability } from './github.ts';
import {
  assertTransition,
  stageAfterReject,
  type DomainEvent,
  type TaskStatus,
  type TaskView,
  type Workflow,
} from './model.ts';

export function eventSchemaVersion(event: DomainEvent): number {
  return event.schemaVersion ?? EVENT_SCHEMA_VERSION;
}

/**
 * 把一条事件升到当前版本后再折叠。
 * 现在只有版本 1，没有字段要改。以后换版本只加在这里。
 */
export function upgradeEvent(event: DomainEvent): DomainEvent {
  const version = eventSchemaVersion(event);
  if (version === EVENT_SCHEMA_VERSION) return { ...event, schemaVersion: EVENT_SCHEMA_VERSION };
  throw new Error(`不认识的事件版本 ${version}`);
}

function pinIdsOf(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.pinIds)) return [];
  return payload.pinIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`事件缺少字符串字段 ${key}`);
  }
  return value;
}

function diffOf(payload: Record<string, unknown>): TaskView['diff'] {
  const files = Array.isArray(payload.files)
    ? payload.files.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const row = item as { path?: unknown; additions?: unknown; deletions?: unknown };
        if (typeof row.path !== 'string' || row.path.length === 0) return [];
        return [
          {
            path: row.path,
            additions: typeof row.additions === 'number' ? row.additions : 0,
            deletions: typeof row.deletions === 'number' ? row.deletions : 0,
          },
        ];
      })
    : [];
  return {
    pr: typeof payload.pr === 'number' ? payload.pr : null,
    fileCount: files.length,
    additions: typeof payload.additions === 'number' ? payload.additions : 0,
    deletions: typeof payload.deletions === 'number' ? payload.deletions : 0,
    files,
  };
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

function apply(map: Map<string, TaskView>, raw: DomainEvent): void {
  const event = upgradeEvent(raw);
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
      status: 'running',
      stageId: first?.id ?? '',
      attention: null,
      pendingGate: null,
      sessionId: null,
      agentKind: null,
      sessions: {},
      pins: [],
      artifacts: [],
      messages: [{ id: event.id, role: 'user', author: '你', text: str(event.payload, 'prompt') }],
      workflowReason: null,
      canChangeWorkflow: true,
      attempts: 0,
      runs: 0,
      workspacePath: null,
      merging: false,
      mergePr: null,
      diff: null,
      ci: null,
      runStartedAt: null,
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
      if (next === 'running' || next === 'done') task.attention = null;
      if (next !== 'needs_you' && next !== 'to_review') task.pendingGate = null;
      break;
    }
    case 'stage.entered':
      task.stageId = str(payload, 'stageId');
      break;
    case 'template.chosen':
      task.workflowReason = str(payload, 'reason');
      break;
    case 'template.changed': {
      const workflow = workflowOf(payload);
      task.workflow = workflow;
      task.workflowReason = str(payload, 'reason');
      task.stageId = workflow.stages[0]?.id ?? '';
      task.canChangeWorkflow = true;
      task.pendingGate = null;
      task.sessions = {};
      task.sessionId = null;
      task.attention = null;
      break;
    }
    case 'stage.agent': {
      const stageId = str(payload, 'stageId');
      const agent = str(payload, 'agent');
      if (agent !== 'codex' && agent !== 'claude') break;
      task.workflow = {
        ...task.workflow,
        stages: task.workflow.stages.map((stage) => (stage.id === stageId ? { ...stage, agent } : stage)),
      };
      break;
    }
    case 'workspace.created':
      task.workspacePath = str(payload, 'path');
      break;
    case 'run.started':
      task.runs += 1;
      task.runStartedAt = event.at;
      break;
    case 'attempt.counted':
      task.attempts = Number(payload.attempt);
      break;
    case 'agent.session': {
      const kind = str(payload, 'kind');
      const sessionId = str(payload, 'sessionId');
      task.sessionId = sessionId;
      if (kind === 'codex' || kind === 'claude') {
        task.agentKind = kind;
        task.sessions[kind] = sessionId;
      }
      break;
    }
    case 'agent.message': {
      const raw = str(payload, 'author');
      const kind = raw === 'codex' || raw === 'claude' ? raw : null;
      if (kind) task.agentKind = kind;
      const role = payload.role === 'lead' || payload.role === 'system' || payload.role === 'user' ? payload.role : 'agent';
      task.messages.push({
        id: event.id,
        role,
        author: raw,
        text: str(payload, 'text'),
      });
      if (role === 'agent') task.canChangeWorkflow = false;
      break;
    }
    case 'gate.opened':
      task.pendingGate = {
        id: str(payload, 'gateId'),
        requestId: str(payload, 'requestId'),
        kind: payload.kind === 'final' ? 'final' : 'stage',
        operation: str(payload, 'operation'),
        summary: str(payload, 'summary'),
        detail: typeof payload.detail === 'string' ? payload.detail : '',
      };
      task.canChangeWorkflow = false;
      break;
    case 'gate.resolved':
      if (task.pendingGate?.id === payload.gateId) task.pendingGate = null;
      if (payload.decision === 'reject') task.stageId = stageAfterReject(task.workflow, task.stageId);
      break;
    case 'pin.added': {
      if (payload.author !== LEAD_PIN_AUTHOR) break;
      task.pins.push({
        id: str(payload, 'pinId'),
        message: str(payload, 'message'),
        reason: str(payload, 'reason'),
        author: LEAD_PIN_AUTHOR,
        stageId: str(payload, 'stageId'),
        read: false,
        messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined,
      });
      break;
    }
    case 'pin.read': {
      const ids = new Set(pinIdsOf(payload));
      for (const pin of task.pins) {
        if (ids.has(pin.id)) pin.read = true;
      }
      break;
    }
    case 'artifact.added': {
      const kind = payload.kind === 'diff' ? 'diff' : undefined;
      const detail = typeof payload.detail === 'string' ? payload.detail : '';
      if (kind === 'diff') task.diff = diffOf(payload);
      task.artifacts.push({
        id: str(payload, 'artifactId'),
        title: str(payload, 'title'),
        detail,
        ...(kind ? { kind } : {}),
      });
      task.canChangeWorkflow = false;
      break;
    }
    case 'environment.failed':
      task.attention = {
        message: str(payload, 'message'),
        tool: typeof payload.tool === 'string' ? payload.tool : undefined,
        source: typeof payload.source === 'string' ? payload.source : undefined,
      };
      break;
    case 'ci.reported': {
      const pr = Number(payload.pr);
      const { state } = payload;
      if (!Number.isInteger(pr)) break;
      const mergeable: Mergeability =
        payload.mergeable === 'clean' || payload.mergeable === 'conflict' ? payload.mergeable : 'unknown';
      task.ci = {
        pr,
        state: state === 'passed' || state === 'failed' || state === 'pending' ? state : 'pending',
        mergeable,
        additions: typeof payload.additions === 'number' ? payload.additions : null,
        deletions: typeof payload.deletions === 'number' ? payload.deletions : null,
      };
      break;
    }
    case 'merge_requested':
      task.merging = true;
      task.mergePr = typeof payload.pr === 'number' ? payload.pr : null;
      break;
    case 'merge_succeeded':
      task.merging = false;
      task.mergePr = null;
      break;
    case 'merge_failed':
      task.merging = false;
      task.mergePr = null;
      task.attention = {
        message: typeof payload.message === 'string' && payload.message.length > 0 ? payload.message : '合并失败',
        source: typeof payload.reason === 'string' ? payload.reason : undefined,
      };
      break;
    default:
      break;
  }
}
