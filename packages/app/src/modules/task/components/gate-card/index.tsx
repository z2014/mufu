import type { DiffView, GateView } from '@mufu/core/view';
import { useState } from 'react';

import { Button } from '@/common/components/ui/button';
import { Textarea } from '@/common/components/ui/textarea';

export function GateCard({
  gate,
  pending,
  diff,
  merging,
  onShowDiff,
  onDecide,
}: {
  gate: GateView;
  pending: boolean;
  diff: DiffView | null;
  merging: boolean;
  onShowDiff: () => void;
  onDecide: (decision: 'approve' | 'reject', comment?: string) => void;
}) {
  const approveLabel = gate.kind === 'final' ? '验收并合并' : '通过';
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [hint, setHint] = useState('');
  return (
    <div className="mx-4 mb-3 rounded-xl border px-4 py-3.5 md:mx-14">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{gate.summary}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{gate.detail || gate.operation}</p>
        </div>
        {diff ? (
          <Button type="button" variant="outline" onClick={onShowDiff}>
            看改动
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={pending || merging}
          onClick={() => setRejecting((value) => !value)}
        >
          打回
        </Button>
        <Button
          type="button"
          disabled={pending || merging}
          aria-busy={merging || undefined}
          onClick={() => onDecide('approve')}
        >
          {merging ? '合并中' : approveLabel}
        </Button>
      </div>
      {rejecting ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const text = comment.trim();
            if (!text) {
              setHint('打回要写一句原因');
              return;
            }
            setHint('');
            onDecide('reject', text);
          }}
        >
          <label className="sr-only" htmlFor="reject-comment">
            打回原因
          </label>
          <Textarea
            id="reject-comment"
            autoFocus
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="写一句原因"
            className="min-h-16 focus:ring-1"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              送出打回
            </Button>
          </div>
        </form>
      ) : null}
      {hint ? <p className="text-muted-foreground mt-2 text-xs">{hint}</p> : null}
    </div>
  );
}
