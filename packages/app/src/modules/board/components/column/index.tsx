import { sortInColumn, type Column, type TaskView } from '@mufu/core/view';

import { TaskCard } from '@/modules/board/components/task-card';

const copy: Record<Column, { title: string; hint: string }> = {
  needs_you: { title: '等你', hint: '流程中间要你拍板' },
  running: { title: '进行中', hint: '不用管' },
  to_review: { title: '待验收', hint: '点一下就结束' },
};

export function BoardColumn({
  column,
  tasks,
  pendingGateId,
  onDecide,
}: {
  column: Column;
  tasks: TaskView[];
  pendingGateId?: string | null;
  onDecide?: (task: TaskView, decision: 'approve' | 'reject', comment?: string) => void;
}) {
  const sorted = sortInColumn(tasks);
  const meta = copy[column];
  return (
    <section className="bg-muted flex min-h-48 flex-col rounded-lg p-2" aria-label={meta.title}>
      <header className="flex items-center gap-2 px-1.5 pb-2.5 pt-0.5 font-semibold">
        <span className="border-foreground size-3 rounded-full border" aria-hidden />
        {meta.title}
        <span className="text-muted-foreground font-normal">{sorted.length}</span>
        <span className="text-muted-foreground ml-auto text-[11px] font-normal">{meta.hint}</span>
      </header>
      {sorted.length === 0 ? <p className="text-muted-foreground px-1.5 text-xs">这一列还没有任务</p> : null}
      {sorted.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          pending={pendingGateId === task.pendingGate?.id}
          onDecide={(decision, comment) => onDecide?.(task, decision, comment)}
        />
      ))}
      {column === 'to_review' ? (
        <p className="text-muted-foreground mt-3 text-center text-[11.5px]">验收后任务完成，离开看板</p>
      ) : null}
    </section>
  );
}
