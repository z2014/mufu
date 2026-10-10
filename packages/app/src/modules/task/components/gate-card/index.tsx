import type { GateView } from '@mufu/core/view';

import { Button } from '@/common/components/ui/button';

export function GateCard({
  gate,
  pending,
  onDecide,
}: {
  gate: GateView;
  pending: boolean;
  onDecide: (decision: 'approve' | 'reject') => void;
}) {
  const approveLabel = gate.kind === 'final' ? '验收并合并' : '通过';
  return (
    <div className="mx-4 mb-3 flex items-center gap-3 rounded-xl border px-4 py-3.5 md:mx-14">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{gate.summary}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{gate.detail || gate.operation}</p>
      </div>
      <Button type="button" variant="outline" disabled={pending} onClick={() => onDecide('reject')}>
        打回
      </Button>
      <Button type="button" disabled={pending} onClick={() => onDecide('approve')}>
        {approveLabel}
      </Button>
    </div>
  );
}
