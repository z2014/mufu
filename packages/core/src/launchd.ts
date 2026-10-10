import { LAUNCH_AGENT_LABEL } from './product.ts';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/**
 * 每用户 LaunchAgent，不是 LaunchDaemon，这样才读得到登录钥匙串。
 * 桌面壳在 macOS 上安装它。默认参数仍是 `daemon`，给开发时的绝对路径用。
 */
export function launchAgentPlist(bin: string, args: string[] = ['daemon'], env: Record<string, string> = {}): string {
  const programArgs = [bin, ...args].map((value) => `    <string>${xml(value)}</string>`).join('\n');
  const envEntries = Object.entries(env)
    .map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`)
    .join('\n');
  const environment =
    envEntries.length > 0
      ? `  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
`
      : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
${environment}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
}
