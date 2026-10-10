import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { LineQueue } from '../line-queue.ts';

export type CodexTransport = {
  send(line: string): void;
  incoming: AsyncIterable<string>;
  close(): void;
  readonly argv: string[];
  readonly spawnEnv: NodeJS.ProcessEnv;
};

export function spawnCodexTransport(argv: string[], spawnEnv: NodeJS.ProcessEnv): CodexTransport {
  const bin = argv[0];
  if (!bin) throw new Error('缺少 codex 可执行文件');
  const child: ChildProcessWithoutNullStreams = spawn(bin, argv.slice(1), {
    env: spawnEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const incoming = new LineQueue();
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) incoming.push(line);
    }
  });
  child.on('close', () => incoming.close());
  return {
    argv,
    spawnEnv,
    incoming,
    send(line: string) {
      child.stdin.write(`${line}\n`);
    },
    close() {
      child.kill();
      incoming.close();
    },
  };
}
