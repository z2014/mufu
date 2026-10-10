import { describe, expect, it } from 'vitest';

import { DAEMON_WS_PORT, DEV_PORT, resolveDaemonPort } from './product.ts';

describe('resolveDaemonPort', () => {
  it('defaults to the websocket port and ignores PORT', () => {
    expect(resolveDaemonPort({})).toBe(DAEMON_WS_PORT);
    expect(resolveDaemonPort({ MUFU_WS_PORT: '' })).toBe(DAEMON_WS_PORT);
    expect(resolveDaemonPort({ PORT: String(DEV_PORT) })).toBe(DAEMON_WS_PORT);
    expect(DEV_PORT).not.toBe(DAEMON_WS_PORT);
  });

  it('refuses the board port and unusable values', () => {
    expect(() => resolveDaemonPort({ MUFU_WS_PORT: String(DEV_PORT) })).toThrow(/看板端口/);
    expect(() => resolveDaemonPort({ MUFU_WS_PORT: '0' })).toThrow(/不是可用端口/);
    expect(() => resolveDaemonPort({ MUFU_WS_PORT: 'foo' })).toThrow(/不是可用端口/);
    expect(() => resolveDaemonPort({ MUFU_WS_PORT: '65536' })).toThrow(/不是可用端口/);
  });

  it('accepts another fixed port', () => {
    expect(resolveDaemonPort({ MUFU_WS_PORT: '43125' })).toBe(43125);
  });
});
