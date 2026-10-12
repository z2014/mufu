import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  connectionKeys,
  DaemonError,
  fetchSecretStatus,
  removeOpenRouterKey,
  setOpenRouterKey,
  useDoctor,
} from '@/api/connections';
import { Button } from '@/common/components/ui/button';
import { Input } from '@/common/components/ui/input';

const keySchema = z.object({
  value: z.string().trim().min(1, '先贴上钥匙'),
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
  const queryClient = useQueryClient();
  const doctorQuery = useDoctor();
  const doctor = doctorQuery.data;
  const doctorPending = doctorQuery.isPending;
  const doctorFetching = doctorQuery.isFetching;
  const doctorError = doctorQuery.error;
  const secret = useQuery({ queryKey: connectionKeys.secret, queryFn: fetchSecretStatus, retry: false });
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
  return (
    <>
      <header className="flex h-12 items-center gap-3 border-b px-4 md:px-7">
        <h1 className="font-semibold">连接</h1>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={doctorFetching}
          onClick={() => void doctorQuery.refetch()}
        >
          重新检测
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-6 md:px-7">
        {doctorPending ? <p className="text-muted-foreground text-sm">正在检查本机的 codex、claude 和 gh</p> : null}
        {doctorError ? (
          <p className="mb-4 text-sm">{doctorError instanceof DaemonError ? doctorError.message : '检查没有完成'}</p>
        ) : null}
        {doctor ? (
          <>
            {doctor.ignoredEnvKeys.length > 0 ? (
              <p className="border-border mb-4 rounded-lg border px-3 py-2 text-sm">
                已检测到，已忽略，使用订阅：{doctor.ignoredEnvKeys.join('、')}
              </p>
            ) : null}
            <ul className="flex flex-col gap-4">
              {doctor.tools.map((tool) => (
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
            {doctor.configKeys.length > 0 ? (
              <p className="text-muted-foreground mt-4 text-xs">
                配置文件里写了钥匙，不会读取内容：
                {doctor.configKeys.map((finding) => `${finding.tool} ${finding.key}`).join('、')}
              </p>
            ) : null}
            <p className="text-muted-foreground mt-4 text-xs">{doctor.note}</p>
          </>
        ) : null}

        <section className="mt-8 max-w-md">
          <h2 className="font-semibold">OpenRouter</h2>
          <p className="text-muted-foreground mt-1 text-sm">留给以后用。现在还不会用到。页面上不显示已保存的值。</p>
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
    </>
  );
}
