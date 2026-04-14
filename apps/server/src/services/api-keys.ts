import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { z } from "zod";

import {
  apiKeyCreateSchema,
  apiKeyUpdateSchema,
  maskSecret
} from "../../../../packages/shared/src/index.ts";
import { createId, nowIso } from "../lib/utils.ts";
import { hashCredential, verifyCredential } from "../security/crypto.ts";

export interface ApiKeyRecord {
  id: string;
  name: string;
  maskedPreview: string;
  enabled: boolean;
  deletedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  allowedProviderIds: string[];
  allowedModelAliasIds: string[];
  allProvidersAllowed: boolean;
  allModelsAllowed: boolean;
}

export interface AuthenticatedApiKey {
  id: string;
  name: string;
  maskedPreview: string;
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
  masked_preview: string;
  enabled: number;
  deleted_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
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

function getApiKeyRow(
  sqlite: DatabaseSync,
  apiKeyId: string,
  includeDeleted = false
): ApiKeyRow | undefined {
  const whereDeleted = includeDeleted ? "" : "AND deleted_at IS NULL";

  return sqlite
    .prepare(
      `
        SELECT *
        FROM api_keys
        WHERE id = ?
          ${whereDeleted}
        LIMIT 1
      `
    )
    .get(apiKeyId) as ApiKeyRow | undefined;
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
    .all(...apiKeyIds) as Array<{
    api_key_id: string;
    scope_id: string;
  }>;

  for (const row of rows) {
    const scopeIds = scopeMap.get(row.api_key_id) ?? [];
    scopeIds.push(row.scope_id);
    scopeMap.set(row.api_key_id, scopeIds);
  }

  return scopeMap;
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
    allowedProviderIds: providerScopeIds,
    allowedModelAliasIds: modelScopeIds,
    allProvidersAllowed: providerScopeIds.length === 0,
    allModelsAllowed: modelScopeIds.length === 0
  };
}

function loadApiKeyRecord(
  sqlite: DatabaseSync,
  apiKeyId: string,
  includeDeleted = false
): ApiKeyRecord | null {
  const row = getApiKeyRow(sqlite, apiKeyId, includeDeleted);
  if (!row) {
    return null;
  }

  const providerScopeMap = loadScopeMap(sqlite, "api_key_provider_scopes", "provider_id", [row.id]);
  const modelScopeMap = loadScopeMap(sqlite, "api_key_model_scopes", "model_alias_id", [row.id]);

  return toApiKeyRecord(
    row,
    providerScopeMap.get(row.id) ?? [],
    modelScopeMap.get(row.id) ?? []
  );
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

function replaceProviderScopes(
  sqlite: DatabaseSync,
  apiKeyId: string,
  providerIds: string[]
): void {
  sqlite
    .prepare(
      `
        DELETE FROM api_key_provider_scopes
        WHERE api_key_id = ?
      `
    )
    .run(apiKeyId);

  if (providerIds.length === 0) {
    return;
  }

  const insert = sqlite.prepare(
    `
      INSERT INTO api_key_provider_scopes (api_key_id, provider_id, created_at)
      VALUES (?, ?, ?)
    `
  );
  const createdAt = nowIso();

  for (const providerId of providerIds) {
    insert.run(apiKeyId, providerId, createdAt);
  }
}

function replaceModelScopes(
  sqlite: DatabaseSync,
  apiKeyId: string,
  modelAliasIds: string[]
): void {
  sqlite
    .prepare(
      `
        DELETE FROM api_key_model_scopes
        WHERE api_key_id = ?
      `
    )
    .run(apiKeyId);

  if (modelAliasIds.length === 0) {
    return;
  }

  const insert = sqlite.prepare(
    `
      INSERT INTO api_key_model_scopes (api_key_id, model_alias_id, created_at)
      VALUES (?, ?, ?)
    `
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

export function listApiKeys(sqlite: DatabaseSync, includeDeleted = false): ApiKeyRecord[] {
  const whereDeleted = includeDeleted ? "" : "WHERE deleted_at IS NULL";

  const rows = sqlite
    .prepare(
      `
        SELECT *
        FROM api_keys
        ${whereDeleted}
        ORDER BY created_at DESC
      `
    )
    .all() as unknown as ApiKeyRow[];

  const apiKeyIds = rows.map((row) => row.id);
  const providerScopeMap = loadScopeMap(sqlite, "api_key_provider_scopes", "provider_id", apiKeyIds);
  const modelScopeMap = loadScopeMap(sqlite, "api_key_model_scopes", "model_alias_id", apiKeyIds);

  return rows
    .map((row) =>
      toApiKeyRecord(
        row,
        providerScopeMap.get(row.id) ?? [],
        modelScopeMap.get(row.id) ?? []
      )
    )
    .filter((row): row is ApiKeyRecord => Boolean(row));
}

export async function createApiKey(
  sqlite: DatabaseSync,
  input: z.infer<typeof apiKeyCreateSchema>
): Promise<{ item: ApiKeyRecord; createdKeyPlaintext: string }> {
  validateScopes(sqlite, input.allowedProviderIds, input.allowedModelAliasIds);

  const id = createId();
  const plaintext = buildApiKeyPlaintext(id);
  const keyHash = await hashCredential(plaintext);
  const maskedPreview = maskSecret(plaintext) ?? "***";
  const timestamp = nowIso();

  try {
    sqlite.exec("BEGIN");
    sqlite
      .prepare(
        `
          INSERT INTO api_keys (
            id,
            name,
            key_hash,
            masked_preview,
            enabled,
            deleted_at,
            last_used_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(id, input.name, keyHash, maskedPreview, 1, null, null, timestamp, timestamp);

    replaceProviderScopes(sqlite, id, input.allowedProviderIds);
    replaceModelScopes(sqlite, id, input.allowedModelAliasIds);
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
  input: z.infer<typeof apiKeyUpdateSchema>
): ApiKeyRecord | null {
  const current = loadApiKeyRecord(sqlite, apiKeyId);
  if (!current) {
    return null;
  }

  validateScopes(sqlite, input.allowedProviderIds, input.allowedModelAliasIds);

  try {
    sqlite.exec("BEGIN");
    sqlite
      .prepare(
        `
          UPDATE api_keys
          SET
            name = ?,
            enabled = ?,
            updated_at = ?
          WHERE id = ?
            AND deleted_at IS NULL
        `
      )
      .run(
        input.name ?? current.name,
        (input.enabled ?? current.enabled) ? 1 : 0,
        nowIso(),
        apiKeyId
      );

    if (input.allowedProviderIds) {
      replaceProviderScopes(sqlite, apiKeyId, input.allowedProviderIds);
    }

    if (input.allowedModelAliasIds) {
      replaceModelScopes(sqlite, apiKeyId, input.allowedModelAliasIds);
    }

    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  return loadApiKeyRecord(sqlite, apiKeyId);
}

export function deleteApiKey(sqlite: DatabaseSync, apiKeyId: string): boolean {
  const timestamp = nowIso();
  const result = sqlite
    .prepare(
      `
        UPDATE api_keys
        SET
          enabled = 0,
          deleted_at = ?,
          updated_at = ?
        WHERE id = ?
          AND deleted_at IS NULL
      `
    )
    .run(timestamp, timestamp, apiKeyId);

  return result.changes > 0;
}

export function getApiKeyCounts(sqlite: DatabaseSync): {
  activeApiKeyCount: number;
  totalApiKeyCount: number;
} {
  const row = sqlite
    .prepare(
      `
        SELECT
          COUNT(*) AS total_count,
          SUM(CASE WHEN enabled = 1 AND deleted_at IS NULL THEN 1 ELSE 0 END) AS active_count
        FROM api_keys
      `
    )
    .get() as {
    total_count: number;
    active_count: number | null;
  };

  return {
    activeApiKeyCount: Number(row.active_count ?? 0),
    totalApiKeyCount: Number(row.total_count ?? 0)
  };
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

  const apiKeyId = extractApiKeyId(plaintext);
  if (!apiKeyId) {
    return {
      kind: "invalid",
      apiKey: null
    };
  }

  const row = sqlite
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

  const providerScopeIds =
    loadScopeMap(sqlite, "api_key_provider_scopes", "provider_id", [row.id]).get(row.id) ?? [];
  const modelScopeIds =
    loadScopeMap(sqlite, "api_key_model_scopes", "model_alias_id", [row.id]).get(row.id) ?? [];

  const lastUsedAt = nowIso();
  sqlite
    .prepare(
      `
        UPDATE api_keys
        SET last_used_at = ?
        WHERE id = ?
      `
    )
    .run(lastUsedAt, row.id);

  return {
    kind: "matched",
    apiKey: {
      id: row.id,
      name: row.name,
      maskedPreview: row.masked_preview,
      allowedProviderIds: providerScopeIds.length > 0 ? providerScopeIds : null,
      allowedModelAliasIds: modelScopeIds.length > 0 ? modelScopeIds : null
    }
  };
}
