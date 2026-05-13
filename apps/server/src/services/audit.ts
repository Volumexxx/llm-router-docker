import type { DatabaseSync } from "node:sqlite";

import type { FastifyRequest } from "fastify";

import type { z } from "zod";

import {
  auditQuerySchema,
  auditStatusSchema,
  endpointTypeSchema,
  normalizeDisplayInputTokens
} from "../../../../packages/shared/src/index.ts";
import { createId, nowIso } from "../lib/utils.ts";
import { getClientIp } from "../security/ip.ts";

export interface AuditLogInput {
  requestId: string;
  endpointType: z.infer<typeof endpointTypeSchema>;
  providerId?: string | null;
  providerName?: string | null;
  providerProtocol?: "openai" | "anthropic" | null;
  modelAlias?: string | null;
  upstreamModel?: string | null;
  apiKeyId?: string | null;
  apiKeyName?: string | null;
  apiKeyMaskedPreview?: string | null;
  userId?: string | null;
  userDisplayName?: string | null;
  isStream?: boolean;
  statusCategory: z.infer<typeof auditStatusSchema>;
  httpStatus: number;
  latencyMs: number;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
}

export function writeAuditLog(sqlite: DatabaseSync, input: AuditLogInput): void {
  sqlite
    .prepare(
      `
        INSERT INTO audit_logs (
          id,
          request_id,
          occurred_at,
          endpoint_type,
          provider_id,
          provider_name,
          provider_protocol,
          model_alias,
          upstream_model,
          api_key_id,
          api_key_name,
          api_key_masked_preview,
          user_id,
          user_display_name,
          is_stream,
          status_category,
          http_status,
          latency_ms,
          input_tokens,
          cached_input_tokens,
          output_tokens,
          total_tokens,
          estimated_cost,
          error_code,
          error_summary,
          client_ip,
          user_agent
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      createId(),
      input.requestId,
      nowIso(),
      input.endpointType,
      input.providerId ?? null,
      input.providerName ?? null,
      input.providerProtocol ?? null,
      input.modelAlias ?? null,
      input.upstreamModel ?? null,
      input.apiKeyId ?? null,
      input.apiKeyName ?? null,
      input.apiKeyMaskedPreview ?? null,
      input.userId ?? null,
      input.userDisplayName ?? null,
      input.isStream ? 1 : 0,
      input.statusCategory,
      input.httpStatus,
      input.latencyMs,
      input.inputTokens ?? null,
      input.cachedInputTokens ?? null,
      input.outputTokens ?? null,
      input.totalTokens ?? null,
      input.estimatedCost ?? null,
      input.errorCode ?? null,
      input.errorSummary ?? null,
      input.clientIp ?? null,
      input.userAgent ?? null
    );
}

export function writeSecurityAuditFromRequest(
  sqlite: DatabaseSync,
  request: FastifyRequest,
  payload: Omit<AuditLogInput, "clientIp" | "userAgent">
): void {
  writeAuditLog(sqlite, {
    ...payload,
    clientIp: getClientIp(request),
    userAgent: request.headers["user-agent"]?.toString() ?? null
  });
}

export interface AuditQueryInput extends z.infer<typeof auditQuerySchema> {}

function mapAuditRow(row: Record<string, unknown>) {
  const rawInputTokens =
    typeof row.input_tokens === "number" && Number.isFinite(row.input_tokens)
      ? row.input_tokens
      : null;
  const cachedInputTokens =
    typeof row.cached_input_tokens === "number" && Number.isFinite(row.cached_input_tokens)
      ? row.cached_input_tokens
      : 0;
  const outputTokens =
    typeof row.output_tokens === "number" && Number.isFinite(row.output_tokens)
      ? row.output_tokens
      : null;
  const totalTokens =
    typeof row.total_tokens === "number" && Number.isFinite(row.total_tokens)
      ? row.total_tokens
      : rawInputTokens != null || outputTokens != null
        ? (rawInputTokens ?? 0) + (outputTokens ?? 0)
        : null;

  return {
    ...row,
    input_tokens: normalizeDisplayInputTokens(rawInputTokens, cachedInputTokens),
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens
  };
}

export function queryAuditLogs(sqlite: DatabaseSync, input: AuditQueryInput) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (input.providerId) {
    clauses.push("provider_id = ?");
    params.push(input.providerId);
  }
  if (input.apiKeyId) {
    clauses.push("api_key_id = ?");
    params.push(input.apiKeyId);
  }
  if (input.userId) {
    clauses.push("user_id = ?");
    params.push(input.userId);
  }
  if (input.modelAlias) {
    clauses.push("model_alias = ?");
    params.push(input.modelAlias);
  }
  if (input.statusCategory) {
    clauses.push("status_category = ?");
    params.push(input.statusCategory);
  }
  if (input.endpointType) {
    clauses.push("endpoint_type = ?");
    params.push(input.endpointType);
  }
  if (input.start) {
    clauses.push("occurred_at >= ?");
    params.push(input.start);
  }
  if (input.end) {
    clauses.push("occurred_at <= ?");
    params.push(input.end);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const offset = (input.page - 1) * input.pageSize;

  const items = sqlite
    .prepare(
      `
        SELECT *
        FROM audit_logs
        ${where}
        ORDER BY occurred_at DESC
        LIMIT ?
        OFFSET ?
      `
    )
    .all(...params, input.pageSize, offset) as Array<Record<string, unknown>>;

  const totalRow = sqlite
    .prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where}`)
    .get(...params) as { count: number };

  return {
    items: items.map((row) => mapAuditRow(row)),
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: totalRow.count,
      totalPages: Math.max(1, Math.ceil(totalRow.count / input.pageSize))
    }
  };
}

export function queryInferenceAuditRows(
  sqlite: DatabaseSync,
  start: string,
  end: string,
  filters?: {
    providerId?: string;
    modelAlias?: string;
    apiKeyId?: string;
    userId?: string;
  }
): Array<Record<string, unknown>> {
  const clauses = [
    "endpoint_type IN ('chat_completions', 'responses', 'messages')",
    "occurred_at >= ?",
    "occurred_at <= ?"
  ];
  const params: Array<string> = [start, end];

  if (filters?.providerId) {
    clauses.push("provider_id = ?");
    params.push(filters.providerId);
  }

  if (filters?.modelAlias) {
    clauses.push("model_alias = ?");
    params.push(filters.modelAlias);
  }

  if (filters?.apiKeyId) {
    clauses.push("api_key_id = ?");
    params.push(filters.apiKeyId);
  }

  if (filters?.userId) {
    clauses.push("user_id = ?");
    params.push(filters.userId);
  }

  return sqlite
    .prepare(
      `
        SELECT *
        FROM audit_logs
        WHERE ${clauses.join("\n          AND ")}
        ORDER BY occurred_at ASC
      `
    )
    .all(...params) as Array<Record<string, unknown>>;
}
