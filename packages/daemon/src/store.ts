import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { DomainEvent } from '@mufu/core';

export class SqliteEventLog {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        task_id TEXT,
        type TEXT NOT NULL,
        at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);
  }

  append(event: { taskId: string | null; type: string; payload: Record<string, unknown> }): DomainEvent {
    const row: DomainEvent = {
      id: randomUUID(),
      taskId: event.taskId,
      at: new Date().toISOString(),
      type: event.type,
      payload: event.payload,
    };
    this.db
      .prepare('INSERT INTO events (id, task_id, type, at, payload) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.taskId, row.type, row.at, JSON.stringify(row.payload));
    return row;
  }

  readAll(): DomainEvent[] {
    const rows = this.db.prepare('SELECT id, task_id, type, at, payload FROM events ORDER BY seq ASC').all() as Array<{
      id: string;
      task_id: string | null;
      type: string;
      at: string;
      payload: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      type: row.type,
      at: row.at,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    }));
  }

  close(): void {
    this.db.close();
  }
}
