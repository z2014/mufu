export type Decision = 'approve' | 'reject';

export class GateBroker {
  private readonly pending = new Map<string, { decision?: Decision; waiters: Array<(decision: Decision) => void> }>();

  open(id: string): void {
    this.pending.set(id, { waiters: [] });
  }

  wait(id: string): Promise<Decision> {
    const entry = this.pending.get(id);
    if (!entry) return Promise.reject(new Error(`门禁 ${id} 不存在`));
    if (entry.decision) return Promise.resolve(entry.decision);
    return new Promise((resolve) => entry.waiters.push(resolve));
  }

  resolve(id: string, decision: Decision): void {
    const entry = this.pending.get(id);
    if (!entry || entry.decision) throw new Error('这个门禁不在等待');
    entry.decision = decision;
    for (const waiter of entry.waiters) waiter(decision);
  }

  cancelAll(): void {
    for (const entry of this.pending.values()) {
      if (entry.decision) continue;
      entry.decision = 'reject';
      for (const waiter of entry.waiters) waiter('reject');
    }
  }
}
