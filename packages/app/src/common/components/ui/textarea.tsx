import * as React from 'react';

import { cn } from '@/common/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'border-input bg-background focus-visible:ring-ring flex min-h-24 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
