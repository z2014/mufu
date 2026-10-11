export type AgentKindName = 'codex' | 'claude';

/** Codex 和 Claude 都是 C 开头，缩写用 Cx / Cl 区分。 */
export function agentIdentity(kind: AgentKindName): { displayName: 'Codex' | 'Claude'; initials: 'Cx' | 'Cl' } {
  if (kind === 'claude') return { displayName: 'Claude', initials: 'Cl' };
  return { displayName: 'Codex', initials: 'Cx' };
}
