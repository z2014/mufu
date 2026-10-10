import { randomUUID } from 'node:crypto';
import { createServer as createNetServer, type Socket } from 'node:net';
import { readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { parse as parseYaml } from 'yaml';

import { createClaudeAdapter, createCodexAdapter, createFakeAdapter } from '@mufu/adapters';
import {
  MAX_ATTEMPTS,
  MAX_PINS_PER_STAGE,
  MergeUnavailable,
  SubscriptionRefused,
  foldTask,
  foldTasks,
  leadIntro,
  type AgentAdapter,
  type AgentEvent,
  type DomainEvent,
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
  fixturePath?: string;
  maxConcurrent?: number;
  codexBin?: string;
  claudeBin?: string;
};

export type RunningDaemon = {
  socketPath: string;
  wsPort: number;
  close: () => Promise<void>;
  report: () => DoctorReport | null;
};

type Created = { title: string; prompt: string; workflowId?: string; repoPath?: string };

export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const log = new SqliteEventLog(join(options.home, 'events.sqlite'));
  const broker = new GateBroker();
  const running = new Set<string>();
  const maxConcurrent = options.maxConcurrent ?? Number.POSITIVE_INFINITY;
  let doctorReport: DoctorReport | null = null;
  let awake: { stop(): void } | null = null;
  const github = new MergeUnavailable();

  const workflows = loadWorkflows(options.workflowsDir);
  const adapter = makeAdapter(options);

  const views = () => foldTasks(log.readAll());
  const one = (taskId: string) => foldTask(log.readAll(), taskId);

  const setStatus = (taskId: string, status: TaskView['status']) => {
    log.append({ taskId, type: 'task.status', payload: { status } });
  };

  const activeCount = () => views().filter((task) => task.status === 'running' || task.status === 'needs_you' || task.status === 'to_review').length;

  async function runTask(taskId: string): Promise<void> {
    if (running.has(taskId)) return;
    running.add(taskId);
    if (!awake) awake = holdAwake();
    const task = one(taskId);
    if (!task) return;
    const runId = randomUUID();
    log.append({ taskId, type: 'run.started', payload: { runId } });
    log.append({
      taskId,
      type: 'agent.message',
      payload: { role: 'lead', author: '协调 Agent', text: leadIntro(task.workflow.title, task.workflow.stages.map((stage) => stage.title)) },
    });
    try {
      const session = await adapter.startSession({
        taskId,
        workspacePath: task.workspacePath ?? options.home,
        prompt: task.prompt,
        resumeSessionId: task.sessionId ?? undefined,
      });
      log.append({ taskId, type: 'agent.session', payload: { sessionId: session.sessionId, kind: adapter.kind } });
      for await (const event of session.events) {
        await applyAgentEvent(taskId, event, session.decide.bind(session));
        if (event.type === 'completed' || event.type === 'interrupted' || event.type === 'environment_failure') break;
      }
    } catch (error) {
      if (error instanceof SubscriptionRefused) {
        log.append({
          taskId,
          type: 'environment.failed',
          payload: { tool: error.tool, source: error.source, message: error.message },
        });
        setStatus(taskId, 'needs_you');
      } else {
        const message = error instanceof Error ? error.message : String(error);
        log.append({ taskId, type: 'environment.failed', payload: { message, tool: adapter.kind, source: 'launch' } });
        setStatus(taskId, 'needs_you');
      }
    } finally {
      running.delete(taskId);
      if (running.size === 0) {
        awake?.stop();
        awake = null;
      }
      pump();
    }
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
          payload: { pinId: randomUUID(), message: event.message, reason: event.reason, author: event.author, stageId: current.stageId },
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
        log.append({ taskId, type: 'attempt.counted', payload: { attempt: attempts, reason: event.reason ?? 'failed' } });
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
        const latest = one(taskId);
        if (latest?.workflow.doneWhen === 'final_gate_approved') setStatus(taskId, 'done');
      }
    }
  }

  function pump(): void {
    for (const task of views()) {
      if (task.status !== 'queued') continue;
      if (activeCount() >= maxConcurrent) break;
      setStatus(task.id, 'running');
      void runTask(task.id);
    }
  }

  async function createTask(input: Created): Promise<TaskView> {
    const workflow = workflows.get(input.workflowId ?? 'fix-bug');
    if (!workflow) throw new Error(`没有这个流程：${input.workflowId ?? 'fix-bug'}`);
    const taskId = randomUUID();
    const seq = views().length + 1;
    log.append({
      taskId,
      type: 'task.created',
      payload: { seq, title: input.title, prompt: input.prompt, workflow, repoPath: input.repoPath ?? null },
    });
    const path = await createWorkspace(input.repoPath, taskId, options.home);
    log.append({ taskId, type: 'workspace.created', payload: { path } });
    if (activeCount() >= maxConcurrent) {
      setStatus(taskId, 'queued');
    } else {
      setStatus(taskId, 'running');
      void runTask(taskId);
    }
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
        });
      case 'task.list':
        return views().filter((task) => task.status !== 'done');
      case 'task.get':
        return one(String(params.taskId));
      case 'task.events':
        return log.readAll().filter((event) => event.taskId === params.taskId);
      case 'task.note': {
        const taskId = String(params.taskId);
        log.append({ taskId, type: 'agent.message', payload: { role: 'user', author: '你', text: String(params.text ?? '') } });
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

  const socket = createNetServer((connection) => attachNdjson(connection, handle));
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(options.socketPath, () => resolve());
  });

  const http: HttpServer = createHttpServer();
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (socketConnection) => attachWebSocket(socketConnection, handle));
  const wsPort = await new Promise<number>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.wsPort ?? 0, '127.0.0.1', () => {
      const address = http.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
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
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
      log.close();
      rmSync(options.socketPath, { force: true });
    },
  };
}

function makeAdapter(options: DaemonOptions): AgentAdapter {
  const kind = options.agent ?? (process.env.MUFU_AGENT as DaemonOptions['agent']) ?? 'fake';
  if (kind === 'codex') return createCodexAdapter({ bin: options.codexBin });
  if (kind === 'claude') return createClaudeAdapter({ bin: options.claudeBin });
  const fixture = options.fixturePath ?? process.env.MUFU_FIXTURE;
  if (!fixture) throw new Error('fake 代理需要夹具路径 MUFU_FIXTURE');
  return createFakeAdapter(fixture);
}

function loadWorkflows(dir: string): Map<string, Workflow> {
  const map = new Map<string, Workflow>();
  for (const name of ['fix-bug.yaml', 'new-feature.yaml']) {
    const file = workflowSchema.parse(parseYaml(readFileSync(join(dir, name), 'utf8')));
    map.set(file.id, {
      id: file.id,
      title: file.title,
      doneWhen: file.done_when,
      stages: file.stages.map((stage) => ({ id: stage.id, title: stage.title, gate: stage.gate })),
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

export type { DomainEvent };
