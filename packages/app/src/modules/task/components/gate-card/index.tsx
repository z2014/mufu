import type { GateView } from '@mufu/core/view';
import { useState } from 'react';

import { Button } from '@/common/components/ui/button';

export function GateCard({
  gate,
  pending,
  onDecide,
}: {
  gate: GateView;
  pending: boolean;
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
        <Button type="button" variant="outline" disabled={pending} onClick={() => setRejecting((value) => !value)}>
          打回
        </Button>
        <Button type="button" disabled={pending} onClick={() => onDecide('approve')}>
          {approveLabel}
        </Button>
      </div>
      {rejecting ? (
        <form
          className="mt-3 flex gap-2"
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
          <input
            id="reject-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="写一句原因"
            className="border-input focus-visible:ring-ring min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1"
          />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            送出打回
          </Button>
        </form>
      ) : null}
      {hint ? <p className="text-muted-foreground mt-2 text-xs">{hint}</p> : null}
    </div>
  );
}
