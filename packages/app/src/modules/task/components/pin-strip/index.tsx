import type { PinView } from '@mufu/core/view';

export function PinStrip({ pins, onReadAll }: { pins: PinView[]; onReadAll: () => void }) {
  const unread = pins.filter((pin) => !pin.read);
  if (unread.length === 0) return null;
  return (
    <div className="bg-muted mx-4 mt-3 rounded-lg border px-3.5 py-2.5 md:mx-14">
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
        <p key={pin.id} className="flex py-1 text-sm">
          {pin.message}
          <span className="text-muted-foreground ml-auto text-xs">{pin.author}</span>
        </p>
      ))}
    </div>
  );
}
