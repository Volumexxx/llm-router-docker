import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { ANTHROPIC_API_VERSION, estimateCost } from "../../../../packages/shared/src/index.ts";
import { sendGatewayError } from "../lib/http.ts";
import { clampText, parseJson } from "../lib/utils.ts";
import {
  requireGatewayAnthropicToken,
  requireGatewayApiKeyHeader,
  requireGatewayBearerToken,
  rejectGatewayRequest
} from "../security/auth.ts";
import { getClientIp, isIpAllowed } from "../security/ip.ts";
import { authenticateApiKey } from "../services/api-keys.ts";
import { writeAuditLog, writeSecurityAuditFromRequest } from "../services/audit.ts";
import { listVisibleModels, resolveRoutableBinding } from "../services/models.ts";
import { proxyProviderJson, streamProviderResponse } from "../services/provider-client.ts";

type GatewayProtocol = "openai" | "anthropic";
type EndpointType = "chat_completions" | "responses" | "messages";

function classifyFailure(errorCode: string | null): "upstream_error" | "network_error" {
  return errorCode === "network_error" ? "network_error" : "upstream_error";
}

function buildApiKeyAuditContext(request: FastifyRequest) {
  return request.gatewayApiKey
    ? {
        apiKeyId: request.gatewayApiKey.id,
        apiKeyName: request.gatewayApiKey.name,
        apiKeyMaskedPreview: request.gatewayApiKey.maskedPreview,
        userId: request.gatewayApiKey.userId,
        userDisplayName: request.gatewayApiKey.userDisplayName
      }
    : {};
}

function detectGatewayProtocol(request: FastifyRequest): GatewayProtocol {
  if (request.url.startsWith("/v1/messages")) {
    return "anthropic";
  }

  if (request.url.startsWith("/v1/models") && request.headers["anthropic-version"]) {
    return "anthropic";
  }

  return "openai";
}

function validateAnthropicVersion(
  request: FastifyRequest,
  reply: FastifyReply,
  protocol: GatewayProtocol
): string | null {
  if (protocol !== "anthropic") {
    return null;
  }

  const header = request.headers["anthropic-version"];
  if (typeof header !== "string" || !header.trim()) {
    rejectGatewayRequest(
      request,
      reply,
      "anthropic_version_required",
      400,
      "Anthropic requests require the anthropic-version header",
      {
        endpointType: request.url.startsWith("/v1/messages") ? "messages" : "model_list",
        statusCategory: "configuration_error",
        protocol
      }
    );
    return null;
  }

  if (header.trim() !== ANTHROPIC_API_VERSION) {
    rejectGatewayRequest(
      request,
      reply,
      "unsupported_anthropic_version",
      400,
      `Only anthropic-version ${ANTHROPIC_API_VERSION} is supported`,
      {
        endpointType: request.url.startsWith("/v1/messages") ? "messages" : "model_list",
        statusCategory: "configuration_error",
        protocol
      }
    );
    return null;
  }

  return header.trim();
}

function readGatewayToken(request: FastifyRequest, protocol: GatewayProtocol): string | null {
  return protocol === "anthropic"
    ? requireGatewayAnthropicToken(request)
    : requireGatewayBearerToken(request);
}

async function authorizeGatewayRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  protocol: GatewayProtocol
): Promise<{ anthropicVersion: string | null } | null> {
  const { appCtx } = request.server;
  const ip = getClientIp(request);

  if (!isIpAllowed(ip, appCtx.config.apiCidrs)) {
    rejectGatewayRequest(request, reply, "api_ip_not_allowed", 403, "Current IP is not allowed", {
      protocol
    });
    return null;
  }

  const limiter = appCtx.state.apiLimiter.consume(
    `api:${ip}:${request.url}`,
    appCtx.config.apiRateLimitMax,
    appCtx.config.apiRateLimitWindowMs
  );

  if (!limiter.allowed) {
    writeSecurityAuditFromRequest(appCtx.database.sqlite, request, {
      requestId: request.id,
      endpointType: protocol === "anthropic" && request.url.startsWith("/v1/messages") ? "messages" : "security",
      statusCategory: "security_policy",
      httpStatus: 429,
      latencyMs: 0,
      errorCode: "api_rate_limited",
      errorSummary: "API rate limit exceeded"
    });

    reply.header("retry-after", Math.ceil(limiter.retryAfterMs / 1000));
    sendGatewayError(reply, 429, protocol, "api_rate_limited", "API rate limit exceeded, please retry later");
    return null;
  }

  const anthropicVersion = validateAnthropicVersion(request, reply, protocol);
  if (protocol === "anthropic" && !anthropicVersion) {
    return null;
  }

  const token = readGatewayToken(request, protocol);
  if (!token) {
    rejectGatewayRequest(
      request,
      reply,
      "gateway_auth_required",
      401,
      "Missing API key",
      {
        endpointType: protocol === "anthropic" && request.url.startsWith("/v1/messages") ? "messages" : undefined,
        protocol
      }
    );
    return null;
  }

  const authResult = await authenticateApiKey(appCtx.database.sqlite, token);
  if (authResult.kind === "no_active_keys") {
    rejectGatewayRequest(
      request,
      reply,
      "api_keys_not_configured",
      503,
      "No active API key is configured yet. Please create one in the admin console first.",
      {
        statusCategory: "configuration_error",
        endpointType: protocol === "anthropic" && request.url.startsWith("/v1/messages") ? "messages" : undefined,
        protocol
      }
    );
    return null;
  }

  if (authResult.kind !== "matched" || !authResult.apiKey) {
    rejectGatewayRequest(request, reply, "gateway_auth_invalid", 401, "Invalid API key", {
      endpointType: protocol === "anthropic" && request.url.startsWith("/v1/messages") ? "messages" : undefined,
      protocol
    });
    return null;
  }

  request.gatewayApiKey = {
    id: authResult.apiKey.id,
    name: authResult.apiKey.name,
    maskedPreview: authResult.apiKey.maskedPreview,
    userId: authResult.apiKey.userId,
    userDisplayName: authResult.apiKey.userDisplayName,
    allowedProviderIds: authResult.apiKey.allowedProviderIds,
    allowedModelAliasIds: authResult.apiKey.allowedModelAliasIds
  };

  return {
    anthropicVersion
  };
}

function sendModelRequiredError(
  reply: FastifyReply,
  protocol: GatewayProtocol
): void {
  sendGatewayError(reply, 400, protocol, "model_required", "Request body is missing model");
}

function sendModelNotRoutableError(
  reply: FastifyReply,
  protocol: GatewayProtocol
): void {
  sendGatewayError(reply, 404, protocol, "model_not_routable", "Model alias is not routable");
}

async function handleProxyEndpoint(
  app: FastifyInstance,
  endpointType: EndpointType,
  path: string,
  gatewayProtocol: GatewayProtocol
): Promise<void> {
  app.post(path, async (request, reply) => {
    const started = Date.now();
    const auth = await authorizeGatewayRequest(request, reply, gatewayProtocol);
    if (!auth) {
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
      sendModelRequiredError(reply, gatewayProtocol);
      return;
    }

    const resolution = resolveRoutableBinding(
      request.server.appCtx.database.sqlite,
      requestedModel,
      gatewayProtocol,
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
      sendModelNotRoutableError(reply, gatewayProtocol);
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
        providerProtocol: binding.providerProtocol,
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

      sendGatewayError(
        reply,
        429,
        gatewayProtocol,
        "proxy_concurrency_limited",
        "Maximum active proxy request limit reached"
      );
      return;
    }

    request.server.appCtx.state.activeProxyRequests += 1;

    try {
      const requestContext = {
        gatewayProtocol,
        endpointType,
        anthropicVersion: auth.anthropicVersion
      } as const;

      if (body?.stream) {
        try {
          const result = await streamProviderResponse(
            {
              fetchImpl: request.server.appCtx.fetchImpl,
              config: request.server.appCtx.config,
              binding,
              request: requestContext,
              body: request.body
            },
            reply
          );

          writeAuditLog(request.server.appCtx.database.sqlite, {
            requestId: request.id,
            endpointType,
            providerId: binding.providerId,
            providerName: binding.providerName,
            providerProtocol: binding.providerProtocol,
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
            providerProtocol: binding.providerProtocol,
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

      const result = await proxyProviderJson({
        fetchImpl: request.server.appCtx.fetchImpl,
        config: request.server.appCtx.config,
        binding,
        request: requestContext,
        body: request.body
      });

      if (!result.ok) {
        const payload = parseJson(result.bodyText) ?? result.bodyText;
        reply.header("content-type", "application/json");
        reply.code(result.httpStatus).send(payload);

        writeAuditLog(request.server.appCtx.database.sqlite, {
          requestId: request.id,
          endpointType,
          providerId: binding.providerId,
          providerName: binding.providerName,
          providerProtocol: binding.providerProtocol,
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
        providerProtocol: binding.providerProtocol,
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
    const protocol = detectGatewayProtocol(request);
    const auth = await authorizeGatewayRequest(request, reply, protocol);
    if (!auth) {
      return;
    }

    const models = listVisibleModels(
      request.server.appCtx.database.sqlite,
      protocol,
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

    if (protocol === "anthropic") {
      reply.send({
        data: models.map((model) => ({
          type: "model",
          id: model.alias,
          display_name: model.display_name,
          created_at: 0
        })),
        has_more: false,
        first_id: models[0]?.alias ?? null,
        last_id: models.at(-1)?.alias ?? null
      });
      return;
    }

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

  await handleProxyEndpoint(app, "chat_completions", "/v1/chat/completions", "openai");
  await handleProxyEndpoint(app, "responses", "/v1/responses", "openai");
  await handleProxyEndpoint(app, "messages", "/v1/messages", "anthropic");
}
