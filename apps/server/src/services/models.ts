import type { DatabaseSync } from "node:sqlite";

import type { z } from "zod";

import {
  bindingCreateSchema,
  bindingUpdateSchema,
  modelAliasCreateSchema,
  modelAliasUpdateSchema
} from "../../../../packages/shared/src/index.ts";
import { createId, nowIso } from "../lib/utils.ts";

export interface ModelBindingView {
  id: string;
  providerId: string;
  providerName: string;
  upstreamModel: string;
  inputPrice: number;
  outputPrice: number;
  enabled: boolean;
  runtimePriority: number;
  defaultPriority: number;
}

export interface ModelAliasView {
  id: string;
  alias: string;
  displayName: string;
  enabled: boolean;
  bindings: ModelBindingView[];
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
  upstreamModel: string;
  inputPrice: number;
  outputPrice: number;
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
          model_bindings.upstream_model,
          model_bindings.input_price,
          model_bindings.output_price,
          model_bindings.enabled,
          model_bindings.runtime_priority,
          model_bindings.default_priority,
          providers.name AS provider_name
        FROM model_bindings
        INNER JOIN providers ON providers.id = model_bindings.provider_id
        ORDER BY model_bindings.runtime_priority ASC
      `
    )
    .all() as Array<{
    id: string;
    model_alias_id: string;
    provider_id: string;
    upstream_model: string;
    input_price: number;
    output_price: number;
    enabled: number;
    runtime_priority: number;
    default_priority: number;
    provider_name: string;
  }>;

  const bindingMap = new Map<string, ModelBindingView[]>();

  for (const binding of bindings) {
    const list = bindingMap.get(binding.model_alias_id) ?? [];
    list.push({
      id: binding.id,
      providerId: binding.provider_id,
      providerName: binding.provider_name,
      upstreamModel: binding.upstream_model,
      inputPrice: Number(binding.input_price),
      outputPrice: Number(binding.output_price),
      enabled: Boolean(binding.enabled),
      runtimePriority: binding.runtime_priority,
      defaultPriority: binding.default_priority
    });
    bindingMap.set(binding.model_alias_id, list);
  }

  return models.map((model) => ({
    id: model.id,
    alias: model.alias,
    displayName: model.display_name,
    enabled: Boolean(model.enabled),
    bindings: bindingMap.get(model.id) ?? []
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

function nextBindingPriority(sqlite: DatabaseSync, modelId: string): number {
  const row = sqlite
    .prepare(
      `
        SELECT COALESCE(MAX(runtime_priority), -1) AS max_priority
        FROM model_bindings
        WHERE model_alias_id = ?
      `
    )
    .get(modelId) as { max_priority: number };

  return row.max_priority + 1;
}

export function createBinding(
  sqlite: DatabaseSync,
  modelId: string,
  input: z.infer<typeof bindingCreateSchema>
): ModelAliasView | null {
  const priority = nextBindingPriority(sqlite, modelId);
  const timestamp = nowIso();

  sqlite
    .prepare(
      `
        INSERT INTO model_bindings (
          id,
          model_alias_id,
          provider_id,
          upstream_model,
          input_price,
          output_price,
          enabled,
          runtime_priority,
          default_priority,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      createId(),
      modelId,
      input.providerId,
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
  bindingIds: string[]
): ModelAliasView | null {
  try {
    sqlite.exec("BEGIN");
    bindingIds.forEach((bindingId, index) => {
      sqlite
        .prepare(
          `
            UPDATE model_bindings
            SET runtime_priority = ?, updated_at = ?
            WHERE id = ? AND model_alias_id = ?
          `
        )
        .run(index, nowIso(), bindingId, modelId);
    });
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  return getModelById(sqlite, modelId);
}

export function saveRuntimeOrderAsDefault(sqlite: DatabaseSync, modelId: string): ModelAliasView | null {
  sqlite
    .prepare(
      `
        UPDATE model_bindings
        SET default_priority = runtime_priority,
            updated_at = ?
        WHERE model_alias_id = ?
      `
    )
    .run(nowIso(), modelId);

  return getModelById(sqlite, modelId);
}

export function listVisibleModels(sqlite: DatabaseSync) {
  return sqlite
    .prepare(
      `
        SELECT DISTINCT
          model_aliases.alias,
          model_aliases.display_name
        FROM model_aliases
        INNER JOIN model_bindings ON model_bindings.model_alias_id = model_aliases.id
        INNER JOIN providers ON providers.id = model_bindings.provider_id
        WHERE model_aliases.enabled = 1
          AND model_bindings.enabled = 1
          AND providers.enabled = 1
        ORDER BY model_aliases.alias ASC
      `
    )
    .all() as Array<{ alias: string; display_name: string }>;
}

export function resolveRoutableBinding(
  sqlite: DatabaseSync,
  alias: string
): RoutableBinding | null {
  const row = sqlite
    .prepare(
      `
        SELECT
          model_bindings.id AS binding_id,
          model_aliases.id AS model_alias_id,
          model_aliases.alias AS model_alias,
          model_aliases.display_name AS display_name,
          providers.id AS provider_id,
          providers.name AS provider_name,
          providers.base_url AS provider_base_url,
          providers.api_key_encrypted AS provider_api_key_encrypted,
          model_bindings.upstream_model AS upstream_model,
          model_bindings.input_price AS input_price,
          model_bindings.output_price AS output_price
        FROM model_aliases
        INNER JOIN model_bindings ON model_bindings.model_alias_id = model_aliases.id
        INNER JOIN providers ON providers.id = model_bindings.provider_id
        WHERE model_aliases.alias = ?
          AND model_aliases.enabled = 1
          AND model_bindings.enabled = 1
          AND providers.enabled = 1
        ORDER BY model_bindings.runtime_priority ASC
        LIMIT 1
      `
    )
    .get(alias) as
    | {
        binding_id: string;
        model_alias_id: string;
        model_alias: string;
        display_name: string;
        provider_id: string;
        provider_name: string;
        provider_base_url: string;
        provider_api_key_encrypted: string;
        upstream_model: string;
        input_price: number;
        output_price: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    bindingId: row.binding_id,
    modelAliasId: row.model_alias_id,
    modelAlias: row.model_alias,
    displayName: row.display_name,
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerBaseUrl: row.provider_base_url,
    providerApiKeyEncrypted: row.provider_api_key_encrypted,
    upstreamModel: row.upstream_model,
    inputPrice: Number(row.input_price),
    outputPrice: Number(row.output_price)
  };
}
