import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { estimateCost } from "../../../../packages/shared/src/index.ts";
import { sendJsonError } from "../lib/http.ts";
import { clampText, parseJson } from "../lib/utils.ts";
import { requireGatewayBearerToken, rejectGatewayRequest } from "../security/auth.ts";
import { getClientIp, isIpAllowed } from "../security/ip.ts";
import { authenticateApiKey } from "../services/api-keys.ts";
import { writeAuditLog, writeSecurityAuditFromRequest } from "../services/audit.ts";
import { listVisibleModels, resolveRoutableBinding } from "../services/models.ts";
import { proxyProviderJson, streamProviderResponse } from "../services/provider-client.ts";

function classifyFailure(errorCode: string | null): "upstream_error" | "network_error" {
  return errorCode === "network_error" ? "network_error" : "upstream_error";
}

function buildApiKeyAuditContext(request: FastifyRequest) {
  return request.gatewayApiKey
    ? {
        apiKeyId: request.gatewayApiKey.id,
        apiKeyName: request.gatewayApiKey.name,
        apiKeyMaskedPreview: request.gatewayApiKey.maskedPreview
      }
    : {};
}

async function authorizeGatewayRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const { appCtx } = request.server;
  const ip = getClientIp(request);

  if (!isIpAllowed(ip, appCtx.config.apiCidrs)) {
    rejectGatewayRequest(request, reply, "api_ip_not_allowed", 403, "Current IP is not allowed");
    return false;
  }

  const limiter = appCtx.state.apiLimiter.consume(
    `api:${ip}:${request.url}`,
    appCtx.config.apiRateLimitMax,
    appCtx.config.apiRateLimitWindowMs
  );

  if (!limiter.allowed) {
    writeSecurityAuditFromRequest(appCtx.database.sqlite, request, {
      requestId: request.id,
      endpointType: "security",
      statusCategory: "security_policy",
      httpStatus: 429,
      latencyMs: 0,
      errorCode: "api_rate_limited",
      errorSummary: "API rate limit exceeded"
    });

    reply.header("retry-after", Math.ceil(limiter.retryAfterMs / 1000));
    reply.code(429).send({
      error: {
        code: "api_rate_limited",
        message: "API rate limit exceeded, please retry later"
      }
    });
    return false;
  }

  const bearerToken = requireGatewayBearerToken(request);
  if (!bearerToken) {
    rejectGatewayRequest(request, reply, "gateway_auth_required", 401, "Missing API key");
    return false;
  }

  const authResult = await authenticateApiKey(appCtx.database.sqlite, bearerToken);
  if (authResult.kind === "no_active_keys") {
    rejectGatewayRequest(
      request,
      reply,
      "api_keys_not_configured",
      503,
      "No active API key is configured yet. Please create one in the admin console first.",
      {
        statusCategory: "configuration_error"
      }
    );
    return false;
  }

  if (authResult.kind !== "matched" || !authResult.apiKey) {
    rejectGatewayRequest(request, reply, "gateway_auth_invalid", 401, "Invalid API key");
    return false;
  }

  request.gatewayApiKey = {
    id: authResult.apiKey.id,
    name: authResult.apiKey.name,
    maskedPreview: authResult.apiKey.maskedPreview,
    allowedProviderIds: authResult.apiKey.allowedProviderIds,
    allowedModelAliasIds: authResult.apiKey.allowedModelAliasIds
  };

  return true;
}

async function handleProxyEndpoint(
  app: FastifyInstance,
  endpointType: "chat_completions" | "responses",
  endpointPath: "chat/completions" | "responses"
): Promise<void> {
  app.post(`/v1/${endpointPath}`, async (request, reply) => {
    const started = Date.now();
    if (!(await authorizeGatewayRequest(request, reply))) {
      return;
    }

    const body = request.body as { model?: string; stream?: boolean } | undefined;
    const requestedModel = body?.model;

    if (!requestedModel) {
      writeAuditLog(request.server.appCtx.database.sqlite, {
        requestId: request.id,
        endpointType,
        isStream: Boolean(body?.stream),
        statusCategory: "configuration_error",
        httpStatus: 400,
        latencyMs: Date.now() - started,
        errorCode: "model_required",
        errorSummary: "Request body is missing model",
        clientIp: getClientIp(request),
        userAgent: request.headers["user-agent"]?.toString() ?? null,
        ...buildApiKeyAuditContext(request)
      });

      sendJsonError(reply, 400, "model_required", "Request body is missing model");
      return;
    }

    const resolution = resolveRoutableBinding(
      request.server.appCtx.database.sqlite,
      requestedModel,
      request.gatewayApiKey ?? undefined
    );

    if (resolution.kind !== "matched") {
      writeAuditLog(request.server.appCtx.database.sqlite, {
        requestId: request.id,
        endpointType,
        modelAlias: requestedModel,
        isStream: Boolean(body?.stream),
        statusCategory: "configuration_error",
        httpStatus: 404,
        latencyMs: Date.now() - started,
        errorCode: resolution.kind === "scope_denied" ? "api_key_scope_denied" : "model_not_routable",
        errorSummary: "Model alias is not routable for the current API key",
        clientIp: getClientIp(request),
        userAgent: request.headers["user-agent"]?.toString() ?? null,
        ...buildApiKeyAuditContext(request)
      });

      sendJsonError(reply, 404, "model_not_routable", "Model alias is not routable");
      return;
    }

    const binding = resolution.binding;

    if (
      request.server.appCtx.state.activeProxyRequests >=
      request.server.appCtx.config.maxActiveProxyRequests
    ) {
      writeAuditLog(request.server.appCtx.database.sqlite, {
        requestId: request.id,
        endpointType,
        providerId: binding.providerId,
        providerName: binding.providerName,
        modelAlias: binding.modelAlias,
        upstreamModel: binding.upstreamModel,
        isStream: Boolean(body?.stream),
        statusCategory: "security_policy",
        httpStatus: 429,
        latencyMs: Date.now() - started,
        errorCode: "proxy_concurrency_limited",
        errorSummary: "Maximum active proxy request limit reached",
        clientIp: getClientIp(request),
        userAgent: request.headers["user-agent"]?.toString() ?? null,
        ...buildApiKeyAuditContext(request)
      });

      sendJsonError(
        reply,
        429,
        "proxy_concurrency_limited",
        "Maximum active proxy request limit reached"
      );
      return;
    }

    request.server.appCtx.state.activeProxyRequests += 1;

    try {
      if (body?.stream) {
        try {
          const result = await streamProviderResponse(
            request.server.appCtx.fetchImpl,
            request.server.appCtx.config,
            binding,
            endpointPath,
            request.body,
            reply
          );

          writeAuditLog(request.server.appCtx.database.sqlite, {
            requestId: request.id,
            endpointType,
            providerId: binding.providerId,
            providerName: binding.providerName,
            modelAlias: binding.modelAlias,
            upstreamModel: binding.upstreamModel,
            isStream: true,
            statusCategory: "success",
            httpStatus: result.httpStatus,
            latencyMs: Date.now() - started,
            inputTokens: result.usage.inputTokens,
            cachedInputTokens: result.usage.cachedInputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
            estimatedCost:
              result.estimatedCost ??
              estimateCost(result.usage, binding.inputPrice, binding.outputPrice),
            clientIp: getClientIp(request),
            userAgent: request.headers["user-agent"]?.toString() ?? null,
            ...buildApiKeyAuditContext(request)
          });
        } catch (error) {
          const statusCode =
            error instanceof Error && "statusCode" in error && typeof error.statusCode === "number"
              ? error.statusCode
              : 502;
          const errorCode =
            error instanceof Error && "errorCode" in error && typeof error.errorCode === "string"
              ? error.errorCode
              : "network_error";
          const summary =
            error instanceof Error
              ? clampText(error.message, 500) ?? "Streaming upstream request failed"
              : "Streaming upstream request failed";

          writeAuditLog(request.server.appCtx.database.sqlite, {
            requestId: request.id,
            endpointType,
            providerId: binding.providerId,
            providerName: binding.providerName,
            modelAlias: binding.modelAlias,
            upstreamModel: binding.upstreamModel,
            isStream: true,
            statusCategory: classifyFailure(errorCode),
            httpStatus: statusCode,
            latencyMs: Date.now() - started,
            errorCode,
            errorSummary: summary,
            clientIp: getClientIp(request),
            userAgent: request.headers["user-agent"]?.toString() ?? null,
            ...buildApiKeyAuditContext(request)
          });
        }

        return;
      }

      const result = await proxyProviderJson(
        request.server.appCtx.fetchImpl,
        request.server.appCtx.config,
        binding,
        endpointPath,
        request.body
      );

      if (!result.ok) {
        const payload = parseJson(result.bodyText) ?? result.bodyText;
        reply.header("content-type", "application/json");
        reply.code(result.httpStatus).send(payload);

        writeAuditLog(request.server.appCtx.database.sqlite, {
          requestId: request.id,
          endpointType,
          providerId: binding.providerId,
          providerName: binding.providerName,
          modelAlias: binding.modelAlias,
          upstreamModel: binding.upstreamModel,
          isStream: false,
          statusCategory: classifyFailure(result.errorCode),
          httpStatus: result.httpStatus,
          latencyMs: Date.now() - started,
          errorCode: result.errorCode,
          errorSummary: result.errorSummary,
          clientIp: getClientIp(request),
          userAgent: request.headers["user-agent"]?.toString() ?? null,
          ...buildApiKeyAuditContext(request)
        });
        return;
      }

      reply.header("content-type", result.contentType ?? "application/json");
      reply.code(result.httpStatus).send(parseJson(result.bodyText ?? "") ?? result.bodyText);

      writeAuditLog(request.server.appCtx.database.sqlite, {
        requestId: request.id,
        endpointType,
        providerId: binding.providerId,
        providerName: binding.providerName,
        modelAlias: binding.modelAlias,
        upstreamModel: binding.upstreamModel,
        isStream: false,
        statusCategory: "success",
        httpStatus: result.httpStatus,
        latencyMs: Date.now() - started,
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        estimatedCost: result.estimatedCost,
        clientIp: getClientIp(request),
        userAgent: request.headers["user-agent"]?.toString() ?? null,
        ...buildApiKeyAuditContext(request)
      });
    } finally {
      request.server.appCtx.state.activeProxyRequests -= 1;
    }
  });
}

export async function registerGatewayRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/models", async (request, reply) => {
    const started = Date.now();
    if (!(await authorizeGatewayRequest(request, reply))) {
      return;
    }

    const models = listVisibleModels(
      request.server.appCtx.database.sqlite,
      request.gatewayApiKey ?? undefined
    );

    writeAuditLog(request.server.appCtx.database.sqlite, {
      requestId: request.id,
      endpointType: "model_list",
      statusCategory: "success",
      httpStatus: 200,
      latencyMs: Date.now() - started,
      clientIp: getClientIp(request),
      userAgent: request.headers["user-agent"]?.toString() ?? null,
      ...buildApiKeyAuditContext(request)
    });

    reply.send({
      object: "list",
      data: models.map((model) => ({
        id: model.alias,
        object: "model",
        owned_by: "llm-router",
        display_name: model.display_name
      }))
    });
  });

  await handleProxyEndpoint(app, "chat_completions", "chat/completions");
  await handleProxyEndpoint(app, "responses", "responses");
}
