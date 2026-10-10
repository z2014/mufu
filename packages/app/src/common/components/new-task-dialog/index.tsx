import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/common/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/common/components/ui/dialog';
import { Input } from '@/common/components/ui/input';
import { Textarea } from '@/common/components/ui/textarea';

const formSchema = z.object({
  title: z.string().trim().min(1, '写一个标题'),
  prompt: z.string().trim().min(1, '写清楚要做什么'),
  workflowId: z.string().min(1, '选一个流程'),
  repoPath: z.string(),
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新任务</DialogTitle>
          <DialogDescription>
            流程和每个阶段的代理从守护进程读来，可以改。最终验收通过后会合并对应的 PR。
          </DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 flex max-h-[70vh] flex-col gap-3 overflow-auto"
          onSubmit={(event) => {
            void form.handleSubmit((value) => onSubmit({ ...value, agents }))(event);
          }}
        >
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
          <label className="flex flex-col gap-1 text-sm">
            流程
            <select className="border-input bg-background h-9 rounded-md border px-3" {...form.register('workflowId')}>
              {workflows.length === 0 ? <option value="">没有可用的流程</option> : null}
              {workflows.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm">各阶段的代理</legend>
            {(selected?.stages ?? []).map((stage) => (
              <label key={stage.id} className="flex items-center justify-between gap-3 text-sm">
                {stage.title}
                <select
                  className="border-input bg-background h-9 rounded-md border px-3"
                  aria-label={`${stage.title}的代理`}
                  value={agents[stage.id] ?? 'codex'}
                  onChange={(event) => {
                    const kind = event.target.value === 'claude' ? 'claude' : 'codex';
                    setAgents((current) => ({ ...current, [stage.id]: kind }));
                  }}
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude</option>
                </select>
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm">
            工作目录
            <span className="flex gap-2">
              <Input placeholder="仓库或目录的绝对路径，留空则用临时仓库" {...form.register('repoPath')} />
              {window.mufu?.pickDirectory ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void window.mufu?.pickDirectory().then((path) => {
                      if (path) form.setValue('repoPath', path);
                    });
                  }}
                >
                  选择目录
                </Button>
              ) : null}
            </span>
          </label>
          {errorMessage ? <p className="text-sm">{errorMessage}</p> : null}
          <div className="mt-2 flex justify-end gap-2">
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
