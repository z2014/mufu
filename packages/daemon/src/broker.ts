export type Decision = 'approve' | 'reject';

export type GateResolution = {
  decision: Decision;
  comment?: string;
  /** 进程退出时解开等待，不是人打回。 */
  cancelled?: boolean;
};

export class GateBroker {
  private readonly pending = new Map<
    string,
    { resolution?: GateResolution; waiters: Array<(resolution: GateResolution) => void> }
  >();

  open(id: string): void {
    this.pending.set(id, { waiters: [] });
  }

  wait(id: string): Promise<GateResolution> {
    const entry = this.pending.get(id);
    if (!entry) return Promise.reject(new Error(`门禁 ${id} 不存在`));
    if (entry.resolution) return Promise.resolve(entry.resolution);
    return new Promise((resolve) => entry.waiters.push(resolve));
  }

  resolve(id: string, decision: Decision, comment?: string): void {
    const entry = this.pending.get(id);
    if (!entry || entry.resolution) throw new Error('这个门禁不在等待');
    const resolution: GateResolution = { decision, comment };
    entry.resolution = resolution;
    for (const waiter of entry.waiters) waiter(resolution);
  }

  cancelAll(): void {
    for (const entry of this.pending.values()) {
      if (entry.resolution) continue;
      const resolution: GateResolution = { decision: 'reject', cancelled: true };
      entry.resolution = resolution;
      for (const waiter of entry.waiters) waiter(resolution);
    }
  }
}
