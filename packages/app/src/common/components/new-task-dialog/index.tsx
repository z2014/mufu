import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/common/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/common/components/ui/dialog';
import { Input } from '@/common/components/ui/input';
import { Textarea } from '@/common/components/ui/textarea';

const formSchema = z.object({
  title: z.string().trim().min(1, '写一个标题'),
  prompt: z.string().trim().min(1, '写清楚要做什么'),
  workflowId: z.enum(['fix-bug', 'new-feature']),
  repoPath: z.string(),
});

export type NewTaskInput = z.infer<typeof formSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRepo: string;
  pending: boolean;
  errorMessage: string | null;
  onSubmit: (value: NewTaskInput) => void;
};

export function NewTaskDialog({ open, onOpenChange, defaultRepo, pending, errorMessage, onSubmit }: Props) {
  const form = useForm<NewTaskInput>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: '', prompt: '', workflowId: 'fix-bug', repoPath: defaultRepo },
  });

  useEffect(() => {
    if (open) form.reset({ title: '', prompt: '', workflowId: 'fix-bug', repoPath: defaultRepo });
  }, [open, defaultRepo, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新任务</DialogTitle>
          <DialogDescription>任务会进 git worktree，由本地代理按流程做。合并不会自动发生。</DialogDescription>
        </DialogHeader>
        <form className="mt-4 flex flex-col gap-3" onSubmit={form.handleSubmit(onSubmit)}>
          <label className="flex flex-col gap-1 text-sm">
            标题
            <Input {...form.register('title')} />
            <span className="text-xs text-muted-foreground">{form.formState.errors.title?.message}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            描述
            <Textarea {...form.register('prompt')} />
            <span className="text-xs text-muted-foreground">{form.formState.errors.prompt?.message}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            流程
            <select
              className="h-9 rounded-md border border-input bg-background px-3"
              {...form.register('workflowId')}
            >
              <option value="fix-bug">修 bug</option>
              <option value="new-feature">新功能</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            仓库路径
            <Input placeholder="留空则用临时仓库" {...form.register('repoPath')} />
          </label>
          {errorMessage ? <p className="text-sm">{errorMessage}</p> : null}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? '正在创建' : '创建任务'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
