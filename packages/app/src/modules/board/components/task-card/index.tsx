import type { TaskView } from '@mufu/core/view';
import { Link } from 'react-router';

import { cn } from '@/common/utils';

function stageTitle(task: TaskView): string {
  return task.workflow.stages.find((stage) => stage.id === task.stageId)?.title ?? task.stageId;
}

function summary(task: TaskView): string {
  if (task.attention) return task.attention.message;
  const last = [...task.messages].reverse().find((message) => message.role !== 'user');
  return last?.text ?? task.prompt;
}

function statusText(task: TaskView): string {
  if (task.status === 'queued') return '排队';
  if (task.attention) return '出问题了';
  if (task.status === 'to_review') return '等你验收';
  if (task.pendingGate) return '等你决定';
  return '正在跑';
}

function actionLabel(task: TaskView): string | null {
  if (task.attention?.source === 'auth' || task.attention?.message.includes('登录')) return '重新登录';
  if (task.status === 'to_review') return '验收';
  if (task.pendingGate) return '去看看';
  return null;
}

export function TaskCard({ task }: { task: TaskView }) {
  const queued = task.status === 'queued';
  const stageIndex = Math.max(
    0,
    task.workflow.stages.findIndex((stage) => stage.id === task.stageId),
  );
  const label = actionLabel(task);
  return (
    <article
      className={cn(
        'mb-2 rounded-lg border bg-card px-3 py-2.5 shadow-sm',
        queued && 'border-dashed bg-muted text-muted-foreground',
        task.attention && 'border-foreground',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <span>#{task.seq}</span>
        <span className="rounded bg-secondary px-1.5 text-[10.5px] text-muted-foreground">
          {task.workflow.title} · {stageTitle(task)}
        </span>
        <span className="ml-1 tracking-widest" aria-hidden>
          {task.workflow.stages.map((stage, index) => (
            <span key={stage.id} className={index <= stageIndex && !queued ? 'text-foreground' : 'text-border'}>
              ●
            </span>
          ))}
        </span>
      </div>
      <h3 className="mt-1.5 flex items-center gap-1.5 text-[13.5px] font-semibold">
        {task.attention ? (
          <span
            className="inline-flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
            aria-label="出问题了"
          >
            !
          </span>
        ) : null}
        <Link to={`/task/${task.id}`} className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {task.title}
        </Link>
      </h3>
      <p className="truncate text-xs text-muted-foreground">{summary(task)}</p>
      <div className="mt-2.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <span
          className={cn(
            'inline-flex size-5 items-center justify-center rounded-full text-[9px] text-primary-foreground',
            queued ? 'bg-border' : 'bg-primary',
          )}
        >
          {task.agentKind === 'claude' ? 'C' : task.agentKind === 'codex' ? 'x' : '代'}
        </span>
        <span className="ml-auto">{statusText(task)}</span>
        {label ? (
          <Link
            to={`/task/${task.id}`}
            className={cn(
              'rounded-md border px-2 py-0.5 text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              task.status === 'to_review' && 'border-primary bg-primary text-primary-foreground',
            )}
          >
            {label}
          </Link>
        ) : null}
      </div>
    </article>
  );
}
