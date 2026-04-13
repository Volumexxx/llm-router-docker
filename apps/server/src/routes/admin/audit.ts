import type { FastifyInstance } from "fastify";

import { auditQuerySchema } from "../../../../../packages/shared/src/index.ts";
import { sendValidationError } from "../../lib/http.ts";
import { enforceAdminIpAllowlist, requireAdminSession } from "../../security/auth.ts";
import { queryAuditLogs } from "../../services/audit.ts";

export async function registerAdminAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/api/audit",
    { preHandler: [enforceAdminIpAllowlist, requireAdminSession] },
    async (request, reply) => {
      try {
        const input = auditQuerySchema.parse(request.query);
        reply.send(queryAuditLogs(request.server.appCtx.database.sqlite, input));
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        throw error;
      }
    }
  );
}
