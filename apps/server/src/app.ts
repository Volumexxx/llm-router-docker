import fs from "node:fs";
import path from "node:path";

import cookie from "@fastify/cookie";
import fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { createSqliteConnection, migrateSqlite } from "../../../packages/db/src/index.ts";
import { resolveConfig } from "./config.ts";
import { bootstrapIfNeeded, resetRuntimePrioritiesToDefault } from "./services/bootstrap.ts";
import { MemoryRateLimiter } from "./security/rate-limit.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerAdminAuthRoutes } from "./routes/admin/auth.ts";
import { registerAdminProviderRoutes } from "./routes/admin/providers.ts";
import { registerAdminModelRoutes } from "./routes/admin/models.ts";
import { registerAdminDashboardRoutes } from "./routes/admin/dashboard.ts";
import { registerAdminAuditRoutes } from "./routes/admin/audit.ts";
import { registerAdminSecurityRoutes } from "./routes/admin/security.ts";
import { registerAdminSystemRoutes } from "./routes/admin/system.ts";
import { registerGatewayRoutes } from "./routes/gateway.ts";
import type { AppContext } from "./types.ts";

export async function buildApp(options?: {
  configOverrides?: Partial<Record<string, string | number | boolean | undefined>>;
  fetchImpl?: typeof fetch;
}) {
  const config = resolveConfig(options?.configOverrides);
  const database = createSqliteConnection(config.dataDir);
  const appliedMigrations = migrateSqlite(database.sqlite);

  await bootstrapIfNeeded(database.sqlite, config);
  resetRuntimePrioritiesToDefault(database.sqlite);

  const appCtx: AppContext = {
    config,
    database,
    fetchImpl: options?.fetchImpl ?? fetch,
    state: {
      ready: false,
      readyErrors: [],
      appliedMigrations,
      activeProxyRequests: 0,
      loginLimiter: new MemoryRateLimiter(),
      apiLimiter: new MemoryRateLimiter()
    }
  };

  const app = fastify({
    logger: config.nodeEnv === "test" ? false : { level: "info" },
    trustProxy: config.trustProxy,
    bodyLimit: config.maxRequestBodySizeBytes,
    requestTimeout: config.requestTimeoutMs
  });

  app.decorate("appCtx", appCtx);
  app.addHook("onRequest", async (request, reply) => {
    request.adminUser = null;
    request.gatewayApiKey = null;
    reply.header("x-request-id", request.id);
  });

  app.addHook("onClose", async () => {
    database.sqlite.close();
  });

  await app.register(cookie);

  if (fs.existsSync(config.publicDir)) {
    await app.register(fastifyStatic, {
      root: config.publicDir,
      prefix: "/admin/",
      index: false,
      wildcard: false
    });

    const sendAdminIndex = async (_request: unknown, reply: any) => {
      const indexPath = path.join(config.publicDir, "index.html");
      if (!fs.existsSync(indexPath)) {
        reply.code(404).send({
          error: {
            code: "admin_assets_missing",
            message: "管理台静态资源尚未构建"
          }
        });
        return;
      }

      reply.type("text/html; charset=utf-8").send(fs.readFileSync(indexPath, "utf8"));
    };

    app.get("/admin", sendAdminIndex);
    app.get("/admin/", sendAdminIndex);
    app.get("/admin/*", async (request, reply) => {
      if (request.url.startsWith("/admin/api/")) {
        reply.code(404).send({
          error: {
            code: "not_found",
            message: "接口不存在"
          }
        });
        return;
      }

      await sendAdminIndex(request, reply);
    });
  }

  await registerHealthRoutes(app);
  await registerAdminAuthRoutes(app);
  await registerAdminProviderRoutes(app);
  await registerAdminModelRoutes(app);
  await registerAdminDashboardRoutes(app);
  await registerAdminAuditRoutes(app);
  await registerAdminSecurityRoutes(app);
  await registerAdminSystemRoutes(app);
  await registerGatewayRoutes(app);

  appCtx.state.ready = true;

  return app;
}
