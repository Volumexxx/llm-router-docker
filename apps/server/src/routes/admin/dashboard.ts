import type { FastifyInstance } from "fastify";

import { dashboardQuerySchema } from "../../../../../packages/shared/src/index.ts";
import { sendValidationError } from "../../lib/http.ts";
import { requireSession } from "../../security/auth.ts";
import { buildDashboardSummary } from "../../services/dashboard.ts";

export async function registerAdminDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/api/dashboard",
    { preHandler: [requireSession] },
    async (request, reply) => {
      try {
        const query = dashboardQuerySchema.parse(request.query ?? {});
        const filters =
          request.currentUser?.role === "admin"
            ? {
                providerId: query.providerId,
                modelAlias: query.modelAlias,
                apiKeyId: query.apiKeyId,
                userId: query.userId
              }
            : {
                modelAlias: query.modelAlias,
                apiKeyId: query.apiKeyId,
                userId: request.currentUser!.id
              };

        reply.send(
          buildDashboardSummary(
            request.server.appCtx.database.sqlite,
            query.range,
            request.server.appCtx.config.timezone,
            new Date(),
            query.range === "day" ? query.date : undefined,
            filters
          )
        );
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        throw error;
      }
    }
  );
}
