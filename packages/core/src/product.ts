/** 产品名只写在这里。目录、命令、LaunchAgent、钥匙串都从它派生。 */
export const PRODUCT_NAME = 'mufu';

export const PRODUCT_VERSION = '0.0.1';

export const CONFIG_DIR_NAME = `.${PRODUCT_NAME}`;

export const LAUNCH_AGENT_LABEL = `com.${PRODUCT_NAME}.daemon`;

export const KEYCHAIN_SERVICE = PRODUCT_NAME;

/** 浏览器看板。只有 `pnpm dev:app`（Vite）听这个端口。 */
export const DEV_PORT = 43123;

/** 守护进程的 WebSocket。不提供页面。 */
export const DAEMON_WS_PORT = 43124;

/** 和 DAEMON_WS_PORT 同一个数，留给已经写成这个名字的调用。 */
export const DEFAULT_WS_PORT = DAEMON_WS_PORT;

/**
 * 守护进程实际要绑的端口。环境变量可以改它，但不能改成看板端口。
 * 不读 PORT，避免和 Vite 抢同一个数。
 */
export function resolveDaemonPort(env: Record<string, string | undefined>): number {
  const raw = env.MUFU_WS_PORT;
  const port = raw !== undefined && raw.length > 0 ? Number(raw) : DAEMON_WS_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`MUFU_WS_PORT 不是可用端口：${raw ?? ''}`);
  }
  if (port === DEV_PORT) {
    throw new Error(`MUFU_WS_PORT 不能是看板端口 ${DEV_PORT}。守护进程用 ${DAEMON_WS_PORT}，看板用 pnpm dev:app。`);
  }
  return port;
}
