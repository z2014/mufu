import { describe, expect, it } from 'vitest';

import { chooseWorkflow } from './choose.ts';

const templates = [
  { id: 'fix-bug', title: '修 bug', match: ['bug', '报错', '崩', '修'], default: false },
  { id: 'new-feature', title: '新功能', match: [], default: true },
];

describe('chooseWorkflow', () => {
  it('按模板关键词选用，并说明命中的词', () => {
    expect(chooseWorkflow('列表崩了', templates)).toEqual({
      workflowId: 'fix-bug',
      reason: '需求里有「崩」',
    });
    expect(chooseWorkflow('接口报错', templates).workflowId).toBe('fix-bug');
    expect(chooseWorkflow('please fix this bug', templates)).toEqual({
      workflowId: 'fix-bug',
      reason: '需求里有「bug」',
    });
    expect(chooseWorkflow('把空值修一下', templates).reason).toBe('需求里有「修」');
  });

  it('没有关键词时用 default', () => {
    expect(chooseWorkflow('做一个筛选', templates)).toEqual({
      workflowId: 'new-feature',
      reason: '没有对上关键词',
    });
  });
});
