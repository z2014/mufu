import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Outlet, useMatch, useNavigate } from 'react-router';

import { connectionKeys, fetchDoctor } from '@/api/connections';
import { createTask, listTasks, listWorkflows, taskKeys } from '@/api/tasks';
import { AppShell } from '@/common/components/app-shell';
import { NewTaskDialog, type NewTaskInput } from '@/common/components/new-task-dialog';
import { TaskNav } from '@/common/components/task-nav';
import { cn } from '@/common/utils';
import type { WorkbenchContext } from '@/common/workbench';
import { usePreferences } from '@/store/preferences';

/** 侧栏的任务列表和连接状态只在这里订阅。换页不卸载这个布局，所以不会重取。 */
export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const taskMatch = useMatch('/task/:taskId');
  const settingsMatch = useMatch('/settings');
  const tasks = useQuery({ queryKey: taskKeys.list, queryFn: listTasks });
  const doctor = useQuery({ queryKey: connectionKeys.doctor, queryFn: fetchDoctor, retry: false });
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
  let active: 'board' | 'task' | 'settings' = 'board';
  if (taskMatch) active = 'task';
  if (settingsMatch) active = 'settings';
  const context: WorkbenchContext = {
    tasks: tasks.data,
    tasksPending: tasks.isPending,
    tasksError: tasks.error,
    openNewTask: () => setOpen(true),
    doctor: doctor.data,
    doctorPending: doctor.isPending,
    doctorFetching: doctor.isFetching,
    doctorError: doctor.error,
    recheckDoctor: () => {
      void doctor.refetch();
    },
  };

  return (
    <AppShell
      active={active}
      onNewTask={() => setOpen(true)}
      menu={<TaskNav tasks={tasks.data ?? []} currentId={taskMatch?.params.taskId} />}
      footer={
        <p className="text-muted-foreground hidden px-2.5 pt-3 text-[11px] md:block">
          Codex <Dot on={doctor.data?.tools.find((tool) => tool.name === 'codex')?.installed} /> Claude{' '}
          <Dot on={doctor.data?.tools.find((tool) => tool.name === 'claude')?.installed} />
        </p>
      }
    >
      <Outlet context={context} />
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
