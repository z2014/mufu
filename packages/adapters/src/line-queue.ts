export class LineQueue implements AsyncIterable<string> {
  private lines: string[] = [];
  private waiters: Array<(result: IteratorResult<string>) => void> = [];
  private closed = false;

  push(line: string): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: line, done: false });
    else this.lines.push(line);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters) waiter({ value: undefined, done: true });
    this.waiters = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        const line = this.lines.shift();
        if (line !== undefined) return Promise.resolve({ value: line, done: false as const });
        if (this.closed) return Promise.resolve({ value: undefined, done: true as const });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

export class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters) waiter({ value: undefined, done: true });
    this.waiters = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false as const });
        if (this.closed) return Promise.resolve({ value: undefined, done: true as const });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
