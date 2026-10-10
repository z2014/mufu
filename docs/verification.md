# 什么算验证过

修 bug 这条路径有两套结果，不要混在一起看。

## 替身（这台云主机上能跑的）

`pnpm test` 使用 `fixtures/handwritten/`。这些 JSONL 的第一行是 `origin: handwritten`，按官方文档和 [开源集成笔记](research/agent-integration.md) 写的，不是从 `codex` 或 `claude` 录下来的。

通过只说明：

- 命令行能创建任务，守护进程把事件写进 SQLite
- 夹具走到最终门禁。批准后守护进程用注入的 gh 合并，成功才完成。打回要写一句，任务回到「进行中」，不算完成。冲突、CI 失败、环境问题分开测
- Codex / Claude 的解析器能读懂这些手写消息，并按坑表拒绝错误的恢复、审批和登录

这不算真实验证。

## 录音（只有你的 Mac）

`pnpm verify:mac` 要求 macOS，并且本机已经用订阅登录 Codex 和 Claude。它会：

1. 用登录 shell 找 `codex`、`claude`、`gh` 的绝对路径，只读检查配置文件里有没有 key
2. 各开一个很短的真会话：审批、中断、按 id 恢复
3. 把原始事件写到 `fixtures/recorded/codex.jsonl` 和 `fixtures/recorded/claude.jsonl`。第一行是我们加的标记，后面不改写。流里如果像凭据，脚本拒绝落盘
4. 再跑两遍测试：普通的手写夹具，以及 `MUFU_REQUIRE_RECORDED=1` 的录音夹具

**录音那一遍通过之前，这条路径不算验证过。** 手写测试通过不能代替它。

脚本最后打一张通过/失败表。把那张表和 `fixtures/recorded/` 发回来。不要把含 token 的终端全文贴回来。

配置文件在跑之前和之后会比大小和 mtime。脚本不应该改 `~/.codex` 或 `~/.claude`。
