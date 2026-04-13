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

  return `${normalized.slice(0, maxLength - 1)}…`;
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

export function extractUsage(payload: unknown): TokenUsage {
  const usage = (payload as { usage?: Record<string, unknown> } | null)?.usage;

  if (!usage || typeof usage !== "object") {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null
    };
  }

  const promptTokens =
    typeof usage.prompt_tokens === "number"
      ? usage.prompt_tokens
      : typeof usage.input_tokens === "number"
        ? usage.input_tokens
        : null;

  const completionTokens =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : typeof usage.output_tokens === "number"
        ? usage.output_tokens
        : null;

  const totalTokens =
    typeof usage.total_tokens === "number"
      ? usage.total_tokens
      : promptTokens != null || completionTokens != null
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : null;

  return {
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    totalTokens
  };
}

export function getErrorSummary(bodyText: string, fallback: string): { code: string | null; summary: string } {
  const parsed = parseJson<{ error?: { code?: string; message?: string }; message?: string }>(bodyText);

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
