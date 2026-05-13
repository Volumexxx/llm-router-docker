import type { FastifyInstance } from "fastify";

import { requireSession } from "../../security/auth.ts";
import { buildSystemStatus } from "../../services/system.ts";

export async function registerAdminSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/api/system/status",
    { preHandler: [requireSession] },
    async (request) => {
      const status = buildSystemStatus(request.server.appCtx.database.sqlite, request, request.server.appCtx.config, {
        ready: request.server.appCtx.state.ready,
        readyErrors: request.server.appCtx.state.readyErrors,
        appliedMigrations: request.server.appCtx.state.appliedMigrations
      }, {
        userId: request.currentUser?.role === "admin" ? undefined : request.currentUser!.id
      });

      if (request.currentUser?.role === "admin") {
        return status;
      }

      return {
        ready: status.ready,
        recommendedApiBaseUrl: status.recommendedApiBaseUrl,
        activeApiKeyCount: status.activeApiKeyCount,
        totalApiKeyCount: status.totalApiKeyCount,
        warnings: status.warnings
      };
    }
  );
}
