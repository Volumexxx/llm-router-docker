import type { DatabaseSync } from "node:sqlite";

import type { FastifyRequest } from "fastify";

import type { z } from "zod";

import {
  auditQuerySchema,
  auditStatusSchema,
  endpointTypeSchema
} from "../../../../packages/shared/src/index.ts";
import { createId, nowIso } from "../lib/utils.ts";
import { getClientIp } from "../security/ip.ts";

export interface AuditLogInput {
  requestId: string;
  endpointType: z.infer<typeof endpointTypeSchema>;
  providerId?: string | null;
  providerName?: string | null;
  modelAlias?: string | null;
  upstreamModel?: string | null;
  isStream?: boolean;
  statusCategory: z.infer<typeof auditStatusSchema>;
  httpStatus: number;
  latencyMs: number;
  inputTokens?: number | null;
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
          model_alias,
          upstream_model,
          is_stream,
          status_category,
          http_status,
          latency_ms,
          input_tokens,
          output_tokens,
          total_tokens,
          estimated_cost,
          error_code,
          error_summary,
          client_ip,
          user_agent
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      createId(),
      input.requestId,
      nowIso(),
      input.endpointType,
      input.providerId ?? null,
      input.providerName ?? null,
      input.modelAlias ?? null,
      input.upstreamModel ?? null,
      input.isStream ? 1 : 0,
      input.statusCategory,
      input.httpStatus,
      input.latencyMs,
      input.inputTokens ?? null,
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

export function queryAuditLogs(sqlite: DatabaseSync, input: AuditQueryInput) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (input.providerId) {
    clauses.push("provider_id = ?");
    params.push(input.providerId);
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
    .all(...params, input.pageSize, offset);

  const totalRow = sqlite
    .prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where}`)
    .get(...params) as { count: number };

  return {
    items,
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
  end: string
): Array<Record<string, unknown>> {
  return sqlite
    .prepare(
      `
        SELECT *
        FROM audit_logs
        WHERE endpoint_type IN ('chat_completions', 'responses')
          AND occurred_at >= ?
          AND occurred_at <= ?
        ORDER BY occurred_at ASC
      `
    )
    .all(start, end) as Array<Record<string, unknown>>;
}
