import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';

import {
  connectionKeys,
  DaemonError,
  fetchDoctor,
  fetchSecretStatus,
  removeOpenRouterKey,
  setOpenRouterKey,
} from '@/api/connections';
import { createTask, listWorkflows, taskKeys } from '@/api/tasks';
import { AppShell } from '@/common/components/app-shell';
import { NewTaskDialog, type NewTaskInput } from '@/common/components/new-task-dialog';
import { Button } from '@/common/components/ui/button';
import { Input } from '@/common/components/ui/input';
import { usePreferences } from '@/store/preferences';

const keySchema = z.object({
  value: z.string().trim().min(1, '先贴上 key'),
});

type KeyForm = z.infer<typeof keySchema>;

function markFor(status: 'ok' | 'failed' | 'skipped'): string {
  if (status === 'ok') return '✓';
  if (status === 'skipped') return '–';
  return '✗';
}

const labels: Record<string, string> = {
  installed: '已安装',
  logged_in: '已登录',
  subscription: '订阅登录',
};

export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const doctor = useQuery({ queryKey: connectionKeys.doctor, queryFn: fetchDoctor, retry: false });
  const secret = useQuery({ queryKey: connectionKeys.secret, queryFn: fetchSecretStatus, retry: false });
  const workflows = useQuery({ queryKey: taskKeys.workflows, queryFn: listWorkflows });
  const repoPath = usePreferences((state) => state.repoPath);
  const setRepoPath = usePreferences((state) => state.setRepoPath);
  const [open, setOpen] = useState(false);
  const form = useForm<KeyForm>({ resolver: zodResolver(keySchema), defaultValues: { value: '' } });
  const save = useMutation({
    mutationFn: (value: string) => setOpenRouterKey(value),
    onSuccess: async () => {
      form.reset({ value: '' });
      await queryClient.invalidateQueries({ queryKey: connectionKeys.secret });
    },
  });
  const remove = useMutation({
    mutationFn: () => removeOpenRouterKey(),
    onSuccess: async () => {
      form.reset({ value: '' });
      await queryClient.invalidateQueries({ queryKey: connectionKeys.secret });
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

  return (
    <AppShell active="settings" onNewTask={() => setOpen(true)}>
      <header className="flex h-12 items-center gap-3 border-b px-4 md:px-7">
        <h1 className="font-semibold">连接</h1>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={doctor.isFetching}
          onClick={() => {
            void doctor.refetch();
          }}
        >
          重新检测
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-6 md:px-7">
        {doctor.isPending ? <p className="text-muted-foreground text-sm">正在检查本机的 codex、claude 和 gh</p> : null}
        {doctor.isError ? (
          <p className="mb-4 text-sm">{doctor.error instanceof DaemonError ? doctor.error.message : '检查没有完成'}</p>
        ) : null}
        {doctor.data ? (
          <>
            {doctor.data.ignoredEnvKeys.length > 0 ? (
              <p className="border-border mb-4 rounded-lg border px-3 py-2 text-sm">
                已检测到，已忽略，使用订阅：{doctor.data.ignoredEnvKeys.join('、')}
              </p>
            ) : null}
            <ul className="flex flex-col gap-4">
              {doctor.data.tools.map((tool) => (
                <li key={tool.name} className="rounded-lg border px-4 py-3">
                  <p className="font-semibold">{tool.name}</p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {tool.items.map((item) => (
                      <li
                        key={item.name}
                        className={
                          item.status === 'skipped'
                            ? 'text-muted-foreground flex flex-wrap items-baseline gap-2 text-sm'
                            : 'flex flex-wrap items-baseline gap-2 text-sm'
                        }
                      >
                        <span aria-hidden>{markFor(item.status)}</span>
                        <span>{labels[item.name] ?? item.name}</span>
                        {item.detail ? <span className="text-muted-foreground">{item.detail}</span> : null}
                        {item.fix ? <span className="text-muted-foreground">修复：{item.fix}</span> : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {doctor.data.configKeys.length > 0 ? (
              <p className="text-muted-foreground mt-4 text-xs">
                配置文件里有 key 字段，不会读取内容：
                {doctor.data.configKeys.map((finding) => `${finding.tool} ${finding.key}`).join('、')}
              </p>
            ) : null}
            <p className="text-muted-foreground mt-4 text-xs">{doctor.data.note}</p>
          </>
        ) : null}

        <section className="mt-8 max-w-md">
          <h2 className="font-semibold">OpenRouter</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            留给以后用。现在还不会用到。页面上不显示已保存的值。
          </p>
          {secret.isPending ? <p className="text-muted-foreground mt-3 text-sm">正在查看是否已设置</p> : null}
          {secret.isError ? (
            <p className="mt-3 text-sm">{secret.error instanceof Error ? secret.error.message : '钥匙状态没读到'}</p>
          ) : null}
          {secret.data ? (
            <form
              className="mt-3 flex flex-col gap-2"
              onSubmit={(event) => {
                void form.handleSubmit((values) => save.mutate(values.value))(event);
              }}
            >
              <p className="text-sm">{secret.data.openrouter ? '已设置' : '未设置'}</p>
              <label className="text-sm" htmlFor="openrouter-key">
                {secret.data.openrouter ? '替换' : '填入'}
              </label>
              <Input id="openrouter-key" type="password" autoComplete="off" {...form.register('value')} />
              {form.formState.errors.value ? (
                <p className="text-muted-foreground text-xs">{form.formState.errors.value.message}</p>
              ) : null}
              {save.isError ? (
                <p className="text-sm">{save.error instanceof Error ? save.error.message : '没存上'}</p>
              ) : null}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={save.isPending}>
                  {secret.data.openrouter ? '替换' : '保存'}
                </Button>
                {secret.data.openrouter ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    删除
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}
        </section>
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
    </AppShell>
  );
}
