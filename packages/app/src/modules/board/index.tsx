import { columnOf, type Column, type TaskView } from '@mufu/core/view';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';

import { DaemonError, resolveGate, taskKeys } from '@/api/tasks';
import { DiffDialog } from '@/common/components/diff-dialog';
import { Button } from '@/common/components/ui/button';
import type { WorkbenchContext } from '@/common/workbench';
import { BoardColumn } from '@/modules/board/components/column';
import { MergeConfirm } from '@/modules/board/components/merge-confirm';

const columns: Column[] = ['needs_you', 'running', 'to_review'];

function group(tasks: TaskView[]): Record<Column, TaskView[]> {
  return {
    needs_you: tasks.filter((task) => columnOf(task) === 'needs_you'),
    running: tasks.filter((task) => columnOf(task) === 'running'),
    to_review: tasks.filter((task) => columnOf(task) === 'to_review'),
  };
}

export function Component() {
  const { tasks, tasksPending, tasksError, openNewTask } = useOutletContext<WorkbenchContext>();
  const queryClient = useQueryClient();
  const gate = useMutation({
    mutationFn: (input: { gateId: string; decision: 'approve' | 'reject'; comment?: string }) =>
      resolveGate(input.gateId, input.decision, input.comment),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.list });
    },
  });
  const [diffTask, setDiffTask] = useState<TaskView | null>(null);
  const [confirmTask, setConfirmTask] = useState<TaskView | null>(null);
  const grouped = tasks ? group(tasks) : null;
  const waiting = (grouped?.needs_you.length ?? 0) + (grouped?.to_review.length ?? 0);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="text-muted-foreground flex h-12 items-center gap-3 border-b px-4">
        <span className="text-foreground">
          等你 {grouped?.needs_you.length ?? 0} · 待验收 {grouped?.to_review.length ?? 0}
        </span>
        <Button className="ml-auto" size="sm" onClick={openNewTask}>
          ＋ 新任务
        </Button>
      </header>
      {tasksPending ? <p className="text-muted-foreground p-6 text-sm">正在读取任务</p> : null}
      {tasksError ? (
        <p className="border-foreground m-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className="bg-primary text-primary-foreground inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold">
            !
          </span>
          {tasksError instanceof DaemonError ? tasksError.message : '任务列表没有读出来'}
        </p>
      ) : null}
      {grouped && tasks?.length === 0 ? (
        <p className="text-muted-foreground px-4 pt-4 text-sm">看板上还没有任务。建一个，它会从「进行中」开始。</p>
      ) : null}
      {grouped ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-auto p-3 md:grid-cols-3 md:p-4">
          {columns.map((column) => (
            <BoardColumn
              key={column}
              column={column}
              tasks={grouped[column]}
              pendingGateId={gate.isPending ? gate.variables?.gateId : null}
              onShowDiff={setDiffTask}
              onAskMerge={setConfirmTask}
              onDecide={(task, decision, comment) => {
                const gateId = task.pendingGate?.id;
                if (!gateId) return;
                gate.mutate({ gateId, decision, comment });
              }}
            />
          ))}
        </div>
      ) : null}
      <span className="sr-only">{waiting}</span>
      <DiffDialog
        diff={diffTask?.diff ?? null}
        open={diffTask !== null}
        onOpenChange={(open) => !open && setDiffTask(null)}
      />
      {confirmTask?.diff ? (
        <MergeConfirm
          diff={confirmTask.diff}
          fallbackPr={confirmTask.ci?.pr ?? null}
          open
          pending={gate.isPending}
          onOpenChange={(open) => {
            if (!open) setConfirmTask(null);
          }}
          onConfirm={() => {
            const gateId = confirmTask.pendingGate?.id;
            if (!gateId) return;
            gate.mutate({ gateId, decision: 'approve' }, { onSuccess: () => setConfirmTask(null) });
          }}
        />
      ) : null}
    </div>
  );
}
