import type { FastifyInstance } from "fastify";

import { loginSchema } from "../../../../../packages/shared/src/index.ts";
import { sendValidationError } from "../../lib/http.ts";
import { nowIso } from "../../lib/utils.ts";
import { enforceAdminIpAllowlist, requireAdminSession } from "../../security/auth.ts";
import { getClientIp, isRequestSecure } from "../../security/ip.ts";
import { createSession, destroySessionByToken } from "../../security/session.ts";
import { verifyCredential } from "../../security/crypto.ts";
import { writeSecurityAuditFromRequest } from "../../services/audit.ts";

export async function registerAdminAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/api/auth/login", { preHandler: [enforceAdminIpAllowlist] }, async (request, reply) => {
    try {
      const input = loginSchema.parse(request.body);
      const { appCtx } = request.server;
      const ip = getClientIp(request);
      const limiter = appCtx.state.loginLimiter.consume(
        `login:${ip}`,
        appCtx.config.loginRateLimitMax,
        appCtx.config.loginRateLimitWindowMs
      );

      if (!limiter.allowed) {
        writeSecurityAuditFromRequest(appCtx.database.sqlite, request, {
          requestId: request.id,
          endpointType: "admin_login",
          statusCategory: "security_policy",
          httpStatus: 429,
          latencyMs: 0,
          errorCode: "login_rate_limited",
          errorSummary: "登录尝试过于频繁"
        });

        reply.header("retry-after", Math.ceil(limiter.retryAfterMs / 1000));
        reply.code(429).send({
          error: {
            code: "login_rate_limited",
            message: "登录尝试过于频繁，请稍后再试"
          }
        });
        return;
      }

      const row = appCtx.database.sqlite
        .prepare(
          `
            SELECT id, username, password_hash
            FROM admin_users
            WHERE username = ?
            LIMIT 1
          `
        )
        .get(input.username) as
        | {
            id: string;
            username: string;
            password_hash: string;
          }
        | undefined;

      const verified = row ? await verifyCredential(row.password_hash, input.password) : false;
      if (!verified || !row) {
        writeSecurityAuditFromRequest(appCtx.database.sqlite, request, {
          requestId: request.id,
          endpointType: "admin_login",
          statusCategory: "unauthorized",
          httpStatus: 401,
          latencyMs: 0,
          errorCode: "invalid_admin_credentials",
          errorSummary: "管理员用户名或密码错误"
        });

        reply.code(401).send({
          error: {
            code: "invalid_admin_credentials",
            message: "管理员用户名或密码错误"
          }
        });
        return;
      }

      const session = createSession(
        appCtx.database.sqlite,
        {
          id: row.id,
          username: row.username
        },
        appCtx.config.sessionTtlHours,
        ip,
        request.headers["user-agent"]?.toString() ?? null
      );

      reply.setCookie(appCtx.config.cookieName, session.token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: isRequestSecure(request),
        expires: new Date(session.expiresAt)
      });

      writeSecurityAuditFromRequest(appCtx.database.sqlite, request, {
        requestId: request.id,
        endpointType: "admin_login",
        statusCategory: "success",
        httpStatus: 200,
        latencyMs: 0,
        errorSummary: `管理员 ${row.username} 登录成功`
      });

      reply.send({
        user: {
          id: row.id,
          username: row.username
        },
        loggedInAt: nowIso()
      });
    } catch (error) {
      if (sendValidationError(reply, error)) {
        return;
      }

      throw error;
    }
  });

  app.get("/admin/api/auth/me", { preHandler: [enforceAdminIpAllowlist, requireAdminSession] }, async (request) => ({
    user: request.adminUser
  }));

  app.post(
    "/admin/api/auth/logout",
    { preHandler: [enforceAdminIpAllowlist, requireAdminSession] },
    async (request, reply) => {
      const token = request.cookies[request.server.appCtx.config.cookieName];
      if (token) {
        destroySessionByToken(request.server.appCtx.database.sqlite, token);
      }

      reply.clearCookie(request.server.appCtx.config.cookieName, {
        path: "/"
      });

      writeSecurityAuditFromRequest(request.server.appCtx.database.sqlite, request, {
        requestId: request.id,
        endpointType: "admin_logout",
        statusCategory: "success",
        httpStatus: 200,
        latencyMs: 0,
        errorSummary: "管理员退出登录"
      });

      reply.send({
        success: true
      });
    }
  );
}
