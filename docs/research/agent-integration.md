# 代理集成：开源实现里踩过的坑

写 Codex / Claude 适配器之前看了四套现成集成。下面只记和本仓库有关的做法：用 SDK 还是 CLI、审批怎么截住、会话怎么恢复、限流和登录失效怎么认。对应的测试在 `packages/adapters`。

官方协议仍以这些页面为准，开源仓库只说明别人实际怎么接、在哪里翻车：

- Codex app-server：<https://developers.openai.com/codex/app-server>
- Codex 登录与 `forced_login_method`：<https://developers.openai.com/codex/auth>
- Codex 配置（`-c` / `--config`，`approval_policy`）：<https://developers.openai.com/codex/config-reference>
- Claude Agent SDK 会话：<https://code.claude.com/docs/en/agent-sdk/sessions>
- Claude Agent SDK 审批（`canUseTool`）：<https://code.claude.com/docs/en/agent-sdk/user-input>
- `forceLoginMethod`、`apiKeySource`：<https://code.claude.com/docs/en/authentication> ，设置项 <https://code.claude.com/docs/en/settings>
- CLI 退路：`claude -p --output-format stream-json --verbose --permission-prompt-tool <mcp工具名>`（<https://code.claude.com/docs/en/cli-reference>）

## Vibe Kanban

仓库：<https://github.com/BloopAI/vibe-kanban>

- Codex 走 CLI 的 `codex app-server`（JSON-RPC over stdio），不走已经过时的 `@openai/codex-sdk`。见 [`crates/executors/src/executors/codex.rs`](https://github.com/BloopAI/vibe-kanban/blob/main/crates/executors/src/executors/codex.rs) 和 [`codex/client.rs`](https://github.com/BloopAI/vibe-kanban/blob/main/crates/executors/src/executors/codex/client.rs)。
- 发任务前先 `account/read`。`requiresOpenaiAuth && account == null` 当成未登录，不再开 thread。他们不区分 ChatGPT 订阅和 API key；幕府更严：`account.type` 必须是 `chatgpt`。
- 审批是服务端请求：`item/fileChange/requestApproval`、`item/commandExecution/requestApproval`，用 `item_id` 当 call id，回复 `{ decision: accept | decline }`。提问走 `item/tool/requestUserInput`。
- [PR #2570](https://github.com/BloopAI/vibe-kanban/pull/2570)：审批请求若比 `item/started` 先到，用空的 `call_id` 去配对会超时，界面永远等不到门禁。必须用请求里的 `itemId`，不能等开始事件。
- 同一文件里，`PermissionsRequestApproval` 和 `mcpServer/elicitation/request` 曾用 `result: null` 打发。Nimbalyst 证明 null 会被 Codex 解成「用户拒绝」。
- 「恢复」实际调用的是 `thread/fork`，会得到新的 thread id。这不是原会话继续。
- Claude 不走 Agent SDK，走 `claude -p --output-format=stream-json --input-format=stream-json --permission-prompt-tool=stdio`。审批是 `control_request` / `can_use_tool`。恢复是 `--resume <session_id>`，可选 `--resume-session-at`。`isReplay` 的历史消息必须丢掉，否则恢复后像是代理又说了一遍。
- `system/init` 的 `apiKeySource === "ANTHROPIC_API_KEY"` 会警告「没用上订阅」，但他们仍继续跑，而且只在勾选时才删环境变量。幕府是拒绝运行，并且每次都剥掉 key。
- 限流认结构化的 `rate_limit_event`，不是终端文字。

## Crystal / Nimbalyst

Crystal（<https://github.com/stravu/crystal>）已停更，后继是 Nimbalyst：<https://github.com/nimbalyst/nimbalyst>。文档写明 Claude 用 Agent SDK，Codex 主路径是 app-server，旧 SDK 只留作开关。[`docs/AI_PROVIDER_TYPES.md`](https://github.com/nimbalyst/nimbalyst/blob/main/docs/AI_PROVIDER_TYPES.md)。

Codex：[`CodexAppServerProtocol.ts`](https://github.com/nimbalyst/nimbalyst/blob/main/packages/runtime/src/ai/server/protocols/CodexAppServerProtocol.ts)

- 每次恢复都新起一个 app-server 进程，所以 `thread/resume` 必须带上和 `thread/start` 一样的 cwd、sandbox、approval policy。只传 `threadId` 时，恢复后的线程回到 Codex 默认值，MCP 工具会全部消失。
- `thread/resume` 失败不能退回 `thread/start`（他们的 #1254）。界面上旧消息还在，模型却把上下文丢了，看起来像是代理突然失忆。
- `turn/interrupt` 必须同时带 `threadId` 和 `turnId`。没有 `turnId` 时服务端回 `-32600`，回合继续跑（NIM-1607）。取消若发生在 `turn/start` 返回之前，不要发 interrupt。
- 一个进程里会有协作子线程。`threadId` 对不上的通知不能算进当前会话。
- `turn/start` 的响应和第一条通知可能在同一块 stdout 里。审批处理器必须在 `turn/start` 之前就挂上。
- 没有宿主绑定的审批默认拒绝。`mcpServer/elicitation/request` 回 null 会被报成 “user rejected MCP tool call”（#797）。回复必须是 `{ action, content }`。
- 旧方法名 `applyPatchApproval`、`execCommandApproval` 仍会出现，要和 v2 方法一起认。
- 他们在宿主里可以注入 `CODEX_API_KEY`。幕府不注入、不保存任何 Codex/Claude key。

Claude：[`sdkOptionsBuilder.ts`](https://github.com/nimbalyst/nimbalyst/blob/main/packages/runtime/src/ai/server/providers/claudeCode/sdkOptionsBuilder.ts)，权限说明在 [`docs/AGENT_PERMISSIONS.md`](https://github.com/nimbalyst/nimbalyst/blob/main/docs/AGENT_PERMISSIONS.md)。

- SDK 的 `query()`，`canUseTool` 加上 `PreToolUse`。`permissionMode: 'auto'` 会让分类器静默放行；要人点的门禁用 `'default'`。不能设 `allowedTools: ['*']`，否则 `canUseTool` 根本不会被调用。
- `PreToolUse` 回 `permissionDecision: 'ask'`（或空对象），把决定留给人，而不是在 hook 里放行。
- prompt 用 `AsyncIterable`，不要传字符串。字符串会让 SDK 在 `result` 时关掉 stdin，长回合的权限请求报 “Stream closed”。
- 恢复用 `options.resume = <system/init 的 session_id>`。普通恢复不能设 `forkSession`，否则会另开一条历史。
- 从 Dock 启动的 Electron 没有终端 PATH。二进制要用登录 shell 的绝对路径。
- SDK 默认 `CLAUDE_CODE_ENTRYPOINT=sdk-ts`，Anthropic 把这类流量当第三方，限流比官方 CLI 更早。他们改成 `cli`（用户自己设了就不动）。
- `rate_limit_event.status` 有 `allowed` 和 `allowed_warning`。只有 `rejected` 才是限流失败。把每条 rate limit 事件都当成失败会杀掉还在跑的会话。

## tutti-os/tutti

仓库：<https://github.com/tutti-os/tutti>。排查笔记：[`docs/conventions/troubleshooting/agent-provider-setup.md`](https://github.com/tutti-os/tutti/blob/main/docs/conventions/troubleshooting/agent-provider-setup.md)。

- Codex 用 app-server。就绪与否看 `initialize` 握手，不看 `codex --version`。bun/pnpm 装出来的二进制在 GUI 的 PATH 里经常找不到，要用登录环境解析绝对路径。多套安装不要默默挑一个。
- Claude 用 sidecar 里的 Agent SDK（`packages/agent/claude-sdk-sidecar`），不是扫终端。
- 用量窗口不能按 primary/secondary 的位置猜。`limit_window_seconds === 604800`（或 daemon 里的 `windowDurationMins === 10080`）是每周额度，即使用户把它放在 primary。
- `modelUsage` 可能是按模型 id 做键的对象，不是数组。解析失败只能当「没有窗口数字」，不能当成登录失效。
- 登录按钮曾经因为状态刷新被 effect 反复触发，一次点击开出一串浏览器。失败后不要自动再调 `account/login/start`。
- 已经在跑的进程不会自己换账号。凭证文件变了，下一轮要新进程，并用原来的会话 id 恢复。

## nutthouse/tutti

仓库：<https://github.com/nutthouse/tutti>。这是另一套同名工具，用 tmux 包住交互式 CLI。

- [`src/runtime/claude_code.rs`](https://github.com/nutthouse/tutti/blob/main/src/runtime/claude_code.rs) 和 [`src/runtime/codex.rs`](https://github.com/nutthouse/tutti/blob/main/src/runtime/codex.rs) 没有协议，靠输出里的字符串认登录失效和限流（`please log in`、`rate limit`、`429`）。转圈字符也会被当成「正在工作」。这种刮终端的办法分不清代理引用了这些词，还是真的失败。
- 权限写进 Claude 的 settings allow 列表（[`src/permissions/mod.rs`](https://github.com/nutthouse/tutti/blob/main/src/permissions/mod.rs)）。没配策略时默认放行。幕府只探测用户配置，不改文件；没人应答的审批拒绝，不默认放行。
- 「会话还在」靠 tmux 进程还活着，不是 `thread/resume` 或 SDK `resume`。进程死了就接不回去。

## 幕府因此固定下来的行为

| 坑 | 适配器里的做法 |
| --- | --- |
| 审批早于 `item/started` | 用请求的 `itemId` / JSON-RPC id，不等开始事件 |
| 恢复用 fork 或失败后改 `thread/start` | 只发 `thread/resume`，失败就停 |
| resume 不带策略 | resume 参数带上 cwd 和 `approvalPolicy: "onRequest"` |
| interrupt 缺 `turnId` | 没有 turn id 就不发 |
| 子线程通知 | `threadId` 不符的通知丢掉 |
| 审批回复 null / `denied` | `accept`/`decline`，MCP 用 `{ action, content }` |
| 旧审批方法名 | `applyPatchApproval`、`execCommandApproval` 同样进门禁 |
| `allowedTools: ['*']`、`permissionMode: 'auto'` | 不设 allowedTools，模式用 `default` |
| 字符串 prompt 关掉 stdin | prompt 是 AsyncIterable，init 确认订阅之后才吐出任务 |
| `apiKeySource` 不是 `none` | 不放行任务，记环境失败 |
| 每条 `rate_limit_event` 都当失败 | 只有 `rejected`；Codex 只认 `codexErrorInfo` |
| 刮终端认限流 | 助手正文里的 “rate limit” 仍是普通消息 |
| 改用户 settings / 注入 API key | 探测只读；子进程环境剥掉三把 key；不调用 `account/login/start` |
| GUI PATH | doctor 用登录 shell 的 `command -v` 记绝对路径 |
| 额度窗口看位置 | 按秒数（或分钟换算）区分 5 小时和 7 天 |
