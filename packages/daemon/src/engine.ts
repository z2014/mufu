import { randomUUID } from 'node:crypto';

import type { FixtureRunner } from '@mufu/adapters';
import {
  MAX_ATTEMPTS,
  MAX_PINS_PER_STAGE,
  MergeFailure,
  SubscriptionRefused,
  countsAsAttempt,
  foldTask,
  foldTasks,
  LEAD_PIN_AUTHOR,
  concreteAuthor,
  leadIntro,
  mergeFailureCopy,
  stageDoneText,
  type AgentAdapter,
  type AgentEvent,
  type AgentKind,
  type AgentSession,
  type DomainEvent,
  type GitHub,
  type MergeFailureReason,
  type TaskView,
  type Workflow,
} from '@mufu/core';

import { GateBroker, type Decision, type GateResolution } from './broker.ts';
import { holdAwake } from './sleep.ts';
import { assertGitRepo, createWorkspace } from './workspace.ts';
import type { ListedWorkflow, WorkflowCatalog } from './workflows.ts';

type EventLog = {
  append(event: { taskId: string | null; type: string; payload: Record<string, unknown> }): void;
  readAll(): DomainEvent[];
  close(): void;
};

type EngineOptions = {
  home: string;
  log: EventLog;
  workflows: WorkflowCatalog;
  adapters: Record<AgentKind, AgentAdapter>;
  fixture: FixtureRunner | null;
  github: GitHub;
  agent?: AgentKind;
};

type Created = {
  title: string;
  prompt: string;
  workflowId?: string;
  repoPath?: string;
  agents?: Record<string, AgentKind>;
};

export type TaskEngine = {
  createTask(input: Created): Promise<TaskView>;
  listTasks(): TaskView[];
  getTask(taskId: string): TaskView | null;
  events(taskId: string): DomainEvent[];
  note(taskId: string, text: string): TaskView;
  resolveGate(gateId: string, decision: Decision, comment?: string): TaskView;
  readPins(taskId: string): TaskView;
  workflows(): ListedWorkflow[];
  shutdown(): void;
};

export function createTaskEngine(options: EngineOptions): TaskEngine {
  const { log, github } = options;
  const broker = new GateBroker();
  const running = new Set<string>();
  const live = new Map<string, AgentSession>();
  let awake: { stop(): void } | null = null;

  const views = () => foldTasks(log.readAll());
  const one = (taskId: string) => foldTask(log.readAll(), taskId);

  const setStatus = (taskId: string, status: TaskView['status']) => {
    log.append({ taskId, type: 'task.status', payload: { status } });
  };

  /** 阶段 1 的桩：模板里每一个已经完成的阶段钉一句「阶段完成」。同一阶段只钉一次。 */
  function pinCompletedStage(taskId: string, stageId: string): void {
    const task = one(taskId);
    if (!task || stageId.length === 0) return;
    if (!task.workflow.stages.some((stage) => stage.id === stageId)) return;
    const onStage = task.pins.filter((pin) => pin.stageId === stageId);
    if (onStage.some((pin) => pin.author === LEAD_PIN_AUTHOR) || onStage.length >= MAX_PINS_PER_STAGE) return;
    const pinned = [...task.messages].reverse().find((message) => message.role !== 'user');
    const stageTitle = task.workflow.stages.find((stage) => stage.id === stageId)?.title ?? stageId;
    const text = stageDoneText(stageTitle, pinned?.text ?? '');
    log.append({
      taskId,
      type: 'pin.added',
      payload: {
        pinId: randomUUID(),
        message: text,
        reason: text,
        author: LEAD_PIN_AUTHOR,
        stageId,
        ...(pinned ? { messageId: pinned.id } : {}),
      },
    });
  }

  function failTask(taskId: string, error: unknown, tool: string): void {
    if (error instanceof SubscriptionRefused) {
      log.append({
        taskId,
        type: 'environment.failed',
        payload: { tool: error.tool, source: error.source, message: error.message },
      });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      log.append({ taskId, type: 'environment.failed', payload: { message, tool, source: 'launch' } });
    }
    setStatus(taskId, 'needs_you');
  }

  function prFromArtifacts(task: TaskView): number | null {
    for (const artifact of [...task.artifacts].reverse()) {
      const match = `${artifact.title}\n${artifact.detail}`.match(/PR #(\d+)/);
      const digits = match?.[1];
      if (digits) return Number(digits);
    }
    return null;
  }

  function failMerge(taskId: string, pr: number | null, reason: MergeFailureReason): void {
    const current = one(taskId);
    const attempts = (current?.attempts ?? 0) + 1;
    const message = mergeFailureCopy(reason);
    log.append({ taskId, type: 'merge_failed', payload: { pr, reason, message } });
    if (countsAsAttempt({ kind: reason, detail: message })) {
      log.append({ taskId, type: 'attempt.counted', payload: { attempt: attempts, reason } });
      if (attempts >= MAX_ATTEMPTS) {
        log.append({
          taskId,
          type: 'environment.failed',
          payload: { message: `已经失败 ${attempts} 次`, source: 'attempts' },
        });
      }
    }
    setStatus(taskId, 'needs_you');
  }

  async function reportCi(taskId: string): Promise<void> {
    const task = one(taskId);
    const repo = task?.workspacePath;
    if (!task || !repo) return;
    try {
      const inspected = await github.inspect(repo);
      const pr = inspected.pr ?? prFromArtifacts(task);
      if (!pr) return;
      log.append({
        taskId,
        type: 'ci.reported',
        payload: {
          pr,
          state: inspected.ci,
          mergeable: inspected.mergeable,
          additions: inspected.additions,
          deletions: inspected.deletions,
        },
      });
    } catch {
      // 查不到 CI 不改任务状态。界面只读已经写下的事件。
    }
  }

  async function completeByMerge(taskId: string): Promise<void> {
    const task = one(taskId);
    if (!task || task.status === 'done' || task.status === 'needs_you') return;
    const repo = task.workspacePath ?? options.home;
    let inspected: Awaited<ReturnType<GitHub['inspect']>>;
    try {
      inspected = await github.inspect(repo);
    } catch {
      failMerge(taskId, null, 'environment');
      return;
    }
    const pr = inspected.pr ?? prFromArtifacts(task);
    if (!pr) {
      failMerge(taskId, null, 'environment');
      return;
    }
    log.append({ taskId, type: 'merge_requested', payload: { pr } });
    if (inspected.ci === 'failed') {
      failMerge(taskId, pr, 'ci_failed');
      return;
    }
    try {
      await github.merge({ repoPath: repo, pr });
    } catch (error) {
      failMerge(taskId, pr, error instanceof MergeFailure ? error.reason : 'environment');
      return;
    }
    log.append({ taskId, type: 'merge_succeeded', payload: { pr } });
    setStatus(taskId, 'done');
  }

  async function consume(taskId: string, session: AgentSession): Promise<'ok' | 'stop'> {
    live.set(taskId, session);
    let outcome: 'ok' | 'stop' = 'stop';
    for await (const event of session.events) {
      await applyAgentEvent(taskId, event, session);
      if (event.type === 'completed') {
        outcome = event.ok ? 'ok' : 'stop';
        break;
      }
      if (event.type === 'interrupted' || event.type === 'environment_failure') break;
      const latest = one(taskId);
      if (latest?.status === 'needs_you') break;
    }
    return outcome;
  }

  async function runTask(taskId: string): Promise<void> {
    if (running.has(taskId)) return;
    running.add(taskId);
    if (!awake) awake = holdAwake();
    const task = one(taskId);
    if (!task) {
      running.delete(taskId);
      return;
    }
    log.append({ taskId, type: 'run.started', payload: { runId: randomUUID() } });
    if (!task.messages.some((message) => message.role === 'lead')) {
      log.append({
        taskId,
        type: 'agent.message',
        payload: {
          role: 'lead',
          author: '协调 Agent',
          text: leadIntro(
            task.workflow.title,
            task.workflow.stages.map((stage) => stage.title),
          ),
        },
      });
    }
    try {
      if (options.fixture) await runFixture(taskId);
      else await runStages(taskId);
    } catch (error) {
      failTask(taskId, error, 'launch');
    } finally {
      live.delete(taskId);
      running.delete(taskId);
      if (running.size === 0) {
        awake?.stop();
        awake = null;
      }
    }
  }

  async function runFixture(taskId: string): Promise<void> {
    const runner = options.fixture;
    const task = one(taskId);
    if (!runner || !task) return;
    const session = await runner.startSession({
      taskId,
      workspacePath: task.workspacePath ?? options.home,
      prompt: task.prompt,
      resumeSessionId: task.sessionId ?? undefined,
    });
    const outcome = await consume(taskId, session);
    const latest = one(taskId);
    if (outcome === 'ok' && latest?.status === 'running') {
      pinCompletedStage(taskId, latest.stageId);
      await completeByMerge(taskId);
    }
  }

  async function runStages(taskId: string): Promise<void> {
    for (let guard = 0; guard < 8; guard += 1) {
      const task = one(taskId);
      if (!task || task.status === 'done' || task.status === 'needs_you') return;
      const stage = task.workflow.stages.find((item) => item.id === task.stageId) ?? task.workflow.stages[0];
      if (!stage) return;
      const kind = kindFor(stage.agent, options.agent);
      const adapter = options.adapters[kind];
      let session: AgentSession;
      try {
        session = await adapter.startSession({
          taskId,
          workspacePath: task.workspacePath ?? options.home,
          prompt: stagePrompt(task, stage),
          resumeSessionId: task.sessions[kind],
          stageId: stage.id,
        });
      } catch (error) {
        failTask(taskId, error, kind);
        return;
      }
      log.append({ taskId, type: 'agent.session', payload: { sessionId: session.sessionId, kind } });
      let openedGate = false;
      live.set(taskId, session);
      let outcome: 'ok' | 'stop' | 'open' = 'open';
      for await (const event of session.events) {
        if (event.type === 'approval_request') openedGate = true;
        await applyAgentEvent(taskId, event, session);
        if (event.type === 'completed') {
          outcome = event.ok ? 'ok' : 'stop';
          break;
        }
        if (event.type === 'interrupted' || event.type === 'environment_failure') {
          outcome = 'stop';
          break;
        }
        const mid = one(taskId);
        if (mid?.status === 'needs_you') {
          outcome = 'stop';
          break;
        }
      }
      if (outcome === 'open') outcome = 'ok';
      const latest = one(taskId);
      if (!latest || latest.status === 'needs_you' || latest.status === 'done' || outcome !== 'ok') return;
      const current = latest.workflow.stages.find((item) => item.id === latest.stageId) ?? stage;
      if (current.gate && !openedGate) {
        const resolution = await openProductGate(
          taskId,
          current.gate,
          `${current.title}`,
          session.followUp?.bind(session),
        );
        if (resolution.cancelled || resolution.decision === 'reject') return;
      }
      const after = one(taskId);
      if (!after || after.status === 'needs_you' || after.status === 'done') return;
      pinCompletedStage(taskId, after.stageId);
      const index = after.workflow.stages.findIndex((item) => item.id === after.stageId);
      const next = after.workflow.stages[index + 1];
      if (!next) {
        await completeByMerge(taskId);
        return;
      }
      log.append({ taskId, type: 'stage.entered', payload: { stageId: next.id } });
    }
  }

  async function openProductGate(
    taskId: string,
    gate: 'final' | 'stage',
    summary: string,
    followUp?: (text: string) => string | void,
  ): Promise<GateResolution> {
    const gateId = randomUUID();
    log.append({
      taskId,
      type: 'gate.opened',
      payload: {
        gateId,
        requestId: gateId,
        kind: gate,
        operation: gate === 'final' ? 'final' : 'other',
        summary: gate === 'final' ? `验收 ${summary}` : summary,
        detail: '这一阶段做完了',
      },
    });
    setStatus(taskId, gate === 'final' ? 'to_review' : 'needs_you');
    if (gate === 'final') void reportCi(taskId).catch(() => undefined);
    broker.open(gateId);
    const resolution = await broker.wait(gateId);
    applyResolution(taskId, gateId, resolution, followUp);
    return resolution;
  }

  function applyResolution(
    taskId: string,
    gateId: string,
    resolution: GateResolution,
    followUp?: (text: string) => string | void,
  ): void {
    if (resolution.cancelled) return;
    log.append({
      taskId,
      type: 'gate.resolved',
      payload: {
        gateId,
        decision: resolution.decision,
        ...(resolution.comment ? { comment: resolution.comment } : {}),
      },
    });
    if (resolution.decision === 'reject') {
      const comment = resolution.comment ?? '';
      log.append({
        taskId,
        type: 'agent.message',
        payload: { role: 'user', author: '你', text: comment },
      });
      const reply = followUp?.(comment);
      const author = eventAuthor(one(taskId)?.agentKind);
      if (typeof reply === 'string' && reply.length > 0 && author) {
        log.append({
          taskId,
          type: 'agent.message',
          payload: { role: 'agent', author, text: reply },
        });
      }
      setStatus(taskId, 'running');
      return;
    }
    const latest = one(taskId);
    if (latest && latest.status !== 'done' && latest.status !== 'needs_you') setStatus(taskId, 'running');
  }

  async function applyAgentEvent(
    taskId: string,
    event: AgentEvent,
    session: {
      decide: (requestId: string, decision: Decision) => Promise<void>;
      followUp?: (text: string) => string | void;
    },
  ): Promise<void> {
    const current = one(taskId);
    if (!current) return;
    if (event.type === 'stage') {
      if (event.stageId !== current.stageId) pinCompletedStage(taskId, current.stageId);
      log.append({ taskId, type: 'stage.entered', payload: { stageId: event.stageId } });
    } else if (event.type === 'message') {
      log.append({
        taskId,
        type: 'agent.message',
        payload: { role: 'agent', author: concreteAuthor(event.author), text: event.text },
      });
    } else if (event.type === 'system') {
      log.append({ taskId, type: 'agent.message', payload: { role: 'system', author: '系统', text: event.text } });
    } else if (event.type === 'artifact') {
      log.append({
        taskId,
        type: 'artifact.added',
        payload: { artifactId: randomUUID(), title: event.title, detail: event.detail },
      });
    } else if (event.type === 'approval_request') {
      const gateId = randomUUID();
      const kind = event.gate === 'final' ? 'final' : 'stage';
      log.append({
        taskId,
        type: 'gate.opened',
        payload: {
          gateId,
          requestId: event.requestId,
          kind,
          operation: event.operation,
          summary: event.summary,
          detail: event.detail,
        },
      });
      setStatus(taskId, kind === 'final' ? 'to_review' : 'needs_you');
      if (kind === 'final') void reportCi(taskId).catch(() => undefined);
      broker.open(gateId);
      const resolution = await broker.wait(gateId);
      applyResolution(taskId, gateId, resolution, session.followUp);
      if (!resolution.cancelled) await session.decide(event.requestId, resolution.decision);
    } else if (event.type === 'environment_failure') {
      log.append({
        taskId,
        type: 'environment.failed',
        payload: { message: event.message, tool: event.tool, source: event.source },
      });
      setStatus(taskId, 'needs_you');
    } else if (event.type === 'interrupted') {
      log.append({ taskId, type: 'run.finished', payload: { outcome: 'interrupted' } });
    } else if (event.type === 'completed') {
      const counts = countsAsAttempt({ kind: 'task', detail: event.reason ?? 'failed' });
      if (!event.ok && event.reason !== 'rejected' && counts) {
        const attempts = current.attempts + 1;
        log.append({
          taskId,
          type: 'attempt.counted',
          payload: { attempt: attempts, reason: event.reason ?? 'failed' },
        });
        log.append({ taskId, type: 'run.finished', payload: { outcome: 'failed' } });
        if (attempts >= MAX_ATTEMPTS) {
          log.append({
            taskId,
            type: 'environment.failed',
            payload: { message: `已经失败 ${attempts} 次`, source: 'attempts' },
          });
        }
        setStatus(taskId, 'needs_you');
      } else {
        log.append({
          taskId,
          type: 'run.finished',
          payload: { outcome: event.ok ? 'completed' : 'rejected' },
        });
      }
    }
  }

  async function createTask(input: Created): Promise<TaskView> {
    const workflowId = input.workflowId ?? options.workflows.defaultWorkflowId;
    const template = options.workflows.byId.get(workflowId);
    if (!template) throw new Error(`没有这个流程：${workflowId}`);
    const workflow = {
      ...template,
      stages: template.stages.map((stage) => {
        const override = input.agents?.[stage.id];
        if (override !== 'codex' && override !== 'claude') return stage;
        return { ...stage, agent: override };
      }),
    };
    const repoPath = input.repoPath?.trim() ?? '';
    if (!repoPath) throw new Error('先选择工作目录');
    await assertGitRepo(repoPath);
    const taskId = randomUUID();
    const seq = views().length + 1;
    log.append({
      taskId,
      type: 'task.created',
      payload: { seq, title: input.title, prompt: input.prompt, workflow, repoPath },
    });
    const path = await createWorkspace(repoPath, taskId, options.home);
    log.append({ taskId, type: 'workspace.created', payload: { path } });
    setStatus(taskId, 'running');
    void runTask(taskId);
    const created = one(taskId);
    if (!created) throw new Error('任务没有写进日志');
    return created;
  }

  function resolveGate(gateId: string, decision: Decision, comment?: string): TaskView {
    const task = views().find((item) => item.pendingGate?.id === gateId);
    if (!task?.pendingGate) throw new Error('没有待处理的门禁');
    if (decision === 'reject' && (!comment || comment.trim().length === 0)) throw new Error('打回要写一句原因');
    broker.resolve(gateId, decision, comment?.trim());
    return task;
  }

  function note(taskId: string, text: string): TaskView {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('写点什么');
    if (!one(taskId)) throw new Error('没有这个任务');
    log.append({
      taskId,
      type: 'agent.message',
      payload: { role: 'user', author: '你', text: trimmed },
    });
    const session = live.get(taskId);
    const reply = session?.followUp?.(trimmed);
    if (typeof reply === 'string' && reply.length > 0) {
      const author = eventAuthor(one(taskId)?.agentKind);
      if (author) {
        log.append({
          taskId,
          type: 'agent.message',
          payload: { role: 'agent', author, text: reply },
        });
      }
    }
    const updated = one(taskId);
    if (!updated) throw new Error('没有这个任务');
    return updated;
  }

  return {
    createTask,
    listTasks: () => views().filter((task) => task.status !== 'done'),
    getTask: one,
    events: (taskId) => log.readAll().filter((event) => event.taskId === taskId),
    note,
    resolveGate,
    readPins(taskId) {
      log.append({ taskId, type: 'pin.read', payload: {} });
      const task = one(taskId);
      if (!task) throw new Error('没有这个任务');
      return task;
    },
    workflows: () => options.workflows.list,
    shutdown() {
      broker.cancelAll();
      for (const session of live.values()) void session.interrupt().catch(() => undefined);
    },
  };
}

function kindFor(stageAgent: AgentKind | undefined, fallback: AgentKind | undefined): AgentKind {
  if (stageAgent === 'codex' || stageAgent === 'claude') return stageAgent;
  if (fallback === 'codex' || fallback === 'claude') return fallback;
  return 'codex';
}

function eventAuthor(kind: string | null | undefined): 'codex' | 'claude' | null {
  if (kind === 'claude' || kind === 'codex') return kind;
  return null;
}

function stagePrompt(task: TaskView, stage: Workflow['stages'][number]): string {
  const notes = task.pins.map((pin) => pin.message).join('\n');
  return [
    task.prompt,
    `当前阶段：${stage.title}（${stage.id}）。做完这一阶段就停，不要合并。`,
    notes.length > 0 ? `已有重点：\n${notes}` : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
}
