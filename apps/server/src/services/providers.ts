import type { DatabaseSync } from "node:sqlite";

import type { z } from "zod";

import {
  ANTHROPIC_API_VERSION,
  providerProtocolSchema,
  providerCreateSchema,
  providerUpdateSchema
} from "../../../../packages/shared/src/index.ts";
import { maskSecret, normalizeUrl } from "../../../../packages/shared/src/index.ts";
import type { RuntimeConfig } from "../config.ts";
import { createId, nowIso } from "../lib/utils.ts";
import { decryptSecret, encryptSecret } from "../security/crypto.ts";
import { joinUrl } from "../lib/utils.ts";

type ProviderProtocol = z.infer<typeof providerProtocolSchema>;

export interface ProviderRecord {
  id: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  apiVersion: string | null;
  enabled: boolean;
  testTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
  apiKeyPreview: string | null;
}

export interface ProviderWithSecret extends ProviderRecord {
  apiKey: string;
}

export interface ProviderDeleteResult {
  success: true;
  providerId: string;
  providerName: string;
  removedBindingCount: number;
  affectedModelCount: number;
}

function sanitizeProviderRow(
  row:
    | {
        id: string;
        name: string;
        base_url: string;
        api_key_encrypted: string;
        protocol: string;
        api_version: string | null;
        enabled: number;
        test_timeout_ms: number;
        created_at: string;
        updated_at: string;
      }
    | undefined,
  config: RuntimeConfig
): ProviderWithSecret | null {
  if (!row) {
    return null;
  }

  const apiKey = decryptSecret(row.api_key_encrypted, config.configEncryptionKey);
  const protocol = normalizeProviderProtocol(row.protocol);
  const apiVersion = normalizeProviderApiVersion(protocol, row.api_version);

  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    protocol,
    apiVersion,
    apiKey,
    enabled: Boolean(row.enabled),
    testTimeoutMs: row.test_timeout_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    apiKeyPreview: maskSecret(apiKey)
  };
}

export function listProviders(sqlite: DatabaseSync, config: RuntimeConfig): ProviderRecord[] {
  const rows = sqlite
    .prepare(
      `
        SELECT *
        FROM providers
        ORDER BY created_at DESC
      `
    )
    .all() as Array<{
    id: string;
    name: string;
    base_url: string;
    api_key_encrypted: string;
    protocol: string;
    api_version: string | null;
    enabled: number;
    test_timeout_ms: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows
    .map((row) => sanitizeProviderRow(row, config))
    .filter((row): row is ProviderWithSecret => Boolean(row))
      .map(({ apiKey, ...provider }) => provider);
}

export function getProviderById(
  sqlite: DatabaseSync,
  config: RuntimeConfig,
  providerId: string
): ProviderWithSecret | null {
  const row = sqlite
    .prepare("SELECT * FROM providers WHERE id = ? LIMIT 1")
    .get(providerId) as
    | {
        id: string;
        name: string;
        base_url: string;
        api_key_encrypted: string;
        protocol: string;
        api_version: string | null;
        enabled: number;
        test_timeout_ms: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  return sanitizeProviderRow(row, config);
}

function normalizeProviderProtocol(value: string | null | undefined): ProviderProtocol {
  return value === "anthropic" ? "anthropic" : "openai";
}

function normalizeProviderApiVersion(
  protocol: ProviderProtocol,
  apiVersion: string | null | undefined
): string | null {
  if (protocol !== "anthropic") {
    return null;
  }

  return apiVersion?.trim() || ANTHROPIC_API_VERSION;
}

export function createProvider(
  sqlite: DatabaseSync,
  config: RuntimeConfig,
  input: z.infer<typeof providerCreateSchema>
): ProviderRecord {
  const id = createId();
  const timestamp = nowIso();
  const protocol = normalizeProviderProtocol(input.protocol);
  const apiVersion = normalizeProviderApiVersion(protocol, input.apiVersion);

  sqlite
    .prepare(
      `
        INSERT INTO providers (
          id,
          name,
          base_url,
          api_key_encrypted,
          protocol,
          api_version,
          enabled,
          test_timeout_ms,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      id,
      input.name,
      normalizeUrl(input.baseUrl),
      encryptSecret(input.apiKey, config.configEncryptionKey),
      protocol,
      apiVersion,
      input.enabled ? 1 : 0,
      input.testTimeoutMs,
      timestamp,
      timestamp
    );

  const provider = getProviderById(sqlite, config, id);
  if (!provider) {
    throw new Error("Provider was created but could not be loaded");
  }

  const { apiKey, ...sanitized } = provider;
  return sanitized;
}

export function updateProvider(
  sqlite: DatabaseSync,
  config: RuntimeConfig,
  providerId: string,
  input: z.infer<typeof providerUpdateSchema>
): ProviderRecord | null {
  const current = getProviderById(sqlite, config, providerId);
  if (!current) {
    return null;
  }

  const protocol = normalizeProviderProtocol(input.protocol ?? current.protocol);
  const apiVersion = normalizeProviderApiVersion(
    protocol,
    input.apiVersion === undefined ? current.apiVersion : input.apiVersion
  );

  const next = {
    name: input.name ?? current.name,
    baseUrl: normalizeUrl(input.baseUrl ?? current.baseUrl),
    apiKey: input.apiKey ?? current.apiKey,
    protocol,
    apiVersion,
    enabled: input.enabled ?? current.enabled,
    testTimeoutMs: input.testTimeoutMs ?? current.testTimeoutMs
  };

  sqlite
    .prepare(
      `
        UPDATE providers
        SET
          name = ?,
          base_url = ?,
          api_key_encrypted = ?,
          protocol = ?,
          api_version = ?,
          enabled = ?,
          test_timeout_ms = ?,
          updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      next.name,
      next.baseUrl,
      encryptSecret(next.apiKey, config.configEncryptionKey),
      next.protocol,
      next.apiVersion,
      next.enabled ? 1 : 0,
      next.testTimeoutMs,
      nowIso(),
      providerId
    );

  const updated = getProviderById(sqlite, config, providerId);
  if (!updated) {
    return null;
  }

  const { apiKey, ...sanitized } = updated;
  return sanitized;
}

export function deleteProvider(sqlite: DatabaseSync, providerId: string): ProviderDeleteResult | null {
  const provider = sqlite
    .prepare(
      `
        SELECT id, name
        FROM providers
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(providerId) as
    | {
        id: string;
        name: string;
      }
    | undefined;

  if (!provider) {
    return null;
  }

  const impact = sqlite
    .prepare(
      `
        SELECT
          COUNT(*) AS binding_count,
          COUNT(DISTINCT model_alias_id) AS model_count
        FROM model_bindings
        WHERE provider_id = ?
      `
    )
    .get(providerId) as {
    binding_count: number;
    model_count: number;
  };

  try {
    sqlite.exec("BEGIN");
    sqlite.prepare("DELETE FROM model_bindings WHERE provider_id = ?").run(providerId);

    const deletedProvider = sqlite.prepare("DELETE FROM providers WHERE id = ?").run(providerId);
    if (deletedProvider.changes === 0) {
      throw new Error("Provider was not deleted");
    }

    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  return {
    success: true,
    providerId: provider.id,
    providerName: provider.name,
    removedBindingCount: Number(impact.binding_count),
    affectedModelCount: Number(impact.model_count)
  };
}

export function isSqliteUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

export function buildProviderRequestUrl(baseUrl: string, resource: string): string {
  return joinUrl(baseUrl, resource);
}
