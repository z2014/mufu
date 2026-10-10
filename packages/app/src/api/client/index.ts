import { DAEMON_WS_PORT } from '@/runtime';

/**
 * 唯一的守护进程客户端。本地 WebSocket 的请求就是一行 JSON，
 * 响应不是 { code, data, message }，所以这里不用 axios。
 */
export class DaemonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DaemonError';
  }
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const port = import.meta.env.VITE_MUFU_WS_PORT ?? String(DAEMON_WS_PORT);
const url = `ws://127.0.0.1:${port}`;

let socket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(error: Error): void {
  for (const item of pending.values()) item.reject(error);
  pending.clear();
}

function openSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new DaemonError(message));
    };
    ws.addEventListener('open', () => {
      settled = true;
      socket = ws;
      resolve(ws);
    });
    ws.addEventListener('message', (event) => {
      const data = typeof event.data === 'string' ? event.data : '';
      let parsed: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        parsed = JSON.parse(data) as { id?: number; result?: unknown; error?: { message?: string } };
      } catch {
        return;
      }
      if (typeof parsed.id !== 'number') return;
      const waiter = pending.get(parsed.id);
      if (!waiter) return;
      pending.delete(parsed.id);
      if (parsed.error) waiter.reject(new DaemonError(parsed.error.message ?? '守护进程拒绝了请求'));
      else waiter.resolve(parsed.result);
    });
    ws.addEventListener('error', () => {
      fail('连不上守护进程。先在另一个终端运行 pnpm daemon');
    });
    ws.addEventListener('close', () => {
      socket = null;
      if (!settled) fail('连不上守护进程。先在另一个终端运行 pnpm daemon');
      failAll(new DaemonError('守护进程连接断了'));
    });
  });
}

function connect(): Promise<WebSocket> {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  if (!connecting) {
    connecting = openSocket().finally(() => {
      connecting = null;
    });
  }
  return connecting;
}

export async function rpc(method: string, params?: unknown): Promise<unknown> {
  const ws = await connect();
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
