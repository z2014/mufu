import { connect } from 'node:net';

import { dataDir, socketPath } from '@mufu/daemon';
import type { RpcResponse } from '@mufu/schema';

export async function callDaemon(method: string, params?: unknown): Promise<unknown> {
  const path = socketPath(dataDir());
  const id = 1;
  const response = await new Promise<RpcResponse>((resolve, reject) => {
    const socket = connect(path);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', () => reject(new Error('守护进程没在跑。先执行 mufu daemon')));
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      const line = buffer.split('\n').find((item) => item.trim().length > 0);
      if (!line) return;
      socket.end();
      resolve(JSON.parse(line) as RpcResponse);
    });
  });
  if (response.error) throw new Error(response.error.message);
  return response.result;
}
