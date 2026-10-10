import { rmSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer, type Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

import { DAEMON_WS_PORT, DEV_PORT, type RpcRequest, type RpcResponse } from '@mufu/schema';

type Handle = (request: RpcRequest) => Promise<unknown>;

type Listening = {
  wsPort: number;
  close: () => Promise<void>;
};

export async function listen(options: { socketPath: string; wsPort?: number; handle: Handle }): Promise<Listening> {
  const requested = options.wsPort ?? DAEMON_WS_PORT;
  if (!Number.isInteger(requested) || requested < 0 || requested > 65535 || requested === DEV_PORT) {
    throw new Error(
      `守护进程不能听 ${requested}。看板端口 ${DEV_PORT} 只给 pnpm dev:app（http://127.0.0.1:${DEV_PORT}），WebSocket 用 ${DAEMON_WS_PORT}。`,
    );
  }

  const socket = createNetServer((connection) => attachNdjson(connection, options.handle));
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(options.socketPath, () => resolve());
  });

  const hint = `mufu 守护进程不提供看板。\n在另一个终端运行 pnpm dev:app，然后打开 http://127.0.0.1:${DEV_PORT}\n`;
  const http: HttpServer = createHttpServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(hint),
      'Cache-Control': 'no-store',
    });
    res.end(hint);
  });
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (socketConnection) => attachWebSocket(socketConnection, options.handle));
  const wsPort = await new Promise<number>((resolve, reject) => {
    const fail = (error: Error) => {
      http.close(() => {
        socket.close(() => {
          rmSync(options.socketPath, { force: true });
          reject(error);
        });
      });
    };
    http.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        fail(
          new Error(
            `127.0.0.1:${requested} 已被占用。守护进程的 WebSocket 是 ${DAEMON_WS_PORT}，看板端口 ${DEV_PORT} 留给 pnpm dev:app。`,
          ),
        );
        return;
      }
      fail(error);
    });
    http.listen({ port: requested, host: '127.0.0.1', exclusive: true }, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      if (port === DEV_PORT || (requested !== 0 && port !== requested)) {
        fail(
          new Error(
            `守护进程绑在了 127.0.0.1:${port}。它不能占看板端口 ${DEV_PORT}，WebSocket 应是 ${requested === 0 ? DAEMON_WS_PORT : requested}。`,
          ),
        );
        return;
      }
      resolve(port);
    });
  });

  return {
    wsPort,
    async close() {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
      rmSync(options.socketPath, { force: true });
    },
  };
}

function attachNdjson(connection: Socket, handle: Handle): void {
  let buffer = '';
  connection.setEncoding('utf8');
  connection.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      void answer(line, handle).then((response) => connection.write(`${JSON.stringify(response)}\n`));
    }
  });
}

function attachWebSocket(connection: WebSocket, handle: Handle): void {
  connection.on('message', (data) => {
    void answer(String(data), handle).then((response) => connection.send(JSON.stringify(response)));
  });
}

async function answer(line: string, handle: Handle): Promise<RpcResponse> {
  let request: RpcRequest;
  try {
    request = JSON.parse(line) as RpcRequest;
  } catch {
    return { id: 0, error: { message: '无法解析请求' } };
  }
  try {
    const result = await handle(request);
    return { id: request.id, result };
  } catch (error) {
    return { id: request.id, error: { message: error instanceof Error ? error.message : String(error) } };
  }
}
