import { AgentStartupError, type AgentStartupKind } from '@mufu/core';

export function coarseFailure(kind: AgentStartupKind): 'rate_limit' | 'auth' | 'network' {
  if (kind === 'rate_limit') return 'rate_limit';
  if (kind === 'network') return 'network';
  return 'auth';
}

/** 把进程或 SDK 抛出的原文收成一种启动失败。原文留在 raw。 */
export function classifyLaunchError(tool: 'codex' | 'claude', error: unknown): AgentStartupError {
  if (error instanceof AgentStartupError) return error;
  const raw = error instanceof Error ? error.message : String(error);
  return new AgentStartupError(kindFromLaunchText(raw), tool, raw);
}

export function kindFromLaunchText(raw: string): AgentStartupKind {
  const sample = raw.toLowerCase();
  if (
    sample.includes('native cli binary') ||
    sample.includes('executable not found') ||
    sample.includes('enoent') ||
    /claude-agent-sdk-(?:darwin|linux|win32|android)-/.test(sample)
  ) {
    return 'cli_not_found';
  }
  if (sample.includes('not logged') || sample.includes('unauthorized') || sample.includes('/login')) {
    return 'not_logged_in';
  }
  if (sample.includes('rate limit') || sample.includes('usage limit') || sample.includes('429')) {
    return 'rate_limit';
  }
  if (
    sample.includes('econnreset') ||
    sample.includes('econnrefused') ||
    sample.includes('etimedout') ||
    sample.includes('network') ||
    sample.includes('timeout') ||
    sample.includes('fetch failed')
  ) {
    return 'network';
  }
  return 'launch_failed';
}
