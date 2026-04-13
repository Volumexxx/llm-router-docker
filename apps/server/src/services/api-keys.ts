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
}

export interface ApiKeyAuthenticationResult {
  kind: "matched" | "invalid" | "no_active_keys";
  apiKey: ApiKeyRecord | null;
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

function toApiKeyRecord(row: ApiKeyRow | undefined): ApiKeyRecord | null {
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
    updatedAt: row.updated_at
  };
}

function buildApiKeyPlaintext(id: string): string {
  return `lrk_${id}_${randomBytes(32).toString("base64url")}`;
}

function extractApiKeyId(value: string): string | null {
  const match = /^lrk_([0-9a-fA-F-]{36})_[A-Za-z0-9\-_]+$/.exec(value.trim());
  return match?.[1] ?? null;
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

  return rows
    .map((row) => toApiKeyRecord(row))
    .filter((row): row is ApiKeyRecord => Boolean(row));
}

export async function createApiKey(
  sqlite: DatabaseSync,
  input: z.infer<typeof apiKeyCreateSchema>
): Promise<{ item: ApiKeyRecord; createdKeyPlaintext: string }> {
  const id = createId();
  const plaintext = buildApiKeyPlaintext(id);
  const keyHash = await hashCredential(plaintext);
  const maskedPreview = maskSecret(plaintext) ?? "***";
  const timestamp = nowIso();

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

  const item = toApiKeyRecord(getApiKeyRow(sqlite, id));
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
  const current = toApiKeyRecord(getApiKeyRow(sqlite, apiKeyId));
  if (!current) {
    return null;
  }

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

  return toApiKeyRecord(getApiKeyRow(sqlite, apiKeyId));
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
      enabled: Boolean(row.enabled),
      deletedAt: row.deleted_at,
      lastUsedAt,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  };
}
