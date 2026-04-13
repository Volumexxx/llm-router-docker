import type { FastifyInstance } from "fastify";

import { enforceAdminIpAllowlist, requireAdminSession } from "../../security/auth.ts";
import { buildSystemStatus } from "../../services/system.ts";

export async function registerAdminSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/api/system/status",
    { preHandler: [enforceAdminIpAllowlist, requireAdminSession] },
    async (request) =>
      buildSystemStatus(request.server.appCtx.database.sqlite, request, request.server.appCtx.config, {
        ready: request.server.appCtx.state.ready,
        readyErrors: request.server.appCtx.state.readyErrors,
        appliedMigrations: request.server.appCtx.state.appliedMigrations
      })
  );
}
