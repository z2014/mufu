import { columnOf, type TaskView } from '@mufu/core/view';
import { Link } from 'react-router';

import { cn } from '@/common/utils';

export function TaskNav({ tasks, currentId }: { tasks: TaskView[]; currentId?: string }) {
  const needsYou = tasks.filter((task) => {
    const column = columnOf(task);
    return column === 'needs_you' || column === 'to_review';
  });
  const running = tasks.filter((task) => columnOf(task) === 'running');
  return (
    <>
      <Group title="需要你" tasks={needsYou} currentId={currentId} />
      <Group title="进行中" tasks={running} currentId={currentId} muted />
    </>
  );
}

function Group({
  title,
  tasks,
  currentId,
  muted,
}: {
  title: string;
  tasks: TaskView[];
  currentId?: string;
  muted?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground px-2.5 pb-1 pt-4 text-xs">{title}</p>
      {tasks.length === 0 ? <p className="text-muted-foreground px-2.5 text-xs">无</p> : null}
      {tasks.map((item) => {
        const unread = item.pins.some((pin) => !pin.read);
        return (
          <Link
            key={item.id}
            to={`/task/${item.id}`}
            className={cn(
              'flex items-center rounded-md px-2.5 py-2',
              item.id === currentId && 'bg-accent',
              unread && 'font-semibold',
              muted && item.id !== currentId && !unread && 'text-muted-foreground',
            )}
          >
            <span className="truncate">{item.title}</span>
            {item.attention ? <span className="ml-auto text-xs font-bold">!</span> : null}
            {!item.attention && item.pendingGate ? (
              <span className="bg-foreground ml-auto size-1.5 rounded-full" />
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
