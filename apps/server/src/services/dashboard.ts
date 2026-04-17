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

interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface DashboardWindow {
  start: Date;
  end: Date;
  labels: string[];
  currentBucketIndex: number;
  startParts: ZonedDateTimeParts;
  anchorDate: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

function normalizeTimezone(timezone: string): string {
  try {
    getFormatter(timezone);
    return timezone;
  } catch {
    return "UTC";
  }
}

function readZonedParts(date: Date, timezone: string): ZonedDateTimeParts {
  const values: Partial<Record<keyof ZonedDateTimeParts, number>> = {};

  for (const part of getFormatter(timezone).formatToParts(date)) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute" ||
      part.type === "second"
    ) {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year ?? 1970,
    month: values.month ?? 1,
    day: values.day ?? 1,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0
  };
}

function zonedTimeToUtc(parts: ZonedDateTimeParts, timezone: string): Date {
  let timestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = readZonedParts(new Date(timestamp), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      0
    );
    const wantedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      0
    );
    const delta = actualAsUtc - wantedAsUtc;

    if (delta === 0) {
      break;
    }

    timestamp -= delta;
  }

  return new Date(timestamp);
}

function startOfZonedDay(parts: ZonedDateTimeParts): ZonedDateTimeParts {
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0
  };
}

function addUtcDays(parts: ZonedDateTimeParts, days: number): ZonedDateTimeParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatMonthDay(parts: ZonedDateTimeParts): string {
  return `${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatDashboardDate(parts: Pick<ZonedDateTimeParts, "year" | "month" | "day">): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseDashboardDate(value: string): Pick<ZonedDateTimeParts, "year" | "month" | "day"> {
  const [year, month, day] = value.split("-").map((part) => Number(part));

  return {
    year,
    month,
    day
  };
}

function buildDashboardWindow(
  range: DashboardRange,
  timezoneInput: string,
  now = new Date(),
  anchorDate?: string
): DashboardWindow {
  const timezone = normalizeTimezone(timezoneInput);
  const nowParts = readZonedParts(now, timezone);
  const currentAnchorDate = formatDashboardDate(nowParts);

  if (range === "day") {
    const anchorParts = anchorDate
      ? {
          ...parseDashboardDate(anchorDate),
          hour: 0,
          minute: 0,
          second: 0
        }
      : startOfZonedDay(nowParts);
    const resolvedAnchorDate = formatDashboardDate(anchorParts);
    const nextStartParts = addUtcDays(anchorParts, 1);

    return {
      start: zonedTimeToUtc(anchorParts, timezone),
      end: new Date(zonedTimeToUtc(nextStartParts, timezone).getTime() - 1),
      labels: Array.from({ length: 24 }, (_, index) => `${String(index).padStart(2, "0")}:00`),
      currentBucketIndex: resolvedAnchorDate === currentAnchorDate ? nowParts.hour : 23,
      startParts: anchorParts,
      anchorDate: resolvedAnchorDate
    };
  }

  if (range === "week") {
    const dayOfWeek = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)).getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const startParts = addUtcDays(startOfZonedDay(nowParts), -daysSinceMonday);
    const nextStartParts = addUtcDays(startParts, 7);
    const labels = Array.from({ length: 7 }, (_, index) => formatMonthDay(addUtcDays(startParts, index)));

    return {
      start: zonedTimeToUtc(startParts, timezone),
      end: new Date(zonedTimeToUtc(nextStartParts, timezone).getTime() - 1),
      labels,
      currentBucketIndex: daysSinceMonday,
      startParts,
      anchorDate: currentAnchorDate
    };
  }

  const startParts = {
    year: nowParts.year,
    month: nowParts.month,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0
  };
  const monthLength = daysInMonth(nowParts.year, nowParts.month);
  const nextStartParts =
    nowParts.month === 12
      ? { ...startParts, year: nowParts.year + 1, month: 1 }
      : { ...startParts, month: nowParts.month + 1 };
  const labels = Array.from({ length: monthLength }, (_, index) =>
    formatMonthDay({
      ...startParts,
      day: index + 1
    })
  );

  return {
    start: zonedTimeToUtc(startParts, timezone),
    end: new Date(zonedTimeToUtc(nextStartParts, timezone).getTime() - 1),
    labels,
    currentBucketIndex: nowParts.day - 1,
    startParts,
    anchorDate: currentAnchorDate
  };
}

function makeBuckets(labels: string[]): BucketAccumulator[] {
  return labels.map((label) => ({
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
  }));
}

function bucketIndex(
  range: DashboardRange,
  occurredAt: string,
  timezone: string,
  window: DashboardWindow
): number | null {
  const timestamp = new Date(occurredAt).getTime();
  if (!Number.isFinite(timestamp) || timestamp < window.start.getTime() || timestamp > window.end.getTime()) {
    return null;
  }

  const parts = readZonedParts(new Date(timestamp), timezone);

  if (range === "day") {
    return parts.hour >= 0 && parts.hour < window.labels.length ? parts.hour : null;
  }

  const localEventDay = Date.UTC(parts.year, parts.month - 1, parts.day);
  const localWindowStartDay = Date.UTC(
    window.startParts.year,
    window.startParts.month - 1,
    window.startParts.day
  );
  const index = Math.floor((localEventDay - localWindowStartDay) / DAY_MS);

  return index >= 0 && index < window.labels.length ? index : null;
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
  range: DashboardRange,
  timezoneInput = "UTC",
  now = new Date(),
  anchorDate?: string
): DashboardSummary {
  const timezone = normalizeTimezone(timezoneInput);
  const window = buildDashboardWindow(range, timezone, now, anchorDate);
  const rows = queryInferenceAuditRows(sqlite, window.start.toISOString(), window.end.toISOString()).map((row) =>
    toAuditMetricRow(row)
  );

  const overallBuckets = makeBuckets(window.labels);
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
    const index = bucketIndex(range, row.occurred_at, timezone, window);
    if (index == null) {
      continue;
    }

    const isSuccess = row.status_category === "success";
    const latency = row.latency_ms ?? 0;
    const tokens = getDisplayTokens(row);
    const cost = row.estimated_cost ?? 0;
    const providerLabel = row.provider_name?.trim() || null;
    const modelLabel = row.model_alias ?? "Unknown Model";
    const apiKeyLabel = formatApiKeyLabel(row.api_key_name, row.api_key_masked_preview);
    const apiKeyGroupKey = row.api_key_id ?? `${row.api_key_name ?? ""}:${row.api_key_masked_preview ?? ""}`;

    accumulateBucket(overallBuckets[index], isSuccess, latency, tokens, cost);

    if (providerLabel) {
      const providerBucketList = providerBuckets.get(providerLabel) ?? makeBuckets(window.labels);
      accumulateBucket(providerBucketList[index], isSuccess, latency, tokens, cost);
      providerBuckets.set(providerLabel, providerBucketList);
    }

    const modelBucketList = modelBuckets.get(modelLabel) ?? makeBuckets(window.labels);
    accumulateBucket(modelBucketList[index], isSuccess, latency, tokens, cost);
    modelBuckets.set(modelLabel, modelBucketList);

    const apiKeyBucketEntry = apiKeyBuckets.get(apiKeyGroupKey) ?? {
      label: apiKeyLabel,
      buckets: makeBuckets(window.labels)
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
    windowEnd: window.end.toISOString(),
    timezone,
    anchorDate: window.anchorDate,
    currentBucketIndex: window.currentBucketIndex,
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
