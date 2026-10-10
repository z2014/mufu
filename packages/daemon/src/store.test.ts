import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { EVENT_SCHEMA_VERSION } from '@mufu/core';

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
});
