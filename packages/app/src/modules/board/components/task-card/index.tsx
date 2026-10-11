import { mergeFailureCopy, type MergeFailureReason, type TaskView } from '@mufu/core/view';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { agentIdentity, type AgentKindName } from '@/common/agent';
import { cn } from '@/common/utils';

function stageAgent(task: TaskView): AgentKindName | null {
  const stage = task.workflow.stages.find((item) => item.id === task.stageId);
  if (stage?.agent === 'codex' || stage?.agent === 'claude') return stage.agent;
  return null;
}

function stageTitle(task: TaskView): string {
  return task.workflow.stages.find((stage) => stage.id === task.stageId)?.title ?? task.stageId;
}

function isMergeReason(source: string | undefined): source is MergeFailureReason {
  return source === 'conflict' || source === 'ci_failed' || source === 'environment';
}

function ciWords(state: 'pending' | 'passed' | 'failed'): string {
  if (state === 'passed') return 'CI 通过';
  if (state === 'failed') return 'CI 失败';
  return 'CI 还在跑';
}

function mergeWords(mergeable: 'clean' | 'conflict' | 'unknown'): string {
  if (mergeable === 'clean') return '无冲突';
  if (mergeable === 'conflict') return '有冲突';
  return '冲突未知';
}

function reviewLine(task: TaskView): string | null {
  if (task.status !== 'to_review' || !task.ci) return null;
  const { ci } = task;
  const stats = ci.additions === null || ci.deletions === null ? '' : ` · +${ci.additions} −${ci.deletions}`;
  return `PR #${ci.pr} · ${ciWords(ci.state)} · ${mergeWords(ci.mergeable)}${stats}`;
}

function summary(task: TaskView): string {
  if (task.attention && isMergeReason(task.attention.source)) return mergeFailureCopy(task.attention.source);
  if (task.attention) return task.attention.message;
  const review = reviewLine(task);
  if (review) return review;
  const last = [...task.messages].reverse().find((message) => message.role !== 'user');
  return last?.text ?? task.prompt;
}

function elapsedText(startedAt: string, now: number): string {
  const ms = now - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 60_000) return '不到 1 分钟';
  return `${Math.floor(ms / 60_000)} 分钟`;
}

function statusText(task: TaskView, now: number): string {
  if (task.attention) return '出问题了';
  if (task.status === 'to_review') return '可以合并';
  if (task.pendingGate) return '等你决定';
  if (task.status === 'running' && task.runStartedAt) return `正在跑 · ${elapsedText(task.runStartedAt, now)}`;
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
  const stageIndex = Math.max(
    0,
    task.workflow.stages.findIndex((stage) => stage.id === task.stageId),
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (task.status !== 'running') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [task.status]);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [hint, setHint] = useState('');
  const review = task.status === 'to_review' && task.pendingGate;
  const kind = stageAgent(task);
  const identity = kind ? agentIdentity(kind) : null;
  return (
    <article
      className={cn('bg-card mb-2 rounded-lg border px-3 py-2.5 shadow-sm', task.attention && 'border-foreground')}
    >
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11.5px]">
        <span>#{task.seq}</span>
        <span className="bg-secondary text-muted-foreground rounded px-1.5 text-[10.5px]">
          {task.workflow.title} · {stageTitle(task)}
        </span>
        <span className="ml-1 tracking-widest" aria-hidden>
          {task.workflow.stages.map((stage, index) => (
            <span key={stage.id} className={index <= stageIndex ? 'text-foreground' : 'text-border'}>
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
          className="focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-1"
        >
          {task.title}
        </Link>
      </h3>
      <p className="text-muted-foreground truncate text-xs">{summary(task)}</p>
      <div className="text-muted-foreground mt-2.5 flex flex-wrap items-center gap-2 text-[11.5px]">
        {identity ? (
          <span
            title={identity.displayName}
            className="bg-primary text-primary-foreground inline-flex h-5 items-center justify-center rounded-full px-1 text-[9px]"
          >
            {identity.initials}
          </span>
        ) : null}
        <span className="ml-auto">{statusText(task, now)}</span>
        {task.attention ? (
          <Link to={`/task/${task.id}`} className="text-foreground rounded-md border px-2 py-0.5">
            {task.attention.source === 'auth' ? '重新登录' : '去看看'}
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
            className="border-input focus-visible:ring-ring min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 focus-visible:outline-none focus-visible:ring-1"
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
