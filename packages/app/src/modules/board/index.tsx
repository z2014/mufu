import { columnOf, type Column, type TaskView } from '@mufu/core/view';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { createTask, DaemonError, fetchDoctor, listTasks, taskKeys } from '@/api/tasks';
import { NewTaskDialog, type NewTaskInput } from '@/common/components/new-task-dialog';
import { Button } from '@/common/components/ui/button';
import { cn } from '@/common/utils';
import { BoardColumn } from '@/modules/board/components/column';
import { usePreferences } from '@/store/preferences';

const columns: Column[] = ['needs_you', 'running', 'to_review'];

const nav = [
  { label: '任务', icon: '#', live: true },
  { label: '对话', icon: '◌', live: false },
  { label: '自动化', icon: '◷', live: false },
  { label: 'Agents', icon: '☺', live: false },
  { label: 'Skills', icon: '▤', live: false },
  { label: '集成', icon: '⌁', live: false },
  { label: '设置', icon: '⚙', live: false },
];

function group(tasks: TaskView[]): Record<Column, TaskView[]> {
  return {
    needs_you: tasks.filter((task) => columnOf(task) === 'needs_you'),
    running: tasks.filter((task) => columnOf(task) === 'running'),
    to_review: tasks.filter((task) => columnOf(task) === 'to_review'),
  };
}

export function Component() {
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: taskKeys.list, queryFn: listTasks, refetchInterval: 1500 });
  const doctor = useQuery({ queryKey: taskKeys.doctor, queryFn: fetchDoctor, retry: false });
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
      }),
    onSuccess: async (_task, input) => {
      setRepoPath(input.repoPath);
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: taskKeys.list });
    },
  });
  const grouped = tasks.data ? group(tasks.data) : null;
  const waiting = (grouped?.needs_you.length ?? 0) + (grouped?.to_review.length ?? 0);

  return (
    <div className="flex h-dvh flex-col bg-background md:flex-row">
      <nav className="flex gap-1 overflow-x-auto border-b bg-muted px-2 py-2 md:w-44 md:flex-col md:overflow-visible md:border-r md:border-b-0 md:px-2 md:py-2.5">
        <div className="mb-1 hidden gap-1.5 md:flex">
          <button type="button" className="h-8 flex-1 rounded-md bg-accent text-muted-foreground" aria-label="新任务" onClick={() => setOpen(true)}>
            ＋
          </button>
          <button type="button" className="size-8 rounded-md bg-accent text-muted-foreground" aria-disabled="true">
            ⌕
          </button>
        </div>
        {nav.map((item) =>
          item.live ? (
            <Link key={item.label} to="/" className="flex items-center gap-2.5 rounded-md bg-accent px-2.5 py-1.5 font-medium">
              <span className="w-3.5 text-center text-muted-foreground">{item.icon}</span>
              {item.label}
              <span className="ml-auto text-[11px] text-muted-foreground">{tasks.data?.length ?? 0}</span>
            </Link>
          ) : (
            <button
              key={item.label}
              type="button"
              aria-disabled="true"
              className="flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-foreground"
            >
              <span className="w-3.5 text-center text-muted-foreground">{item.icon}</span>
              {item.label}
            </button>
          ),
        )}
        <p className="mt-auto hidden px-2 pt-6 text-[11px] text-muted-foreground md:block">
          Codex <Dot on={doctor.data?.tools.find((tool) => tool.name === 'codex')?.installed} /> Claude{' '}
          <Dot on={doctor.data?.tools.find((tool) => tool.name === 'claude')?.installed} />
        </p>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-3 border-b px-4 text-muted-foreground">
          <span>全部项目</span>
          <span className="hidden sm:inline">排序</span>
          <span className="hidden sm:inline">模板：全部</span>
          <span className="text-foreground">等你 {grouped?.needs_you.length ?? 0} · 待验收 {grouped?.to_review.length ?? 0}</span>
          <Button className="ml-auto" size="sm" onClick={() => setOpen(true)}>
            ＋ 新任务
          </Button>
          <div className="hidden gap-1 sm:flex">
            <span className="rounded bg-accent px-1.5 py-0.5 text-foreground">▦</span>
            <span className="px-1.5 py-0.5" aria-disabled="true">
              ☰
            </span>
          </div>
        </header>
        {tasks.isPending ? <p className="p-6 text-sm text-muted-foreground">正在读取任务</p> : null}
        {tasks.isError ? (
          <p className="m-4 flex items-center gap-2 rounded-lg border border-foreground px-3 py-2 text-sm">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              !
            </span>
            {tasks.error instanceof DaemonError ? tasks.error.message : '任务列表没有读出来'}
          </p>
        ) : null}
        {grouped && tasks.data?.length === 0 ? (
          <p className="px-4 pt-4 text-sm text-muted-foreground">看板上还没有任务。建一个，它会从「进行中」开始。</p>
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
  return (
    <span className={cn('inline-block size-1.5 rounded-full', on ? 'bg-foreground' : 'bg-border')} aria-hidden />
  );
}
