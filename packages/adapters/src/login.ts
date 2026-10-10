/** 设置页要的结论。source 是原因，不是密钥。 */
export type LoginVerdict = {
  loggedIn: boolean;
  subscription: boolean;
  source: string;
};
