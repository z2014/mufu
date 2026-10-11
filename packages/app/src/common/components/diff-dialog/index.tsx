import type { DiffView } from '@mufu/core/view';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/common/components/ui/dialog';

export function DiffDialog({
  diff,
  open,
  onOpenChange,
}: {
  diff: DiffView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>看改动</DialogTitle>
          <DialogDescription>
            {diff ? `${diff.fileCount} 个文件 · +${diff.additions} −${diff.deletions}` : '还没有改动记录'}
          </DialogDescription>
        </DialogHeader>
        {diff && diff.files.length > 0 ? (
          <ul className="mt-4 min-h-0 flex-1 overflow-y-auto text-sm">
            {diff.files.map((file) => (
              <li key={file.path} className="flex items-baseline gap-3 border-b py-2">
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  +{file.additions} −{file.deletions}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground mt-4 text-sm">这条任务还没有文件列表。</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
