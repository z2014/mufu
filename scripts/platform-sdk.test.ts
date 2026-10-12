import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { platformSdkHits, removePlatformSdkPackages } from './platform-sdk.ts';

describe('SDK 平台二进制', () => {
  it('只认平台包路径', () => {
    expect(
      platformSdkHits([
        '/app/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
        '/app/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
        '/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude',
      ]),
    ).toEqual([
      '/app/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
      '/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude',
    ]);
  });

  it('从资源目录里删掉平台包，留下 SDK 本体', () => {
    const root = mkdtempSync(join(tmpdir(), 'mufu-sdk-'));
    const sdk = join(root, 'node_modules', '@anthropic-ai');
    mkdirSync(join(sdk, 'claude-agent-sdk'), { recursive: true });
    writeFileSync(join(sdk, 'claude-agent-sdk', 'sdk.mjs'), '');
    mkdirSync(join(sdk, 'claude-agent-sdk-darwin-arm64'), { recursive: true });
    writeFileSync(join(sdk, 'claude-agent-sdk-darwin-arm64', 'claude'), '');
    symlinkSync(join(sdk, 'claude-agent-sdk-darwin-arm64'), join(sdk, 'claude-agent-sdk-linux-x64'));
    try {
      const removed = removePlatformSdkPackages(root);
      expect(removed.map((path) => path.split('/').at(-1))).toEqual([
        'claude-agent-sdk-darwin-arm64',
        'claude-agent-sdk-linux-x64',
      ]);
      expect(platformSdkHits([root, ...removed])).toHaveLength(2);
      expect(removePlatformSdkPackages(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
