import { columnOf, type TaskView } from '@mufu/core/view';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import {
  addNote,
  createTask,
  DaemonError,
  getTask,
  listTasks,
  listWorkflows,
  readPins,
  resolveGate,
  taskKeys,
} from '@/api/tasks';
import { NewTaskDialog, type NewTaskInput } from '@/common/components/new-task-dialog';
import { cn } from '@/common/utils';
import { ArtifactPanel } from '@/modules/task/components/artifact-panel';
import { GateCard } from '@/modules/task/components/gate-card';
import { PinStrip } from '@/modules/task/components/pin-strip';
import { usePreferences } from '@/store/preferences';

const nav = [
  { label: '新任务', icon: '＋', action: 'create' as const },
  { label: '任务', icon: '▦', action: 'board' as const },
];

export function Component() {
  const { taskId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: taskKeys.list, queryFn: listTasks, refetchInterval: 1500 });
  const workflows = useQuery({ queryKey: taskKeys.workflows, queryFn: listWorkflows });
  const task = useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => getTask(taskId),
    enabled: taskId.length > 0,
    refetchInterval: 1500,
  });
  const repoPath = usePreferences((state) => state.repoPath);
  const setRepoPath = usePreferences((state) => state.setRepoPath);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(true);
  const [draft, setDraft] = useState('');
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: taskKeys.list });
    await queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
  };
  const gate = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => {
      const gateId = task.data?.pendingGate?.id;
      if (!gateId) throw new DaemonError('没有待处理的门禁');
      return resolveGate(gateId, decision);
    },
    onSuccess: () => invalidate(),
  });
  const pins = useMutation({
    mutationFn: () => readPins(taskId),
    onSuccess: () => invalidate(),
  });
  const note = useMutation({
    mutationFn: (text: string) => addNote(taskId, text),
    onSuccess: async () => {
      setDraft('');
      await invalidate();
    },
  });
  const create = useMutation({
    mutationFn: (input: NewTaskInput) =>
      createTask({
        title: input.title,
        prompt: input.prompt,
        workflowId: input.workflowId,
        repoPath: input.repoPath.trim() || undefined,
        agents: input.agents,
      }),
    onSuccess: async (created, input) => {
      setRepoPath(input.repoPath);
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: taskKeys.list });
      void navigate(`/task/${created.id}`);
    },
  });

  const current = task.data;
  const needsYou = (list.data ?? []).filter((item) => columnOf(item) === 'needs_you' || columnOf(item) === 'to_review');
  const running = (list.data ?? []).filter((item) => columnOf(item) === 'running');

  return (
    <div className="bg-background flex h-dvh flex-col md:flex-row">
      <nav className="bg-muted flex max-h-52 flex-col overflow-auto border-b px-3 py-3 md:max-h-none md:w-56 md:border-b-0 md:border-r md:py-4">
        <Link to="/" className="px-2.5 pb-3 text-lg font-bold">
          工作台
        </Link>
        {nav.map((item) => (
          <button
            key={item.label}
            type="button"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left"
            onClick={() => {
              if (item.action === 'board') void navigate('/');
              if (item.action === 'create') setOpen(true);
            }}
          >
            <span className="text-muted-foreground w-4 text-center">{item.icon}</span>
            {item.label}
          </button>
        ))}
        <TaskGroup title="需要你" tasks={needsYou} currentId={taskId} />
        <TaskGroup title="进行中" tasks={running} currentId={taskId} muted />
        <p className="mt-auto flex items-center gap-2.5 px-2.5 pt-4">
          <span className="bg-accent inline-flex size-7 items-center justify-center rounded-full text-xs">Z</span>
          chunlin
        </p>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {task.isPending ? <p className="text-muted-foreground p-8 text-sm">正在读取任务</p> : null}
          {task.isError ? (
            <p className="m-6 flex items-center gap-2 text-sm">
              <span className="bg-primary text-primary-foreground inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold">
                !
              </span>
              {task.error instanceof DaemonError ? task.error.message : '任务没有读出来'}
            </p>
          ) : null}
          {task.data === null ? (
            <p className="text-muted-foreground p-8 text-sm">没有这个任务，或者它已经离开看板。</p>
          ) : null}
          {current ? (
            <>
              <header className="flex h-12 items-center gap-3 border-b px-4 md:px-7">
                <h1 className="font-semibold">{current.title}</h1>
                <span className="text-muted-foreground text-xs">
                  {current.workflow.title}
                  {agentTitle(current.agentKind)}
                  {current.status === 'to_review' && current.ci ? ` · ${ciText(current.ci.state)}` : ''}
                </span>
                <ol className="text-muted-foreground hidden items-center gap-2 text-xs md:flex">
                  {current.workflow.stages.map((stage, index) => {
                    const currentIndex = current.workflow.stages.findIndex((item) => item.id === current.stageId);
                    const done = index < currentIndex;
                    const now = index === currentIndex;
                    return (
                      <li key={stage.id} className="flex items-center gap-2">
                        {index > 0 ? <span className="bg-border h-px w-4" /> : null}
                        <span className={cn(now && 'text-foreground font-semibold', done && 'text-foreground')}>
                          <span
                            className={cn(
                              'mr-1 inline-flex size-3.5 items-center justify-center rounded-full border text-[9px]',
                              done && 'border-primary bg-primary text-primary-foreground',
                              now && 'border-foreground',
                            )}
                          >
                            {done ? '✓' : ''}
                          </span>
                          {stage.title}
                        </span>
                      </li>
                    );
                  })}
                </ol>
                {current.attention ? (
                  <span
                    className="bg-primary text-primary-foreground ml-auto inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold"
                    title={current.attention.message}
                  >
                    !
                  </span>
                ) : null}
              </header>
              <PinStrip pins={current.pins} onReadAll={() => pins.mutate()} />
              <div className="min-h-0 flex-1 overflow-auto px-4 py-6 md:px-14">
                {current.messages.map((message) => (
                  <Message key={message.id} message={message} pins={current.pins} />
                ))}
              </div>
              {current.pendingGate ? (
                <GateCard
                  gate={current.pendingGate}
                  pending={gate.isPending}
                  onDecide={(decision) => gate.mutate(decision)}
                />
              ) : null}
              {gate.isError ? (
                <p className="mx-4 mb-2 text-xs md:mx-14">
                  {gate.error instanceof Error ? gate.error.message : '门禁没有送出'}
                </p>
              ) : null}
              <form
                className="relative mx-4 mb-5 rounded-2xl border px-4 pb-11 pt-3.5 md:mx-14"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = draft.trim();
                  if (!text) return;
                  note.mutate(text);
                }}
              >
                <label className="sr-only" htmlFor="note">
                  补充说明
                </label>
                <input
                  id="note"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="描述任务，输入 / 调用技能"
                  className="w-full bg-transparent text-sm focus-visible:outline-none"
                />
                <button
                  type="submit"
                  className="bg-accent text-muted-foreground focus-visible:ring-ring absolute bottom-2.5 right-3 inline-flex size-7 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2"
                  aria-label="发送"
                  disabled={note.isPending || current.status === 'done'}
                >
                  ↑
                </button>
                {note.isError ? (
                  <p className="text-muted-foreground absolute bottom-3 left-4 text-xs">
                    {note.error instanceof Error ? note.error.message : '没送出去'}
                  </p>
                ) : null}
              </form>
            </>
          ) : null}
        </section>
        {current ? (
          <ArtifactPanel artifacts={current.artifacts} open={panel} onToggle={() => setPanel((value) => !value)} />
        ) : null}
      </div>
      <NewTaskDialog
        open={open}
        onOpenChange={setOpen}
        defaultRepo={repoPath}
        workflows={workflows.data ?? []}
        pending={create.isPending}
        errorMessage={create.error instanceof Error ? create.error.message : null}
        onSubmit={(value) => create.mutate(value)}
      />
    </div>
  );
}

function agentTitle(kind: string | null): string {
  if (kind === 'claude') return ' · Claude';
  if (kind === 'codex') return ' · Codex';
  return '';
}

function ciText(state: 'pending' | 'passed' | 'failed'): string {
  if (state === 'passed') return 'CI 通过';
  if (state === 'failed') return 'CI 失败';
  return 'CI 还在跑';
}

function TaskGroup({
  title,
  tasks,
  currentId,
  muted,
}: {
  title: string;
  tasks: TaskView[];
  currentId: string;
  muted?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground px-2.5 pb-1 pt-4 text-xs">{title}</p>
      {tasks.length === 0 ? <p className="text-muted-foreground px-2.5 text-xs">无</p> : null}
      {tasks.map((item) => (
        <Link
          key={item.id}
          to={`/task/${item.id}`}
          className={cn(
            'flex items-center rounded-md px-2.5 py-2',
            item.id === currentId && 'bg-accent',
            muted && item.id !== currentId && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{item.title}</span>
          {item.attention ? <span className="ml-auto text-xs font-bold">!</span> : null}
          {!item.attention && item.pendingGate ? (
            <span className="bg-foreground ml-auto size-1.5 rounded-full" />
          ) : null}
        </Link>
      ))}
    </div>
  );
}

function Message({ message, pins }: { message: TaskView['messages'][number]; pins: TaskView['pins'] }) {
  const pin = pins.find((item) => item.messageId === message.id);
  if (message.role === 'system') {
    return (
      <p className="text-muted-foreground mb-4 text-xs">
        {message.text}
        {pin ? <em className="ml-2 font-normal">📌 {pin.reason}</em> : null}
      </p>
    );
  }
  if (message.role === 'user') {
    return (
      <div className="mb-5 flex justify-end">
        <p className="bg-secondary max-w-lg rounded-xl px-3.5 py-2.5">{message.text}</p>
      </div>
    );
  }
  return (
    <div className={cn('mb-5 max-w-xl', pin && 'border-border border-l-2 pl-3')}>
      <p className="text-muted-foreground mb-1 text-xs">
        {message.author}
        {pin ? <em className="ml-2 font-normal">📌 {pin.reason}</em> : null}
      </p>
      <p className="leading-7">{message.text}</p>
    </div>
  );
}
