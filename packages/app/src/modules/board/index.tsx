import { columnOf, type Column, type TaskView } from '@mufu/core/view';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { createTask, DaemonError, fetchDoctor, listTasks, listWorkflows, taskKeys } from '@/api/tasks';
import { NewTaskDialog, type NewTaskInput } from '@/common/components/new-task-dialog';
import { Button } from '@/common/components/ui/button';
import { cn } from '@/common/utils';
import { BoardColumn } from '@/modules/board/components/column';
import { usePreferences } from '@/store/preferences';

const columns: Column[] = ['needs_you', 'running', 'to_review'];

const nav = [
  { label: '新任务', icon: '＋', action: 'create' as const },
  { label: '任务', icon: '▦', action: 'board' as const },
];

function group(tasks: TaskView[]): Record<Column, TaskView[]> {
  return {
    needs_you: tasks.filter((task) => columnOf(task) === 'needs_you'),
    running: tasks.filter((task) => columnOf(task) === 'running'),
    to_review: tasks.filter((task) => columnOf(task) === 'to_review'),
  };
}

export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: taskKeys.list, queryFn: listTasks, refetchInterval: 1500 });
  const doctor = useQuery({ queryKey: taskKeys.doctor, queryFn: fetchDoctor, retry: false });
  const workflows = useQuery({ queryKey: taskKeys.workflows, queryFn: listWorkflows });
  const repoPath = usePreferences((state) => state.repoPath);
  const setRepoPath = usePreferences((state) => state.setRepoPath);
  const [open, setOpen] = useState(false);
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
  const grouped = tasks.data ? group(tasks.data) : null;
  const waiting = (grouped?.needs_you.length ?? 0) + (grouped?.to_review.length ?? 0);

  return (
    <div className="bg-background flex h-dvh flex-col md:flex-row">
      <nav className="bg-muted flex gap-1 overflow-x-auto border-b px-2 py-2 md:w-44 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-2 md:py-2.5">
        {nav.map((item) =>
          item.action === 'board' ? (
            <Link
              key={item.label}
              to="/"
              className="bg-accent flex items-center gap-2.5 rounded-md px-2.5 py-1.5 font-medium"
            >
              <span className="text-muted-foreground w-3.5 text-center">{item.icon}</span>
              {item.label}
              <span className="text-muted-foreground ml-auto text-[11px]">{tasks.data?.length ?? 0}</span>
            </Link>
          ) : (
            <button
              key={item.label}
              type="button"
              className="text-foreground flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left"
              onClick={() => {
                if (item.action === 'create') setOpen(true);
              }}
            >
              <span className="text-muted-foreground w-3.5 text-center">{item.icon}</span>
              {item.label}
            </button>
          ),
        )}
        <p className="text-muted-foreground mt-auto hidden px-2 pt-6 text-[11px] md:block">
          Codex <Dot on={doctor.data?.tools.find((tool) => tool.name === 'codex')?.installed} /> Claude{' '}
          <Dot on={doctor.data?.tools.find((tool) => tool.name === 'claude')?.installed} />
        </p>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="text-muted-foreground flex h-12 items-center gap-3 border-b px-4">
          <span>全部项目</span>
          <span className="hidden sm:inline">排序</span>
          <span className="hidden sm:inline">模板：全部</span>
          <span className="text-foreground">
            等你 {grouped?.needs_you.length ?? 0} · 待验收 {grouped?.to_review.length ?? 0}
          </span>
          <Button className="ml-auto" size="sm" onClick={() => setOpen(true)}>
            ＋ 新任务
          </Button>
          <div className="hidden gap-1 sm:flex">
            <span className="bg-accent text-foreground rounded px-1.5 py-0.5">▦</span>
            <span className="px-1.5 py-0.5" aria-disabled="true">
              ☰
            </span>
          </div>
        </header>
        {tasks.isPending ? <p className="text-muted-foreground p-6 text-sm">正在读取任务</p> : null}
        {tasks.isError ? (
          <p className="border-foreground m-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <span className="bg-primary text-primary-foreground inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold">
              !
            </span>
            {tasks.error instanceof DaemonError ? tasks.error.message : '任务列表没有读出来'}
          </p>
        ) : null}
        {grouped && tasks.data?.length === 0 ? (
          <p className="text-muted-foreground px-4 pt-4 text-sm">看板上还没有任务。建一个，它会从「进行中」开始。</p>
        ) : null}
        {grouped ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-auto p-3 md:grid-cols-3 md:p-4">
            {columns.map((column) => (
              <BoardColumn key={column} column={column} tasks={grouped[column]} />
            ))}
          </div>
        ) : null}
        <span className="sr-only">{waiting}</span>
      </div>
      <NewTaskDialog
        open={open}
        onOpenChange={setOpen}
        defaultRepo={repoPath}
        workflows={workflows.data ?? []}
        pending={create.isPending}
        errorMessage={create.error instanceof Error ? create.error.message : null}
        onSubmit={(value) => {
          create.mutate(value);
        }}
      />
    </div>
  );
}

function Dot({ on }: { on: boolean | undefined }) {
  return <span className={cn('inline-block size-1.5 rounded-full', on ? 'bg-foreground' : 'bg-border')} aria-hidden />;
}
