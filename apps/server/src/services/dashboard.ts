import type { DatabaseSync } from "node:sqlite";

import type { DashboardCard, DashboardSummary, TrendPoint } from "../../../../packages/shared/src/index.ts";
import {
  average,
  calculatePercentile,
  dashboardRangeSchema,
  formatApiKeyLabel,
  normalizeDisplayInputTokens
} from "../../../../packages/shared/src/index.ts";
import { queryInferenceAuditRows } from "./audit.ts";

type DashboardRange = typeof dashboardRangeSchema._type;

interface BucketAccumulator {
  label: string;
  latencies: number[];
  requests: number;
  successes: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

interface AuditMetricRow {
  occurred_at: string;
  status_category: string;
  latency_ms: number | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost: number | null;
  provider_name: string | null;
  model_alias: string | null;
  api_key_id: string | null;
  api_key_name: string | null;
  api_key_masked_preview: string | null;
}

function buildWindow(range: DashboardRange): { start: Date; end: Date; bucketCount: number; stepMs: number } {
  const end = new Date();

  if (range === "day") {
    const aligned = new Date(end);
    aligned.setUTCMinutes(0, 0, 0);
    return {
      end: aligned,
      start: new Date(aligned.getTime() - 23 * 60 * 60 * 1000),
      bucketCount: 24,
      stepMs: 60 * 60 * 1000
    };
  }

  const aligned = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const days = range === "week" ? 7 : 30;
  return {
    end: aligned,
    start: new Date(aligned.getTime() - (days - 1) * 24 * 60 * 60 * 1000),
    bucketCount: days,
    stepMs: 24 * 60 * 60 * 1000
  };
}

function makeBuckets(range: DashboardRange): BucketAccumulator[] {
  const window = buildWindow(range);

  return Array.from({ length: window.bucketCount }, (_, index) => {
    const date = new Date(window.start.getTime() + index * window.stepMs);
    const label =
      range === "day"
        ? `${String(date.getUTCHours()).padStart(2, "0")}:00`
        : `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

    return {
      label,
      latencies: [],
      requests: 0,
      successes: 0,
      failures: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      totalTokens: 0,
      estimatedCost: 0
    };
  });
}

function bucketIndex(range: DashboardRange, occurredAt: string): number | null {
  const window = buildWindow(range);
  const timestamp = new Date(occurredAt).getTime();
  const diff = timestamp - window.start.getTime();
  if (diff < 0) {
    return null;
  }

  const index = Math.floor(diff / window.stepMs);
  return index >= 0 && index < window.bucketCount ? index : null;
}

function finalizeBuckets(buckets: BucketAccumulator[]): TrendPoint[] {
  return buckets.map((bucket) => ({
    label: bucket.label,
    requests: bucket.requests,
    successes: bucket.successes,
    failures: bucket.failures,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    cacheTokens: bucket.cacheTokens,
    totalTokens: bucket.totalTokens,
    estimatedCost: Number(bucket.estimatedCost.toFixed(8)),
    averageLatencyMs: average(bucket.latencies),
    p95LatencyMs: calculatePercentile(bucket.latencies, 95)
  }));
}

function createCard(key: string, label: string, buckets: BucketAccumulator[]): DashboardCard {
  const trend = finalizeBuckets(buckets);
  const latencies = buckets.flatMap((bucket) => bucket.latencies);

  return {
    key,
    label,
    requests: trend.reduce((sum, point) => sum + point.requests, 0),
    successes: trend.reduce((sum, point) => sum + point.successes, 0),
    failures: trend.reduce((sum, point) => sum + point.failures, 0),
    inputTokens: trend.reduce((sum, point) => sum + point.inputTokens, 0),
    outputTokens: trend.reduce((sum, point) => sum + point.outputTokens, 0),
    cacheTokens: trend.reduce((sum, point) => sum + point.cacheTokens, 0),
    totalTokens: trend.reduce((sum, point) => sum + point.totalTokens, 0),
    estimatedCost: Number(trend.reduce((sum, point) => sum + point.estimatedCost, 0).toFixed(8)),
    averageLatencyMs: average(latencies),
    p95LatencyMs: calculatePercentile(latencies, 95),
    trend
  };
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toAuditMetricRow(row: Record<string, unknown>): AuditMetricRow {
  return {
    occurred_at: String(row.occurred_at),
    status_category: String(row.status_category ?? ""),
    latency_ms: readNumber(row.latency_ms),
    input_tokens: readNumber(row.input_tokens),
    cached_input_tokens: readNumber(row.cached_input_tokens),
    output_tokens: readNumber(row.output_tokens),
    total_tokens: readNumber(row.total_tokens),
    estimated_cost: readNumber(row.estimated_cost),
    provider_name: row.provider_name != null ? String(row.provider_name) : null,
    model_alias: row.model_alias != null ? String(row.model_alias) : null,
    api_key_id: row.api_key_id != null ? String(row.api_key_id) : null,
    api_key_name: row.api_key_name != null ? String(row.api_key_name) : null,
    api_key_masked_preview:
      row.api_key_masked_preview != null ? String(row.api_key_masked_preview) : null
  };
}

function getDisplayTokens(row: AuditMetricRow) {
  const cacheTokens = row.cached_input_tokens ?? 0;
  const inputTokens = normalizeDisplayInputTokens(row.input_tokens, cacheTokens) ?? 0;
  const outputTokens = row.output_tokens ?? 0;
  const totalTokens =
    row.total_tokens ?? (row.input_tokens != null || row.output_tokens != null ? (row.input_tokens ?? 0) + outputTokens : 0);

  return {
    inputTokens,
    outputTokens,
    cacheTokens,
    totalTokens
  };
}

function accumulateBucket(
  bucket: BucketAccumulator,
  isSuccess: boolean,
  latency: number,
  tokens: ReturnType<typeof getDisplayTokens>,
  estimatedCost: number
): void {
  bucket.requests += 1;
  bucket.successes += isSuccess ? 1 : 0;
  bucket.failures += isSuccess ? 0 : 1;
  bucket.inputTokens += tokens.inputTokens;
  bucket.outputTokens += tokens.outputTokens;
  bucket.cacheTokens += tokens.cacheTokens;
  bucket.totalTokens += tokens.totalTokens;
  bucket.estimatedCost += estimatedCost;
  bucket.latencies.push(latency);
}

export function buildDashboardSummary(
  sqlite: DatabaseSync,
  range: DashboardRange
): DashboardSummary {
  const window = buildWindow(range);
  const rows = queryInferenceAuditRows(
    sqlite,
    window.start.toISOString(),
    new Date(window.end.getTime() + window.stepMs - 1).toISOString()
  ).map((row) => toAuditMetricRow(row));

  const overallBuckets = makeBuckets(range);
  const providerBuckets = new Map<string, BucketAccumulator[]>();
  const modelBuckets = new Map<string, BucketAccumulator[]>();
  const apiKeyBuckets = new Map<
    string,
    {
      label: string;
      buckets: BucketAccumulator[];
    }
  >();

  const overallLatencies: number[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let totalTokens = 0;
  let estimatedCost = 0;
  let missingUsageCount = 0;
  let successes = 0;
  let failures = 0;

  for (const row of rows) {
    const index = bucketIndex(range, row.occurred_at);
    if (index == null) {
      continue;
    }

    const isSuccess = row.status_category === "success";
    const latency = row.latency_ms ?? 0;
    const tokens = getDisplayTokens(row);
    const cost = row.estimated_cost ?? 0;
    const providerLabel = row.provider_name ?? "Unknown Provider";
    const modelLabel = row.model_alias ?? "Unknown Model";
    const apiKeyLabel = formatApiKeyLabel(row.api_key_name, row.api_key_masked_preview);
    const apiKeyGroupKey = row.api_key_id ?? `${row.api_key_name ?? ""}:${row.api_key_masked_preview ?? ""}`;

    accumulateBucket(overallBuckets[index], isSuccess, latency, tokens, cost);

    const providerBucketList = providerBuckets.get(providerLabel) ?? makeBuckets(range);
    accumulateBucket(providerBucketList[index], isSuccess, latency, tokens, cost);
    providerBuckets.set(providerLabel, providerBucketList);

    const modelBucketList = modelBuckets.get(modelLabel) ?? makeBuckets(range);
    accumulateBucket(modelBucketList[index], isSuccess, latency, tokens, cost);
    modelBuckets.set(modelLabel, modelBucketList);

    const apiKeyBucketEntry = apiKeyBuckets.get(apiKeyGroupKey) ?? {
      label: apiKeyLabel,
      buckets: makeBuckets(range)
    };
    apiKeyBucketEntry.label = apiKeyLabel;
    accumulateBucket(apiKeyBucketEntry.buckets[index], isSuccess, latency, tokens, cost);
    apiKeyBuckets.set(apiKeyGroupKey, apiKeyBucketEntry);

    successes += isSuccess ? 1 : 0;
    failures += isSuccess ? 0 : 1;
    overallLatencies.push(latency);
    inputTokens += tokens.inputTokens;
    outputTokens += tokens.outputTokens;
    cacheTokens += tokens.cacheTokens;
    totalTokens += tokens.totalTokens;
    estimatedCost += cost;

    if (row.input_tokens == null && row.output_tokens == null && row.total_tokens == null) {
      missingUsageCount += 1;
    }
  }

  return {
    range,
    windowStart: window.start.toISOString(),
    windowEnd: new Date(window.end.getTime() + window.stepMs - 1).toISOString(),
    overall: {
      requests: successes + failures,
      successes,
      failures,
      errorRate: successes + failures === 0 ? 0 : Number((failures / (successes + failures)).toFixed(4)),
      inputTokens,
      outputTokens,
      cacheTokens,
      totalTokens,
      estimatedCost: Number(estimatedCost.toFixed(8)),
      averageLatencyMs: average(overallLatencies),
      p50LatencyMs: calculatePercentile(overallLatencies, 50),
      p95LatencyMs: calculatePercentile(overallLatencies, 95),
      missingUsageCount
    },
    trend: finalizeBuckets(overallBuckets),
    providerCards: Array.from(providerBuckets.entries())
      .map(([label, buckets]) => createCard(label, label, buckets))
      .sort((left, right) => right.requests - left.requests),
    modelCards: Array.from(modelBuckets.entries())
      .map(([label, buckets]) => createCard(label, label, buckets))
      .sort((left, right) => right.requests - left.requests),
    apiKeyCards: Array.from(apiKeyBuckets.entries())
      .map(([key, value]) => createCard(key, value.label, value.buckets))
      .sort((left, right) => right.requests - left.requests)
  };
}
