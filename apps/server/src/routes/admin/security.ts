import type { FastifyInstance } from "fastify";

import {
  apiKeyCreateSchema,
  apiKeyListQuerySchema,
  apiKeyUpdateSchema
} from "../../../../../packages/shared/src/index.ts";
import { sendJsonError, sendValidationError } from "../../lib/http.ts";
import { enforceAdminIpAllowlist, requireAdminSession } from "../../security/auth.ts";
import {
  ApiKeyScopeValidationError,
  createApiKey,
  deleteApiKey,
  listApiKeys,
  updateApiKey
} from "../../services/api-keys.ts";
import { writeSecurityAuditFromRequest } from "../../services/audit.ts";

function sendScopeValidationError(reply: { code: (statusCode: number) => { send: (payload: unknown) => void } }, error: ApiKeyScopeValidationError): void {
  reply.code(400).send({
    error: {
      code: "api_key_scope_invalid_reference",
      message: `${error.field} contains unknown IDs: ${error.missingIds.join(", ")}`
    }
  });
}

export async function registerAdminSecurityRoutes(app: FastifyInstance): Promise<void> {
  const protectedHandlers = [enforceAdminIpAllowlist, requireAdminSession];

  app.get(
    "/admin/api/security/api-keys",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      try {
        const query = apiKeyListQuerySchema.parse(request.query);
        reply.send({
          items: listApiKeys(request.server.appCtx.database.sqlite, query.includeDeleted)
        });
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        throw error;
      }
    }
  );

  app.post(
    "/admin/api/security/api-keys",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      try {
        const input = apiKeyCreateSchema.parse(request.body);
        const result = await createApiKey(request.server.appCtx.database.sqlite, input);

        writeSecurityAuditFromRequest(request.server.appCtx.database.sqlite, request, {
          requestId: request.id,
          endpointType: "security",
          statusCategory: "success",
          httpStatus: 201,
          latencyMs: 0,
          errorSummary: `Created API key: ${result.item.name}`
        });

        reply.code(201).send(result);
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        if (error instanceof ApiKeyScopeValidationError) {
          sendScopeValidationError(reply, error);
          return;
        }

        throw error;
      }
    }
  );

  app.patch(
    "/admin/api/security/api-keys/:id",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      try {
        const apiKeyId = (request.params as { id: string }).id;
        const input = apiKeyUpdateSchema.parse(request.body);
        const item = updateApiKey(request.server.appCtx.database.sqlite, apiKeyId, input);

        if (!item) {
          sendJsonError(reply, 404, "api_key_not_found", "API key not found");
          return;
        }

        writeSecurityAuditFromRequest(request.server.appCtx.database.sqlite, request, {
          requestId: request.id,
          endpointType: "security",
          statusCategory: "success",
          httpStatus: 200,
          latencyMs: 0,
          errorSummary: `Updated API key: ${item.name}`
        });

        reply.send({ item });
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        if (error instanceof ApiKeyScopeValidationError) {
          sendScopeValidationError(reply, error);
          return;
        }

        throw error;
      }
    }
  );

  app.delete(
    "/admin/api/security/api-keys/:id",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      const apiKeyId = (request.params as { id: string }).id;
      const deleted = deleteApiKey(request.server.appCtx.database.sqlite, apiKeyId);

      if (!deleted) {
        sendJsonError(reply, 404, "api_key_not_found", "API key not found");
        return;
      }

      writeSecurityAuditFromRequest(request.server.appCtx.database.sqlite, request, {
        requestId: request.id,
        endpointType: "security",
        statusCategory: "success",
        httpStatus: 200,
        latencyMs: 0,
        errorSummary: `Deleted API key: ${apiKeyId}`
      });

      reply.send({ success: true });
    }
  );
}
