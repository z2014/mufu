/** 看板端口。必须和 packages/daemon/src/runtime.ts 里的两个数一致。 */
export const DEV_PORT = 43123;

/** 守护进程 WebSocket。界面只连这个，不调用 gh。 */
export const DAEMON_WS_PORT = 43124;
