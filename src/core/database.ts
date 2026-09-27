import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WorkspaceError } from './errors';

const migrations = [
  `CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE TABLE workspace_items (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('application', 'file', 'folder', 'url')),
    name TEXT NOT NULL,
    target TEXT NOT NULL,
    arguments_json TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    launch_order INTEGER NOT NULL CHECK(launch_order >= 0)
  );
  CREATE INDEX workspace_items_order ON workspace_items(workspace_id, launch_order, id);`,
];

export function transaction<T>(database: DatabaseSync, action: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(dataDirectory: string): DatabaseSync {
  mkdirSync(dataDirectory, { recursive: true });
  const database = new DatabaseSync(join(dataDirectory, 'contextdock.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    transaction(database, () => {
      const row = database.prepare('PRAGMA user_version').get();
      const version = Number(row?.user_version ?? 0);
      if (version > migrations.length) {
        throw new WorkspaceError(
          'This database was created by a newer ContextDock version. Please update the application.',
          'STORAGE',
        );
      }
      for (let index = version; index < migrations.length; index += 1) {
        database.exec(migrations[index]);
        database.exec(`PRAGMA user_version = ${index + 1}`);
      }
    });
    database.exec('PRAGMA journal_mode = WAL;');
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
