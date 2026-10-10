import { OPENROUTER_ACCOUNT, type SecretStore } from '@mufu/core';
import type { RpcRequest } from '@mufu/schema';

import type { DoctorReport } from './doctor.ts';
import type { TaskEngine } from './engine.ts';
import { assertOpenRouterAccount } from './secrets.ts';

export function createRpc(deps: {
  engine: TaskEngine;
  secrets: SecretStore;
  loadDoctor: () => Promise<DoctorReport>;
}): (request: RpcRequest) => Promise<unknown> {
  return async (request) => {
    const params = (request.params ?? {}) as Record<string, unknown>;
    const { engine } = deps;
    switch (request.method) {
      case 'health':
        return { ok: true };
      case 'doctor':
        return deps.loadDoctor();
      case 'secret.status':
        return { openrouter: await deps.secrets.has(OPENROUTER_ACCOUNT) };
      case 'secret.set': {
        const account = assertOpenRouterAccount(String(params.account ?? ''));
        const value = String(params.value ?? '');
        if (value.trim().length === 0) throw new Error('密钥是空的');
        await deps.secrets.set(account, value);
        return { account, set: true };
      }
      case 'secret.remove': {
        const account = assertOpenRouterAccount(String(params.account ?? ''));
        await deps.secrets.remove(account);
        return { account, set: false };
      }
      case 'task.create':
        return engine.createTask({
          title: String(params.title ?? ''),
          prompt: String(params.prompt ?? ''),
          workflowId: typeof params.workflowId === 'string' ? params.workflowId : undefined,
          repoPath: typeof params.repoPath === 'string' ? params.repoPath : undefined,
          agents: agentOverrides(params.agents),
        });
      case 'workflows.list':
      case 'workflow.list':
        return engine.workflows();
      case 'task.list':
        return engine.listTasks();
      case 'task.get':
        return engine.getTask(String(params.taskId));
      case 'task.events':
        return engine.events(String(params.taskId));
      case 'task.note':
        return engine.note(String(params.taskId), String(params.text ?? ''));
      case 'gate.resolve':
        return engine.resolveGate(
          String(params.gateId),
          params.decision === 'reject' ? 'reject' : 'approve',
          typeof params.comment === 'string' ? params.comment : undefined,
        );
      case 'pin.readAll':
        return engine.readPins(String(params.taskId));
      default:
        throw new Error(`未知方法 ${request.method}`);
    }
  };
}

function agentOverrides(value: unknown): Record<string, 'codex' | 'claude'> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const map: Record<string, 'codex' | 'claude'> = {};
  for (const [stageId, kind] of Object.entries(value)) {
    if (kind === 'codex' || kind === 'claude') map[stageId] = kind;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}
