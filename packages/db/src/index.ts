import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { migrations } from "./migrations.ts";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type DatabaseSyncType = import("node:sqlite").DatabaseSync;

export type SqliteDatabase = ReturnType<typeof createSqliteConnection>;

export function createSqliteConnection(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "exports"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "tmp"), { recursive: true });

  const dbPath = path.join(dataDir, "app.db");
  const sqlite = new DatabaseSync(dbPath);

  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  return {
    sqlite,
    dbPath
  };
}

export function migrateSqlite(sqlite: DatabaseSyncType): string[] {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS migration_state (
      version TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    sqlite
      .prepare("SELECT version FROM migration_state")
      .all()
      .map((row: unknown) => String((row as { version: string }).version))
  );

  const appliedNow: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }

    try {
      sqlite.exec("BEGIN");
      sqlite.exec(migration.sql);
      sqlite
        .prepare("INSERT INTO migration_state (version, applied_at) VALUES (?, ?)")
        .run(migration.version, new Date().toISOString());
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }

    appliedNow.push(migration.version);
  }

  return appliedNow;
}

export * from "./schema.ts";
