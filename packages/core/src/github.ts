export type CiState = 'pending' | 'passed' | 'failed';

export type MergeFailureReason = 'conflict' | 'ci_failed' | 'environment';

export class MergeFailure extends Error {
  readonly reason: MergeFailureReason;

  constructor(reason: MergeFailureReason, message: string) {
    super(message);
    this.name = 'MergeFailure';
    this.reason = reason;
  }
}

/** 只有守护进程在人点了验收并合并之后才能调用。代理拿不到这个接口。 */
export interface GitHub {
  inspect(repoPath: string): Promise<{ pr: number | null; ci: CiState }>;
  merge(input: { repoPath: string; pr: number }): Promise<void>;
}
