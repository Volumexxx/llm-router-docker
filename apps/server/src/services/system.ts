import type { DatabaseSync } from "node:sqlite";

import type { FastifyRequest } from "fastify";

import type { RuntimeConfig } from "../config.ts";
import { deriveBaseUrl } from "../security/ip.ts";
import { getApiKeyCounts } from "./api-keys.ts";

export function buildSystemStatus(
  sqlite: DatabaseSync,
  request: FastifyRequest,
  config: RuntimeConfig,
  state: {
    ready: boolean;
    readyErrors: string[];
    appliedMigrations: string[];
  }
) {
  const detectedBaseUrl = deriveBaseUrl(request, config);
  const apiBaseUrl = `${config.externalBaseUrl ?? detectedBaseUrl}/v1`;
  const adminBaseUrl =
    config.adminExternalBaseUrl ?? `${config.externalBaseUrl ?? detectedBaseUrl}/admin`;
  const warnings: string[] = [];
  const apiKeyCounts = getApiKeyCounts(sqlite);

  if (!config.trustProxy && request.headers["x-forwarded-host"]) {
    warnings.push("检测到代理头，但 TRUST_PROXY 未启用，来源 IP 与 HTTPS 判断可能不准确。");
  }

  if (config.externalBaseUrl) {
    const configured = new URL(config.externalBaseUrl);
    const detected = new URL(detectedBaseUrl);
    if (configured.host !== detected.host || configured.protocol !== detected.protocol) {
      warnings.push("检测到代理头与 EXTERNAL_BASE_URL 不一致，请检查反向代理配置。");
    }
  }

  if (apiKeyCounts.activeApiKeyCount === 0) {
    warnings.push("当前还没有可用的 API Key，请先登录后台创建至少一把启用中的 Key。");
  }

  return {
    ready: state.ready,
    readyErrors: state.readyErrors,
    dataDir: config.dataDir,
    dbPath: `${config.dataDir}/app.db`,
    timezone: config.timezone,
    externalBaseUrl: config.externalBaseUrl,
    adminExternalBaseUrl: config.adminExternalBaseUrl,
    detectedBaseUrl,
    recommendedApiBaseUrl: apiBaseUrl,
    recommendedAdminUrl: adminBaseUrl,
    trustProxy: config.trustProxy,
    maxRequestBodySizeBytes: config.maxRequestBodySizeBytes,
    upstreamTimeoutMs: config.upstreamTimeoutMs,
    loginRateLimit: {
      windowMs: config.loginRateLimitWindowMs,
      max: config.loginRateLimitMax
    },
    apiRateLimit: {
      windowMs: config.apiRateLimitWindowMs,
      max: config.apiRateLimitMax
    },
    maxActiveProxyRequests: config.maxActiveProxyRequests,
    adminWhitelistEnabled: config.adminCidrs.length > 0,
    apiWhitelistEnabled: config.apiCidrs.length > 0,
    appliedMigrations: state.appliedMigrations,
    activeApiKeyCount: apiKeyCounts.activeApiKeyCount,
    totalApiKeyCount: apiKeyCounts.totalApiKeyCount,
    warnings
  };
}
