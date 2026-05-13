import type { FastifyInstance } from "fastify";

import { auditQuerySchema } from "../../../../../packages/shared/src/index.ts";
import { sendValidationError } from "../../lib/http.ts";
import { requireSession } from "../../security/auth.ts";
import { queryAuditLogs } from "../../services/audit.ts";

export async function registerAdminAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/api/audit",
    { preHandler: [requireSession] },
    async (request, reply) => {
      try {
        const input = auditQuerySchema.parse(request.query);
        const scopedInput =
          request.currentUser?.role === "admin"
            ? input
            : {
                ...input,
                providerId: undefined,
                userId: request.currentUser!.id
              };
        reply.send(queryAuditLogs(request.server.appCtx.database.sqlite, scopedInput));
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        throw error;
      }
    }
  );
}
