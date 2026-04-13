import type { FastifyInstance } from "fastify";

import { dashboardRangeSchema } from "../../../../../packages/shared/src/index.ts";
import { sendValidationError } from "../../lib/http.ts";
import { enforceAdminIpAllowlist, requireAdminSession } from "../../security/auth.ts";
import { buildDashboardSummary } from "../../services/dashboard.ts";

export async function registerAdminDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/api/dashboard",
    { preHandler: [enforceAdminIpAllowlist, requireAdminSession] },
    async (request, reply) => {
      try {
        const range = dashboardRangeSchema.parse((request.query as { range?: string }).range ?? "day");
        reply.send(buildDashboardSummary(request.server.appCtx.database.sqlite, range));
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        throw error;
      }
    }
  );
}
