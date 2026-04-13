import type { FastifyReply, FastifyRequest } from "fastify";

import { getClientIp, isIpAllowed } from "./ip.ts";
import { loadSessionUserByToken } from "./session.ts";
import { writeSecurityAuditFromRequest } from "../services/audit.ts";
import { clampText } from "../lib/utils.ts";

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

export async function requireAdminSession(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (reply.sent) {
    return;
  }

  const token = request.cookies[request.server.appCtx.config.cookieName];
  if (!token) {
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

  request.adminUser = user;
}

export function requireGatewayBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

export function rejectGatewayRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  code: string,
  status: number,
  message: string
): void {
  writeSecurityAuditFromRequest(request.server.appCtx.database.sqlite, request, {
    requestId: request.id,
    endpointType: request.url.startsWith("/v1/models") ? "model_list" : "security",
    statusCategory: status === 401 ? "unauthorized" : "security_policy",
    httpStatus: status,
    latencyMs: 0,
    errorCode: code,
    errorSummary: clampText(message, 500)
  });

  reply.code(status).send({
    error: {
      code,
      message
    }
  });
}
