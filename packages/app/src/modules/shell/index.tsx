import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Link, Outlet, useMatch, useNavigate } from 'react-router';

import { useDoctor } from '@/api/connections';
import { checkWorkdir, createTask, listWorkflows, taskKeys, useTasks } from '@/api/tasks';
import { AppShell } from '@/common/components/app-shell';
import { NewTaskDialog, type NewTaskInput } from '@/common/components/new-task-dialog';
import { TaskNav } from '@/common/components/task-nav';
import type { WorkbenchContext } from '@/common/workbench';
import { usePreferences } from '@/store/preferences';

/** 侧栏自己读任务和连接。页面用同一套 query key，React Query 会合并进行中的请求。 */
export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const taskMatch = useMatch('/task/:taskId');
  const settingsMatch = useMatch('/settings');
  const tasks = useTasks();
  const doctor = useDoctor();
  const workflows = useQuery({ queryKey: taskKeys.workflows, queryFn: listWorkflows });
  const repoPath = usePreferences((state) => state.repoPath);
  const setRepoPath = usePreferences((state) => state.setRepoPath);
  const [open, setOpen] = useState(false);
  const validateRepo = useCallback(async (path: string) => {
    try {
      await checkWorkdir(path);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '这个目录不是 git 仓库';
    }
  }, []);
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
    openNewTask: () => setOpen(true),
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
        validateRepo={validateRepo}
        onSubmit={(value) => {
          create.mutate(value);
        }}
      />
    </AppShell>
  );
}

function Dot({ on }: { on: boolean | undefined }) {
  if (on) {
    return <span className="bg-foreground inline-block size-2 rounded-full align-middle" aria-label="已连接" />;
  }
  if (on === false) {
    return (
      <Link
        to="/settings"
        className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex size-4 items-center justify-center rounded-full align-middle text-[10px] font-bold focus-visible:outline-none focus-visible:ring-1"
        aria-label="未连接"
      >
        !
      </Link>
    );
  }
  return <span className="bg-border inline-block size-2 rounded-full align-middle" aria-hidden />;
}
