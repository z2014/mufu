/**
 * OpenRouter 的账户名。阶段 1 只存这把钥匙，适配器还不读它。
 * 服务名用 KEYCHAIN_SERVICE（产品名），不写在这里。
 */
export const OPENROUTER_ACCOUNT = 'openrouter';

/**
 * 存一把钥匙。has 只回答有没有，不把值交出来。
 * 实现不得把值写进日志、错误信息或返回值。
 */
export interface SecretStore {
  has(account: string): Promise<boolean>;
  set(account: string, value: string): Promise<void>;
  remove(account: string): Promise<void>;
}
