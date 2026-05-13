import type { DatabaseSync } from "node:sqlite";

import type { z } from "zod";

import {
  registerSchema,
  userRoleSchema,
  userStatusSchema,
  userUpdateSchema,
} from "../../../../packages/shared/src/index.ts";
import { createId, nowIso } from "../lib/utils.ts";
import { hashCredential } from "../security/crypto.ts";

type UserRole = z.infer<typeof userRoleSchema>;
type UserStatus = z.infer<typeof userStatusSchema>;

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  approvedAt: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  allowedProviderIds: string[];
  allowedModelAliasIds: string[];
  allProvidersAllowed: boolean;
  allModelsAllowed: boolean;
  activeApiKeyCount: number;
  totalApiKeyCount: number;
}

export interface GatewayUserScope {
  allowedProviderIds: string[] | null;
  allowedModelAliasIds: string[] | null;
}

type ScopeField = "allowedProviderIds" | "allowedModelAliasIds";

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  role: UserRole;
  status: UserStatus;
  approved_at: string | null;
  approved_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  active_api_key_count: number | null;
  total_api_key_count: number | null;
}

export class UserScopeValidationError extends Error {
  field: ScopeField;
  missingIds: string[];

  constructor(field: ScopeField, missingIds: string[]) {
    super(`Invalid ${field}: ${missingIds.join(", ")}`);
    this.name = "UserScopeValidationError";
    this.field = field;
    this.missingIds = missingIds;
  }
}

function buildInClause(values: string[]): string {
  return values.map(() => "?").join(", ");
}

function loadScopeMap(
  sqlite: DatabaseSync,
  tableName: "user_provider_scopes" | "user_model_scopes",
  valueColumn: "provider_id" | "model_alias_id",
  userIds: string[]
): Map<string, string[]> {
  const scopeMap = new Map<string, string[]>();
  if (userIds.length === 0) {
    return scopeMap;
  }

  const rows = sqlite
    .prepare(
      `
        SELECT user_id, ${valueColumn} AS scope_id
        FROM ${tableName}
        WHERE user_id IN (${buildInClause(userIds)})
        ORDER BY user_id ASC, ${valueColumn} ASC
      `
    )
    .all(...userIds) as Array<{ user_id: string; scope_id: string }>;

  for (const row of rows) {
    const ids = scopeMap.get(row.user_id) ?? [];
    ids.push(row.scope_id);
    scopeMap.set(row.user_id, ids);
  }

  return scopeMap;
}

function assertScopeTargetsExist(
  sqlite: DatabaseSync,
  field: ScopeField,
  tableName: "providers" | "model_aliases",
  ids: string[]
): void {
  if (ids.length === 0) {
    return;
  }

  const rows = sqlite
    .prepare(
      `
        SELECT id
        FROM ${tableName}
        WHERE id IN (${buildInClause(ids)})
      `
    )
    .all(...ids) as Array<{ id: string }>;

  const existingIds = new Set(rows.map((row) => row.id));
  const missingIds = ids.filter((id) => !existingIds.has(id));
  if (missingIds.length > 0) {
    throw new UserScopeValidationError(field, missingIds);
  }
}

function validateScopes(
  sqlite: DatabaseSync,
  providerIds: string[] | undefined,
  modelAliasIds: string[] | undefined
): void {
  if (providerIds) {
    assertScopeTargetsExist(sqlite, "allowedProviderIds", "providers", providerIds);
  }

  if (modelAliasIds) {
    assertScopeTargetsExist(sqlite, "allowedModelAliasIds", "model_aliases", modelAliasIds);
  }
}

function getScopeTargetCounts(sqlite: DatabaseSync): {
  providerCount: number;
  modelCount: number;
} {
  const providerRow = sqlite
    .prepare("SELECT COUNT(*) AS count FROM providers")
    .get() as { count: number };
  const modelRow = sqlite
    .prepare("SELECT COUNT(*) AS count FROM model_aliases")
    .get() as { count: number };

  return {
    providerCount: Number(providerRow.count ?? 0),
    modelCount: Number(modelRow.count ?? 0)
  };
}

function replaceProviderScopes(sqlite: DatabaseSync, userId: string, providerIds: string[]): void {
  sqlite.prepare("DELETE FROM user_provider_scopes WHERE user_id = ?").run(userId);
  if (providerIds.length === 0) {
    return;
  }

  const insert = sqlite.prepare(
    "INSERT INTO user_provider_scopes (user_id, provider_id, created_at) VALUES (?, ?, ?)"
  );
  const createdAt = nowIso();
  for (const providerId of providerIds) {
    insert.run(userId, providerId, createdAt);
  }
}

function replaceModelScopes(sqlite: DatabaseSync, userId: string, modelAliasIds: string[]): void {
  sqlite.prepare("DELETE FROM user_model_scopes WHERE user_id = ?").run(userId);
  if (modelAliasIds.length === 0) {
    return;
  }

  const insert = sqlite.prepare(
    "INSERT INTO user_model_scopes (user_id, model_alias_id, created_at) VALUES (?, ?, ?)"
  );
  const createdAt = nowIso();
  for (const modelAliasId of modelAliasIds) {
    insert.run(userId, modelAliasId, createdAt);
  }
}

function toUserRecord(
  row: UserRow,
  providerScopeIds: string[] = [],
  modelScopeIds: string[] = [],
  scopeTargetCounts: { providerCount: number; modelCount: number } = {
    providerCount: 0,
    modelCount: 0
  }
): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? row.username,
    role: row.role,
    status: row.status,
    approvedAt: row.approved_at,
    approvedByUserId: row.approved_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    allowedProviderIds: providerScopeIds,
    allowedModelAliasIds: modelScopeIds,
    allProvidersAllowed:
      scopeTargetCounts.providerCount > 0 && providerScopeIds.length === scopeTargetCounts.providerCount,
    allModelsAllowed:
      scopeTargetCounts.modelCount > 0 && modelScopeIds.length === scopeTargetCounts.modelCount,
    activeApiKeyCount: Number(row.active_api_key_count ?? 0),
    totalApiKeyCount: Number(row.total_api_key_count ?? 0)
  };
}

function queryUserRows(sqlite: DatabaseSync, userId?: string): UserRow[] {
  const where = userId ? "WHERE admin_users.id = ?" : "";
  const params = userId ? [userId] : [];

  return sqlite
    .prepare(
      `
        SELECT
          admin_users.id,
          admin_users.username,
          admin_users.display_name,
          admin_users.role,
          admin_users.status,
          admin_users.approved_at,
          admin_users.approved_by_user_id,
          admin_users.created_at,
          admin_users.updated_at,
          SUM(CASE WHEN api_keys.enabled = 1 AND api_keys.deleted_at IS NULL THEN 1 ELSE 0 END)
            AS active_api_key_count,
          COUNT(api_keys.id) AS total_api_key_count
        FROM admin_users
        LEFT JOIN api_keys ON api_keys.owner_user_id = admin_users.id
        ${where}
        GROUP BY admin_users.id
        ORDER BY admin_users.created_at ASC
      `
    )
    .all(...params) as unknown as UserRow[];
}

export function listUsers(sqlite: DatabaseSync): UserRecord[] {
  const rows = queryUserRows(sqlite);
  const userIds = rows.map((row) => row.id);
  const providerScopes = loadScopeMap(sqlite, "user_provider_scopes", "provider_id", userIds);
  const modelScopes = loadScopeMap(sqlite, "user_model_scopes", "model_alias_id", userIds);
  const scopeTargetCounts = getScopeTargetCounts(sqlite);

  return rows.map((row) =>
    toUserRecord(
      row,
      providerScopes.get(row.id) ?? [],
      modelScopes.get(row.id) ?? [],
      scopeTargetCounts
    )
  );
}

export function getUserById(sqlite: DatabaseSync, userId: string): UserRecord | null {
  const row = queryUserRows(sqlite, userId)[0];
  if (!row) {
    return null;
  }

  const providerScopes = loadScopeMap(sqlite, "user_provider_scopes", "provider_id", [userId]);
  const modelScopes = loadScopeMap(sqlite, "user_model_scopes", "model_alias_id", [userId]);
  return toUserRecord(
    row,
    providerScopes.get(userId) ?? [],
    modelScopes.get(userId) ?? [],
    getScopeTargetCounts(sqlite)
  );
}

export async function registerPendingUser(
  sqlite: DatabaseSync,
  input: z.infer<typeof registerSchema>
): Promise<UserRecord> {
  const id = createId();
  const timestamp = nowIso();
  const passwordHash = await hashCredential(input.password);

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
      id,
      input.username,
      passwordHash,
      "user",
      "pending",
      input.username,
      null,
      null,
      timestamp,
      timestamp
    );

  const user = getUserById(sqlite, id);
  if (!user) {
    throw new Error("User was registered but could not be loaded");
  }
  return user;
}

export function updateUser(
  sqlite: DatabaseSync,
  userId: string,
  input: z.infer<typeof userUpdateSchema>,
  approverUserId?: string
): UserRecord | null {
  const current = getUserById(sqlite, userId);
  if (!current) {
    return null;
  }

  validateScopes(sqlite, input.allowedProviderIds, input.allowedModelAliasIds);

  const nextStatus = input.status ?? current.status;
  const now = nowIso();
  const approvedAt =
    nextStatus === "approved" && current.status !== "approved" ? now : current.approvedAt;
  const approvedByUserId =
    nextStatus === "approved" && current.status !== "approved"
      ? (approverUserId ?? current.approvedByUserId)
      : current.approvedByUserId;

  try {
    sqlite.exec("BEGIN");
    sqlite
      .prepare(
        `
          UPDATE admin_users
          SET
            display_name = ?,
            status = ?,
            approved_at = ?,
            approved_by_user_id = ?,
            updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        input.displayName ?? current.displayName,
        nextStatus,
        approvedAt,
        approvedByUserId,
        now,
        userId
      );

    if (input.allowedProviderIds) {
      replaceProviderScopes(sqlite, userId, input.allowedProviderIds);
    }

    if (input.allowedModelAliasIds) {
      replaceModelScopes(sqlite, userId, input.allowedModelAliasIds);
    }

    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  return getUserById(sqlite, userId);
}

export function getUserGatewayScope(sqlite: DatabaseSync, userId: string): GatewayUserScope | null {
  const user = getUserById(sqlite, userId);
  if (!user || user.status !== "approved") {
    return null;
  }

  if (user.role === "admin") {
    return {
      allowedProviderIds: null,
      allowedModelAliasIds: null
    };
  }

  return {
    allowedProviderIds: user.allowedProviderIds,
    allowedModelAliasIds: user.allowedModelAliasIds
  };
}

export function getFirstAdminUserId(sqlite: DatabaseSync): string | null {
  const row = sqlite
    .prepare(
      `
        SELECT id
        FROM admin_users
        WHERE role = 'admin'
        ORDER BY created_at ASC
        LIMIT 1
      `
    )
    .get() as { id: string } | undefined;

  return row?.id ?? null;
}

export function getUserCounts(sqlite: DatabaseSync): {
  activeUserCount: number;
  totalUserCount: number;
  pendingUserCount: number;
} {
  const row = sqlite
    .prepare(
      `
        SELECT
          COUNT(*) AS total_count,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS active_count,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count
        FROM admin_users
        WHERE role = 'user'
      `
    )
    .get() as {
    total_count: number;
    active_count: number | null;
    pending_count: number | null;
  };

  return {
    activeUserCount: Number(row.active_count ?? 0),
    totalUserCount: Number(row.total_count ?? 0),
    pendingUserCount: Number(row.pending_count ?? 0)
  };
}
