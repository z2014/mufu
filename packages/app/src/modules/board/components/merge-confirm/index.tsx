import type { DiffView } from '@mufu/core/view';

import { Button } from '@/common/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/common/components/ui/dialog';

function mergeConfirmTitle(diff: DiffView, fallbackPr: number | null): string {
  const pr = diff.pr ?? fallbackPr;
  const number = pr === null ? 'PR' : `PR #${pr}`;
  return `合并 ${number} · ${diff.fileCount} 个文件`;
}

export function MergeConfirm({
  diff,
  fallbackPr,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  diff: DiffView;
  fallbackPr: number | null;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mergeConfirmTitle(diff, fallbackPr)}</DialogTitle>
          <DialogDescription>确认后由本机 gh 合并。这一步不会在页面里跑 git。</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={pending} onClick={onConfirm}>
            验收并合并
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
