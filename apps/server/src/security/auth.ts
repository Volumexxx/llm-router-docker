import type { FastifyReply, FastifyRequest } from "fastify";

import { clampText } from "../lib/utils.ts";
import type { GatewayResponseProtocol } from "../lib/http.ts";
import { buildGatewayErrorPayload } from "../lib/http.ts";
import { writeSecurityAuditFromRequest } from "../services/audit.ts";
import { getClientIp, isIpAllowed } from "./ip.ts";
import { loadSessionUserByToken } from "./session.ts";

export async function enforceAdminIpAllowlist(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { appCtx } = request.server;
  const ip = getClientIp(request);

  if (isIpAllowed(ip, appCtx.config.adminCidrs)) {
    return;
  }

  writeSecurityAuditFromRequest(appCtx.database.sqlite, request, {
    requestId: request.id,
    endpointType: "security",
    statusCategory: "security_policy",
    httpStatus: 403,
    latencyMs: 0,
    errorSummary: "管理后台访问来源不在白名单中"
  });

  reply.code(403).send({
    error: {
      code: "admin_ip_not_allowed",
      message: "管理后台访问来源不在白名单中"
    }
  });
}

export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (reply.sent) {
    return;
  }

  const token = request.cookies[request.server.appCtx.config.cookieName];
  if (!token) {
    request.currentUser = null;
    request.adminUser = null;
    writeSecurityAuditFromRequest(request.server.appCtx.database.sqlite, request, {
      requestId: request.id,
      endpointType: "security",
      statusCategory: "unauthorized",
      httpStatus: 401,
      latencyMs: 0,
      errorCode: "admin_auth_required",
      errorSummary: "未登录状态访问管理接口"
    });
    reply.code(401).send({
      error: {
        code: "admin_auth_required",
        message: "请先登录后台"
      }
    });
    return;
  }

  const user = loadSessionUserByToken(request.server.appCtx.database.sqlite, token);
  if (!user) {
    request.currentUser = null;
    request.adminUser = null;
    writeSecurityAuditFromRequest(request.server.appCtx.database.sqlite, request, {
      requestId: request.id,
      endpointType: "security",
      statusCategory: "unauthorized",
      httpStatus: 401,
      latencyMs: 0,
      errorCode: "admin_session_invalid",
      errorSummary: "管理会话已失效"
    });
    reply.clearCookie(request.server.appCtx.config.cookieName, {
      path: "/"
    });
    reply.code(401).send({
      error: {
        code: "admin_session_invalid",
        message: "登录会话已失效，请重新登录"
      }
    });
    return;
  }

  if (user.status !== "approved") {
    request.currentUser = null;
    request.adminUser = null;
    reply.clearCookie(request.server.appCtx.config.cookieName, {
      path: "/"
    });
    reply.code(403).send({
      error: {
        code: "account_not_approved",
        message: "Account is not approved"
      }
    });
    return;
  }

  request.currentUser = user;
  request.adminUser = user.role === "admin" ? user : null;
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await requireSession(request, reply);
  if (reply.sent) {
    return;
  }

  if (request.currentUser?.role !== "admin") {
    reply.code(403).send({
      error: {
        code: "admin_required",
        message: "Administrator privileges are required"
      }
    });
  }
}

export const requireAdminSession = requireAdmin;

export function requireGatewayBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

export function requireGatewayApiKeyHeader(request: FastifyRequest): string | null {
  const header = request.headers["x-api-key"];
  if (typeof header !== "string") {
    return null;
  }

  return header.trim() || null;
}

function normalizeGatewayTokenHeaderValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("Bearer ")) {
    return trimmed.slice("Bearer ".length).trim() || null;
  }

  return trimmed;
}

export function requireGatewayAnthropicToken(request: FastifyRequest): string | null {
  const apiKeyHeader = requireGatewayApiKeyHeader(request);
  if (apiKeyHeader) {
    return apiKeyHeader;
  }

  const proxyAuthorization = request.headers["proxy-authorization"];
  if (typeof proxyAuthorization === "string") {
    const proxyToken = normalizeGatewayTokenHeaderValue(proxyAuthorization);
    if (proxyToken) {
      return proxyToken;
    }
  }

  return normalizeGatewayTokenHeaderValue(request.headers.authorization);
}

export function rejectGatewayRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  code: string,
  status: number,
  message: string,
  options?: {
    statusCategory?: "unauthorized" | "configuration_error" | "security_policy";
    endpointType?: "model_list" | "messages" | "security";
    protocol?: GatewayResponseProtocol;
  }
): void {
  writeSecurityAuditFromRequest(request.server.appCtx.database.sqlite, request, {
    requestId: request.id,
    endpointType:
      options?.endpointType ?? (request.url.startsWith("/v1/models") ? "model_list" : "security"),
    statusCategory:
      options?.statusCategory ?? (status === 401 ? "unauthorized" : "security_policy"),
    httpStatus: status,
    latencyMs: 0,
    errorCode: code,
    errorSummary: clampText(message, 500)
  });

  reply.code(status).send(buildGatewayErrorPayload(options?.protocol ?? "openai", code, message));
}
