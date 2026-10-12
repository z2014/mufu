import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { macUniversalAsarPath, missingDistElectron } from './asar-check.ts';

describe('asar 对照 dist-electron', () => {
  it('列出 asar 里没有的编译结果', () => {
    const listed = [
      '/dist-electron',
      '/dist-electron/main.js',
      '/dist-electron/preload.js',
      '/dist-electron/launch-agent.js',
    ].join('\n');
    expect(missingDistElectron(listed, ['launch-agent.js', 'main.js', 'plist.js', 'preload.js'])).toEqual(['plist.js']);
  });

  it('每个编译结果都在 asar 里时为空', () => {
    const listed = '/dist-electron/main.js\n/dist-electron/plist.js\n';
    expect(missingDistElectron(listed, ['main.js', 'plist.js'])).toEqual([]);
  });

  it('Mac 检查打在通用包的 app.asar 上', () => {
    expect(macUniversalAsarPath('/repo')).toBe(
      join('/repo', 'release/mac-universal/mufu.app/Contents/Resources/app.asar'),
    );
  });
});
