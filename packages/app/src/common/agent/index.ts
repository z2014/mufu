export type AgentKindName = 'codex' | 'claude';

/** Codex 和 Claude 都是 C 开头，缩写用 Cx / Cl 区分。 */
export function agentIdentity(kind: AgentKindName): { displayName: 'Codex' | 'Claude'; initials: 'Cx' | 'Cl' } {
  if (kind === 'claude') return { displayName: 'Claude', initials: 'Cl' };
  return { displayName: 'Codex', initials: 'Cx' };
}

/** 事件里只存小写种类。大写名字不在这里认，界面一律走 agentIdentity。 */
export function agentLabel(author: string): 'Codex' | 'Claude' | null {
  if (author === 'codex' || author === 'claude') return agentIdentity(author).displayName;
  return null;
}
