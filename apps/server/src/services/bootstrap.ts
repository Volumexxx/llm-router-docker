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
  if (!config.bootstrapGatewayApiKey) {
    missing.push("BOOTSTRAP_GATEWAY_API_KEY");
  }

  if (missing.length > 0) {
    throw new Error(
      `Database is not initialized. Missing bootstrap environment variables: ${missing.join(", ")}`
    );
  }

  const timestamp = nowIso();
  const passwordHash = await hashCredential(config.bootstrapAdminPassword!);
  const gatewayApiKeyHash = await hashCredential(config.bootstrapGatewayApiKey!);

  try {
    sqlite.exec("BEGIN");
    sqlite
      .prepare(
        `
          INSERT INTO admin_users (id, username, password_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(createId(), config.bootstrapAdminUsername, passwordHash, timestamp, timestamp);

    setSetting(sqlite, "gateway_api_key_hash", gatewayApiKeyHash);
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
