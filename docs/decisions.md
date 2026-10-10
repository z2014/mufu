# mufu: decisions agreed so far (from design discussion with the user, 产品经理, 架构师)

Product: personal, local-first macOS desktop workbench that coordinates the user's own locally logged-in Codex (via `codex app-server`) and Claude (via Claude Agent SDK) as an "agent team". The human only approves at gates. Name `mufu` (幕府). Phase one is minimal, for the user's own use.

## Hard constraints
- Desktop only. No backend server. All data local (SQLite, append-only event log, single writer = the daemon).
- Use ONLY the user's locally logged-in `codex` and `claude` subscriptions. Never register for, collect or store Anthropic/OpenAI API keys. MUST run on subscription:
  1. Daemon strips `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY` from the child env.
  2. At launch force subscription login, passed per launch without editing user config files (candidates: Codex `forced_login_method = "chatgpt"` via `-c` override; Claude `forceLoginMethod: "claudeai"` via `--settings` / SDK settings). Verify field names and whether they override config-file keys (`~/.claude/settings.json` apiKeyHelper/env, `~/.codex/auth.json`, `~/.codex/config.toml` api_key).
  3. Check before sending the real task, and refuse to run if not subscription: Claude reads `apiKeySource` from the `system/init` message (must be confirmed BEFORE the task prompt is sent, or use a tiny probe at daemon start); Codex asks the app-server for the current account (e.g. `account/read`) rather than `codex login status`, which misses `config.toml` keys. On failure the task goes to "needs you" with "!" naming the tool and the key source.
  - User config files are only detected, never modified.
- Lead agent: OpenRouter, user-supplied key stored in macOS Keychain. Non-critical, degrades gracefully. Prototype: stub.
- Daemon runs as a per-user LaunchAgent (not LaunchDaemon) so it can read the login keychain where `claude` stores credentials. Resolve absolute paths of `codex`, `claude`, `gh` once via a login shell and store them (launchd has no terminal PATH). First-run check: installed + logged in for codex, claude, gh; run the check from the daemon itself.
- Prevent idle sleep while tasks run (like `caffeinate -i`).
- GitHub via `gh` polling, no webhooks. Only the daemon merges, only on the user's click; agents never get merge capability.
- Errors: environment failures (rate limit, auth expired, network, and merge failures caused by gh login or network) don't count as attempts. Task failures, merge conflicts, and CI failures count; after 3 attempts the task goes to the user. Distinguish "run" vs "attempt" in the glossary. The rule is `countsAsAttempt` in core.
- Daemon restart: resume agent sessions by id, mark the in-flight turn interrupted, cancel pending approvals, prompt the agent to check `git status`; defer daemon self-update while any task is mid-run.
- The product name must come from ONE constant in code (config dir `.mufu/`, CLI `mufu`, LaunchAgent label, `~/Library/Application Support/<name>`, keychain service). Renaming later = change the constant + data-dir migration.

## Domain
task / stage / gate / artifact / workspace / pin / agent session. Built-in workflows only: "fix bug" and "new feature" (no template editor). Workflow YAML lives only in `packages/daemon/workflows/*.yaml`. The daemon scans every file there. Shipped templates use `done_when: pr_merged`, and that is the only value the schema accepts. One file may set `default: true`. Each task snapshots its template. One git worktree per dev task. Pins: agents/lead call MCP `pin_message(message, reason)`, max 5 per stage; a pin becomes a decision passed to later agents only after gate approval. No concurrency limit. No cost tracking. Task completion is a merged PR: after the final gate is approved the daemon merges via `gh` and writes `done` only when that succeeds.

## UI (later phases; prototype may stub)
Monochrome minimal (Linear / Qwen style). Home = board with columns 等你 / 进行中 / 待验收 (to-review only when the PR is mergeable: CI green, no conflicts, required reviews met); merging there completes the task; viewed finished tasks auto-archive. Not draggable. Errors marked with a black "!" and sorted first. Left nav: 新任务, 任务 (grouped 需要你 / 进行中). Task page: workflow steps in title bar, unread pins fixed at top of chat, "待你处理" card above the input, collapsible right panel with outputs only.

## Architecture (架构师, following dev-principles)
pnpm monorepo:
- `packages/core`: state machines for task/stage/gate, event formats, and the interfaces it owns (AgentAdapter, Store, GitHub). Depends on nothing concrete. All deps point toward core.
- `packages/adapters`: Codex and Claude adapters implementing core's AgentAdapter. Deep module: callers only call "start session"; subscription check, env cleanup, binary paths, resume are hidden inside.
- `packages/schema`: event-log and workflow YAML schemas.
- `packages/daemon`: the long-running process; SQLite store; local socket server.
- `packages/cli`: `mufu` CLI talking to the daemon over the local socket.
- `packages/app`: Electron + Vite + React + shadcn + TanStack Query per frontend-dev, except `api/client` is the single local daemon client instead of an axios instance (no HTTP backend).
- `fixtures/`: raw Codex and Claude event streams recorded unchanged as JSONL, for replay tests.
- `docs/glossary.md` first.
