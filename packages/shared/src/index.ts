import { z } from "zod";

export const MODEL_ALIAS_REGEX = /^[A-Za-z0-9._:-]+$/;

export const endpointTypeSchema = z.enum([
  "model_list",
  "chat_completions",
  "responses",
  "admin_login",
  "admin_logout",
  "admin_system",
  "security"
]);

export const auditStatusSchema = z.enum([
  "success",
  "unauthorized",
  "configuration_error",
  "upstream_error",
  "network_error",
  "security_policy"
]);

export const dashboardRangeSchema = z.enum(["day", "week", "month"]);

export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(256)
});

export const providerCreateSchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).max(512),
  enabled: z.boolean().default(true),
  testTimeoutMs: z.number().int().min(1000).max(600000).default(10000)
});

export const providerUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).max(512).optional(),
  enabled: z.boolean().optional(),
  testTimeoutMs: z.number().int().min(1000).max(600000).optional()
});

export const modelAliasCreateSchema = z.object({
  alias: z
    .string()
    .min(1)
    .max(120)
    .regex(MODEL_ALIAS_REGEX, "模型别名只允许字母、数字、点、下划线、冒号和短横线"),
  displayName: z.string().min(1).max(120),
  enabled: z.boolean().default(true)
});

export const modelAliasUpdateSchema = z.object({
  alias: z
    .string()
    .min(1)
    .max(120)
    .regex(MODEL_ALIAS_REGEX, "模型别名只允许字母、数字、点、下划线、冒号和短横线")
    .optional(),
  displayName: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional()
});

export const bindingCreateSchema = z.object({
  providerId: z.string().uuid(),
  upstreamModel: z.string().min(1).max(240),
  inputPrice: z.number().min(0),
  outputPrice: z.number().min(0),
  enabled: z.boolean().default(true)
});

export const bindingUpdateSchema = z.object({
  upstreamModel: z.string().min(1).max(240).optional(),
  inputPrice: z.number().min(0).optional(),
  outputPrice: z.number().min(0).optional(),
  enabled: z.boolean().optional(),
  runtimePriority: z.number().int().min(0).optional(),
  defaultPriority: z.number().int().min(0).optional()
});

export const runtimeOrderSchema = z.object({
  bindingIds: z.array(z.string().uuid()).min(1)
});

const uuidArraySchema = z
  .array(z.string().uuid())
  .transform((items) => Array.from(new Set(items)));

export const apiKeyCreateSchema = z.object({
  name: z.string().min(1).max(120),
  allowedProviderIds: uuidArraySchema.default([]),
  allowedModelAliasIds: uuidArraySchema.default([])
});

export const apiKeyUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  allowedProviderIds: uuidArraySchema.optional(),
  allowedModelAliasIds: uuidArraySchema.optional()
});

export const apiKeyListQuerySchema = z.object({
  includeDeleted: z
    .preprocess((value) => {
      if (typeof value === "boolean") {
        return value;
      }

      if (typeof value !== "string") {
        return false;
      }

      return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    }, z.boolean())
    .default(false)
});

export const auditQuerySchema = z.object({
  providerId: z.string().uuid().optional(),
  apiKeyId: z.string().uuid().optional(),
  modelAlias: z.string().optional(),
  statusCategory: auditStatusSchema.optional(),
  endpointType: endpointTypeSchema.optional(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  totalTokens: number | null;
}

export interface TrendPoint {
  label: string;
  requests: number;
  successes: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  estimatedCost: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
}

export interface DashboardCard {
  key: string;
  label: string;
  requests: number;
  successes: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  estimatedCost: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  trend: TrendPoint[];
}

export interface DashboardSummary {
  range: z.infer<typeof dashboardRangeSchema>;
  windowStart: string;
  windowEnd: string;
  overall: {
    requests: number;
    successes: number;
    failures: number;
    errorRate: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    totalTokens: number;
    estimatedCost: number;
    averageLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    missingUsageCount: number;
  };
  trend: TrendPoint[];
  providerCards: DashboardCard[];
  modelCards: DashboardCard[];
  apiKeyCards: DashboardCard[];
}

export function estimateCost(
  usage: TokenUsage,
  inputPrice: number,
  outputPrice: number
): number | null {
  if (usage.inputTokens == null && usage.outputTokens == null) {
    return null;
  }

  const inputCost = ((usage.inputTokens ?? 0) / 1_000_000) * inputPrice;
  const outputCost = ((usage.outputTokens ?? 0) / 1_000_000) * outputPrice;

  return Number((inputCost + outputCost).toFixed(8));
}

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value.length <= 6) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

export function formatApiKeyLabel(
  name: string | null | undefined,
  maskedPreview: string | null | undefined
): string {
  if (name && maskedPreview) {
    return `${name} (${maskedPreview})`;
  }

  return name ?? maskedPreview ?? "未知 API Key";
}

export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1)
  );

  return sorted[index] ?? 0;
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizeDisplayInputTokens(
  inputTokens: number | null | undefined,
  cachedInputTokens: number | null | undefined
): number | null {
  if (inputTokens == null) {
    return null;
  }

  return Math.max(inputTokens - (cachedInputTokens ?? 0), 0);
}
