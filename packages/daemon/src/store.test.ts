import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { EVENT_SCHEMA_VERSION, LEAD_PIN_AUTHOR, foldTasks } from '@mufu/core';

import { SqliteEventLog } from './store.ts';

describe('event log', () => {
  it('只追加，并带上事件版本', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-log-'));
    const file = join(dir, 'events.sqlite');
    try {
      const log = new SqliteEventLog(file);
      const row = log.append({ taskId: 't1', type: 'task.created', payload: { title: 'a' } });
      expect(row.schemaVersion).toBe(EVENT_SCHEMA_VERSION);
      const again = new SqliteEventLog(file);
      expect(again.readAll()).toEqual([row]);
      again.close();
      log.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('旧库没有版本列时补上，读出来仍是版本 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-log-old-'));
    const file = join(dir, 'events.sqlite');
    try {
      const db = new DatabaseSync(file);
      db.exec(`
        CREATE TABLE events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          task_id TEXT,
          type TEXT NOT NULL,
          at TEXT NOT NULL,
          payload TEXT NOT NULL
        );
      `);
      db.prepare('INSERT INTO events (id, task_id, type, at, payload) VALUES (?, ?, ?, ?, ?)').run(
        'old',
        't1',
        'task.status',
        '2026-10-10T00:00:00.000Z',
        '{"status":"running"}',
      );
      db.close();
      const log = new SqliteEventLog(file);
      const [row] = log.readAll();
      expect(row?.schemaVersion).toBe(EVENT_SCHEMA_VERSION);
      expect(row?.type).toBe('task.status');
      log.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('重放日志后重点仍指向原来的消息事件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mufu-log-pin-'));
    const file = join(dir, 'events.sqlite');
    try {
      const log = new SqliteEventLog(file);
      log.append({
        taskId: 't1',
        type: 'task.created',
        payload: {
          seq: 1,
          title: '空列表崩了',
          prompt: '修',
          workflow: {
            id: 'fix-bug',
            title: '修 bug',
            doneWhen: 'pr_merged',
            stages: [{ id: 'fix', title: '修复' }],
          },
        },
      });
      const message = log.append({
        taskId: 't1',
        type: 'agent.message',
        payload: { role: 'agent', author: 'codex', text: '已修复' },
      });
      log.append({
        taskId: 't1',
        type: 'pin.added',
        payload: {
          pinId: 'pin-1',
          message: '阶段完成：修复',
          reason: '阶段完成：修复',
          author: LEAD_PIN_AUTHOR,
          stageId: 'fix',
          messageId: message.id,
        },
      });
      log.close();
      const replay = new SqliteEventLog(file);
      const events = replay.readAll();
      const first = foldTasks(events);
      const second = foldTasks(events);
      const pinned = first[0]?.messages.find((item) => item.text === '已修复');
      expect(pinned?.id).toBe(message.id);
      expect(first[0]?.pins[0]?.messageId).toBe(message.id);
      expect(second[0]?.pins[0]?.messageId).toBe(message.id);
      expect(message.id).not.toBe('1');
      expect(message.id).not.toBe('2');
      replay.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
