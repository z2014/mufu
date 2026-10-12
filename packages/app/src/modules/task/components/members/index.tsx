import type { TaskView } from '@mufu/core/view';
import { useState } from 'react';

import { agentIdentity } from '@/common/agent';
import { Button } from '@/common/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/common/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/common/components/ui/select';

export function MembersButton({
  task,
  onAgent,
}: {
  task: TaskView;
  onAgent: (stageId: string, agent: 'codex' | 'claude') => void;
}) {
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
            <DialogDescription>每个阶段一开始用流程模板里的代理。在这里改的是这个任务。</DialogDescription>
          </DialogHeader>
          <ul>
            {task.workflow.stages.map((stage) => (
              <li key={stage.id} className="flex items-center justify-between gap-3 border-b py-2 text-sm">
                <span className="font-medium">{stage.title}</span>
                <Select
                  value={stage.agent === 'claude' ? 'claude' : 'codex'}
                  onValueChange={(value) => onAgent(stage.id, value === 'claude' ? 'claude' : 'codex')}
                >
                  <SelectTrigger className="w-32" aria-label={`${stage.title}用谁`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="codex">{agentIdentity('codex').displayName}</SelectItem>
                    <SelectItem value="claude">{agentIdentity('claude').displayName}</SelectItem>
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
