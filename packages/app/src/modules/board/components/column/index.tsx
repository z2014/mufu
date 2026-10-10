import { sortInColumn, type Column, type TaskView } from '@mufu/core/view';

import { TaskCard } from '@/modules/board/components/task-card';

const copy: Record<Column, { title: string; hint: string }> = {
  needs_you: { title: '等你', hint: '流程中间要你拍板' },
  running: { title: '进行中', hint: '不用管' },
  to_review: { title: '待验收', hint: '点一下就结束' },
};

export function BoardColumn({ column, tasks }: { column: Column; tasks: TaskView[] }) {
  const sorted = sortInColumn(tasks);
  const queued = column === 'running' ? sorted.filter((task) => task.status === 'queued') : [];
  const active = column === 'running' ? sorted.filter((task) => task.status !== 'queued') : sorted;
  const meta = copy[column];
  return (
    <section className="flex min-h-48 flex-col rounded-lg bg-muted p-2" aria-label={meta.title}>
      <header className="flex items-center gap-2 px-1.5 pt-0.5 pb-2.5 font-semibold">
        <span className="size-3 rounded-full border border-foreground" aria-hidden />
        {meta.title}
        <span className="font-normal text-muted-foreground">{sorted.length}</span>
        <span className="ml-auto text-[11px] font-normal text-muted-foreground">{meta.hint}</span>
      </header>
      {sorted.length === 0 ? <p className="px-1.5 text-xs text-muted-foreground">这一列还没有任务</p> : null}
      {active.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
      {queued.length > 0 ? <p className="px-1.5 py-1.5 text-[11px] text-muted-foreground">等待开始</p> : null}
      {queued.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
      {column === 'to_review' ? (
        <p className="mt-3 text-center text-[11.5px] text-muted-foreground">验收后任务完成，离开看板</p>
      ) : null}
    </section>
  );
}
