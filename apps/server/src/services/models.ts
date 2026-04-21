import type { DatabaseSync } from "node:sqlite";

import type { z } from "zod";

import type { GatewayApiKeyContext } from "../types.ts";
import {
  ANTHROPIC_API_VERSION,
  bindingCreateSchema,
  bindingUpdateSchema,
  modelAliasCreateSchema,
  modelAliasUpdateSchema,
  type ProviderProtocol
} from "../../../../packages/shared/src/index.ts";
import { createId, nowIso } from "../lib/utils.ts";

export interface ModelBindingView {
  id: string;
  providerId: string;
  providerName: string;
  protocol: ProviderProtocol;
  upstreamModel: string;
  inputPrice: number;
  outputPrice: number;
  enabled: boolean;
  runtimePriority: number;
  defaultPriority: number;
}

export interface ModelBindingGroups {
  openai: ModelBindingView[];
  anthropic: ModelBindingView[];
}

export interface ModelAliasView {
  id: string;
  alias: string;
  displayName: string;
  enabled: boolean;
  bindings: ModelBindingGroups;
}

export interface RoutableBinding {
  bindingId: string;
  modelAliasId: string;
  modelAlias: string;
  displayName: string;
  providerId: string;
  providerName: string;
  providerBaseUrl: string;
  providerApiKeyEncrypted: string;
  providerProtocol: ProviderProtocol;
  providerApiVersion: string | null;
  upstreamModel: string;
  inputPrice: number;
  outputPrice: number;
}

type GatewayRoutingScope = Pick<
  GatewayApiKeyContext,
  "allowedProviderIds" | "allowedModelAliasIds"
>;

interface BindingRow {
  id: string;
  model_alias_id: string;
  provider_id: string;
  protocol: string;
  upstream_model: string;
  input_price: number;
  output_price: number;
  enabled: number;
  runtime_priority: number;
  default_priority: number;
  provider_name: string;
}

export type RoutableBindingResolution =
  | {
      kind: "matched";
      binding: RoutableBinding;
    }
  | {
      kind: "not_found";
    }
  | {
      kind: "scope_denied";
    };

export class BindingProtocolConfigMissingError extends Error {
  protocol: ProviderProtocol;
  providerId: string;

  constructor(providerId: string, protocol: ProviderProtocol) {
    super(`Provider ${providerId} does not have a configured ${protocol} endpoint`);
    this.name = "BindingProtocolConfigMissingError";
    this.providerId = providerId;
    this.protocol = protocol;
  }
}

function normalizeProviderProtocol(value: string | null | undefined): ProviderProtocol {
  return value === "anthropic" ? "anthropic" : "openai";
}

function emptyBindingGroups(): ModelBindingGroups {
  return {
    openai: [],
    anthropic: []
  };
}

function groupBindings(bindings: BindingRow[]): Map<string, ModelBindingGroups> {
  const bindingMap = new Map<string, ModelBindingGroups>();

  for (const binding of bindings) {
    const groups = bindingMap.get(binding.model_alias_id) ?? emptyBindingGroups();
    const protocol = normalizeProviderProtocol(binding.protocol);

    groups[protocol].push({
      id: binding.id,
      providerId: binding.provider_id,
      providerName: binding.provider_name,
      protocol,
      upstreamModel: binding.upstream_model,
      inputPrice: Number(binding.input_price),
      outputPrice: Number(binding.output_price),
      enabled: Boolean(binding.enabled),
      runtimePriority: binding.runtime_priority,
      defaultPriority: binding.default_priority
    });

    bindingMap.set(binding.model_alias_id, groups);
  }

  return bindingMap;
}

export function listModels(sqlite: DatabaseSync): ModelAliasView[] {
  const models = sqlite
    .prepare(
      `
        SELECT *
        FROM model_aliases
        ORDER BY created_at DESC
      `
    )
    .all() as Array<{
    id: string;
    alias: string;
    display_name: string;
    enabled: number;
  }>;

  const bindings = sqlite
    .prepare(
      `
        SELECT
          model_bindings.id,
          model_bindings.model_alias_id,
          model_bindings.provider_id,
          model_bindings.protocol,
          model_bindings.upstream_model,
          model_bindings.input_price,
          model_bindings.output_price,
          model_bindings.enabled,
          model_bindings.runtime_priority,
          model_bindings.default_priority,
          providers.name AS provider_name
        FROM model_bindings
        INNER JOIN providers ON providers.id = model_bindings.provider_id
        ORDER BY model_bindings.protocol ASC, model_bindings.runtime_priority ASC
      `
    )
    .all() as unknown as BindingRow[];

  const bindingMap = groupBindings(bindings);

  return models.map((model) => ({
    id: model.id,
    alias: model.alias,
    displayName: model.display_name,
    enabled: Boolean(model.enabled),
    bindings: bindingMap.get(model.id) ?? emptyBindingGroups()
  }));
}

export function createModelAlias(
  sqlite: DatabaseSync,
  input: z.infer<typeof modelAliasCreateSchema>
): ModelAliasView {
  const id = createId();
  const timestamp = nowIso();

  sqlite
    .prepare(
      `
        INSERT INTO model_aliases (id, alias, display_name, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    )
    .run(id, input.alias, input.displayName, input.enabled ? 1 : 0, timestamp, timestamp);

  const model = getModelById(sqlite, id);
  if (!model) {
    throw new Error("Model alias was created but could not be loaded");
  }

  return model;
}

export function getModelById(sqlite: DatabaseSync, modelId: string): ModelAliasView | null {
  return listModels(sqlite).find((model) => model.id === modelId) ?? null;
}

export function updateModelAlias(
  sqlite: DatabaseSync,
  modelId: string,
  input: z.infer<typeof modelAliasUpdateSchema>
): ModelAliasView | null {
  const current = getModelById(sqlite, modelId);
  if (!current) {
    return null;
  }

  sqlite
    .prepare(
      `
        UPDATE model_aliases
        SET alias = ?, display_name = ?, enabled = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      input.alias ?? current.alias,
      input.displayName ?? current.displayName,
      (input.enabled ?? current.enabled) ? 1 : 0,
      nowIso(),
      modelId
    );

  return getModelById(sqlite, modelId);
}

export function deleteModelAlias(sqlite: DatabaseSync, modelId: string): boolean {
  const result = sqlite.prepare("DELETE FROM model_aliases WHERE id = ?").run(modelId);
  return result.changes > 0;
}

function nextBindingPriority(
  sqlite: DatabaseSync,
  modelId: string,
  protocol: ProviderProtocol
): number {
  const row = sqlite
    .prepare(
      `
        SELECT COALESCE(MAX(runtime_priority), -1) AS max_priority
        FROM model_bindings
        WHERE model_alias_id = ?
          AND protocol = ?
      `
    )
    .get(modelId, protocol) as { max_priority: number };

  return row.max_priority + 1;
}

function assertProviderHasProtocolConfig(
  sqlite: DatabaseSync,
  providerId: string,
  protocol: ProviderProtocol
): void {
  const row = sqlite
    .prepare(
      `
        SELECT id
        FROM provider_protocol_configs
        WHERE provider_id = ?
          AND protocol = ?
        LIMIT 1
      `
    )
    .get(providerId, protocol) as { id: string } | undefined;

  if (!row) {
    throw new BindingProtocolConfigMissingError(providerId, protocol);
  }
}

export function createBinding(
  sqlite: DatabaseSync,
  modelId: string,
  input: z.infer<typeof bindingCreateSchema>
): ModelAliasView | null {
  assertProviderHasProtocolConfig(sqlite, input.providerId, input.protocol);

  const priority = nextBindingPriority(sqlite, modelId, input.protocol);
  const timestamp = nowIso();

  sqlite
    .prepare(
      `
        INSERT INTO model_bindings (
          id,
          model_alias_id,
          provider_id,
          protocol,
          upstream_model,
          input_price,
          output_price,
          enabled,
          runtime_priority,
          default_priority,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      createId(),
      modelId,
      input.providerId,
      input.protocol,
      input.upstreamModel,
      input.inputPrice,
      input.outputPrice,
      input.enabled ? 1 : 0,
      priority,
      priority,
      timestamp,
      timestamp
    );

  return getModelById(sqlite, modelId);
}

export function updateBinding(
  sqlite: DatabaseSync,
  modelId: string,
  bindingId: string,
  input: z.infer<typeof bindingUpdateSchema>
): ModelAliasView | null {
  const existing = sqlite
    .prepare(
      `
        SELECT *
        FROM model_bindings
        WHERE id = ? AND model_alias_id = ?
        LIMIT 1
      `
    )
    .get(bindingId, modelId) as
    | {
        upstream_model: string;
        input_price: number;
        output_price: number;
        enabled: number;
        runtime_priority: number;
        default_priority: number;
      }
    | undefined;

  if (!existing) {
    return null;
  }

  sqlite
    .prepare(
      `
        UPDATE model_bindings
        SET
          upstream_model = ?,
          input_price = ?,
          output_price = ?,
          enabled = ?,
          runtime_priority = ?,
          default_priority = ?,
          updated_at = ?
        WHERE id = ? AND model_alias_id = ?
      `
    )
    .run(
      input.upstreamModel ?? existing.upstream_model,
      input.inputPrice ?? existing.input_price,
      input.outputPrice ?? existing.output_price,
      (input.enabled ?? Boolean(existing.enabled)) ? 1 : 0,
      input.runtimePriority ?? existing.runtime_priority,
      input.defaultPriority ?? existing.default_priority,
      nowIso(),
      bindingId,
      modelId
    );

  return getModelById(sqlite, modelId);
}

export function deleteBinding(sqlite: DatabaseSync, modelId: string, bindingId: string): boolean {
  const result = sqlite
    .prepare("DELETE FROM model_bindings WHERE id = ? AND model_alias_id = ?")
    .run(bindingId, modelId);

  return result.changes > 0;
}

export function applyRuntimeOrder(
  sqlite: DatabaseSync,
  modelId: string,
  protocol: ProviderProtocol,
  bindingIds: string[]
): ModelAliasView | null {
  const timestamp = nowIso();

  try {
    sqlite.exec("BEGIN");
    bindingIds.forEach((bindingId, index) => {
      sqlite
        .prepare(
          `
            UPDATE model_bindings
            SET runtime_priority = ?, updated_at = ?
            WHERE id = ? AND model_alias_id = ? AND protocol = ?
          `
        )
        .run(index, timestamp, bindingId, modelId, protocol);
    });
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  return getModelById(sqlite, modelId);
}

export function saveRuntimeOrderAsDefault(
  sqlite: DatabaseSync,
  modelId: string,
  protocol: ProviderProtocol,
  bindingIds: string[]
): ModelAliasView | null {
  if (!getModelById(sqlite, modelId)) {
    return null;
  }

  const timestamp = nowIso();

  try {
    sqlite.exec("BEGIN");
    bindingIds.forEach((bindingId, index) => {
      sqlite
        .prepare(
          `
            UPDATE model_bindings
            SET runtime_priority = ?,
                default_priority = ?,
                updated_at = ?
            WHERE id = ? AND model_alias_id = ? AND protocol = ?
          `
        )
        .run(index, index, timestamp, bindingId, modelId, protocol);
    });
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  return getModelById(sqlite, modelId);
}

function buildScopeSets(gatewayScope?: GatewayRoutingScope): {
  allowedProviderIds: Set<string> | null;
  allowedModelAliasIds: Set<string> | null;
} {
  return {
    allowedProviderIds: gatewayScope?.allowedProviderIds
      ? new Set(gatewayScope.allowedProviderIds)
      : null,
    allowedModelAliasIds: gatewayScope?.allowedModelAliasIds
      ? new Set(gatewayScope.allowedModelAliasIds)
      : null
  };
}

function isBindingAllowedByScope(
  row: {
    provider_id: string;
    model_alias_id: string;
  },
  scopeSets: {
    allowedProviderIds: Set<string> | null;
    allowedModelAliasIds: Set<string> | null;
  }
): boolean {
  if (scopeSets.allowedProviderIds && !scopeSets.allowedProviderIds.has(row.provider_id)) {
    return false;
  }

  if (scopeSets.allowedModelAliasIds && !scopeSets.allowedModelAliasIds.has(row.model_alias_id)) {
    return false;
  }

  return true;
}

export function listVisibleModels(
  sqlite: DatabaseSync,
  protocol: ProviderProtocol,
  gatewayScope?: GatewayRoutingScope
) {
  const scopeSets = buildScopeSets(gatewayScope);
  const rows = sqlite
    .prepare(
      `
        SELECT
          model_aliases.alias,
          model_aliases.display_name,
          model_aliases.id AS model_alias_id,
          providers.id AS provider_id
        FROM model_aliases
        INNER JOIN model_bindings ON model_bindings.model_alias_id = model_aliases.id
        INNER JOIN providers ON providers.id = model_bindings.provider_id
        INNER JOIN provider_protocol_configs
          ON provider_protocol_configs.provider_id = providers.id
         AND provider_protocol_configs.protocol = model_bindings.protocol
        WHERE model_aliases.enabled = 1
          AND model_bindings.enabled = 1
          AND providers.enabled = 1
          AND model_bindings.protocol = ?
        ORDER BY model_aliases.alias ASC, model_bindings.runtime_priority ASC
      `
    )
    .all(protocol) as Array<{
    alias: string;
    display_name: string;
    model_alias_id: string;
    provider_id: string;
  }>;

  const visibleModels = new Map<string, { alias: string; display_name: string }>();

  for (const row of rows) {
    if (!isBindingAllowedByScope(row, scopeSets)) {
      continue;
    }

    if (!visibleModels.has(row.model_alias_id)) {
      visibleModels.set(row.model_alias_id, {
        alias: row.alias,
        display_name: row.display_name
      });
    }
  }

  return Array.from(visibleModels.values()).sort((left, right) => left.alias.localeCompare(right.alias));
}

export function resolveRoutableBinding(
  sqlite: DatabaseSync,
  alias: string,
  protocol: ProviderProtocol,
  gatewayScope?: GatewayRoutingScope
): RoutableBindingResolution {
  const scopeSets = buildScopeSets(gatewayScope);
  const rows = sqlite
    .prepare(
      `
        SELECT
          model_bindings.id AS binding_id,
          model_aliases.id AS model_alias_id,
          model_aliases.alias AS model_alias,
          model_aliases.display_name AS display_name,
          providers.id AS provider_id,
          providers.name AS provider_name,
          provider_protocol_configs.base_url AS provider_base_url,
          provider_protocol_configs.api_key_encrypted AS provider_api_key_encrypted,
          provider_protocol_configs.protocol AS provider_protocol,
          provider_protocol_configs.api_version AS provider_api_version,
          model_bindings.upstream_model AS upstream_model,
          model_bindings.input_price AS input_price,
          model_bindings.output_price AS output_price
        FROM model_aliases
        INNER JOIN model_bindings ON model_bindings.model_alias_id = model_aliases.id
        INNER JOIN providers ON providers.id = model_bindings.provider_id
        INNER JOIN provider_protocol_configs
          ON provider_protocol_configs.provider_id = providers.id
         AND provider_protocol_configs.protocol = model_bindings.protocol
        WHERE model_aliases.alias = ?
          AND model_aliases.enabled = 1
          AND model_bindings.enabled = 1
          AND providers.enabled = 1
          AND model_bindings.protocol = ?
        ORDER BY model_bindings.runtime_priority ASC
      `
    )
    .all(alias, protocol) as Array<{
    binding_id: string;
    model_alias_id: string;
    model_alias: string;
    display_name: string;
    provider_id: string;
    provider_name: string;
    provider_base_url: string;
    provider_api_key_encrypted: string;
    provider_protocol: string;
    provider_api_version: string | null;
    upstream_model: string;
    input_price: number;
    output_price: number;
  }>;

  if (rows.length === 0) {
    return {
      kind: "not_found"
    };
  }

  const matchedRow = rows.find((row) => isBindingAllowedByScope(row, scopeSets));
  if (!matchedRow) {
    return {
      kind: "scope_denied"
    };
  }

  const providerProtocol = normalizeProviderProtocol(matchedRow.provider_protocol);

  return {
    kind: "matched",
    binding: {
      bindingId: matchedRow.binding_id,
      modelAliasId: matchedRow.model_alias_id,
      modelAlias: matchedRow.model_alias,
      displayName: matchedRow.display_name,
      providerId: matchedRow.provider_id,
      providerName: matchedRow.provider_name,
      providerBaseUrl: matchedRow.provider_base_url,
      providerApiKeyEncrypted: matchedRow.provider_api_key_encrypted,
      providerProtocol,
      providerApiVersion:
        providerProtocol === "anthropic"
          ? (matchedRow.provider_api_version ?? ANTHROPIC_API_VERSION)
          : null,
      upstreamModel: matchedRow.upstream_model,
      inputPrice: Number(matchedRow.input_price),
      outputPrice: Number(matchedRow.output_price)
    }
  };
}
