import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { z } from "zod";

import {
  apiKeyCreateSchema,
  apiKeyUpdateSchema,
  maskSecret,
  selfApiKeyCreateSchema,
  selfApiKeyUpdateSchema
} from "../../../../packages/shared/src/index.ts";
import { createId, nowIso } from "../lib/utils.ts";
import { decryptSecret, encryptSecret, hashCredential, hashOpaqueToken, verifyCredential } from "../security/crypto.ts";

export interface ApiKeyRecord {
  id: string;
  name: string;
  maskedPreview: string;
  enabled: boolean;
  deletedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerUserId: string | null;
  createdByUserId: string | null;
  plaintextAvailable: boolean;
  allowedProviderIds: string[];
  allowedModelAliasIds: string[];
  allProvidersAllowed: boolean;
  allModelsAllowed: boolean;
}

export interface AuthenticatedApiKey {
  id: string;
  name: string;
  maskedPreview: string;
  userId: string;
  userDisplayName: string;
  allowedProviderIds: string[] | null;
  allowedModelAliasIds: string[] | null;
}

export interface ApiKeyAuthenticationResult {
  kind: "matched" | "invalid" | "no_active_keys";
  apiKey: AuthenticatedApiKey | null;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  lookup_hash: string | null;
  key_encrypted: string | null;
  owner_user_id: string | null;
  created_by_user_id: string | null;
  masked_preview: string;
  enabled: number;
  deleted_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UserAuthRow {
  id: string;
  username: string;
  display_name: string | null;
  role: "admin" | "user";
  status: "pending" | "approved" | "rejected" | "disabled";
}

type ScopeField = "allowedProviderIds" | "allowedModelAliasIds";

export class ApiKeyScopeValidationError extends Error {
  field: ScopeField;
  missingIds: string[];

  constructor(field: ScopeField, missingIds: string[]) {
    super(`Invalid ${field}: ${missingIds.join(", ")}`);
    this.name = "ApiKeyScopeValidationError";
    this.field = field;
    this.missingIds = missingIds;
  }
}

export class ApiKeyPlaintextUnavailableError extends Error {
  constructor() {
    super("API key plaintext is unavailable for this legacy key");
    this.name = "ApiKeyPlaintextUnavailableError";
  }
}

function buildApiKeyPlaintext(id: string): string {
  return `lrk_${id}_${randomBytes(32).toString("base64url")}`;
}

function extractApiKeyId(value: string): string | null {
  const match = /^lrk_([0-9a-fA-F-]{36})_[A-Za-z0-9\-_]+$/.exec(value.trim());
  return match?.[1] ?? null;
}

function buildInClause(values: string[]): string {
  return values.map(() => "?").join(", ");
}

function loadScopeMap(
  sqlite: DatabaseSync,
  tableName: "api_key_provider_scopes" | "api_key_model_scopes",
  valueColumn: "provider_id" | "model_alias_id",
  apiKeyIds: string[]
): Map<string, string[]> {
  const scopeMap = new Map<string, string[]>();
  if (apiKeyIds.length === 0) {
    return scopeMap;
  }

  const rows = sqlite
    .prepare(
      `
        SELECT api_key_id, ${valueColumn} AS scope_id
        FROM ${tableName}
        WHERE api_key_id IN (${buildInClause(apiKeyIds)})
        ORDER BY api_key_id ASC, ${valueColumn} ASC
      `
    )
    .all(...apiKeyIds) as Array<{ api_key_id: string; scope_id: string }>;

  for (const row of rows) {
    const scopeIds = scopeMap.get(row.api_key_id) ?? [];
    scopeIds.push(row.scope_id);
    scopeMap.set(row.api_key_id, scopeIds);
  }

  return scopeMap;
}

function loadUserScopeIds(
  sqlite: DatabaseSync,
  tableName: "user_provider_scopes" | "user_model_scopes",
  valueColumn: "provider_id" | "model_alias_id",
  userId: string
): string[] {
  const rows = sqlite
    .prepare(
      `
        SELECT ${valueColumn} AS scope_id
        FROM ${tableName}
        WHERE user_id = ?
        ORDER BY ${valueColumn} ASC
      `
    )
    .all(userId) as Array<{ scope_id: string }>;

  return rows.map((row) => row.scope_id);
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
    throw new ApiKeyScopeValidationError(field, missingIds);
  }
}

function replaceProviderScopes(sqlite: DatabaseSync, apiKeyId: string, providerIds: string[]): void {
  sqlite.prepare("DELETE FROM api_key_provider_scopes WHERE api_key_id = ?").run(apiKeyId);
  if (providerIds.length === 0) {
    return;
  }

  const insert = sqlite.prepare(
    "INSERT INTO api_key_provider_scopes (api_key_id, provider_id, created_at) VALUES (?, ?, ?)"
  );
  const createdAt = nowIso();
  for (const providerId of providerIds) {
    insert.run(apiKeyId, providerId, createdAt);
  }
}

function replaceModelScopes(sqlite: DatabaseSync, apiKeyId: string, modelAliasIds: string[]): void {
  sqlite.prepare("DELETE FROM api_key_model_scopes WHERE api_key_id = ?").run(apiKeyId);
  if (modelAliasIds.length === 0) {
    return;
  }

  const insert = sqlite.prepare(
    "INSERT INTO api_key_model_scopes (api_key_id, model_alias_id, created_at) VALUES (?, ?, ?)"
  );
  const createdAt = nowIso();
  for (const modelAliasId of modelAliasIds) {
    insert.run(apiKeyId, modelAliasId, createdAt);
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

function getApiKeyRow(
  sqlite: DatabaseSync,
  apiKeyId: string,
  includeDeleted = false,
  ownerUserId?: string
): ApiKeyRow | undefined {
  const whereDeleted = includeDeleted ? "" : "AND deleted_at IS NULL";
  const whereOwner = ownerUserId ? "AND owner_user_id = ?" : "";
  const params = ownerUserId ? [apiKeyId, ownerUserId] : [apiKeyId];

  return sqlite
    .prepare(
      `
        SELECT *
        FROM api_keys
        WHERE id = ?
          ${whereDeleted}
          ${whereOwner}
        LIMIT 1
      `
    )
    .get(...params) as ApiKeyRow | undefined;
}

function toApiKeyRecord(
  row: ApiKeyRow | undefined,
  providerScopeIds: string[] = [],
  modelScopeIds: string[] = []
): ApiKeyRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    maskedPreview: row.masked_preview,
    enabled: Boolean(row.enabled),
    deletedAt: row.deleted_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerUserId: row.owner_user_id,
    createdByUserId: row.created_by_user_id,
    plaintextAvailable: Boolean(row.key_encrypted),
    allowedProviderIds: providerScopeIds,
    allowedModelAliasIds: modelScopeIds,
    allProvidersAllowed: providerScopeIds.length === 0,
    allModelsAllowed: modelScopeIds.length === 0
  };
}

function loadApiKeyRecord(
  sqlite: DatabaseSync,
  apiKeyId: string,
  includeDeleted = false,
  ownerUserId?: string
): ApiKeyRecord | null {
  const row = getApiKeyRow(sqlite, apiKeyId, includeDeleted, ownerUserId);
  if (!row) {
    return null;
  }

  const providerScopeMap = loadScopeMap(sqlite, "api_key_provider_scopes", "provider_id", [row.id]);
  const modelScopeMap = loadScopeMap(sqlite, "api_key_model_scopes", "model_alias_id", [row.id]);
  return toApiKeyRecord(row, providerScopeMap.get(row.id) ?? [], modelScopeMap.get(row.id) ?? []);
}

export function listApiKeys(
  sqlite: DatabaseSync,
  includeDeleted = false,
  options: { ownerUserId?: string } = {}
): ApiKeyRecord[] {
  const clauses: string[] = [];
  const params: string[] = [];

  if (!includeDeleted) {
    clauses.push("deleted_at IS NULL");
  }
  if (options.ownerUserId) {
    clauses.push("owner_user_id = ?");
    params.push(options.ownerUserId);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = sqlite
    .prepare(
      `
        SELECT *
        FROM api_keys
        ${where}
        ORDER BY created_at DESC
      `
    )
    .all(...params) as unknown as ApiKeyRow[];

  const apiKeyIds = rows.map((row) => row.id);
  const providerScopeMap = loadScopeMap(sqlite, "api_key_provider_scopes", "provider_id", apiKeyIds);
  const modelScopeMap = loadScopeMap(sqlite, "api_key_model_scopes", "model_alias_id", apiKeyIds);

  return rows
    .map((row) =>
      toApiKeyRecord(row, providerScopeMap.get(row.id) ?? [], modelScopeMap.get(row.id) ?? [])
    )
    .filter((row): row is ApiKeyRecord => Boolean(row));
}

export async function createApiKey(
  sqlite: DatabaseSync,
  input: z.infer<typeof apiKeyCreateSchema> | z.infer<typeof selfApiKeyCreateSchema>,
  options: {
    ownerUserId?: string | null;
    createdByUserId?: string | null;
    plaintext?: string;
    encryptionKey?: string;
  } = {}
): Promise<{ item: ApiKeyRecord; createdKeyPlaintext: string }> {
  const allowedProviderIds = "allowedProviderIds" in input ? input.allowedProviderIds : [];
  const allowedModelAliasIds = "allowedModelAliasIds" in input ? input.allowedModelAliasIds : [];
  validateScopes(sqlite, allowedProviderIds, allowedModelAliasIds);

  const id = createId();
  const plaintext = options.plaintext ?? buildApiKeyPlaintext(id);
  const keyHash = await hashCredential(plaintext);
  const timestamp = nowIso();
  const maskedPreview = maskSecret(plaintext) ?? "***";
  const keyEncrypted = options.encryptionKey
    ? encryptSecret(plaintext, options.encryptionKey)
    : null;

  try {
    sqlite.exec("BEGIN");
    sqlite
      .prepare(
        `
          INSERT INTO api_keys (
            id,
            name,
            key_hash,
            lookup_hash,
            key_encrypted,
            owner_user_id,
            created_by_user_id,
            masked_preview,
            enabled,
            deleted_at,
            last_used_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        input.name,
        keyHash,
        hashOpaqueToken(plaintext),
        keyEncrypted,
        options.ownerUserId ?? null,
        options.createdByUserId ?? null,
        maskedPreview,
        1,
        null,
        null,
        timestamp,
        timestamp
      );

    replaceProviderScopes(sqlite, id, allowedProviderIds);
    replaceModelScopes(sqlite, id, allowedModelAliasIds);
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  const item = loadApiKeyRecord(sqlite, id);
  if (!item) {
    throw new Error("API key was created but could not be loaded");
  }

  return {
    item,
    createdKeyPlaintext: plaintext
  };
}

export function updateApiKey(
  sqlite: DatabaseSync,
  apiKeyId: string,
  input: z.infer<typeof apiKeyUpdateSchema> | z.infer<typeof selfApiKeyUpdateSchema>,
  options: { ownerUserId?: string } = {}
): ApiKeyRecord | null {
  const current = loadApiKeyRecord(sqlite, apiKeyId, false, options.ownerUserId);
  if (!current) {
    return null;
  }

  const allowedProviderIds =
    "allowedProviderIds" in input ? input.allowedProviderIds : undefined;
  const allowedModelAliasIds =
    "allowedModelAliasIds" in input ? input.allowedModelAliasIds : undefined;
  const name = "name" in input ? input.name : undefined;

  validateScopes(sqlite, allowedProviderIds, allowedModelAliasIds);

  try {
    sqlite.exec("BEGIN");
    const ownerWhere = options.ownerUserId ? "AND owner_user_id = ?" : "";
    const params = options.ownerUserId
      ? [
          name ?? current.name,
          (input.enabled ?? current.enabled) ? 1 : 0,
          nowIso(),
          apiKeyId,
          options.ownerUserId
        ]
      : [name ?? current.name, (input.enabled ?? current.enabled) ? 1 : 0, nowIso(), apiKeyId];
    sqlite
      .prepare(
        `
          UPDATE api_keys
          SET name = ?,
              enabled = ?,
              updated_at = ?
          WHERE id = ?
            AND deleted_at IS NULL
            ${ownerWhere}
        `
      )
      .run(...params);

    if (allowedProviderIds) {
      replaceProviderScopes(sqlite, apiKeyId, allowedProviderIds);
    }
    if (allowedModelAliasIds) {
      replaceModelScopes(sqlite, apiKeyId, allowedModelAliasIds);
    }

    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  return loadApiKeyRecord(sqlite, apiKeyId, false, options.ownerUserId);
}

export function deleteApiKey(
  sqlite: DatabaseSync,
  apiKeyId: string,
  ownerUserId?: string
): boolean {
  const timestamp = nowIso();
  const ownerWhere = ownerUserId ? "AND owner_user_id = ?" : "";
  const params = ownerUserId
    ? [timestamp, timestamp, apiKeyId, ownerUserId]
    : [timestamp, timestamp, apiKeyId];
  const result = sqlite
    .prepare(
      `
        UPDATE api_keys
        SET enabled = 0,
            deleted_at = ?,
            updated_at = ?
        WHERE id = ?
          AND deleted_at IS NULL
          ${ownerWhere}
      `
    )
    .run(...params);

  return result.changes > 0;
}

export function getApiKeyCounts(
  sqlite: DatabaseSync,
  ownerUserId?: string
): {
  activeApiKeyCount: number;
  totalApiKeyCount: number;
} {
  const whereOwner = ownerUserId ? "WHERE owner_user_id = ?" : "";
  const row = sqlite
    .prepare(
      `
        SELECT
          COUNT(*) AS total_count,
          SUM(CASE WHEN enabled = 1 AND deleted_at IS NULL THEN 1 ELSE 0 END) AS active_count
        FROM api_keys
        ${whereOwner}
      `
    )
    .get(...(ownerUserId ? [ownerUserId] : [])) as {
    total_count: number;
    active_count: number | null;
  };

  return {
    activeApiKeyCount: Number(row.active_count ?? 0),
    totalApiKeyCount: Number(row.total_count ?? 0)
  };
}

function findActiveApiKeyRow(sqlite: DatabaseSync, plaintext: string): ApiKeyRow | undefined {
  const lookupHash = hashOpaqueToken(plaintext);
  const byLookupHash = sqlite
    .prepare(
      `
        SELECT *
        FROM api_keys
        WHERE lookup_hash = ?
          AND enabled = 1
          AND deleted_at IS NULL
        LIMIT 1
      `
    )
    .get(lookupHash) as ApiKeyRow | undefined;

  if (byLookupHash) {
    return byLookupHash;
  }

  const apiKeyId = extractApiKeyId(plaintext);
  if (!apiKeyId) {
    return undefined;
  }

  return sqlite
    .prepare(
      `
        SELECT *
        FROM api_keys
        WHERE id = ?
          AND enabled = 1
          AND deleted_at IS NULL
        LIMIT 1
      `
    )
    .get(apiKeyId) as ApiKeyRow | undefined;
}

function loadUserForApiKey(sqlite: DatabaseSync, userId: string | null): UserAuthRow | null {
  if (!userId) {
    return null;
  }

  const row = sqlite
    .prepare(
      `
        SELECT id, username, display_name, role, status
        FROM admin_users
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(userId) as UserAuthRow | undefined;

  return row ?? null;
}

function normalizeScope(ids: string[]): string[] | null {
  return ids.length > 0 ? ids : null;
}

function intersectScopes(left: string[] | null, right: string[] | null): string[] | null {
  if (left == null) {
    return right;
  }
  if (right == null) {
    return left;
  }

  const rightSet = new Set(right);
  return left.filter((id) => rightSet.has(id));
}

export async function authenticateApiKey(
  sqlite: DatabaseSync,
  plaintext: string
): Promise<ApiKeyAuthenticationResult> {
  const counts = getApiKeyCounts(sqlite);
  if (counts.activeApiKeyCount === 0) {
    return {
      kind: "no_active_keys",
      apiKey: null
    };
  }

  const row = findActiveApiKeyRow(sqlite, plaintext);
  if (!row) {
    return {
      kind: "invalid",
      apiKey: null
    };
  }

  const verified = await verifyCredential(row.key_hash, plaintext);
  if (!verified) {
    return {
      kind: "invalid",
      apiKey: null
    };
  }

  const owner = loadUserForApiKey(sqlite, row.owner_user_id);
  if (!owner || owner.status !== "approved") {
    return {
      kind: "invalid",
      apiKey: null
    };
  }

  const apiKeyProviderScope =
    normalizeScope(
      loadScopeMap(sqlite, "api_key_provider_scopes", "provider_id", [row.id]).get(row.id) ?? []
    );
  const apiKeyModelScope =
    normalizeScope(
      loadScopeMap(sqlite, "api_key_model_scopes", "model_alias_id", [row.id]).get(row.id) ?? []
    );
  const userProviderScope =
    owner.role === "admin"
      ? null
      : loadUserScopeIds(sqlite, "user_provider_scopes", "provider_id", owner.id);
  const userModelScope =
    owner.role === "admin"
      ? null
      : loadUserScopeIds(sqlite, "user_model_scopes", "model_alias_id", owner.id);

  sqlite.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(nowIso(), row.id);

  return {
    kind: "matched",
    apiKey: {
      id: row.id,
      name: row.name,
      maskedPreview: row.masked_preview,
      userId: owner.id,
      userDisplayName: owner.display_name ?? owner.username,
      allowedProviderIds: intersectScopes(apiKeyProviderScope, userProviderScope),
      allowedModelAliasIds: intersectScopes(apiKeyModelScope, userModelScope)
    }
  };
}

export function getApiKeyPlaintext(
  sqlite: DatabaseSync,
  apiKeyId: string,
  encryptionKey: string,
  ownerUserId?: string
): string | null {
  const row = getApiKeyRow(sqlite, apiKeyId, false, ownerUserId);
  if (!row) {
    return null;
  }

  if (!row.key_encrypted) {
    throw new ApiKeyPlaintextUnavailableError();
  }

  return decryptSecret(row.key_encrypted, encryptionKey);
}
