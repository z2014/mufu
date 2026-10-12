import type { ChooseWorkflow, WorkflowChoice, WorkflowTemplate } from '@mufu/core';

function hit(requirement: string, template: WorkflowTemplate): string | null {
  const text = requirement.toLowerCase();
  for (const keyword of template.match) {
    const word = keyword.trim();
    if (word.length === 0) continue;
    if (text.includes(word.toLowerCase())) return word;
  }
  return null;
}

/** 阶段 1：模板 yaml 的 `match` 命中就用它，否则用 `default: true`。 */
export const chooseWorkflow: ChooseWorkflow = (requirement, templates): WorkflowChoice => {
  for (const template of templates) {
    const keyword = hit(requirement, template);
    if (keyword) return { workflowId: template.id, reason: `需求里有「${keyword}」` };
  }
  const fallback = templates.find((template) => template.default) ?? templates[0];
  if (!fallback) throw new Error('没有可用的流程');
  return { workflowId: fallback.id, reason: '没有对上关键词' };
};
