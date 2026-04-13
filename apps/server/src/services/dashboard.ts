import type { DatabaseSync } from "node:sqlite";

import type { DashboardCard, DashboardSummary, TrendPoint } from "../../../../packages/shared/src/index.ts";
import {
  average,
  calculatePercentile,
  dashboardRangeSchema
} from "../../../../packages/shared/src/index.ts";
import { queryInferenceAuditRows } from "./audit.ts";

type DashboardRange = typeof dashboardRangeSchema._type;

interface BucketAccumulator {
  label: string;
  latencies: number[];
  requests: number;
  successes: number;
  failures: number;
  totalTokens: number;
  estimatedCost: number;
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
    totalTokens: bucket.totalTokens,
    estimatedCost: Number(bucket.estimatedCost.toFixed(8)),
    averageLatencyMs: average(bucket.latencies),
    p95LatencyMs: calculatePercentile(bucket.latencies, 95)
  }));
}

function createCard(key: string, label: string, buckets: BucketAccumulator[]): DashboardCard {
  const trend = finalizeBuckets(buckets);
  const latencies = buckets.flatMap((bucket) => bucket.latencies);
  const requests = trend.reduce((sum, point) => sum + point.requests, 0);
  const successes = trend.reduce((sum, point) => sum + point.successes, 0);
  const failures = trend.reduce((sum, point) => sum + point.failures, 0);
  const totalTokens = trend.reduce((sum, point) => sum + point.totalTokens, 0);
  const estimatedCost = Number(
    trend.reduce((sum, point) => sum + point.estimatedCost, 0).toFixed(8)
  );

  return {
    key,
    label,
    requests,
    successes,
    failures,
    totalTokens,
    estimatedCost,
    averageLatencyMs: average(latencies),
    p95LatencyMs: calculatePercentile(latencies, 95),
    trend
  };
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
  );

  const overallBuckets = makeBuckets(range);
  const providerBuckets = new Map<string, BucketAccumulator[]>();
  const modelBuckets = new Map<string, BucketAccumulator[]>();

  const overallLatencies: number[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let estimatedCost = 0;
  let missingUsageCount = 0;
  let successes = 0;
  let failures = 0;

  for (const row of rows) {
    const occurredAt = String(row.occurred_at);
    const index = bucketIndex(range, occurredAt);
    if (index == null) {
      continue;
    }

    const isSuccess = String(row.status_category) === "success";
    const latency = Number(row.latency_ms ?? 0);
    const tokens = Number(row.total_tokens ?? 0);
    const cost = Number(row.estimated_cost ?? 0);
    const providerLabel = String(row.provider_name ?? "未知 Provider");
    const modelLabel = String(row.model_alias ?? "未知模型");

    const bucket = overallBuckets[index];
    bucket.requests += 1;
    bucket.successes += isSuccess ? 1 : 0;
    bucket.failures += isSuccess ? 0 : 1;
    bucket.totalTokens += tokens;
    bucket.estimatedCost += cost;
    bucket.latencies.push(latency);

    const providerBucketList = providerBuckets.get(providerLabel) ?? makeBuckets(range);
    const providerBucket = providerBucketList[index];
    providerBucket.requests += 1;
    providerBucket.successes += isSuccess ? 1 : 0;
    providerBucket.failures += isSuccess ? 0 : 1;
    providerBucket.totalTokens += tokens;
    providerBucket.estimatedCost += cost;
    providerBucket.latencies.push(latency);
    providerBuckets.set(providerLabel, providerBucketList);

    const modelBucketList = modelBuckets.get(modelLabel) ?? makeBuckets(range);
    const modelBucket = modelBucketList[index];
    modelBucket.requests += 1;
    modelBucket.successes += isSuccess ? 1 : 0;
    modelBucket.failures += isSuccess ? 0 : 1;
    modelBucket.totalTokens += tokens;
    modelBucket.estimatedCost += cost;
    modelBucket.latencies.push(latency);
    modelBuckets.set(modelLabel, modelBucketList);

    successes += isSuccess ? 1 : 0;
    failures += isSuccess ? 0 : 1;
    overallLatencies.push(latency);
    inputTokens += Number(row.input_tokens ?? 0);
    outputTokens += Number(row.output_tokens ?? 0);
    totalTokens += tokens;
    estimatedCost += cost;

    if (row.total_tokens == null) {
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
      .sort((a, b) => b.requests - a.requests),
    modelCards: Array.from(modelBuckets.entries())
      .map(([label, buckets]) => createCard(label, label, buckets))
      .sort((a, b) => b.requests - a.requests)
  };
}
