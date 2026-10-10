# mufu

个人用的本地工作台。任务在你自己的机器上跑，代理用已经登录的 Codex CLI 和 Claude，人只在门禁上点通过或打回。

这是第一刀原型：一条「修 bug」路径，从创建任务，到门禁，到看板上的三列。协调 Agent 是固定文案。不会合并 PR，也不会保存 Codex / Claude 的 key。

协议和还没在真二进制上核对的问题写在 [docs/protocols.md](docs/protocols.md)。什么算验证过写在 [docs/verification.md](docs/verification.md)。

## 先跑起来

```bash
pnpm install
pnpm start
```

这一条会编译桌面壳的主进程，打开守护进程，再打开 Electron 窗口。窗口加载 <http://127.0.0.1:43123>。地址用 `127.0.0.1`，不要用 `localhost`。

守护进程同时拿着 Codex 和 Claude。修 bug 默认 Claude 复现和验收，Codex 修复、提 PR。创建任务时可以按阶段改。两边各自检查订阅登录：没登录的那一边只让用到它的任务停在「等你」，卡片上是黑色「!」，另一边照常跑。

不连真代理、只用替身时：

```bash
MUFU_AGENT=fake pnpm start
```

`MUFU_AGENT=codex` 或 `claude` 只是阶段没写代理时的默认，不是「整个守护进程只跑一个」。

## 环境

- Node.js 22
- pnpm 10
- macOS 上跑桌面壳和 `verify:mac`。开发机上的测试用替身代理，不需要登录

## 安装

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm install` 会编译 electron 和 esbuild。桌面壳若提示找不到 electron，再执行 `pnpm rebuild electron esbuild`。

`pnpm test` 使用 `fixtures/handwritten/`。通过只说明替身和解析器没坏，**不算** Codex / Claude 真的跑通。

## 命令行

先开守护进程。它听本机 Unix socket，WebSocket 在 `127.0.0.1:43124`。它不提供页面。浏览器打开守护进程的端口只会看到一段纯文本，告诉你去开看板。

```bash
pnpm daemon
```

日志里应有 `ws 127.0.0.1:43124`。不要设置 `MUFU_WS_PORT=43123`，也不要设置 `PORT` 来改它。设成看板端口时守护进程会直接退出。

另一个终端：

```bash
pnpm mufu -- task create --title "js error 修复" --prompt "空列表崩了"
pnpm mufu -- task list
pnpm mufu -- task status <taskId>
pnpm mufu -- task events <taskId>
pnpm mufu -- gate approve <gateId>
pnpm mufu -- gate reject <gateId> --comment "原因"
pnpm mufu -- doctor
```

不设 `MUFU_AGENT` 时，阶段用流程模板里的代理（Codex / Claude）。`MUFU_AGENT=fake` 时整条任务改读 `fixtures/handwritten/fix-bug.fake.jsonl`。创建时可以用重复的 `--agent 阶段=codex` 盖掉模板，例如 `--agent reproduce=codex --agent accept=codex`。没有订阅登录的那一边会在把任务送出去之前拒绝，并且只挡住用到它的任务。

## 看板

`pnpm start` 已经同时打开守护进程和窗口。要拆开看日志时再用下面的两个终端。

两个端口都写在 `packages/core/src/product.ts`。`DEV_PORT`（43123）只有看板在听。`DAEMON_WS_PORT`（43124）只有守护进程的 WebSocket 在听。守护进程不托管看板。

终端 1：

```bash
pnpm daemon
```

这时打开 <http://127.0.0.1:43123> 会连不上。页面还没人提供，这是正常的。

终端 2：

```bash
pnpm dev:app
```

浏览器打开 <http://127.0.0.1:43123>。地址用 `127.0.0.1`，不要用 `localhost`（macOS 上 `localhost` 常常先走 IPv6，而这两个服务只绑 IPv4）。三列是「等你 / 进行中 / 待验收」。完成的任务离开看板。

如果 `pnpm dev:app` 报 43123 已被占用，停掉占着这个端口的进程再开。旧的守护进程如果曾经把 WebSocket 绑在 43123 上，就会把看板端口占住，而且浏览器打不开页面。停掉它，确认环境里没有 `MUFU_WS_PORT=43123`，再按上面两个终端重新开。

桌面壳（本地构建，没有签名。macOS 第一次打开若被拦截，在「隐私与安全性」里允许这一次，或右键打开）：

```bash
pnpm --filter @mufu/app build
MUFU_RENDERER_URL=http://127.0.0.1:43123 pnpm --filter @mufu/app exec electron dist-electron/main.js
```

不设 `MUFU_RENDERER_URL` 时，壳加载 `packages/app/dist` 里的页面。守护进程仍要单独开着。

## 打成桌面应用

在 Mac 上：

```bash
pnpm install
pnpm build:mac
```

产物是 `release/mac-universal/mufu.app`，arm64 和 x64 打在一个包里，没有签名。Linux 上这条命令会直接说明打不了包，不会去跑 electron-builder。

在本机打出来的包没有隔离属性，直接双击就能打开。从别处下载的副本带隔离属性，第一次要在访达里右键 `mufu.app`，选「打开」，或者在包所在目录执行：

```bash
xattr -dr com.apple.quarantine mufu.app
```

打开之后不需要终端。应用会在 `~/Library/LaunchAgents/com.mufu.daemon.plist` 安装或刷新一个用户级 LaunchAgent（不是 LaunchDaemon），用包里的绝对路径跑守护进程，然后窗口连上它。任务日志在 `~/Library/Application Support/mufu`，重启还在。

卸掉这个 LaunchAgent：

```bash
launchctl bootout gui/$(id -u)/com.mufu.daemon
rm ~/Library/LaunchAgents/com.mufu.daemon.plist
```

开发时用 `pnpm start`，不会安装 LaunchAgent。

## 在 Mac 上真实验证

需要本机已安装并订阅登录 `codex`、`claude`，以及 `gh`。

```bash
pnpm verify:mac
```

脚本会做三件事：检查绝对路径和配置文件里的 key（只读）、各跑一个很短的真会话（审批、中断、按 id 恢复）、把原始流写进 `fixtures/recorded/` 再跑测试。

请把终端里的通过/失败表，以及 `fixtures/recorded/*.jsonl` 发回来。流里如果出现凭据样式，脚本不会写文件。不要另贴含 token 的日志。

录音测试通过之前，不要把这条路径当成已经验证。细节见 [docs/verification.md](docs/verification.md)。
