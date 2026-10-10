/** 只有守护进程在人点了合并之后才能调用。代理拿不到这个接口。 */
export interface GitHub {
  mergePullRequest(input: { repoPath: string; pr: number }): Promise<void>;
}

export class MergeUnavailable implements GitHub {
  async mergePullRequest(_input: { repoPath: string; pr: number }): Promise<void> {
    throw new Error('这个原型还不会合并。最终门禁通过即完成任务，不会调用 gh。');
  }
}
