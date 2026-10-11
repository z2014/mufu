import type { ReactNode } from 'react';

import { cn } from '@/common/utils';

/** 重点记下的是消息事件的 id，不是数组下标。 */
export function pinAnchor(messageId: string): string {
  return `msg-${messageId}`;
}

export function PinTarget({
  messageId,
  highlighted,
  className,
  children,
}: {
  messageId: string;
  highlighted: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={pinAnchor(messageId)}
      data-highlighted={highlighted ? 'true' : 'false'}
      className={cn(className, highlighted && 'bg-accent rounded-md px-3 py-2')}
    >
      {children}
    </div>
  );
}
