import { scrubEnv } from '../env.ts';

export type ClaudeLaunchOptions = {
  cwd: string;
  permissionMode: 'default';
  permissionPrompts: 'host';
  settings: { forceLoginMethod: 'claudeai' };
  env: NodeJS.ProcessEnv;
  pathToClaudeCodeExecutable?: string;
  resume?: string;
  includePartialMessages: false;
  hooks: {
    PreToolUse: Array<{
      hooks: Array<
        () => Promise<{
          continue: true;
          hookSpecificOutput: { hookEventName: 'PreToolUse'; permissionDecision: 'ask' };
        }>
      >;
    }>;
  };
};

/**
 * 不设置 allowedTools。'*' 会让 canUseTool 不被调用。
 * permissionMode 用 default，不用 auto（分类器会静默放行）。
 * 普通恢复只设 resume，不设 forkSession。
 * 用户没自己指定时，把 CLAUDE_CODE_ENTRYPOINT 设为 cli，避免 sdk-ts 被提前限流。
 */
export function buildClaudeLaunchOptions(input: {
  cwd: string;
  bin?: string;
  env?: NodeJS.ProcessEnv;
  resumeSessionId?: string;
}): ClaudeLaunchOptions {
  const env = scrubEnv(input.env ?? process.env);
  if (!env.CLAUDE_CODE_ENTRYPOINT) env.CLAUDE_CODE_ENTRYPOINT = 'cli';
  return {
    cwd: input.cwd,
    permissionMode: 'default',
    permissionPrompts: 'host',
    settings: { forceLoginMethod: 'claudeai' },
    env,
    pathToClaudeCodeExecutable: input.bin,
    resume: input.resumeSessionId,
    includePartialMessages: false,
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async () => ({
              continue: true as const,
              hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'ask' as const },
            }),
          ],
        },
      ],
    },
  };
}
