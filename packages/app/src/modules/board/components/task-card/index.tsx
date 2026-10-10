import type { TaskView } from '@mufu/core/view';
import { useState } from 'react';
import { Link } from 'react-router';

import { cn } from '@/common/utils';

function agentMark(kind: string | null): string {
  if (kind === 'claude') return 'C';
  if (kind === 'codex') return 'x';
  return '代';
}

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
  if (task.status === 'to_review') return '可以合并';
  if (task.pendingGate) return '等你决定';
  return '正在跑';
}

export function TaskCard({
  task,
  pending,
  onDecide,
}: {
  task: TaskView;
  pending?: boolean;
  onDecide?: (decision: 'approve' | 'reject', comment?: string) => void;
}) {
  const queued = task.status === 'queued';
  const stageIndex = Math.max(
    0,
    task.workflow.stages.findIndex((stage) => stage.id === task.stageId),
  );
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [hint, setHint] = useState('');
  const review = task.status === 'to_review' && task.pendingGate;
  return (
    <article
      className={cn(
        'bg-card mb-2 rounded-lg border px-3 py-2.5 shadow-sm',
        queued && 'bg-muted text-muted-foreground border-dashed',
        task.attention && 'border-foreground',
      )}
    >
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11.5px]">
        <span>#{task.seq}</span>
        <span className="bg-secondary text-muted-foreground rounded px-1.5 text-[10.5px]">
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
            className="bg-primary text-primary-foreground inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold"
            aria-label="出问题了"
          >
            !
          </span>
        ) : null}
        <Link
          to={`/task/${task.id}`}
          className="focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2"
        >
          {task.title}
        </Link>
      </h3>
      <p className="text-muted-foreground truncate text-xs">{summary(task)}</p>
      <div className="text-muted-foreground mt-2.5 flex flex-wrap items-center gap-2 text-[11.5px]">
        <span
          className={cn(
            'text-primary-foreground inline-flex size-5 items-center justify-center rounded-full text-[9px]',
            queued ? 'bg-border' : 'bg-primary',
          )}
        >
          {agentMark(task.agentKind)}
        </span>
        <span className="ml-auto">{statusText(task)}</span>
        {task.attention ? (
          <Link to={`/task/${task.id}`} className="text-foreground rounded-md border px-2 py-0.5">
            {task.attention.source === 'auth' || task.attention.message.includes('登录') ? '重新登录' : '去看看'}
          </Link>
        ) : null}
        {review ? (
          <>
            <button
              type="button"
              className="text-foreground rounded-md border px-2 py-0.5"
              disabled={pending}
              onClick={() => setRejecting((value) => !value)}
            >
              打回
            </button>
            <button
              type="button"
              className="border-primary bg-primary text-primary-foreground rounded-md border px-2 py-0.5"
              disabled={pending}
              onClick={() => onDecide?.('approve')}
            >
              验收并合并
            </button>
          </>
        ) : null}
        {!review && task.pendingGate ? (
          <Link to={`/task/${task.id}`} className="text-foreground rounded-md border px-2 py-0.5">
            去看看
          </Link>
        ) : null}
      </div>
      {rejecting && review ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const text = comment.trim();
            if (!text) {
              setHint('打回要写一句原因');
              return;
            }
            setHint('');
            onDecide?.('reject', text);
          }}
        >
          <label className="sr-only" htmlFor={`reject-${task.id}`}>
            打回原因
          </label>
          <input
            id={`reject-${task.id}`}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="写一句原因"
            className="border-input focus-visible:ring-ring min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 focus-visible:outline-none focus-visible:ring-2"
          />
          <button type="submit" className="text-foreground rounded-md border px-2 py-0.5" disabled={pending}>
            送出
          </button>
        </form>
      ) : null}
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
    </article>
  );
}
