import { columnOf, type Column, type TaskView } from '@mufu/core/view';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { connectionKeys, fetchDoctor } from '@/api/connections';
import { createTask, DaemonError, listTasks, listWorkflows, resolveGate, taskKeys } from '@/api/tasks';
import { AppShell } from '@/common/components/app-shell';
import { NewTaskDialog, type NewTaskInput } from '@/common/components/new-task-dialog';
import { TaskNav } from '@/common/components/task-nav';
import { Button } from '@/common/components/ui/button';
import { cn } from '@/common/utils';
import { BoardColumn } from '@/modules/board/components/column';
import { usePreferences } from '@/store/preferences';

const columns: Column[] = ['needs_you', 'running', 'to_review'];

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
  const tasks = useQuery({ queryKey: taskKeys.list, queryFn: listTasks });
  const doctor = useQuery({ queryKey: connectionKeys.doctor, queryFn: fetchDoctor, retry: false });
  const workflows = useQuery({ queryKey: taskKeys.workflows, queryFn: listWorkflows });
  const repoPath = usePreferences((state) => state.repoPath);
  const setRepoPath = usePreferences((state) => state.setRepoPath);
  const [open, setOpen] = useState(false);
  const gate = useMutation({
    mutationFn: (input: { gateId: string; decision: 'approve' | 'reject'; comment?: string }) =>
      resolveGate(input.gateId, input.decision, input.comment),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.list });
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
  const grouped = tasks.data ? group(tasks.data) : null;
  const waiting = (grouped?.needs_you.length ?? 0) + (grouped?.to_review.length ?? 0);

  return (
    <AppShell
      active="board"
      onNewTask={() => setOpen(true)}
      menu={<TaskNav tasks={tasks.data ?? []} />}
      footer={
        <p className="text-muted-foreground hidden px-2.5 pt-3 text-[11px] md:block">
          Codex <Dot on={doctor.data?.tools.find((tool) => tool.name === 'codex')?.installed} /> Claude{' '}
          <Dot on={doctor.data?.tools.find((tool) => tool.name === 'claude')?.installed} />
        </p>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="text-muted-foreground flex h-12 items-center gap-3 border-b px-4">
          <span className="text-foreground">
            等你 {grouped?.needs_you.length ?? 0} · 待验收 {grouped?.to_review.length ?? 0}
          </span>
          <Button className="ml-auto" size="sm" onClick={() => setOpen(true)}>
            ＋ 新任务
          </Button>
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
              <BoardColumn
                key={column}
                column={column}
                tasks={grouped[column]}
                pendingGateId={gate.isPending ? gate.variables?.gateId : null}
                onDecide={(task, decision, comment) => {
                  const gateId = task.pendingGate?.id;
                  if (!gateId) return;
                  gate.mutate({ gateId, decision, comment });
                }}
              />
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
    </AppShell>
  );
}

function Dot({ on }: { on: boolean | undefined }) {
  return <span className={cn('inline-block size-1.5 rounded-full', on ? 'bg-foreground' : 'bg-border')} aria-hidden />;
}
