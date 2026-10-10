import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { listen } from './transport.ts';

describe('ndjson transport', () => {
  it('answers one request per line', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mufu-sock-'));
    const server = await listen({
      socketPath: join(home, 'daemon.sock'),
      wsPort: 0,
      handle: (request) => {
        if (request.method === 'health') return Promise.resolve({ ok: true });
        return Promise.reject(new Error('no'));
      },
    });
    try {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = connect(join(home, 'daemon.sock'));
        let buffer = '';
        socket.setEncoding('utf8');
        socket.on('error', reject);
        socket.on('connect', () => {
          socket.write(`${JSON.stringify({ id: 7, method: 'health' })}\n`);
        });
        socket.on('data', (chunk: string) => {
          buffer += chunk;
          if (!buffer.includes('\n')) return;
          socket.end();
          resolve(buffer);
        });
      });
      expect(JSON.parse(response.split('\n')[0] ?? '{}')).toEqual({ id: 7, result: { ok: true } });
    } finally {
      await server.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});