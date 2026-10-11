import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/common/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/common/components/ui/dialog';
import { Input } from '@/common/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/common/components/ui/select';
import { Textarea } from '@/common/components/ui/textarea';

const formSchema = z.object({
  title: z.string().trim().min(1, '写一个标题'),
  prompt: z.string().trim().min(1, '写清楚要做什么'),
  workflowId: z.string().min(1, '选一个流程'),
  repoPath: z.string().trim().min(1, '先选择工作目录'),
});

type FormValues = z.infer<typeof formSchema>;

export type StageAgentChoice = 'codex' | 'claude';

type WorkflowChoice = {
  id: string;
  title: string;
  default?: boolean;
  stages: { id: string; title: string; agent?: StageAgentChoice }[];
};

export type NewTaskInput = FormValues & {
  agents: Record<string, StageAgentChoice>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRepo: string;
  workflows: WorkflowChoice[];
  pending: boolean;
  errorMessage: string | null;
  onSubmit: (value: NewTaskInput) => void;
};

function preferredId(workflows: WorkflowChoice[]): string {
  return workflows.find((item) => item.default)?.id ?? workflows[0]?.id ?? '';
}

function defaultsFor(workflow: WorkflowChoice | undefined): Record<string, StageAgentChoice> {
  const agents: Record<string, StageAgentChoice> = {};
  for (const stage of workflow?.stages ?? []) {
    agents[stage.id] = stage.agent === 'claude' ? 'claude' : 'codex';
  }
  return agents;
}

export function NewTaskDialog({ open, onOpenChange, defaultRepo, workflows, pending, errorMessage, onSubmit }: Props) {
  const defaultId = preferredId(workflows);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: '', prompt: '', workflowId: defaultId, repoPath: defaultRepo },
  });
  const workflowId = form.watch('workflowId');
  const selected = workflows.find((item) => item.id === workflowId) ?? workflows.find((item) => item.id === defaultId);
  const stageKey = (selected?.stages ?? []).map((stage) => `${stage.id}:${stage.agent ?? ''}`).join('|');
  const [agents, setAgents] = useState<Record<string, StageAgentChoice>>(() => defaultsFor(selected));
  const repoInvalid = Boolean(errorMessage) || Boolean(form.formState.errors.repoPath);

  useEffect(() => {
    if (!open) return;
    form.reset({ title: '', prompt: '', workflowId: defaultId, repoPath: defaultRepo });
  }, [open, defaultRepo, form, defaultId]);

  useEffect(() => {
    const workflow = workflows.find((item) => item.id === workflowId) ?? workflows[0];
    setAgents(defaultsFor(workflow));
  }, [stageKey, workflowId, workflows]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>新任务</DialogTitle>
          <DialogDescription>
            选一个流程，也可以改每个阶段用 Codex 还是 Claude。验收通过后会合并对应的 PR。
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            void form.handleSubmit((value) => onSubmit({ ...value, agents }))(event);
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <label className="flex flex-col gap-1 text-sm">
              标题
              <Input {...form.register('title')} />
              <span className="text-muted-foreground text-xs">{form.formState.errors.title?.message}</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              要做的事
              <Textarea {...form.register('prompt')} placeholder="描述这个任务" />
              <span className="text-muted-foreground text-xs">{form.formState.errors.prompt?.message}</span>
            </label>
            <div className="flex flex-col gap-1 text-sm">
              流程
              <Controller
                control={form.control}
                name="workflowId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={workflows.length === 0}>
                    <SelectTrigger aria-label="流程">
                      <SelectValue placeholder={workflows.length === 0 ? '没有可用的流程' : '选一个流程'} />
                    </SelectTrigger>
                    <SelectContent>
                      {workflows.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm">每个阶段用谁</legend>
              {(selected?.stages ?? []).map((stage) => (
                <div key={stage.id} className="flex items-center justify-between gap-3 text-sm">
                  {stage.title}
                  <Select
                    value={agents[stage.id] ?? 'codex'}
                    onValueChange={(value) => {
                      const kind = value === 'claude' ? 'claude' : 'codex';
                      setAgents((current) => ({ ...current, [stage.id]: kind }));
                    }}
                  >
                    <SelectTrigger className="w-32" aria-label={`${stage.title}用谁`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="codex">Codex</SelectItem>
                      <SelectItem value="claude">Claude</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1 text-sm">
              工作目录
              <span className="flex gap-2">
                <Input
                  id="repo-path"
                  placeholder="git 仓库的路径"
                  aria-invalid={repoInvalid || undefined}
                  {...form.register('repoPath')}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void window.mufu?.pickDirectory().then((path) => {
                      if (path) form.setValue('repoPath', path, { shouldValidate: true });
                    });
                  }}
                >
                  选择…
                </Button>
              </span>
              <span className="text-muted-foreground text-xs">{form.formState.errors.repoPath?.message}</span>
            </label>
            {errorMessage ? (
              <p className="text-destructive flex items-center gap-1.5 text-sm font-medium" role="alert">
                <span
                  className="bg-primary text-primary-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  aria-hidden
                >
                  !
                </span>
                {errorMessage}
              </p>
            ) : null}
          </div>
          <div className="mt-4 flex shrink-0 justify-end gap-2 pb-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={pending || !selected}>
              {pending ? '正在创建' : '创建任务'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
