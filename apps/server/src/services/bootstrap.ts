import type { DatabaseSync } from "node:sqlite";

import type { RuntimeConfig } from "../config.ts";
import { hashCredential } from "../security/crypto.ts";
import { createId, nowIso } from "../lib/utils.ts";
import { hasInitializationState, setSetting } from "./settings.ts";

export async function bootstrapIfNeeded(sqlite: DatabaseSync, config: RuntimeConfig): Promise<void> {
  if (hasInitializationState(sqlite)) {
    return;
  }

  const missing: string[] = [];

  if (!config.bootstrapAdminUsername) {
    missing.push("BOOTSTRAP_ADMIN_USERNAME");
  }
  if (!config.bootstrapAdminPassword) {
    missing.push("BOOTSTRAP_ADMIN_PASSWORD");
  }

  if (missing.length > 0) {
    throw new Error(
      `Database is not initialized. Missing bootstrap environment variables: ${missing.join(", ")}`
    );
  }

  const timestamp = nowIso();
  const passwordHash = await hashCredential(config.bootstrapAdminPassword!);

  try {
    sqlite.exec("BEGIN");
    sqlite
      .prepare(
        `
          INSERT INTO admin_users (
            id,
            username,
            password_hash,
            role,
            status,
            display_name,
            approved_at,
            approved_by_user_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        createId(),
        config.bootstrapAdminUsername,
        passwordHash,
        "admin",
        "approved",
        config.bootstrapAdminUsername,
        timestamp,
        null,
        timestamp,
        timestamp
      );

    setSetting(sqlite, "initialized_at", timestamp);
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

export function resetRuntimePrioritiesToDefault(sqlite: DatabaseSync): void {
  sqlite
    .prepare(
      `
        UPDATE model_bindings
        SET runtime_priority = default_priority,
            updated_at = ?
      `
    )
    .run(nowIso());
}
