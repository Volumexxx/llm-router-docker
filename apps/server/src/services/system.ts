import type { FastifyRequest } from "fastify";

import type { RuntimeConfig } from "../config.ts";
import { deriveBaseUrl } from "../security/ip.ts";

export function buildSystemStatus(
  request: FastifyRequest,
  config: RuntimeConfig,
  state: {
    ready: boolean;
    readyErrors: string[];
    appliedMigrations: string[];
    gatewayApiKeyHash: string | null;
  }
) {
  const detectedBaseUrl = deriveBaseUrl(request, config);
  const apiBaseUrl = `${config.externalBaseUrl ?? detectedBaseUrl}/v1`;
  const adminBaseUrl =
    config.adminExternalBaseUrl ?? `${config.externalBaseUrl ?? detectedBaseUrl}/admin`;
  const warnings: string[] = [];

  if (!config.trustProxy && request.headers["x-forwarded-host"]) {
    warnings.push("当前收到代理头，但 TRUST_PROXY 未启用，来源 IP 与 HTTPS 检测可能不准确。");
  }

  if (config.externalBaseUrl) {
    const configured = new URL(config.externalBaseUrl);
    const detected = new URL(detectedBaseUrl);
    if (configured.host !== detected.host || configured.protocol !== detected.protocol) {
      warnings.push("检测到代理头与 EXTERNAL_BASE_URL 不一致，请检查反向代理配置。");
    }
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
    gatewayKeyConfigured: Boolean(state.gatewayApiKeyHash),
    warnings
  };
}
