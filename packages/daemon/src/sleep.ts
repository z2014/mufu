import { spawn, type ChildProcess } from 'node:child_process';

/** macOS 上有任务在跑时阻止空闲睡眠。Linux 上这是空操作。 */
export function holdAwake(): { stop(): void } {
  if (process.platform !== 'darwin') return { stop() {} };
  const child: ChildProcess = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
  return {
    stop() {
      child.kill();
    },
  };
}
