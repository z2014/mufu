import * as React from 'react';

import { cn } from '@/common/utils';

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-1',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
