import type { FastifyInstance } from "fastify";

import { loginSchema, registerSchema } from "../../../../../packages/shared/src/index.ts";
import { sendJsonError, sendValidationError } from "../../lib/http.ts";
import { nowIso } from "../../lib/utils.ts";
import { requireSession } from "../../security/auth.ts";
import { getClientIp, isRequestSecure } from "../../security/ip.ts";
import { createSession, destroySessionByToken } from "../../security/session.ts";
import { verifyCredential } from "../../security/crypto.ts";
import { writeSecurityAuditFromRequest } from "../../services/audit.ts";
import { isSqliteUniqueConstraintError } from "../../services/providers.ts";
import { registerPendingUser } from "../../services/users.ts";

export async function registerAdminAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/api/auth/register", async (request, reply) => {
    try {
      const input = registerSchema.parse(request.body);
      const user = await registerPendingUser(request.server.appCtx.database.sqlite, input);
      reply.code(201).send({ user });
    } catch (error) {
      if (sendValidationError(reply, error)) {
        return;
      }

      if (isSqliteUniqueConstraintError(error)) {
        sendJsonError(reply, 409, "username_conflict", "Username already exists");
        return;
      }

      throw error;
    }
  });

  app.post("/admin/api/auth/login", async (request, reply) => {
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
                 , display_name, role, status
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
            display_name: string | null;
            role: "admin" | "user";
            status: "pending" | "approved" | "rejected" | "disabled";
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

      if (row.status !== "approved") {
        const code =
          row.status === "pending"
            ? "account_pending_approval"
            : row.status === "rejected"
              ? "account_rejected"
              : "account_disabled";
        reply.code(403).send({
          error: {
            code,
            message:
              row.status === "pending"
                ? "Account registration is waiting for administrator approval"
                : "Account is not allowed to sign in"
          }
        });
        return;
      }

      const session = createSession(
        appCtx.database.sqlite,
        {
          id: row.id,
          username: row.username,
          displayName: row.display_name ?? row.username,
          role: row.role,
          status: row.status
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
          username: row.username,
          displayName: row.display_name ?? row.username,
          role: row.role,
          status: row.status
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

  app.get("/admin/api/auth/me", { preHandler: [requireSession] }, async (request) => ({
    user: request.currentUser
  }));

  app.post(
    "/admin/api/auth/logout",
    { preHandler: [requireSession] },
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
