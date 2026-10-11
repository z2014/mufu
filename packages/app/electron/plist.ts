/**
 * LaunchAgent 的 plist 只写在桌面壳里。
 * 桌面壳编译成普通 JS，不从核心包再抄一份。
 */

const LAUNCH_AGENT_LABEL = 'com.mufu.daemon';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

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

export { LAUNCH_AGENT_LABEL };
