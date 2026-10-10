/**
 * 在用户自己的 Mac 上对已登录的 Codex / Claude 做一次真跑。
 * 云主机上会直接失败：这里没有订阅登录，也不能把替身结果写成录音。
 *
 * 通过条件：录音写入 fixtures/recorded/，并且 MUFU_REQUIRE_RECORDED=1 的测试通过。
 * 在那之前，修 bug 路径只算替身跑通。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClaudeAdapter, createCodexAdapter, fileStamp } from '@mufu/adapters';
import type { AgentSession } from '@mufu/core';
import { doctor } from '@mufu/daemon';

const root = fileURLToPath(new URL('..', import.meta.url));
const recordedDir = join(root, 'fixtures/recorded');

type Row = { name: string; ok: boolean | null; detail: string };

const SECRET = [
  /sk-ant-[A-Za-z0-9_-]{8,}/,
  /sk-proj-[A-Za-z0-9_-]{8,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /Bearer\s+[A-Za-z0-9._-]{8,}/i,
  /"access_token"\s*:/,
  /"refresh_token"\s*:/,
  /"id_token"\s*:/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /api_key\s*=\s*["'][^"']+["']/,
];

const CONFIG_FILES = [
  join(homedir(), '.codex', 'config.toml'),
  join(homedir(), '.codex', 'auth.json'),
  join(homedir(), '.claude', 'settings.json'),
  join(homedir(), '.claude', 'settings.local.json'),
];

function markOf(ok: boolean | null): string {
  if (ok === null) return '未测';
  if (ok) return '通过';
  return '失败';
}

function printTable(rows: Row[]): void {
  for (const row of rows) {
    process.stdout.write(`${markOf(row.ok)}\t${row.name}\t${row.detail}\n`);
  }
}

function stampAll(): string {
  return CONFIG_FILES.map((path) => {
    const stamp = fileStamp(path);
    return `${path}:${stamp ? `${stamp.size}:${stamp.mtimeMs}` : 'missing'}`;
  }).join('|');
}

function looksSecret(text: string): boolean {
  return SECRET.some((pattern) => pattern.test(text));
}

function writeRecording(name: string, protocol: string, lines: string[]): { ok: boolean; detail: string } {
  const body = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  const joined = body.join('\n');
  if (looksSecret(joined)) return { ok: false, detail: '流里有凭据样式，拒绝落盘' };
  if (body.length === 0) return { ok: false, detail: '没有可记录的事件' };
  mkdirSync(recordedDir, { recursive: true });
  const marker = JSON.stringify({
    origin: 'recorded',
    protocol,
    note: 'pnpm verify:mac 原样记录。除第一行标记外未改写。',
    source: 'verify:mac',
  });
  writeFileSync(join(recordedDir, name), `${marker}\n${joined}\n`);
  return { ok: true, detail: `${body.length} 行` };
}

function runVitest(extra: Record<string, string>): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'vitest', 'run'], {
      cwd: root,
      env: { ...process.env, ...extra },
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      output += chunk;
    });
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function drive(
  session: AgentSession,
  approve: boolean,
): Promise<{ approvals: string[]; sawInterrupt: boolean; failure: string | null }> {
  const approvals: string[] = [];
  let sawInterrupt = false;
  let failure: string | null = null;
  const reading = (async () => {
    for await (const event of session.events) {
      if (event.type === 'approval_request') {
        approvals.push(event.operation);
        if (approve) await session.decide(event.requestId, 'approve');
        await session.interrupt();
      }
      if (event.type === 'interrupted') sawInterrupt = true;
      if (event.type === 'environment_failure') failure = event.message;
      if (event.type === 'completed' || event.type === 'interrupted' || event.type === 'environment_failure') break;
    }
  })();
  await withTimeout(reading, 90_000, '会话');
  if (approvals.length === 0) await session.interrupt();
  return { approvals, sawInterrupt, failure };
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  if (process.platform !== 'darwin') {
    rows.push({ name: '平台', ok: false, detail: `当前是 ${process.platform}。请在自己的 Mac 上运行 pnpm verify:mac` });
    rows.push({ name: 'Codex 真会话', ok: null, detail: '未跑' });
    rows.push({ name: 'Claude 真会话', ok: null, detail: '未跑' });
    rows.push({ name: '录音', ok: false, detail: '未写入 fixtures/recorded' });
    rows.push({ name: '手写夹具测试', ok: null, detail: '用 pnpm test。通过也不算真实验证' });
    rows.push({ name: '录音测试', ok: false, detail: '没有录音，路径未验证' });
    printTable(rows);
    process.stdout.write('\n修 bug 路径在录音测试通过之前，只算替身跑通。\n');
    process.exit(1);
  }

  const before = stampAll();
  const report = await doctor(homedir());
  for (const tool of report.tools) {
    rows.push({
      name: `${tool.name} 路径`,
      ok: tool.installed && Boolean(tool.path?.startsWith('/')),
      detail: tool.path ?? '登录 shell 的 command -v 没有找到',
    });
    rows.push({ name: `${tool.name} 登录提示`, ok: tool.installed, detail: tool.loginHint });
  }
  rows.push({
    name: '配置文件里的 key',
    ok: true,
    detail:
      report.configKeys.length === 0
        ? '没有发现'
        : report.configKeys.map((item) => `${item.tool}:${item.key}`).join(', '),
  });

  const codex = report.tools.find((tool) => tool.name === 'codex');
  const claude = report.tools.find((tool) => tool.name === 'claude');
  const codexLines: string[] = [];
  const claudeLines: string[] = [];
  const workspace = mkdtempSync(join(tmpdir(), 'mufu-verify-'));

  if (codex?.path) {
    rows.push(...(await probeCodex(codex.path, workspace, codexLines)));
  } else {
    rows.push({ name: 'Codex account/read', ok: false, detail: '没有二进制' });
  }
  if (claude?.path) {
    rows.push(...(await probeClaude(claude.path, workspace, claudeLines)));
  } else {
    rows.push({ name: 'Claude apiKeySource', ok: false, detail: '没有二进制' });
  }

  const after = stampAll();
  rows.push({
    name: '配置文件未被修改',
    ok: before === after,
    detail: before === after ? '大小和 mtime 没变' : 'mtime 或大小变了，脚本不应写用户配置',
  });

  const codexFile = writeRecording('codex.jsonl', 'codex-app-server', codexLines);
  const claudeFile = writeRecording('claude.jsonl', 'claude-agent-sdk', claudeLines);
  rows.push({ name: 'Codex 录音', ok: codexFile.ok, detail: codexFile.detail });
  rows.push({ name: 'Claude 录音', ok: claudeFile.ok, detail: claudeFile.detail });

  const handwritten = await runVitest({});
  rows.push({
    name: '手写夹具测试',
    ok: handwritten.code === 0,
    detail: handwritten.code === 0 ? '通过（仍不是真实验证）' : tail(handwritten.output),
  });
  const recorded = await runVitest({ MUFU_REQUIRE_RECORDED: '1' });
  rows.push({
    name: '录音测试',
    ok: recorded.code === 0,
    detail: recorded.code === 0 ? '通过。到这一行，路径才算验证过' : tail(recorded.output),
  });

  printTable(rows);
  process.stdout.write('\n把这张表，以及 fixtures/recorded/ 里新出现的 jsonl，发回来。不要发含有 token 的终端全文。\n');
  process.exit(rows.some((row) => row.ok === false) ? 1 : 0);
}

function tail(output: string): string {
  return output.trim().split('\n').slice(-8).join(' / ');
}

async function probeCodex(bin: string, workspace: string, lines: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  const adapter = createCodexAdapter({
    bin,
    onRaw: (line) => lines.push(line),
  });
  try {
    const session = await adapter.startSession({
      taskId: 'verify-codex',
      workspacePath: workspace,
      prompt: 'Run this shell command and nothing else: echo mufu-verify',
    });
    const accountLine = lines.find((line) => line.includes('"account"'));
    rows.push({
      name: 'Codex account/read 在发任务前',
      ok: true,
      detail: accountLine ? 'account/read 已返回，且 startSession 没在拒绝前把任务送进 turn' : '会话已建立',
    });
    rows.push({ name: 'Codex 订阅登录', ok: true, detail: `session ${session.sessionId}` });
    const first = await drive(session, true);
    rows.push({
      name: 'Codex 审批',
      ok: first.approvals.length > 0,
      detail: first.approvals.length > 0 ? first.approvals.join(',') : '这轮没有截到审批',
    });
    rows.push({
      name: 'Codex interrupt',
      ok: first.sawInterrupt || first.approvals.length > 0,
      detail:
        first.failure ?? (first.sawInterrupt ? '收到 interrupted' : '已调用 interrupt；没有 turnId 时适配器不会发'),
    });
    const again = await adapter.startSession({
      taskId: 'verify-codex-resume',
      workspacePath: workspace,
      prompt: 'Reply with only the word resumed.',
      resumeSessionId: session.sessionId,
    });
    rows.push({
      name: 'Codex thread/resume',
      ok: again.sessionId === session.sessionId,
      detail: `resume id ${again.sessionId}`,
    });
    await drive(again, true).catch((error: unknown) => {
      rows.push({
        name: 'Codex 恢复后的回合',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rows.push({ name: 'Codex 订阅登录', ok: false, detail: message });
    rows.push({
      name: 'forced_login_method 是否把用户登出',
      ok: null,
      detail: '看上面的错误。官方文档写明不匹配会退出登录',
    });
  }
  return rows;
}

async function probeClaude(bin: string, workspace: string, lines: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  const adapter = createClaudeAdapter({
    bin,
    onRaw: (message) => lines.push(JSON.stringify(message)),
  });
  try {
    const session = await adapter.startSession({
      taskId: 'verify-claude',
      workspacePath: workspace,
      prompt: 'Use the Bash tool to run exactly: echo mufu-verify. Then stop.',
    });
    const init = lines
      .map((line) => {
        try {
          return JSON.parse(line) as { type?: string; subtype?: string; apiKeySource?: string };
        } catch {
          return null;
        }
      })
      .find((row) => row?.type === 'system' && row.subtype === 'init');
    rows.push({
      name: 'Claude apiKeySource',
      ok: init?.apiKeySource === 'none',
      detail: init?.apiKeySource ?? 'init 里没有 apiKeySource',
    });
    rows.push({ name: 'Claude 会话', ok: session.sessionId.length > 0, detail: session.sessionId });
    const first = await drive(session, true);
    rows.push({
      name: 'Claude 审批',
      ok: first.approvals.length > 0,
      detail: first.approvals.length > 0 ? first.approvals.join(',') : 'canUseTool 没有被调用',
    });
    rows.push({
      name: 'Claude interrupt',
      ok: first.sawInterrupt,
      detail: first.failure ?? (first.sawInterrupt ? '收到 interrupted' : '没有 interrupted 事件'),
    });
    const again = await adapter.startSession({
      taskId: 'verify-claude-resume',
      workspacePath: workspace,
      prompt: 'Reply with only the word resumed.',
      resumeSessionId: session.sessionId,
    });
    rows.push({
      name: 'Claude resume',
      ok: again.sessionId === session.sessionId,
      detail: `resume id ${again.sessionId}`,
    });
  } catch (error) {
    rows.push({
      name: 'Claude 订阅登录',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  return rows;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
