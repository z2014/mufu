import { readFileSync } from 'node:fs';

import type { AgentEvent, AgentSession, GateDecision, OperationKind, StartSession } from '@mufu/core';

import { fixtureMarker, isFixtureMarker } from '../jsonl.ts';

type FakeLine = {
  type: string;
  origin?: string;
  protocol?: string;
  sessionId?: string;
  stageId?: string;
  author?: string;
  text?: string;
  message?: string;
  title?: string;
  detail?: string;
  requestId?: string;
  operation?: OperationKind;
  gate?: 'stage' | 'final';
  summary?: string;
  ok?: boolean;
  tool?: string;
  source?: string;
};

/** 夹具回放。不是 Codex 或 Claude，也不出现在领域类型里。 */
export type FixtureRunner = {
  startSession(input: StartSession): Promise<AgentSession>;
};

/**
 * 按 JSONL 回放。文件必须标明 handwritten 或 recorded，并且 protocol 是 mufu-fake。
 * 这不是 Codex/Claude 的原始流。只在测试和 MUFU_AGENT=fake 时由守护进程注入。
 */
export function createFakeAdapter(fixturePath: string): FixtureRunner {
  return {
    async startSession(input: StartSession): Promise<AgentSession> {
      const marker = fixtureMarker(fixturePath);
      if (marker?.protocol !== 'mufu-fake') {
        throw new Error(`夹具文件不能回放：${fixturePath}`);
      }
      const lines = readFileSync(fixturePath, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FakeLine)
        .filter((line) => !isFixtureMarker(line));

      const sessionId =
        input.resumeSessionId ?? lines.find((line) => line.sessionId)?.sessionId ?? `replay-${input.taskId}`;
      const decisions = new Map<string, (decision: GateDecision) => void>();
      let interrupted = false;
      const script = input.stageId ? linesForStage(lines, input.stageId) : lines;

      async function* events(): AsyncGenerator<AgentEvent> {
        if (input.resumeSessionId) {
          yield { type: 'message', author: '记录', text: `已按会话 ${input.resumeSessionId} 恢复` };
        }
        for (const line of script) {
          if (interrupted) {
            yield { type: 'interrupted' };
            return;
          }
          const event = toEvent(line);
          if (!event) continue;
          if (event.type === 'approval_request') {
            let resolveDecision: (decision: GateDecision) => void = () => undefined;
            const decisionPromise = new Promise<GateDecision>((resolve) => {
              resolveDecision = resolve;
            });
            decisions.set(event.requestId, resolveDecision);
            yield event;
            const decision = await decisionPromise;
            if (interrupted) {
              yield { type: 'interrupted' };
              return;
            }
            if (decision === 'reject') {
              yield { type: 'completed', ok: false, reason: 'rejected' };
              return;
            }
            continue;
          }
          yield event;
        }
      }

      return {
        sessionId,
        events: events(),
        async decide(requestId, decision) {
          const resolve = decisions.get(requestId);
          if (!resolve) throw new Error(`没有待处理的审批 ${requestId}`);
          decisions.delete(requestId);
          resolve(decision);
        },
        async interrupt() {
          interrupted = true;
          for (const resolve of decisions.values()) resolve('reject');
          decisions.clear();
        },
        followUp(text: string) {
          return `收到：${text}`;
        },
      };
    },
  };
}

function linesForStage(lines: FakeLine[], stageId: string): FakeLine[] {
  const start = lines.findIndex((line) => line.type === 'stage' && line.stageId === stageId);
  if (start < 0) {
    return [
      { type: 'message', author: '记录', text: `夹具里没有阶段 ${stageId}` },
      { type: 'completed', ok: true },
    ];
  }
  const next = lines.findIndex((line, index) => index > start && line.type === 'stage');
  return lines.slice(start, next < 0 ? undefined : next);
}

function toEvent(line: FakeLine): AgentEvent | null {
  switch (line.type) {
    case 'message':
      return { type: 'message', author: line.author ?? 'agent', text: line.text ?? '' };
    case 'system':
      return { type: 'system', text: line.text ?? '' };
    case 'stage':
      return { type: 'stage', stageId: line.stageId ?? '' };
    case 'artifact':
      return { type: 'artifact', title: line.title ?? '', detail: line.detail ?? '' };
    case 'approval_request':
      return {
        type: 'approval_request',
        requestId: line.requestId ?? 'approval',
        operation: line.operation ?? 'other',
        summary: line.summary ?? '',
        detail: line.detail ?? '',
        gate: line.gate ?? 'stage',
      };
    case 'completed':
      return { type: 'completed', ok: line.ok !== false };
    case 'environment_failure':
      return {
        type: 'environment_failure',
        message: line.message ?? line.text ?? '环境失败',
        tool: line.tool,
        source: line.source,
        failure: 'auth',
      };
    default:
      return null;
  }
}
