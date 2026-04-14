import { createHash, randomUUID } from "node:crypto";

import type { TokenUsage } from "../../../../packages/shared/src/index.ts";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(): string {
  return randomUUID();
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function clampText(value: string | null | undefined, maxLength = 300): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function joinUrl(baseUrl: string, pathname: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = pathname.replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function looksLikeUsageRecord(value: unknown): value is Record<string, unknown> {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  return [
    "prompt_tokens",
    "input_tokens",
    "completion_tokens",
    "output_tokens",
    "total_tokens",
    "prompt_tokens_details",
    "input_tokens_details"
  ].some((key) => key in record);
}

function findUsageRecord(payload: unknown): Record<string, unknown> | null {
  const queue: unknown[] = [payload];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (looksLikeUsageRecord(current)) {
      return current;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    const nestedUsage = record.usage;
    if (looksLikeUsageRecord(nestedUsage)) {
      return nestedUsage;
    }

    queue.push(...Object.values(record));
  }

  return null;
}

function readCachedInputTokens(usage: Record<string, unknown>): number | null {
  const promptDetails = usage.prompt_tokens_details;
  if (promptDetails && typeof promptDetails === "object") {
    const cachedTokens = readNumber((promptDetails as Record<string, unknown>).cached_tokens);
    if (cachedTokens != null) {
      return cachedTokens;
    }
  }

  const inputDetails = usage.input_tokens_details;
  if (inputDetails && typeof inputDetails === "object") {
    const cachedTokens = readNumber((inputDetails as Record<string, unknown>).cached_tokens);
    if (cachedTokens != null) {
      return cachedTokens;
    }
  }

  return null;
}

export function extractUsage(payload: unknown): TokenUsage {
  const usage = findUsageRecord(payload);

  if (!usage) {
    return {
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      totalTokens: null
    };
  }

  const inputTokens = readNumber(usage.prompt_tokens) ?? readNumber(usage.input_tokens);
  const outputTokens = readNumber(usage.completion_tokens) ?? readNumber(usage.output_tokens);
  const cachedInputTokens = readCachedInputTokens(usage);
  const totalTokens =
    readNumber(usage.total_tokens) ??
    (inputTokens != null || outputTokens != null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null);

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens
  };
}

export function getErrorSummary(
  bodyText: string,
  fallback: string
): { code: string | null; summary: string } {
  const parsed = parseJson<{ error?: { code?: string; message?: string }; message?: string }>(
    bodyText
  );

  if (parsed?.error?.message) {
    return {
      code: parsed.error.code ?? null,
      summary: clampText(parsed.error.message, 500) ?? fallback
    };
  }

  if (parsed?.message) {
    return {
      code: null,
      summary: clampText(parsed.message, 500) ?? fallback
    };
  }

  return {
    code: null,
    summary: clampText(bodyText, 500) ?? fallback
  };
}
