import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class TestSocket extends EventTarget {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- WebSocket 的标准常量名。
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  send = vi.fn<(data: string) => void>();

  constructor(readonly url: string) {
    super();
    TestSocket.instances.push(this);
  }

  open() {
    this.readyState = TestSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }

  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', TestSocket);
  TestSocket.instances = [];
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('守护进程连接恢复', () => {
  it('窗口先启动时等待服务，并发请求共用连接，旧连接关闭不影响新请求', async () => {
    const { rpc } = await import('./index');
    const health = rpc('health');
    const tasks = rpc('task.list');
    const first = TestSocket.instances[0]!;
    expect(TestSocket.instances).toHaveLength(1);
    first.dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(500);
    const second = TestSocket.instances[1]!;
    second.open();
    await vi.advanceTimersByTimeAsync(0);
    first.close();
    expect(second.send).toHaveBeenCalledTimes(2);
    for (const [data] of second.send.mock.calls) {
      const request = JSON.parse(data) as { id: number; method: string };
      second.receive({ id: request.id, result: request.method === 'health' ? { ok: true } : [] });
    }
    await expect(health).resolves.toEqual({ ok: true });
    await expect(tasks).resolves.toEqual([]);
  });

  it('断线后自动恢复推送，已发送的创建任务不会被重发', async () => {
    const { onDaemonPush, rpc } = await import('./index');
    const listener = vi.fn();
    const stop = onDaemonPush(listener);
    const first = TestSocket.instances[0]!;
    first.open();
    await vi.advanceTimersByTimeAsync(0);
    const create = rpc('task.create', { title: 'test' });
    const rejected = expect(create).rejects.toThrow('连接断了');
    await vi.advanceTimersByTimeAsync(0);
    first.close();
    await rejected;
    await vi.advanceTimersByTimeAsync(1000);
    const second = TestSocket.instances[1]!;
    second.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(listener.mock.calls).toEqual([
      ['connected', undefined],
      ['connected', undefined],
    ]);
    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.send).not.toHaveBeenCalled();
    second.receive({ method: 'event', params: { taskId: 't' } });
    expect(listener).toHaveBeenLastCalledWith('event', { taskId: 't' });
    second.close();
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(TestSocket.instances).toHaveLength(2);
  });

  it('服务长时间不可用时显示连接错误，随后恢复仍会通知窗口刷新', async () => {
    const { onDaemonPush, rpc } = await import('./index');
    const listener = vi.fn();
    const stop = onDaemonPush(listener);
    const request = rpc('health');
    const rejected = expect(request).rejects.toThrow('正在重新连接');
    for (let attempt = 0; attempt < 30; attempt += 1) {
      TestSocket.instances[attempt]!.close();
      await vi.advanceTimersByTimeAsync(attempt === 29 ? 0 : 500);
    }
    await rejected;
    await vi.advanceTimersByTimeAsync(1000);
    TestSocket.instances[30]!.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledWith('connected', undefined);
    stop();
  });
});
