import type { DatabaseSync } from "node:sqlite";

import { nowIso } from "../lib/utils.ts";

export function getSetting(sqlite: DatabaseSync, key: string): string | null {
  const row = sqlite
    .prepare("SELECT value FROM system_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;

  return row?.value ?? null;
}

export function setSetting(sqlite: DatabaseSync, key: string, value: string): void {
  sqlite
    .prepare(
      `
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
    )
    .run(key, value, nowIso());
}

export function hasInitializationState(sqlite: DatabaseSync): boolean {
  const adminCount = sqlite
    .prepare("SELECT COUNT(*) AS count FROM admin_users")
    .get() as { count: number };

  return adminCount.count > 0;
}
