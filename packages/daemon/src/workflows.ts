import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { Workflow } from '@mufu/core';
import { workflowSchema } from '@mufu/schema';

export type ListedWorkflow = {
  id: string;
  name: string;
  title: string;
  default: boolean;
  match: string[];
  doneWhen: Workflow['doneWhen'];
  stages: Workflow['stages'];
};

export type WorkflowCatalog = {
  byId: Map<string, Workflow>;
  defaultWorkflowId: string;
  list: ListedWorkflow[];
};

/** 扫描目录里全部 yaml。默认流程只认文件里的 default，否则用文件名排序后的第一个。 */
export function loadWorkflows(dir: string): WorkflowCatalog {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort();
  if (names.length === 0) throw new Error(`流程目录是空的：${dir}`);
  const parsed = names.map((name) => {
    const file = workflowSchema.parse(parseYaml(readFileSync(join(dir, name), 'utf8')));
    return { name, file };
  });
  const flagged = parsed.filter((item) => item.file.default === true);
  if (flagged.length > 1) {
    throw new Error(`只能有一个默认流程：${flagged.map((item) => item.file.id).join('、')}`);
  }
  const defaultWorkflowId = flagged[0]?.file.id ?? parsed[0]?.file.id;
  if (!defaultWorkflowId) throw new Error(`流程目录是空的：${dir}`);
  const byId = new Map<string, Workflow>();
  const list: ListedWorkflow[] = [];
  for (const { file } of parsed) {
    const workflow: Workflow = {
      id: file.id,
      title: file.title,
      doneWhen: file.done_when,
      stages: file.stages.map((stage) => ({
        id: stage.id,
        title: stage.title,
        gate: stage.gate,
        rejectTo: stage.reject_to,
        agent: stage.agent,
      })),
    };
    if (byId.has(workflow.id)) throw new Error(`流程 id 重复：${workflow.id}`);
    byId.set(workflow.id, workflow);
    list.push({
      id: workflow.id,
      name: workflow.title,
      title: workflow.title,
      default: workflow.id === defaultWorkflowId,
      match: file.match ?? [],
      doneWhen: workflow.doneWhen,
      stages: workflow.stages,
    });
  }
  return { byId, defaultWorkflowId, list };
}
