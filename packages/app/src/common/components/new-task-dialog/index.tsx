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
  repoPath: z.string().trim().min(1, '先选择工作目录'),
});

export type NewTaskInput = z.infer<typeof formSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRepo: string;
  pending: boolean;
  errorMessage: string | null;
  validateRepo: (path: string) => Promise<string | null>;
  onSubmit: (value: NewTaskInput) => void;
};

export function WorkdirAlert({ message }: { message: string }) {
  return (
    <p className="text-destructive flex items-center gap-1.5 text-sm font-medium" role="alert">
      <span
        className="bg-primary text-primary-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        aria-hidden
      >
        !
      </span>
      {message}
    </p>
  );
}

export function NewTaskDialog({
  open,
  onOpenChange,
  defaultRepo,
  pending,
  errorMessage,
  validateRepo,
  onSubmit,
}: Props) {
  const form = useForm<NewTaskInput>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: '', prompt: '', repoPath: defaultRepo },
  });
  const title = form.watch('title');
  const repoPath = form.watch('repoPath');
  const [repoVerdict, setRepoVerdict] = useState<{ path: string; message: string | null } | null>(null);
  const [checkingRepo, setCheckingRepo] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRepoVerdict(null);
    form.reset({ title: '', prompt: '', repoPath: defaultRepo });
  }, [open, defaultRepo, form]);

  useEffect(() => {
    if (!open) return undefined;
    const path = repoPath.trim();
    if (!path) {
      setCheckingRepo(false);
      setRepoVerdict(null);
      return undefined;
    }
    let cancelled = false;
    setCheckingRepo(true);
    const timer = setTimeout(() => {
      void validateRepo(path)
        .then((message) => {
          if (cancelled) return;
          setRepoVerdict({ path, message });
          setCheckingRepo(false);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setRepoVerdict({ path, message: error instanceof Error ? error.message : '这个目录不是 git 仓库' });
          setCheckingRepo(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, repoPath, validateRepo]);

  const trimmedRepo = repoPath.trim();
  const repoMessage = repoVerdict?.path === trimmedRepo ? repoVerdict.message : null;
  const repoOk = trimmedRepo.length > 0 && repoMessage === null && !checkingRepo && repoVerdict?.path === trimmedRepo;
  const inlineError = repoMessage ?? errorMessage;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>新任务</DialogTitle>
          <DialogDescription>写下要做的事和工作目录。流程按内容选，每个阶段用模板里的代理。</DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            void form.handleSubmit((value) => onSubmit(value))(event);
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
            <label className="flex flex-col gap-1 text-sm">
              工作目录
              <span className="flex gap-2">
                <Input
                  id="repo-path"
                  placeholder="git 仓库的路径"
                  aria-invalid={Boolean(inlineError) || undefined}
                  {...form.register('repoPath')}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void window.mufu?.pickDirectory().then((path) => {
                      if (path) form.setValue('repoPath', path, { shouldDirty: true });
                    });
                  }}
                >
                  选择…
                </Button>
              </span>
              <span className="text-muted-foreground text-xs">{form.formState.errors.repoPath?.message}</span>
            </label>
            {inlineError ? <WorkdirAlert message={inlineError} /> : null}
          </div>
          <div className="mt-4 flex shrink-0 justify-end gap-2 pb-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={pending || title.trim().length === 0 || !repoOk}>
              {pending ? '正在创建' : '创建任务'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
