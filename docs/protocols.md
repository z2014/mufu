# 协议

适配器只对守护进程暴露 `startSession`。下面是实现藏起来的部分，以及还没在真二进制上核对过的问题。开源仓库里踩过的坑见 [agent-integration.md](research/agent-integration.md)。

## Codex：`codex app-server`

来源：

- <https://developers.openai.com/codex/app-server>
- <https://developers.openai.com/codex/auth>
- <https://developers.openai.com/codex/config-reference>

启动参数：

```text
codex --config 'forced_login_method="chatgpt"' app-server --listen stdio://
```

`--config` 只覆盖这一次进程，不写 `~/.codex/config.toml`。JSON-RPC 行里不带 `"jsonrpc":"2.0"`。

顺序：`initialize` → `initialized` → `account/read`。`account.type === "chatgpt"` 才继续。然后才是 `thread/start` 或 `thread/resume`，再 `turn/start`。不调用 `account/login/start`。

恢复用原来的 thread id，并再次带上 `cwd`、`approvalPolicy: "onRequest"`、`sandbox: "workspaceWrite"`。失败不改走 `thread/start`，也不用 `thread/fork`。

`turn/interrupt` 同时带 `threadId` 和 `turnId`。还没有 turn id 时不发。

审批是服务端请求，用 JSON-RPC id 当门禁 id，不等 `item/started`：

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- `mcpServer/elicitation/request`
- `item/tool/requestUserInput`
- `applyPatchApproval`
- `execCommandApproval`

回复是 `{ decision: "accept" | "decline" }`。MCP elicitation 是 `{ action, content }`。`threadId` 对不上的通知丢掉。

限流、401/403、断流算环境失败，不计入尝试。助手正文里出现 “rate limit” 仍是普通消息。用量窗口按秒数分：604800 秒（或 10080 分钟）是每周，不超过 6 小时是会话窗口。

官方写明：`forced_login_method` 和当前登录方式不一致时，Codex 会退出登录并结束进程。`verify:mac` 要观察这一步有没有把人登出。

## Claude：Agent SDK

来源：

- <https://code.claude.com/docs/en/agent-sdk/sessions>
- <https://code.claude.com/docs/en/agent-sdk/user-input>
- <https://code.claude.com/docs/en/authentication>
- <https://code.claude.com/docs/en/settings>
- CLI：<https://code.claude.com/docs/en/cli-reference>

`query()` 在运行时加载。`permissionMode` 是 `default`。不设置 `allowedTools`。`PreToolUse` 返回 `permissionDecision: "ask"`，真正的决定在 `canUseTool`。

`settings: { forceLoginMethod: "claudeai" }` 是这一次启动的 flag 层，相当于 `--settings`，不写 `~/.claude/settings.json`。

prompt 是 AsyncIterable。`system/init` 的 `apiKeySource === "none"` 之后才把任务文本放出去。别的来源（`ANTHROPIC_API_KEY`、`apiKeyHelper`、`/login managed key`、缺字段、45 秒内没有 init）都拒绝。

会话 id 用 init 里的 `session_id`。恢复只设 `resume`，不设 `forkSession`。用户没有自己设 `CLAUDE_CODE_ENTRYPOINT` 时，把它写成 `cli`。

子进程环境去掉 `ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`OPENAI_API_KEY`。

`rate_limit_event` 只有 `status === "rejected"` 才是环境失败。`isReplay` 的消息丢掉。

CLI 退路（适配器当前不走这条，留给真会话对不上 SDK 时）：

```text
claude -p --output-format stream-json --verbose --input-format stream-json --permission-prompt-tool <mcp工具名>
```

权限工具必须是 MCP 工具。它批不了被标成需要人交互的 MCP 工具（Claude Code v2.1.199 起）。

## 订阅检查和配置文件

| 工具   | 放行条件                                       | 不看                            |
| ------ | ---------------------------------------------- | ------------------------------- |
| Codex  | `account/read` 的 `account.type === "chatgpt"` | `codex login status`、API key   |
| Claude | `system/init` 的 `apiKeySource === "none"`     | 环境变量里有没有 key 的名字本身 |

`doctor` 用登录 shell 的 `command -v` 记绝对路径，并只读探测 `config.toml` 的 `api_key`、`auth.json` 的 apikey 模式、Claude settings 的 `apiKeyHelper`。探测结果不包含密钥原文。

## `verify:mac` 还要回答的问题

手写夹具是按文档写的。下面这些以 Mac 上的原始流为准：

1. 这台机器上 `account/read` 的字段，是不是 `type: chatgpt`。
2. `forced_login_method="chatgpt"` 会不会把已经登录的账号踢掉。
3. 审批请求的方法名和字段，和上面的列表是否一致；shell、改文件、网络、MCP 是否都能截住。
4. `turn/interrupt` 在带了 turn id 之后，回合是否真的停。
5. `thread/resume` 是否还是同一个 thread id，策略有没有丢。
6. Claude 的 `apiKeySource` 是否在任务文本送出之前就到；`forceLoginMethod` 能不能压过配置文件里的 `apiKeyHelper`。
7. SDK 是否复用本机 `claude` 登录，而不是另要一把 API key。
8. 恢复后的 session id 是否和 init 里的一样。
