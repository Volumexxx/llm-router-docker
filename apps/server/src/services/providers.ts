import type { DatabaseSync } from "node:sqlite";

import type { z } from "zod";

import {
  ANTHROPIC_API_VERSION,
  type ProviderProtocol,
  providerCreateSchema,
  providerUpdateSchema
} from "../../../../packages/shared/src/index.ts";
import { maskSecret, normalizeUrl } from "../../../../packages/shared/src/index.ts";
import type { RuntimeConfig } from "../config.ts";
import { createId, nowIso } from "../lib/utils.ts";
import { decryptSecret, encryptSecret } from "../security/crypto.ts";
import { joinUrl } from "../lib/utils.ts";

export interface ProviderProtocolConfigRecord {
  id: string;
  configured: true;
  protocol: ProviderProtocol;
  baseUrl: string;
  testTimeoutMs: number;
  apiVersion: string | null;
  apiKeyPreview: string | null;
}

export interface ProviderProtocolConfigWithSecret extends ProviderProtocolConfigRecord {
  apiKey: string;
}

export interface ProviderRecord {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  openaiConfig: ProviderProtocolConfigRecord | null;
  anthropicConfig: ProviderProtocolConfigRecord | null;
}

export interface ProviderWithSecret extends ProviderRecord {
  openaiConfig: ProviderProtocolConfigWithSecret | null;
  anthropicConfig: ProviderProtocolConfigWithSecret | null;
}

export interface ProviderDeleteResult {
  success: true;
  providerId: string;
  providerName: string;
  removedBindingCount: number;
  affectedModelCount: number;
}

export class ProviderProtocolConfigConflictError extends Error {
  protocol: ProviderProtocol;
  bindingCount: number;
  modelCount: number;

  constructor(protocol: ProviderProtocol, bindingCount: number, modelCount: number) {
    super(`Cannot remove ${protocol} config while ${bindingCount} binding(s) still reference it`);
    this.name = "ProviderProtocolConfigConflictError";
    this.protocol = protocol;
    this.bindingCount = bindingCount;
    this.modelCount = modelCount;
  }
}

export class ProviderProtocolConfigIncompleteError extends Error {
  protocol: ProviderProtocol;

  constructor(protocol: ProviderProtocol) {
    super(`Cannot create ${protocol} config without baseUrl, apiKey, and testTimeoutMs`);
    this.name = "ProviderProtocolConfigIncompleteError";
    this.protocol = protocol;
  }
}

export class ProviderConfigRequiredError extends Error {
  constructor() {
    super("At least one provider protocol config is required");
    this.name = "ProviderConfigRequiredError";
  }
}

interface ProviderRow {
  id: string;
  name: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  config_id: string | null;
  config_protocol: string | null;
  config_base_url: string | null;
  config_api_key_encrypted: string | null;
  config_test_timeout_ms: number | null;
  config_api_version: string | null;
}

interface ProviderProtocolConfigPersisted {
  baseUrl: string;
  apiKey: string;
  testTimeoutMs: number;
  apiVersion: string | null;
}

interface ProviderConfigPair {
  openai: ProviderProtocolConfigPersisted | null;
  anthropic: ProviderProtocolConfigPersisted | null;
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

function decryptProtocolConfig(
  row: ProviderRow,
  config: RuntimeConfig
): ProviderProtocolConfigWithSecret | null {
  if (
    !row.config_id ||
    !row.config_protocol ||
    !row.config_base_url ||
    !row.config_api_key_encrypted ||
    row.config_test_timeout_ms == null
  ) {
    return null;
  }

  const protocol = normalizeProviderProtocol(row.config_protocol);
  const apiKey = decryptSecret(row.config_api_key_encrypted, config.configEncryptionKey);

  return {
    id: row.config_id,
    configured: true,
    protocol,
    baseUrl: row.config_base_url,
    apiKey,
    testTimeoutMs: row.config_test_timeout_ms,
    apiVersion: normalizeProviderApiVersion(protocol, row.config_api_version),
    apiKeyPreview: maskSecret(apiKey)
  };
}

function buildProviderRecord(rows: ProviderRow[], config: RuntimeConfig): ProviderWithSecret | null {
  const first = rows[0];
  if (!first) {
    return null;
  }

  let openaiConfig: ProviderProtocolConfigWithSecret | null = null;
  let anthropicConfig: ProviderProtocolConfigWithSecret | null = null;

  for (const row of rows) {
    const protocolConfig = decryptProtocolConfig(row, config);
    if (!protocolConfig) {
      continue;
    }

    if (protocolConfig.protocol === "anthropic") {
      anthropicConfig = protocolConfig;
    } else {
      openaiConfig = protocolConfig;
    }
  }

  return {
    id: first.id,
    name: first.name,
    enabled: Boolean(first.enabled),
    createdAt: first.created_at,
    updatedAt: first.updated_at,
    openaiConfig,
    anthropicConfig
  };
}

function stripProviderSecrets(provider: ProviderWithSecret): ProviderRecord {
  const toPublicConfig = (
    value: ProviderProtocolConfigWithSecret | null
  ): ProviderProtocolConfigRecord | null => {
    if (!value) {
      return null;
    }

    const { apiKey, ...publicConfig } = value;
    return publicConfig;
  };

  return {
    ...provider,
    openaiConfig: toPublicConfig(provider.openaiConfig),
    anthropicConfig: toPublicConfig(provider.anthropicConfig)
  };
}

function queryProviderRows(
  sqlite: DatabaseSync,
  providerId?: string
): ProviderRow[] {
  const where = providerId ? "WHERE providers.id = ?" : "";

  return sqlite
    .prepare(
      `
        SELECT
          providers.id,
          providers.name,
          providers.enabled,
          providers.created_at,
          providers.updated_at,
          provider_protocol_configs.id AS config_id,
          provider_protocol_configs.protocol AS config_protocol,
          provider_protocol_configs.base_url AS config_base_url,
          provider_protocol_configs.api_key_encrypted AS config_api_key_encrypted,
          provider_protocol_configs.test_timeout_ms AS config_test_timeout_ms,
          provider_protocol_configs.api_version AS config_api_version
        FROM providers
        LEFT JOIN provider_protocol_configs
          ON provider_protocol_configs.provider_id = providers.id
        ${where}
        ORDER BY providers.created_at DESC, provider_protocol_configs.protocol ASC
      `
    )
    .all(...(providerId ? [providerId] : [])) as unknown as ProviderRow[];
}

function groupProviderRows(rows: ProviderRow[]): ProviderRow[][] {
  const groups = new Map<string, ProviderRow[]>();

  for (const row of rows) {
    const group = groups.get(row.id) ?? [];
    group.push(row);
    groups.set(row.id, group);
  }

  return Array.from(groups.values());
}

function buildProviderConfigs(provider: ProviderWithSecret): ProviderConfigPair {
  return {
    openai: provider.openaiConfig
      ? {
          baseUrl: provider.openaiConfig.baseUrl,
          apiKey: provider.openaiConfig.apiKey,
          testTimeoutMs: provider.openaiConfig.testTimeoutMs,
          apiVersion: null
        }
      : null,
    anthropic: provider.anthropicConfig
      ? {
          baseUrl: provider.anthropicConfig.baseUrl,
          apiKey: provider.anthropicConfig.apiKey,
          testTimeoutMs: provider.anthropicConfig.testTimeoutMs,
          apiVersion: provider.anthropicConfig.apiVersion
        }
      : null
  };
}

function ensureProviderConfigsExist(configs: ProviderConfigPair): void {
  if (!configs.openai && !configs.anthropic) {
    throw new ProviderConfigRequiredError();
  }
}

function pickLegacyConfig(configs: ProviderConfigPair): {
  protocol: ProviderProtocol;
  config: ProviderProtocolConfigPersisted;
} {
  if (configs.openai) {
    return {
      protocol: "openai",
      config: configs.openai
    };
  }

  if (configs.anthropic) {
    return {
      protocol: "anthropic",
      config: configs.anthropic
    };
  }

  throw new ProviderConfigRequiredError();
}

function upsertProtocolConfig(
  sqlite: DatabaseSync,
  config: RuntimeConfig,
  providerId: string,
  protocol: ProviderProtocol,
  input: ProviderProtocolConfigPersisted,
  existingConfigId?: string | null
): void {
  const timestamp = nowIso();
  const apiVersion = normalizeProviderApiVersion(protocol, input.apiVersion);

  if (existingConfigId) {
    sqlite
      .prepare(
        `
          UPDATE provider_protocol_configs
          SET
            base_url = ?,
            api_key_encrypted = ?,
            test_timeout_ms = ?,
            api_version = ?,
            updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        normalizeUrl(input.baseUrl),
        encryptSecret(input.apiKey, config.configEncryptionKey),
        input.testTimeoutMs,
        apiVersion,
        timestamp,
        existingConfigId
      );
    return;
  }

  sqlite
    .prepare(
      `
        INSERT INTO provider_protocol_configs (
          id,
          provider_id,
          protocol,
          base_url,
          api_key_encrypted,
          test_timeout_ms,
          api_version,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      createId(),
      providerId,
      protocol,
      normalizeUrl(input.baseUrl),
      encryptSecret(input.apiKey, config.configEncryptionKey),
      input.testTimeoutMs,
      apiVersion,
      timestamp,
      timestamp
    );
}

function getBindingImpactForProtocol(
  sqlite: DatabaseSync,
  providerId: string,
  protocol: ProviderProtocol
): { bindingCount: number; modelCount: number } {
  return sqlite
    .prepare(
      `
        SELECT
          COUNT(*) AS bindingCount,
          COUNT(DISTINCT model_alias_id) AS modelCount
        FROM model_bindings
        WHERE provider_id = ?
          AND protocol = ?
      `
    )
    .get(providerId, protocol) as {
    bindingCount: number;
    modelCount: number;
  };
}

function deleteProtocolConfig(
  sqlite: DatabaseSync,
  providerId: string,
  protocol: ProviderProtocol
): void {
  const impact = getBindingImpactForProtocol(sqlite, providerId, protocol);
  if (impact.bindingCount > 0) {
    throw new ProviderProtocolConfigConflictError(
      protocol,
      Number(impact.bindingCount),
      Number(impact.modelCount)
    );
  }

  sqlite
    .prepare(
      `
        DELETE FROM provider_protocol_configs
        WHERE provider_id = ?
          AND protocol = ?
      `
    )
    .run(providerId, protocol);
}

function resolveNextProtocolConfig(
  protocol: ProviderProtocol,
  current: ProviderProtocolConfigPersisted | null,
  patch:
    | z.infer<typeof providerUpdateSchema>["openai"]
    | z.infer<typeof providerUpdateSchema>["anthropic"]
    | undefined
): ProviderProtocolConfigPersisted | null {
  if (patch === undefined) {
    return current;
  }

  if (patch === null) {
    return null;
  }

  if (!current) {
    if (!patch.baseUrl || !patch.apiKey || patch.testTimeoutMs == null) {
      throw new ProviderProtocolConfigIncompleteError(protocol);
    }

    const nextApiVersion =
      protocol === "anthropic" && "apiVersion" in patch
        ? normalizeProviderApiVersion(protocol, patch.apiVersion)
        : null;

    return {
      baseUrl: normalizeUrl(patch.baseUrl),
      apiKey: patch.apiKey,
      testTimeoutMs: patch.testTimeoutMs,
      apiVersion: nextApiVersion
    };
  }

  const nextApiVersion =
    protocol === "anthropic" && "apiVersion" in patch
      ? patch.apiVersion === undefined
        ? current.apiVersion
        : patch.apiVersion
      : null;

  return {
    baseUrl: normalizeUrl(patch.baseUrl ?? current.baseUrl),
    apiKey: patch.apiKey ?? current.apiKey,
    testTimeoutMs: patch.testTimeoutMs ?? current.testTimeoutMs,
    apiVersion: normalizeProviderApiVersion(protocol, nextApiVersion)
  };
}

function syncLegacyProviderColumns(
  sqlite: DatabaseSync,
  config: RuntimeConfig,
  providerId: string,
  providerName: string,
  providerEnabled: boolean,
  providerConfigs: ProviderConfigPair
): void {
  ensureProviderConfigsExist(providerConfigs);
  const { protocol, config: legacyConfig } = pickLegacyConfig(providerConfigs);

  sqlite
    .prepare(
      `
        UPDATE providers
        SET
          name = ?,
          enabled = ?,
          base_url = ?,
          api_key_encrypted = ?,
          protocol = ?,
          api_version = ?,
          test_timeout_ms = ?,
          updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      providerName,
      providerEnabled ? 1 : 0,
      normalizeUrl(legacyConfig.baseUrl),
      encryptSecret(legacyConfig.apiKey, config.configEncryptionKey),
      protocol,
      normalizeProviderApiVersion(protocol, legacyConfig.apiVersion),
      legacyConfig.testTimeoutMs,
      nowIso(),
      providerId
    );
}

export function listProviders(sqlite: DatabaseSync, config: RuntimeConfig): ProviderRecord[] {
  return groupProviderRows(queryProviderRows(sqlite))
    .map((rows) => buildProviderRecord(rows, config))
    .filter((provider): provider is ProviderWithSecret => Boolean(provider))
    .map((provider) => stripProviderSecrets(provider));
}

export function getProviderById(
  sqlite: DatabaseSync,
  config: RuntimeConfig,
  providerId: string
): ProviderWithSecret | null {
  return buildProviderRecord(queryProviderRows(sqlite, providerId), config);
}

export function getProviderProtocolConfig(
  sqlite: DatabaseSync,
  config: RuntimeConfig,
  providerId: string,
  protocol: ProviderProtocol
): ProviderProtocolConfigWithSecret | null {
  const provider = getProviderById(sqlite, config, providerId);
  if (!provider) {
    return null;
  }

  return protocol === "anthropic" ? provider.anthropicConfig : provider.openaiConfig;
}

export function createProvider(
  sqlite: DatabaseSync,
  config: RuntimeConfig,
  input: z.infer<typeof providerCreateSchema>
): ProviderRecord {
  const id = createId();
  const timestamp = nowIso();
  const providerConfigs: ProviderConfigPair = {
    openai: input.openai
      ? {
          baseUrl: normalizeUrl(input.openai.baseUrl),
          apiKey: input.openai.apiKey,
          testTimeoutMs: input.openai.testTimeoutMs,
          apiVersion: null
        }
      : null,
    anthropic: input.anthropic
      ? {
          baseUrl: normalizeUrl(input.anthropic.baseUrl),
          apiKey: input.anthropic.apiKey,
          testTimeoutMs: input.anthropic.testTimeoutMs,
          apiVersion: normalizeProviderApiVersion("anthropic", input.anthropic.apiVersion)
        }
      : null
  };
  ensureProviderConfigsExist(providerConfigs);
  const { protocol, config: legacyConfig } = pickLegacyConfig(providerConfigs);

  try {
    sqlite.exec("BEGIN");
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
        normalizeUrl(legacyConfig.baseUrl),
        encryptSecret(legacyConfig.apiKey, config.configEncryptionKey),
        protocol,
        normalizeProviderApiVersion(protocol, legacyConfig.apiVersion),
        input.enabled ? 1 : 0,
        legacyConfig.testTimeoutMs,
        timestamp,
        timestamp
      );

    if (providerConfigs.openai) {
      upsertProtocolConfig(sqlite, config, id, "openai", providerConfigs.openai);
    }

    if (providerConfigs.anthropic) {
      upsertProtocolConfig(sqlite, config, id, "anthropic", providerConfigs.anthropic);
    }

    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  const provider = getProviderById(sqlite, config, id);
  if (!provider) {
    throw new Error("Provider was created but could not be loaded");
  }

  return stripProviderSecrets(provider);
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

  const currentConfigs = buildProviderConfigs(current);
  const nextConfigs: ProviderConfigPair = {
    openai: resolveNextProtocolConfig("openai", currentConfigs.openai, input.openai),
    anthropic: resolveNextProtocolConfig("anthropic", currentConfigs.anthropic, input.anthropic)
  };
  ensureProviderConfigsExist(nextConfigs);

  try {
    sqlite.exec("BEGIN");

    if (input.openai === null && current.openaiConfig) {
      deleteProtocolConfig(sqlite, providerId, "openai");
    }

    if (input.anthropic === null && current.anthropicConfig) {
      deleteProtocolConfig(sqlite, providerId, "anthropic");
    }

    if (nextConfigs.openai) {
      upsertProtocolConfig(
        sqlite,
        config,
        providerId,
        "openai",
        nextConfigs.openai,
        current.openaiConfig?.id
      );
    }

    if (nextConfigs.anthropic) {
      upsertProtocolConfig(
        sqlite,
        config,
        providerId,
        "anthropic",
        nextConfigs.anthropic,
        current.anthropicConfig?.id
      );
    }

    syncLegacyProviderColumns(
      sqlite,
      config,
      providerId,
      input.name ?? current.name,
      input.enabled ?? current.enabled,
      nextConfigs
    );

    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  const updated = getProviderById(sqlite, config, providerId);
  if (!updated) {
    return null;
  }

  return stripProviderSecrets(updated);
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
