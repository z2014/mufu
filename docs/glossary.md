# 术语表

代码、文档和界面使用下表里的词。新增概念时补一行：名称、含义、代码标识符、容易混的近义词。

| 名称       | 含义                                                                                                                                                          | 代码标识符                                           | 不要和这些混               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------- |
| 任务       | 用户交给幕府的一件事。有标题、提示、流程快照和状态。完成后离开看板。                                                                                          | `Task`，`taskId`                                     | 运行、尝试、阶段           |
| 阶段       | 流程快照里的一步。修 bug 为复现、修复、PR 与 CI、验收。任务同时只处在一个阶段。每个阶段选定 Codex 或 Claude。                                                 | `Stage`，`stageId`，`stage.agent`                    | 门禁、任务状态             |
| 门禁       | 必须由人批准或打回的停点。阶段门禁进「等你」；最终门禁进「待验收」。打回要写一句，任务回到进行中。                                                            | `Gate`，`gateId`，`pendingGate`                      | 代理自己的工具调用；合并   |
| 打回       | 人拒绝门禁，并写一句原因。原因记成用户消息，交给还在跑的会话。卡片回到进行中，不算一次尝试。                                                                  | `gate.resolve` `decision=reject`，`comment`          | 等你、尝试                 |
| 产物       | 阶段留下、给人看的输出。只出现在任务页右侧，不进聊天。                                                                                                        | `Artifact`                                           | 事件、重点                 |
| 工作区     | 一个开发任务对应的一个 git worktree。代理只在这里改文件。                                                                                                     | `Workspace`，`workspacePath`                         | 仓库根目录、数据目录       |
| 重点       | 只有协调 Agent 能钉的一句话，附理由。执行代理和人不能钉。阶段 1 的桩在每个完成的阶段钉一句「阶段完成」。每个阶段最多 5 条。未读在左栏加粗。点开滚到对应消息。 | `Pin`，`pin.added`，`LEAD_PIN_AUTHOR`                | 普通聊天消息               |
| 代理会话   | 一次 Codex thread 或 Claude session。用对方的会话 id 恢复，不用任务 id 冒充。                                                                                 | `AgentSession`，`sessionId`                          | 任务、运行                 |
| 运行       | 代理的一轮执行，从 `startSession` 到结束。环境失败也算一次运行。                                                                                              | `Run`，`run.started`                                 | 尝试                       |
| 尝试       | 算作任务失败的运行，也包括合并冲突和 CI 失败。限流、登录过期、断网，以及 gh 没登录或网络导致的合并失败不算。累计 3 次后回到人这里。                           | `Attempt`，`attempt.counted`，`countsAsAttempt`      | 运行                       |
| 流程       | 内置工作流模板。任务创建时把模板抄进自己的快照，之后模板改了不影响已有任务。                                                                                  | `Workflow`，`doneWhen`                               | 阶段                       |
| 协调 Agent | 领队。原型是固定文案的桩，不连 OpenRouter，不存密钥。任务开始时写开场白，每个完成的阶段钉一条「阶段完成」。                                                   | `leadIntro`，`LEAD_PIN_AUTHOR`                       | Codex、Claude              |
| 等你       | 看板第一列。阶段门禁，或带黑色「!」的环境/尝试/合并失败。有「!」的排在最前。                                                                                  | `needs_you`，`attention`                             | 待验收                     |
| 进行中     | 看板第二列。正在跑的任务。                                                                                                                                    | `running`                                            | 等你                       |
| 待验收     | 看板第三列。最终门禁。卡片上的 CI 来自事件。验收并合并成功后任务完成并离开看板。                                                                              | `to_review`，`ci.reported`                           | 等你                       |
| 合并       | 最终门禁通过之后，守护进程用本机 gh 合并 PR。只有成功才算任务完成。冲突和 CI 失败回到等你并计入尝试。                                                         | `merge_requested`，`merge_succeeded`，`merge_failed` | 门禁                       |
| 手写夹具   | 在这台没有登录账号的机器上，按文档写成的 JSONL。不是录音。                                                                                                    | `fixtures/handwritten`，`origin: handwritten`        | 录制夹具                   |
| 录制夹具   | 在用户的 Mac 上由 `pnpm verify:mac` 写下的原始事件流。路径只有在对着这些文件的测试通过之后才算真的验证过。                                                    | `fixtures/recorded`，`origin: recorded`              | 手写夹具                   |
| 事件版本   | 追加日志里每条事件的形状版本。现在是 1。读到不认识的版本就停，不猜测。缺省字段当成 1。                                                                        | `schemaVersion`，`EVENT_SCHEMA_VERSION`              | 产品版本 `PRODUCT_VERSION` |
| 连接       | 本机 codex、claude、gh 是否装好、是否登录、是否订阅。设置页只显示 ✓ 或 ✗ 和修复提示。                                                                         | `doctor`，`CheckItem`                                | 钥匙                       |
| 钥匙       | 人自己保存的密钥。阶段 1 只有 OpenRouter，进钥匙串，界面只显示有没有。适配器不读。                                                                            | `SecretStore`，`OPENROUTER_ACCOUNT`                  | Codex / Claude 的登录      |

产品名只有一处常量：`PRODUCT_NAME`（`packages/core`）。配置目录、命令行、LaunchAgent 标签、Application Support 目录和钥匙串服务都从它派生。
