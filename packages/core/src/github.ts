export type CiState = 'pending' | 'passed' | 'failed';

export type Mergeability = 'clean' | 'conflict' | 'unknown';

export type PullInspect = {
  pr: number | null;
  ci: CiState;
  mergeable: Mergeability;
  additions: number | null;
  deletions: number | null;
};

export type MergeFailureReason = 'conflict' | 'ci_failed' | 'environment';

/** 界面只按类别显示这三句，不解析命令输出。 */
export function mergeFailureCopy(reason: MergeFailureReason): string {
  if (reason === 'conflict') return '合并撞上了冲突。在工作目录里解决后，再点一次验收并合并。';
  if (reason === 'ci_failed') return 'CI 没通过。修好检查后，再点一次验收并合并。';
  return '这次没合并成，本机环境有问题。确认 gh 已经登录后再试。这次不计入失败次数。';
}

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
  inspect(repoPath: string): Promise<PullInspect>;
  merge(input: { repoPath: string; pr: number }): Promise<void>;
}
