import type { FastifyInstance } from "fastify";

import { userApprovalSchema, userUpdateSchema } from "../../../../../packages/shared/src/index.ts";
import { sendJsonError, sendValidationError } from "../../lib/http.ts";
import { enforceAdminIpAllowlist, requireAdmin } from "../../security/auth.ts";
import { createApiKey } from "../../services/api-keys.ts";
import {
  getUserById,
  listUsers,
  updateUser,
  UserScopeValidationError
} from "../../services/users.ts";
import { writeSecurityAuditFromRequest } from "../../services/audit.ts";

function sendUserScopeValidationError(
  reply: { code: (statusCode: number) => { send: (payload: unknown) => void } },
  error: UserScopeValidationError
): void {
  reply.code(400).send({
    error: {
      code: "user_scope_invalid_reference",
      message: `${error.field} contains unknown IDs: ${error.missingIds.join(", ")}`
    }
  });
}

export async function registerAdminUserRoutes(app: FastifyInstance): Promise<void> {
  const protectedHandlers = [enforceAdminIpAllowlist, requireAdmin];

  app.get("/admin/api/users", { preHandler: protectedHandlers }, async (request) => ({
    items: listUsers(request.server.appCtx.database.sqlite)
  }));

  app.patch("/admin/api/users/:id", { preHandler: protectedHandlers }, async (request, reply) => {
    try {
      const userId = (request.params as { id: string }).id;
      const input = userUpdateSchema.parse(request.body);
      const item = updateUser(
        request.server.appCtx.database.sqlite,
        userId,
        input,
        request.currentUser?.id
      );

      if (!item) {
        sendJsonError(reply, 404, "user_not_found", "User not found");
        return;
      }

      reply.send({ item });
    } catch (error) {
      if (sendValidationError(reply, error)) {
        return;
      }

      if (error instanceof UserScopeValidationError) {
        sendUserScopeValidationError(reply, error);
        return;
      }

      throw error;
    }
  });

  app.post(
    "/admin/api/users/:id/approve",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      try {
        const userId = (request.params as { id: string }).id;
        const input = userApprovalSchema.parse(request.body ?? {});
        const current = getUserById(request.server.appCtx.database.sqlite, userId);

        if (!current) {
          sendJsonError(reply, 404, "user_not_found", "User not found");
          return;
        }

        if (current.role !== "user") {
          sendJsonError(reply, 400, "admin_user_not_approvable", "Admin users cannot be approved here");
          return;
        }

        if (current.status === "approved") {
          sendJsonError(reply, 409, "user_already_approved", "User is already approved");
          return;
        }

        const user = updateUser(
          request.server.appCtx.database.sqlite,
          userId,
          {
            status: "approved"
          },
          request.currentUser?.id
        );

        if (!user) {
          sendJsonError(reply, 404, "user_not_found", "User not found");
          return;
        }

        const apiKey = await createApiKey(
          request.server.appCtx.database.sqlite,
          {
            name: "默认"
          },
          {
            ownerUserId: user.id,
            createdByUserId: request.currentUser?.id ?? null,
            plaintext: input.apiKeyPlaintext,
            encryptionKey: request.server.appCtx.config.configEncryptionKey
          }
        );

        writeSecurityAuditFromRequest(request.server.appCtx.database.sqlite, request, {
          requestId: request.id,
          endpointType: "security",
          statusCategory: "success",
          httpStatus: 200,
          latencyMs: 0,
          errorSummary: `Approved user: ${user.username}`
        });

        reply.send({
          item: user,
          apiKey
        });
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        throw error;
      }
    }
  );
}
