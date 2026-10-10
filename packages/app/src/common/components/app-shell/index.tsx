import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { cn } from '@/common/utils';

export function AppShell({
  active,
  onNewTask,
  menu,
  footer,
  children,
}: {
  active: 'board' | 'task' | 'settings';
  onNewTask: () => void;
  menu?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-background flex h-dvh flex-col md:flex-row">
      <nav className="bg-muted flex max-h-52 flex-col overflow-auto border-b px-2 py-2 md:max-h-none md:w-56 md:border-b-0 md:border-r md:px-3 md:py-4">
        <Link to="/" className="px-2.5 pb-3 text-lg font-bold">
          工作台
        </Link>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left"
          onClick={onNewTask}
        >
          <span className="text-muted-foreground w-4 text-center">＋</span>
          新任务
        </button>
        <Link
          to="/"
          className={cn(
            'flex items-center gap-2.5 rounded-md px-2.5 py-2',
            active === 'board' && 'bg-accent font-medium',
          )}
        >
          <span className="text-muted-foreground w-4 text-center">▦</span>
          任务
        </Link>
        {menu}
        <div className="mt-auto">
          <Link
            to="/settings"
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2',
              active === 'settings' && 'bg-accent font-medium',
            )}
          >
            <span className="text-muted-foreground w-4 text-center">⚙</span>
            设置
          </Link>
          {footer}
        </div>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
