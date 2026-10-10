# 贯通路径

选定的路径：内置「修 bug」。人用 `mufu` 创建任务，守护进程记一条追加事件，在 git worktree 里启动代理，代理发出最终门禁，人在命令行批准或打回，事件写入日志，命令行再读出状态和事件。桌面看板和任务页读同一份日志。

经过的层：

1. `packages/cli` 通过本机 Unix socket 调用守护进程。
2. `packages/daemon` 是唯一写入者（SQLite 追加日志），折叠出任务状态。
3. `packages/core` 拥有任务/阶段/门禁状态和 `AgentAdapter`。
4. `packages/adapters` 里的 fake 代理按 JSONL 回放。Codex 与 Claude 适配器实现同一接口，订阅检查和恢复藏在接口里面。
5. `packages/app` 用同一个守护进程客户端读任务、批准门禁。

替身：

- 这台云主机没有登录的 `codex` / `claude`。端到端测试使用 fake 代理和 `fixtures/handwritten/fix-bug.fake.jsonl`。
- GitHub 合并是桩。代理拿不到合并能力。最终门禁的 `done_when` 是 `final_gate_approved`，不调用 `gh`。
- 协调 Agent 是固定文案。
- 手写的 Codex / Claude JSONL 来自官方文档和下面的开源实现，不是录音。

暂不验证：

- 真实 `codex app-server` 与 Claude Agent SDK 的往返。`pnpm verify:mac` 在用户的 Mac 上录到 `fixtures/recorded/`，再跑同一套适配器测试。录制测试通过之前，这条路径不算真的验证过。
- LaunchAgent 安装、钥匙串里的 OpenRouter key、`caffeinate` 在 Linux 上的效果。
