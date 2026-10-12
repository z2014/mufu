import type { TaskView } from '@mufu/core/view';
import { useQuery } from '@tanstack/react-query';
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
        rejectTo: z.string().optional(),
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
      mergeable: z.enum(['clean', 'conflict', 'unknown']),
      additions: z.number().nullable(),
      deletions: z.number().nullable(),
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
      kind: z.enum(['diff']).optional(),
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
  workflowReason: z.string().nullable(),
  canChangeWorkflow: z.boolean(),
  merging: z.boolean(),
  mergePr: z.number().nullable(),
  diff: z
    .object({
      pr: z.number().nullable(),
      fileCount: z.number(),
      additions: z.number(),
      deletions: z.number(),
      files: z.array(
        z.object({
          path: z.string(),
          additions: z.number(),
          deletions: z.number(),
        }),
      ),
    })
    .nullable(),
  runStartedAt: z.string().nullable(),
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
  all: ['tasks'] as const,
  list: ['tasks', 'list'] as const,
  detail: (taskId: string) => ['tasks', taskId] as const,
  workflows: ['workflows'] as const,
};

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DaemonError(`${label}的形状不对`);
  return parsed.data;
}

async function listTasks(): Promise<TaskView[]> {
  return parse(z.array(taskViewSchema), await rpc('task.list'), '任务列表');
}

export function useTasks() {
  return useQuery({ queryKey: taskKeys.list, queryFn: listTasks });
}

export async function getTask(taskId: string): Promise<TaskView | null> {
  const result = await rpc('task.get', { taskId });
  if (result === null || result === undefined) return null;
  return parse(taskViewSchema, result, '任务');
}

export async function checkWorkdir(repoPath: string): Promise<void> {
  await rpc('workdir.check', { repoPath });
}

export async function createTask(input: {
  title: string;
  prompt: string;
  repoPath?: string;
  workflowId?: string;
  agents?: Record<string, 'codex' | 'claude'>;
}): Promise<TaskView> {
  return parse(taskViewSchema, await rpc('task.create', input), '新任务');
}

export async function changeWorkflow(taskId: string, workflowId: string): Promise<TaskView | null> {
  const result = await rpc('template.change', { taskId, workflowId });
  if (result === null || result === undefined) return null;
  return parse(taskViewSchema, result, '任务');
}

export async function setStageAgent(
  taskId: string,
  stageId: string,
  agent: 'codex' | 'claude',
): Promise<TaskView | null> {
  const result = await rpc('stage.setAgent', { taskId, stageId, agent });
  if (result === null || result === undefined) return null;
  return parse(taskViewSchema, result, '任务');
}

export async function listWorkflows(): Promise<WorkflowChoice[]> {
  return parse(z.array(workflowSchema), await rpc('workflows.list'), '流程');
}

export async function resolveGate(gateId: string, decision: 'approve' | 'reject', comment?: string): Promise<unknown> {
  return rpc('gate.resolve', { gateId, decision, comment });
}

export async function readPins(taskId: string, pinIds: string[]): Promise<TaskView | null> {
  const result = await rpc('pin.read', { taskId, pinIds });
  if (result === null || result === undefined) return null;
  return parse(taskViewSchema, result, '任务');
}

export async function addNote(taskId: string, text: string): Promise<TaskView | null> {
  const result = await rpc('task.note', { taskId, text });
  if (result === null || result === undefined) return null;
  return parse(taskViewSchema, result, '任务');
}
