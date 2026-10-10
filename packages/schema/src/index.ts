import { z } from 'zod';

export const taskStatusSchema = z.enum(['queued', 'running', 'needs_you', 'to_review', 'done']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const workflowSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  done_when: z.enum(['pr_merged', 'final_gate_approved']),
  stages: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        gate: z.enum(['final', 'stage']).optional(),
      }),
    )
    .min(1),
});
export type WorkflowFile = z.infer<typeof workflowSchema>;

export const rpcRequestSchema = z.object({
  id: z.number(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type RpcRequest = z.infer<typeof rpcRequestSchema>;

export type RpcResponse = {
  id: number;
  result?: unknown;
  error?: { message: string };
};

export const gateDecisionSchema = z.enum(['approve', 'reject']);
export type GateDecision = z.infer<typeof gateDecisionSchema>;
