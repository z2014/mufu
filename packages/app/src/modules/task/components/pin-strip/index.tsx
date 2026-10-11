import type { PinView } from '@mufu/core/view';

import { shownAuthor } from '@/common/author';

export function PinStrip({
  pins,
  onReadAll,
  onOpen,
}: {
  pins: PinView[];
  onReadAll: () => void;
  onOpen: (pin: PinView) => void;
}) {
  const unread = pins.filter((pin) => !pin.read);
  if (unread.length === 0) return null;
  return (
    <div className="bg-background relative z-10 shrink-0 border-b px-4 py-2.5 md:px-7">
      <div className="bg-background rounded-lg border px-3.5 py-2.5">
        <div className="text-muted-foreground mb-1 flex text-xs">
          <span>📌 {unread.length} 条重点未读</span>
          <button
            type="button"
            className="focus-visible:ring-ring ml-auto underline focus-visible:outline-none focus-visible:ring-2"
            onClick={onReadAll}
          >
            全部已读
          </button>
        </div>
        {unread.map((pin) => (
          <button
            key={pin.id}
            type="button"
            className="focus-visible:ring-ring flex w-full items-baseline gap-3 py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2"
            onClick={() => onOpen(pin)}
          >
            <span className="min-w-0 flex-1">{pin.message}</span>
            <span className="text-muted-foreground shrink-0 text-xs">{shownAuthor(pin.author)} ›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
