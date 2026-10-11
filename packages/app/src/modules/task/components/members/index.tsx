import type { TaskView } from '@mufu/core/view';
import { useState } from 'react';

import { Button } from '@/common/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/common/components/ui/dialog';

function agentName(agent: string | undefined): string {
  if (agent === 'claude') return 'Claude';
  if (agent === 'codex') return 'Codex';
  return '未定';
}

export function MembersButton({ task }: { task: TaskView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        成员与能力
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>成员与能力</DialogTitle>
            <DialogDescription>每个阶段用流程里选定的 Codex 或 Claude。这里只看分配，不改模板。</DialogDescription>
          </DialogHeader>
          <ul>
            {task.workflow.stages.map((stage) => (
              <li key={stage.id} className="flex items-baseline gap-3 border-b py-2 text-sm">
                <span className="font-medium">{stage.title}</span>
                <span className="text-muted-foreground">{agentName(stage.agent)}</span>
                {stage.gate === 'final' ? (
                  <span className="text-muted-foreground ml-auto text-xs">最终门禁</span>
                ) : null}
                {stage.gate === 'stage' ? (
                  <span className="text-muted-foreground ml-auto text-xs">阶段门禁</span>
                ) : null}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
