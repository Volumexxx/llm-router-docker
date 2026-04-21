import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { z } from "zod";

import { MAX_TIMEOUT_MS, normalizeUrl } from "../../../packages/shared/src/index.ts";

function loadDotenvFiles(): void {
  const configFilePath = fileURLToPath(import.meta.url);
  const serverPackageRoot = path.resolve(path.dirname(configFilePath), "..");
  const workspaceRoot = path.resolve(serverPackageRoot, "..", "..");

  const mergedEnv: Record<string, string> = {};

  const envCandidates = [
    path.join(workspaceRoot, ".env"),
    path.join(workspaceRoot, ".env.local"),
    path.join(serverPackageRoot, ".env"),
    path.join(serverPackageRoot, ".env.local")
  ];

  for (const candidate of envCandidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    Object.assign(mergedEnv, dotenv.parse(fs.readFileSync(candidate)));
  }

  for (const [key, value] of Object.entries(mergedEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotenvFiles();

const booleanish = z
  .union([z.string(), z.boolean(), z.undefined()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value !== "string") {
      return false;
    }

    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

const rawConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATA_DIR: z.string().default(path.resolve(process.cwd(), "data")),
  PUBLIC_DIR: z.string().optional(),
  TIMEZONE: z.string().default("UTC"),
  MAX_REQUEST_BODY_SIZE_MB: z.coerce.number().min(1).max(200).default(50),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(MAX_TIMEOUT_MS).default(120000),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(MAX_TIMEOUT_MS).default(120000),
  PROVIDER_TEST_DEFAULT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(MAX_TIMEOUT_MS).default(10000),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),
  TRUST_PROXY: booleanish.default(false),
  EXTERNAL_BASE_URL: z.string().url().optional(),
  ADMIN_EXTERNAL_BASE_URL: z.string().url().optional(),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(10 * 60 * 1000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60 * 1000),
  API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  MAX_ACTIVE_PROXY_REQUESTS: z.coerce.number().int().min(1).default(100),
  ADMIN_CIDR_WHITELIST: z.string().optional(),
  API_CIDR_WHITELIST: z.string().optional(),
  CONFIG_ENCRYPTION_KEY: z.string().min(16),
  BOOTSTRAP_ADMIN_USERNAME: z.string().min(1).optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).optional()
});

export interface RuntimeConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  dataDir: string;
  publicDir: string;
  timezone: string;
  maxRequestBodySizeBytes: number;
  requestTimeoutMs: number;
  upstreamTimeoutMs: number;
  providerTestDefaultTimeoutMs: number;
  sessionTtlHours: number;
  trustProxy: boolean;
  externalBaseUrl: string | null;
  adminExternalBaseUrl: string | null;
  loginRateLimitWindowMs: number;
  loginRateLimitMax: number;
  apiRateLimitWindowMs: number;
  apiRateLimitMax: number;
  maxActiveProxyRequests: number;
  adminCidrs: string[];
  apiCidrs: string[];
  configEncryptionKey: string;
  bootstrapAdminUsername: string | null;
  bootstrapAdminPassword: string | null;
  cookieName: string;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveConfig(
  overrides: Partial<Record<string, string | number | boolean | undefined>> = {}
): RuntimeConfig {
  const raw = rawConfigSchema.parse({
    ...process.env,
    ...overrides
  });

  const publicDir = raw.PUBLIC_DIR
    ? path.resolve(raw.PUBLIC_DIR)
    : path.resolve(process.cwd(), "apps/web/dist");

  return {
    nodeEnv: raw.NODE_ENV,
    host: raw.HOST,
    port: raw.PORT,
    dataDir: path.resolve(raw.DATA_DIR),
    publicDir,
    timezone: raw.TIMEZONE,
    maxRequestBodySizeBytes: Math.round(raw.MAX_REQUEST_BODY_SIZE_MB * 1024 * 1024),
    requestTimeoutMs: raw.REQUEST_TIMEOUT_MS,
    upstreamTimeoutMs: raw.UPSTREAM_TIMEOUT_MS,
    providerTestDefaultTimeoutMs: raw.PROVIDER_TEST_DEFAULT_TIMEOUT_MS,
    sessionTtlHours: raw.SESSION_TTL_HOURS,
    trustProxy: raw.TRUST_PROXY,
    externalBaseUrl: raw.EXTERNAL_BASE_URL ? normalizeUrl(raw.EXTERNAL_BASE_URL) : null,
    adminExternalBaseUrl: raw.ADMIN_EXTERNAL_BASE_URL
      ? normalizeUrl(raw.ADMIN_EXTERNAL_BASE_URL)
      : null,
    loginRateLimitWindowMs: raw.LOGIN_RATE_LIMIT_WINDOW_MS,
    loginRateLimitMax: raw.LOGIN_RATE_LIMIT_MAX,
    apiRateLimitWindowMs: raw.API_RATE_LIMIT_WINDOW_MS,
    apiRateLimitMax: raw.API_RATE_LIMIT_MAX,
    maxActiveProxyRequests: raw.MAX_ACTIVE_PROXY_REQUESTS,
    adminCidrs: parseCsv(raw.ADMIN_CIDR_WHITELIST),
    apiCidrs: parseCsv(raw.API_CIDR_WHITELIST),
    configEncryptionKey: raw.CONFIG_ENCRYPTION_KEY,
    bootstrapAdminUsername: raw.BOOTSTRAP_ADMIN_USERNAME ?? null,
    bootstrapAdminPassword: raw.BOOTSTRAP_ADMIN_PASSWORD ?? null,
    cookieName: "llm_router_admin"
  };
}
