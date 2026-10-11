import { STAGE_DONE_PIN, type TaskView } from '@mufu/core/view';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';

import { addNote, DaemonError, getTask, readPins, resolveGate, taskKeys } from '@/api/tasks';
import { agentIdentity, agentLabel } from '@/common/agent';
import { shownAuthor } from '@/common/author';
import { cn } from '@/common/utils';
import { ArtifactPanel } from '@/modules/task/components/artifact-panel';
import { GateCard } from '@/modules/task/components/gate-card';
import { MembersButton } from '@/modules/task/components/members';
import { PinStrip } from '@/modules/task/components/pin-strip';

export function Component() {
  const { taskId = '' } = useParams();
  const queryClient = useQueryClient();
  const task = useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => getTask(taskId),
    enabled: taskId.length > 0,
  });
  const [panel, setPanel] = useState(true);
  const [draft, setDraft] = useState('');
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: taskKeys.list });
    await queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
  };
  const gate = useMutation({
    mutationFn: (input: { decision: 'approve' | 'reject'; comment?: string }) => {
      const gateId = task.data?.pendingGate?.id;
      if (!gateId) throw new DaemonError('没有待处理的门禁');
      return resolveGate(gateId, input.decision, input.comment);
    },
    onSuccess: () => invalidate(),
  });
  const pins = useMutation({
    mutationFn: () => readPins(taskId),
    onSuccess: () => invalidate(),
  });
  const note = useMutation({
    mutationFn: (text: string) => addNote(taskId, text),
    onSuccess: async () => {
      setDraft('');
      await invalidate();
    },
  });
  const current = task.data;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {task.isPending ? <p className="text-muted-foreground p-8 text-sm">正在读取任务</p> : null}
        {task.isError ? (
          <p className="m-6 flex items-center gap-2 text-sm">
            <span className="bg-primary text-primary-foreground inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold">
              !
            </span>
            {task.error instanceof DaemonError ? task.error.message : '任务没有读出来'}
          </p>
        ) : null}
        {task.data === null ? (
          <p className="text-muted-foreground p-8 text-sm">没有这个任务，或者它已经离开看板。</p>
        ) : null}
        {current ? (
          <>
            <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4 md:px-7">
              <h1 className="font-semibold">{current.title}</h1>
              <span className="text-muted-foreground text-xs">
                {current.workflow.title}
                {agentTitle(current.agentKind)}
                {current.status === 'to_review' && current.ci ? ` · ${ciText(current.ci.state)}` : ''}
              </span>
              {current.attention ? (
                <span
                  className="bg-primary text-primary-foreground inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold"
                  title={current.attention.message}
                >
                  !
                </span>
              ) : null}
              <ol className="text-muted-foreground ml-auto hidden items-center gap-2 text-xs md:flex">
                {current.workflow.stages.map((stage, index) => {
                  const currentIndex = current.workflow.stages.findIndex((item) => item.id === current.stageId);
                  const done = index < currentIndex || current.status === 'done';
                  const now = index === currentIndex && current.status !== 'done';
                  return (
                    <li key={stage.id} className="flex items-center gap-2">
                      {index > 0 ? <span className="bg-border h-px w-4" /> : null}
                      <span className={cn(now && 'text-foreground font-semibold', done && 'text-foreground')}>
                        <span
                          className={cn(
                            'mr-1 inline-flex size-3.5 items-center justify-center rounded-full border text-[9px]',
                            done && 'border-primary bg-primary text-primary-foreground',
                            now && 'border-foreground',
                          )}
                          aria-hidden
                        >
                          {done ? '✓' : '○'}
                        </span>
                        {stage.title}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <MembersButton task={current} />
            </header>
            <PinStrip
              pins={current.pins}
              onReadAll={() => pins.mutate()}
              onOpen={(pin) => {
                const target = pin.messageId ? `msg-${pin.messageId}` : '';
                document.getElementById(target)?.scrollIntoView({ block: 'center' });
              }}
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-14">
              {current.messages.map((message) => (
                <Message key={message.id} message={message} pins={current.pins} stages={current.workflow.stages} />
              ))}
            </div>
            <div className="shrink-0">
              {current.pendingGate ? (
                <GateCard
                  gate={current.pendingGate}
                  pending={gate.isPending}
                  onDecide={(decision, comment) => gate.mutate({ decision, comment })}
                />
              ) : null}
              {gate.isError ? (
                <p className="mx-4 mb-2 text-xs md:mx-14">
                  {gate.error instanceof Error ? gate.error.message : '门禁没有送出'}
                </p>
              ) : null}
              <form
                className="relative mx-4 mb-5 rounded-2xl border px-4 pb-11 pt-3.5 md:mx-14"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = draft.trim();
                  if (!text) return;
                  note.mutate(text);
                }}
              >
                <label className="sr-only" htmlFor="note">
                  补充说明
                </label>
                <input
                  id="note"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="补充一句"
                  className="w-full bg-transparent text-sm focus-visible:outline-none"
                />
                <button
                  type="submit"
                  className="bg-accent text-muted-foreground focus-visible:ring-ring absolute bottom-2.5 right-3 inline-flex size-7 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2"
                  aria-label="发送"
                  disabled={note.isPending || current.status === 'done'}
                >
                  ↑
                </button>
                {note.isError ? (
                  <p className="text-muted-foreground absolute bottom-3 left-4 text-xs">
                    {note.error instanceof Error ? note.error.message : '没送出去'}
                  </p>
                ) : null}
              </form>
            </div>
          </>
        ) : null}
      </section>
      {current ? (
        <ArtifactPanel artifacts={current.artifacts} open={panel} onToggle={() => setPanel((value) => !value)} />
      ) : null}
    </div>
  );
}

function agentTitle(kind: string | null): string {
  if (kind === 'codex' || kind === 'claude') return ` · ${agentIdentity(kind).displayName}`;
  return '';
}

function authorLabel(author: string): string {
  return agentLabel(author) ?? shownAuthor(author);
}

function pinCaption(pin: TaskView['pins'][number], stages: TaskView['workflow']['stages']): string {
  const title = stages.find((stage) => stage.id === pin.stageId)?.title ?? pin.stageId;
  return `📌 ${STAGE_DONE_PIN}：${title}`;
}

function ciText(state: 'pending' | 'passed' | 'failed'): string {
  if (state === 'passed') return 'CI 通过';
  if (state === 'failed') return 'CI 失败';
  return 'CI 还在跑';
}

function Message({
  message,
  pins,
  stages,
}: {
  message: TaskView['messages'][number];
  pins: TaskView['pins'];
  stages: TaskView['workflow']['stages'];
}) {
  const pin = pins.find((item) => item.messageId === message.id);
  const caption = pin ? pinCaption(pin, stages) : null;
  if (message.role === 'system') {
    return (
      <p id={`msg-${message.id}`} className="text-muted-foreground mb-4 text-xs">
        {message.text}
        {caption ? <em className="ml-2 font-normal">{caption}</em> : null}
      </p>
    );
  }
  if (message.role === 'user') {
    return (
      <div id={`msg-${message.id}`} className="mb-5 flex justify-end">
        <p className="bg-secondary max-w-lg rounded-xl px-3.5 py-2.5">{message.text}</p>
      </div>
    );
  }
  return (
    <div id={`msg-${message.id}`} className={cn('mb-5 max-w-xl', pin && 'border-border border-l-2 pl-3')}>
      <p className="text-muted-foreground mb-1 text-xs">
        {authorLabel(message.author)}
        {caption ? <em className="ml-2 font-normal">{caption}</em> : null}
      </p>
      <p className="leading-7">{message.text}</p>
    </div>
  );
}
