import { randomUUID } from 'node:crypto';
import { createServer as createNetServer, type Socket } from 'node:net';
import { readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { parse as parseYaml } from 'yaml';

import { createClaudeAdapter, createCodexAdapter, createFakeAdapter } from '@mufu/adapters';
import {
  DAEMON_WS_PORT,
  DEV_PORT,
  MAX_ATTEMPTS,
  MAX_PINS_PER_STAGE,
  MergeUnavailable,
  SubscriptionRefused,
  foldTask,
  foldTasks,
  leadIntro,
  type AgentAdapter,
  type AgentEvent,
  type AgentKind,
  type AgentSession,
  type TaskView,
  type Workflow,
} from '@mufu/core';
import { workflowSchema, type RpcRequest, type RpcResponse } from '@mufu/schema';

import { GateBroker, type Decision } from './broker.ts';
import { doctor, type DoctorReport } from './doctor.ts';
import { holdAwake } from './sleep.ts';
import { SqliteEventLog } from './store.ts';
import { createWorkspace } from './workspace.ts';

export type DaemonOptions = {
  home: string;
  socketPath: string;
  wsPort?: number;
  workflowsDir: string;
  agent?: 'fake' | 'codex' | 'claude';
  /** 测试注入。缺的种类仍用真适配器或 fake 夹具。 */
  adapters?: Partial<Record<AgentKind, AgentAdapter>>;
  fixturePath?: string;
  codexBin?: string;
  claudeBin?: string;
};

export type RunningDaemon = {
  socketPath: string;
  wsPort: number;
  close: () => Promise<void>;
  report: () => DoctorReport | null;
};

type Created = {
  title: string;
  prompt: string;
  workflowId?: string;
  repoPath?: string;
  agents?: Record<string, 'codex' | 'claude'>;
};

export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const log = new SqliteEventLog(join(options.home, 'events.sqlite'));
  const broker = new GateBroker();
  const running = new Set<string>();
  let doctorReport: DoctorReport | null = null;
  let awake: { stop(): void } | null = null;
  const github = new MergeUnavailable();

  const workflows = loadWorkflows(options.workflowsDir);
  const configuredAgent = options.agent ?? envAgent(process.env.MUFU_AGENT);
  const fixtureMode = configuredAgent === 'fake';
  const adapters = buildAdapters(options);
  const live = new Map<string, AgentSession>();

  const views = () => foldTasks(log.readAll());
  const one = (taskId: string) => foldTask(log.readAll(), taskId);

  const setStatus = (taskId: string, status: TaskView['status']) => {
    log.append({ taskId, type: 'task.status', payload: { status } });
  };

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

  async function consume(taskId: string, session: AgentSession): Promise<'ok' | 'stop'> {
    live.set(taskId, session);
    let outcome: 'ok' | 'stop' = 'stop';
    for await (const event of session.events) {
      await applyAgentEvent(taskId, event, session.decide.bind(session));
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
      if (fixtureMode) await runFixture(taskId);
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
    const task = one(taskId);
    if (!task) return;
    const session = await adapters.fake.startSession({
      taskId,
      workspacePath: task.workspacePath ?? options.home,
      prompt: task.prompt,
      resumeSessionId: task.sessions.fake ?? task.sessionId ?? undefined,
    });
    log.append({ taskId, type: 'agent.session', payload: { sessionId: session.sessionId, kind: 'fake' } });
    const outcome = await consume(taskId, session);
    const latest = one(taskId);
    if (outcome === 'ok' && latest?.status === 'running') setStatus(taskId, 'done');
  }

  async function runStages(taskId: string): Promise<void> {
    for (let guard = 0; guard < 8; guard += 1) {
      const task = one(taskId);
      if (!task || task.status === 'done' || task.status === 'needs_you') return;
      const stage = task.workflow.stages.find((item) => item.id === task.stageId) ?? task.workflow.stages[0];
      if (!stage) return;
      const kind = kindFor(stage.agent, configuredAgent);
      const adapter = adapters[kind];
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
      const wrapped: AgentSession = {
        sessionId: session.sessionId,
        events: session.events,
        decide: session.decide.bind(session),
        interrupt: session.interrupt.bind(session),
        followUp: session.followUp?.bind(session),
      };
      live.set(taskId, wrapped);
      let outcome: 'ok' | 'stop' | 'open' = 'open';
      for await (const event of session.events) {
        if (event.type === 'approval_request') openedGate = true;
        await applyAgentEvent(taskId, event, session.decide.bind(session));
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
        const decision = await openProductGate(taskId, current.gate, `${current.title}`);
        if (decision === 'reject') {
          setStatus(taskId, 'needs_you');
          return;
        }
      }
      const after = one(taskId);
      if (!after || after.status === 'needs_you' || after.status === 'done') return;
      const index = after.workflow.stages.findIndex((item) => item.id === after.stageId);
      const next = after.workflow.stages[index + 1];
      if (!next) {
        setStatus(taskId, 'done');
        return;
      }
      log.append({ taskId, type: 'stage.entered', payload: { stageId: next.id } });
    }
  }

  async function openProductGate(taskId: string, gate: 'final' | 'stage', summary: string): Promise<Decision> {
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
    broker.open(gateId);
    const decision = await broker.wait(gateId);
    log.append({ taskId, type: 'gate.resolved', payload: { gateId, decision } });
    if (decision === 'approve') {
      const latest = one(taskId);
      if (latest && latest.status !== 'done' && latest.status !== 'needs_you') setStatus(taskId, 'running');
    }
    return decision;
  }

  async function applyAgentEvent(
    taskId: string,
    event: AgentEvent,
    decide: (requestId: string, decision: Decision) => Promise<void>,
  ): Promise<void> {
    const current = one(taskId);
    if (!current) return;
    if (event.type === 'stage') {
      log.append({ taskId, type: 'stage.entered', payload: { stageId: event.stageId } });
    } else if (event.type === 'message') {
      log.append({
        taskId,
        type: 'agent.message',
        payload: { role: 'agent', author: event.author, text: event.text, pinReason: event.pinReason },
      });
    } else if (event.type === 'system') {
      log.append({ taskId, type: 'agent.message', payload: { role: 'system', author: '系统', text: event.text } });
    } else if (event.type === 'pin') {
      const count = current.pins.filter((pin) => pin.stageId === current.stageId).length;
      if (count < MAX_PINS_PER_STAGE) {
        log.append({
          taskId,
          type: 'pin.added',
          payload: {
            pinId: randomUUID(),
            message: event.message,
            reason: event.reason,
            author: event.author,
            stageId: current.stageId,
          },
        });
      }
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
      broker.open(gateId);
      const decision = await broker.wait(gateId);
      log.append({ taskId, type: 'gate.resolved', payload: { gateId, decision } });
      await decide(event.requestId, decision);
      if (decision === 'reject') {
        setStatus(taskId, 'needs_you');
      } else if (current.status !== 'done') {
        const latest = one(taskId);
        if (latest && latest.status !== 'done' && latest.status !== 'needs_you') setStatus(taskId, 'running');
      }
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
      if (!event.ok) {
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
          setStatus(taskId, 'needs_you');
        } else {
          setStatus(taskId, 'needs_you');
        }
      } else {
        log.append({ taskId, type: 'run.finished', payload: { outcome: 'completed' } });
      }
    }
  }

  async function createTask(input: Created): Promise<TaskView> {
    const template = workflows.get(input.workflowId ?? 'fix-bug');
    if (!template) throw new Error(`没有这个流程：${input.workflowId ?? 'fix-bug'}`);
    const workflow = {
      ...template,
      stages: template.stages.map((stage) => {
        const override = input.agents?.[stage.id];
        if (override !== 'codex' && override !== 'claude') return stage;
        return { ...stage, agent: override };
      }),
    };
    const taskId = randomUUID();
    const seq = views().length + 1;
    log.append({
      taskId,
      type: 'task.created',
      payload: { seq, title: input.title, prompt: input.prompt, workflow, repoPath: input.repoPath ?? null },
    });
    const path = await createWorkspace(input.repoPath, taskId, options.home);
    log.append({ taskId, type: 'workspace.created', payload: { path } });
    setStatus(taskId, 'running');
    void runTask(taskId);
    const created = one(taskId);
    if (!created) throw new Error('任务没有写进日志');
    return created;
  }

  function resolveGate(gateId: string, decision: Decision): TaskView {
    const task = views().find((item) => item.pendingGate?.id === gateId);
    if (!task?.pendingGate) throw new Error('没有待处理的门禁');
    broker.resolve(gateId, decision);
    return task;
  }

  async function handle(request: RpcRequest): Promise<unknown> {
    const params = (request.params ?? {}) as Record<string, unknown>;
    switch (request.method) {
      case 'health':
        return { ok: true };
      case 'doctor':
        doctorReport ??= await doctor();
        return doctorReport;
      case 'task.create':
        return createTask({
          title: String(params.title ?? ''),
          prompt: String(params.prompt ?? ''),
          workflowId: typeof params.workflowId === 'string' ? params.workflowId : undefined,
          repoPath: typeof params.repoPath === 'string' ? params.repoPath : undefined,
          agents: agentOverrides(params.agents),
        });
      case 'workflow.list':
        return [...workflows.values()];
      case 'task.list':
        return views().filter((task) => task.status !== 'done');
      case 'task.get':
        return one(String(params.taskId));
      case 'task.events':
        return log.readAll().filter((event) => event.taskId === params.taskId);
      case 'task.note': {
        const taskId = String(params.taskId);
        const text = String(params.text ?? '').trim();
        if (!text) throw new Error('写点什么');
        if (!one(taskId)) throw new Error('没有这个任务');
        log.append({
          taskId,
          type: 'agent.message',
          payload: { role: 'user', author: '你', text },
        });
        const session = live.get(taskId);
        const reply = session?.followUp?.(text);
        if (typeof reply === 'string' && reply.length > 0) {
          const kind = one(taskId)?.agentKind;
          log.append({
            taskId,
            type: 'agent.message',
            payload: { role: 'agent', author: agentLabel(kind), text: reply },
          });
        }
        return one(taskId);
      }
      case 'gate.resolve':
        return resolveGate(String(params.gateId), params.decision === 'reject' ? 'reject' : 'approve');
      case 'pin.readAll': {
        const taskId = String(params.taskId);
        log.append({ taskId, type: 'pin.read', payload: {} });
        return one(taskId);
      }
      case 'task.merge':
        await github.mergePullRequest({ repoPath: String(params.repoPath ?? ''), pr: Number(params.pr ?? 0) });
        return { ok: false };
      default:
        throw new Error(`未知方法 ${request.method}`);
    }
  }

  const requested = options.wsPort ?? DAEMON_WS_PORT;
  if (!Number.isInteger(requested) || requested < 0 || requested > 65535 || requested === DEV_PORT) {
    log.close();
    throw new Error(
      `守护进程不能听 ${requested}。看板端口 ${DEV_PORT} 只给 pnpm dev:app（http://127.0.0.1:${DEV_PORT}），WebSocket 用 ${DAEMON_WS_PORT}。`,
    );
  }

  const socket = createNetServer((connection) => attachNdjson(connection, handle));
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(options.socketPath, () => resolve());
  });

  const hint = `mufu 守护进程不提供看板。\n在另一个终端运行 pnpm dev:app，然后打开 http://127.0.0.1:${DEV_PORT}\n`;
  const http: HttpServer = createHttpServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(hint),
      'Cache-Control': 'no-store',
    });
    res.end(hint);
  });
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (socketConnection) => attachWebSocket(socketConnection, handle));
  const wsPort = await new Promise<number>((resolve, reject) => {
    const fail = (error: Error) => {
      http.close(() => {
        socket.close(() => {
          log.close();
          rmSync(options.socketPath, { force: true });
          reject(error);
        });
      });
    };
    http.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        fail(
          new Error(
            `127.0.0.1:${requested} 已被占用。守护进程的 WebSocket 是 ${DAEMON_WS_PORT}，看板端口 ${DEV_PORT} 留给 pnpm dev:app。`,
          ),
        );
        return;
      }
      fail(error);
    });
    http.listen({ port: requested, host: '127.0.0.1', exclusive: true }, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      if (port === DEV_PORT || (requested !== 0 && port !== requested)) {
        fail(
          new Error(
            `守护进程绑在了 127.0.0.1:${port}。它不能占看板端口 ${DEV_PORT}，WebSocket 应是 ${requested === 0 ? DAEMON_WS_PORT : requested}。`,
          ),
        );
        return;
      }
      resolve(port);
    });
  });

  void doctor().then((report) => {
    doctorReport = report;
  });

  return {
    socketPath: options.socketPath,
    wsPort,
    report: () => doctorReport,
    async close() {
      broker.cancelAll();
      for (const session of live.values()) void session.interrupt().catch(() => undefined);
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
      log.close();
      rmSync(options.socketPath, { force: true });
    },
  };
}

function envAgent(value: string | undefined): DaemonOptions['agent'] {
  if (value === 'fake' || value === 'codex' || value === 'claude') return value;
  return undefined;
}

function kindFor(stageAgent: AgentKind | undefined, fallback: DaemonOptions['agent']): AgentKind {
  if (stageAgent === 'codex' || stageAgent === 'claude' || stageAgent === 'fake') return stageAgent;
  if (fallback === 'codex' || fallback === 'claude') return fallback;
  return 'codex';
}

function agentLabel(kind: string | null | undefined): string {
  if (kind === 'claude') return 'Claude';
  if (kind === 'codex') return 'Codex';
  return '代理';
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

function agentOverrides(value: unknown): Record<string, 'codex' | 'claude'> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const map: Record<string, 'codex' | 'claude'> = {};
  for (const [stageId, kind] of Object.entries(value)) {
    if (kind === 'codex' || kind === 'claude') map[stageId] = kind;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

function buildAdapters(options: DaemonOptions): Record<AgentKind, AgentAdapter> {
  const fixture = options.fixturePath ?? process.env.MUFU_FIXTURE;
  const fake =
    options.adapters?.fake ??
    (fixture
      ? createFakeAdapter(fixture)
      : {
          kind: 'fake' as const,
          startSession: () => Promise.reject(new Error('fake 代理需要夹具路径 MUFU_FIXTURE')),
        });
  return {
    fake,
    codex: options.adapters?.codex ?? createCodexAdapter({ bin: options.codexBin }),
    claude: options.adapters?.claude ?? createClaudeAdapter({ bin: options.claudeBin }),
  };
}

function loadWorkflows(dir: string): Map<string, Workflow> {
  const map = new Map<string, Workflow>();
  for (const name of ['fix-bug.yaml', 'new-feature.yaml']) {
    const file = workflowSchema.parse(parseYaml(readFileSync(join(dir, name), 'utf8')));
    map.set(file.id, {
      id: file.id,
      title: file.title,
      doneWhen: file.done_when,
      stages: file.stages.map((stage) => ({
        id: stage.id,
        title: stage.title,
        gate: stage.gate,
        agent: stage.agent,
      })),
    });
  }
  return map;
}

function attachNdjson(connection: Socket, handle: (request: RpcRequest) => Promise<unknown>): void {
  let buffer = '';
  connection.setEncoding('utf8');
  connection.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      void answer(line, handle).then((response) => connection.write(`${JSON.stringify(response)}\n`));
    }
  });
}

function attachWebSocket(connection: WebSocket, handle: (request: RpcRequest) => Promise<unknown>): void {
  connection.on('message', (data) => {
    void answer(String(data), handle).then((response) => connection.send(JSON.stringify(response)));
  });
}

async function answer(line: string, handle: (request: RpcRequest) => Promise<unknown>): Promise<RpcResponse> {
  let request: RpcRequest;
  try {
    request = JSON.parse(line) as RpcRequest;
  } catch {
    return { id: 0, error: { message: '无法解析请求' } };
  }
  try {
    const result = await handle(request);
    return { id: request.id, result };
  } catch (error) {
    return { id: request.id, error: { message: error instanceof Error ? error.message : String(error) } };
  }
}
