import type { FastifyInstance } from "fastify";

import {
  selfApiKeyCreateSchema,
  selfApiKeyUpdateSchema
} from "../../../../../packages/shared/src/index.ts";
import { sendJsonError, sendValidationError } from "../../lib/http.ts";
import { requireSession } from "../../security/auth.ts";
import {
  ApiKeyPlaintextUnavailableError,
  createApiKey,
  deleteApiKey,
  getApiKeyPlaintext,
  listApiKeys,
  updateApiKey
} from "../../services/api-keys.ts";
import { getUserGatewayScope } from "../../services/users.ts";
import { listVisibleModels } from "../../services/models.ts";

export async function registerSelfServiceRoutes(app: FastifyInstance): Promise<void> {
  const protectedHandlers = [requireSession];

  app.get("/admin/api/me/api-keys", { preHandler: protectedHandlers }, async (request) => ({
    items: listApiKeys(request.server.appCtx.database.sqlite, false, {
      ownerUserId: request.currentUser!.id
    })
  }));

  app.post("/admin/api/me/api-keys", { preHandler: protectedHandlers }, async (request, reply) => {
    try {
      const input = selfApiKeyCreateSchema.parse(request.body);
      const result = await createApiKey(request.server.appCtx.database.sqlite, input, {
        ownerUserId: request.currentUser!.id,
        createdByUserId: request.currentUser!.id,
        encryptionKey: request.server.appCtx.config.configEncryptionKey
      });

      reply.code(201).send(result);
    } catch (error) {
      if (sendValidationError(reply, error)) {
        return;
      }

      throw error;
    }
  });

  app.get(
    "/admin/api/me/api-keys/:id/plaintext",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      try {
        const apiKeyId = (request.params as { id: string }).id;
        const plaintext = getApiKeyPlaintext(
          request.server.appCtx.database.sqlite,
          apiKeyId,
          request.server.appCtx.config.configEncryptionKey,
          request.currentUser!.id
        );

        if (!plaintext) {
          sendJsonError(reply, 404, "api_key_not_found", "API key not found");
          return;
        }

        reply.send({ plaintext });
      } catch (error) {
        if (error instanceof ApiKeyPlaintextUnavailableError) {
          sendJsonError(
            reply,
            409,
            "api_key_plaintext_unavailable",
            "This legacy API key does not have recoverable plaintext"
          );
          return;
        }

        throw error;
      }
    }
  );

  app.patch("/admin/api/me/api-keys/:id", { preHandler: protectedHandlers }, async (request, reply) => {
    try {
      const apiKeyId = (request.params as { id: string }).id;
      const input = selfApiKeyUpdateSchema.parse(request.body);
      const item = updateApiKey(request.server.appCtx.database.sqlite, apiKeyId, input, {
        ownerUserId: request.currentUser!.id
      });

      if (!item) {
        sendJsonError(reply, 404, "api_key_not_found", "API key not found");
        return;
      }

      reply.send({ item });
    } catch (error) {
      if (sendValidationError(reply, error)) {
        return;
      }

      throw error;
    }
  });

  app.delete("/admin/api/me/api-keys/:id", { preHandler: protectedHandlers }, async (request, reply) => {
    const apiKeyId = (request.params as { id: string }).id;
    const deleted = deleteApiKey(
      request.server.appCtx.database.sqlite,
      apiKeyId,
      request.currentUser!.id
    );

    if (!deleted) {
      sendJsonError(reply, 404, "api_key_not_found", "API key not found");
      return;
    }

    reply.send({ success: true });
  });

  app.get("/admin/api/me/models", { preHandler: protectedHandlers }, async (request, reply) => {
    const scope = getUserGatewayScope(request.server.appCtx.database.sqlite, request.currentUser!.id);
    if (!scope) {
      sendJsonError(reply, 403, "account_not_approved", "Account is not approved");
      return;
    }

    const merged = new Map<
      string,
      {
        alias: string;
        displayName: string;
        protocols: Array<"openai" | "anthropic">;
      }
    >();

    for (const protocol of ["openai", "anthropic"] as const) {
      const models = listVisibleModels(request.server.appCtx.database.sqlite, protocol, scope);
      for (const model of models) {
        const current =
          merged.get(model.alias) ?? {
            alias: model.alias,
            displayName: model.display_name,
            protocols: []
          };
        current.protocols.push(protocol);
        merged.set(model.alias, current);
      }
    }

    reply.send({
      items: Array.from(merged.values()).sort((left, right) =>
        left.alias.localeCompare(right.alias)
      )
    });
  });
}
