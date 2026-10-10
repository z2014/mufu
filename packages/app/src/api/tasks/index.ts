import type { TaskView } from '@mufu/core/view';
import { z } from 'zod';

import { DaemonError, rpc } from '@/api/client';

export { DaemonError };

const taskStatusSchema = z.enum(['running', 'needs_you', 'to_review', 'done']);

const taskViewSchema = z.object({
  id: z.string(),
  seq: z.number(),
  title: z.string(),
  prompt: z.string(),
  workflow: z.object({
    id: z.string(),
    title: z.string(),
    doneWhen: z.enum(['pr_merged']),
    stages: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        gate: z.enum(['final', 'stage']).optional(),
        agent: z.enum(['codex', 'claude']).optional(),
      }),
    ),
  }),
  status: taskStatusSchema,
  stageId: z.string(),
  attention: z
    .object({
      message: z.string(),
      tool: z.string().optional(),
      source: z.string().optional(),
    })
    .nullable(),
  pendingGate: z
    .object({
      id: z.string(),
      requestId: z.string(),
      kind: z.enum(['stage', 'final']),
      operation: z.string(),
      summary: z.string(),
      detail: z.string(),
    })
    .nullable(),
  sessionId: z.string().nullable(),
  agentKind: z.string().nullable(),
  sessions: z.object({
    codex: z.string().optional(),
    claude: z.string().optional(),
  }),
  ci: z
    .object({
      pr: z.number(),
      state: z.enum(['pending', 'passed', 'failed']),
    })
    .nullable(),
  pins: z.array(
    z.object({
      id: z.string(),
      message: z.string(),
      reason: z.string(),
      author: z.string(),
      stageId: z.string(),
      read: z.boolean(),
      messageId: z.string().optional(),
    }),
  ),
  artifacts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      detail: z.string(),
    }),
  ),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['user', 'lead', 'agent', 'system']),
      author: z.string(),
      text: z.string(),
    }),
  ),
  attempts: z.number(),
  runs: z.number(),
  workspacePath: z.string().nullable(),
  updatedAt: z.string(),
});

const workflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  default: z.boolean(),
  doneWhen: z.enum(['pr_merged']),
  stages: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      gate: z.enum(['final', 'stage']).optional(),
      agent: z.enum(['codex', 'claude']).optional(),
    }),
  ),
});

type WorkflowChoice = z.infer<typeof workflowSchema>;

export const taskKeys = {
  list: ['tasks', 'list'] as const,
  detail: (taskId: string) => ['tasks', taskId] as const,
  workflows: ['workflows'] as const,
};

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DaemonError(`${label}的形状不对`);
  return parsed.data;
}

export async function listTasks(): Promise<TaskView[]> {
  return parse(z.array(taskViewSchema), await rpc('task.list'), '任务列表');
}

export async function getTask(taskId: string): Promise<TaskView | null> {
  const result = await rpc('task.get', { taskId });
  if (result === null || result === undefined) return null;
  return parse(taskViewSchema, result, '任务');
}

export async function createTask(input: {
  title: string;
  prompt: string;
  workflowId: string;
  repoPath?: string;
  agents?: Record<string, 'codex' | 'claude'>;
}): Promise<TaskView> {
  return parse(taskViewSchema, await rpc('task.create', input), '新任务');
}

export async function listWorkflows(): Promise<WorkflowChoice[]> {
  return parse(z.array(workflowSchema), await rpc('workflows.list'), '流程');
}

export async function resolveGate(gateId: string, decision: 'approve' | 'reject'): Promise<unknown> {
  return rpc('gate.resolve', { gateId, decision });
}

export async function readPins(taskId: string): Promise<TaskView | null> {
  const result = await rpc('pin.readAll', { taskId });
  if (result === null || result === undefined) return null;
  return parse(taskViewSchema, result, '任务');
}

export async function addNote(taskId: string, text: string): Promise<TaskView | null> {
  const result = await rpc('task.note', { taskId, text });
  if (result === null || result === undefined) return null;
  return parse(taskViewSchema, result, '任务');
}
