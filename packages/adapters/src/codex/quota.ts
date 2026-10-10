/**
 * Codex 用量窗口不按 primary/secondary 的位置猜。
 * 604800 秒或 10080 分钟是 7 天；约 5 小时是会话窗口。
 * tutti-os 把每周额度放在 primary 时曾标成 5 小时。
 */
export function classifyCodexQuotaWindow(input: {
  seconds?: number;
  minutes?: number;
}): 'session' | 'weekly' | 'unknown' {
  const seconds = input.seconds ?? (input.minutes !== undefined ? input.minutes * 60 : undefined);
  if (seconds === undefined || Number.isNaN(seconds)) return 'unknown';
  if (seconds >= 6 * 24 * 3600) return 'weekly';
  if (seconds > 0 && seconds <= 6 * 3600) return 'session';
  return 'unknown';
}
