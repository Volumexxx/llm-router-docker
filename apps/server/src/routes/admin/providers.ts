import type { FastifyInstance } from "fastify";

import {
  providerCreateSchema,
  providerUpdateSchema
} from "../../../../../packages/shared/src/index.ts";
import { sendJsonError, sendValidationError } from "../../lib/http.ts";
import { enforceAdminIpAllowlist, requireAdminSession } from "../../security/auth.ts";
import {
  createProvider,
  deleteProvider,
  getProviderById,
  isSqliteUniqueConstraintError,
  listProviders,
  updateProvider
} from "../../services/providers.ts";
import { testProviderConnection } from "../../services/provider-client.ts";

export async function registerAdminProviderRoutes(app: FastifyInstance): Promise<void> {
  const protectedHandlers = [enforceAdminIpAllowlist, requireAdminSession];

  app.get("/admin/api/providers", { preHandler: protectedHandlers }, async (request) => ({
    items: listProviders(request.server.appCtx.database.sqlite, request.server.appCtx.config)
  }));

  app.post("/admin/api/providers", { preHandler: protectedHandlers }, async (request, reply) => {
    try {
      const input = providerCreateSchema.parse(request.body);
      const provider = createProvider(
        request.server.appCtx.database.sqlite,
        request.server.appCtx.config,
        input
      );

      reply.code(201).send({ item: provider });
    } catch (error) {
      if (sendValidationError(reply, error)) {
        return;
      }

      if (isSqliteUniqueConstraintError(error)) {
        sendJsonError(reply, 409, "provider_name_conflict", "Provider 名称已存在");
        return;
      }

      throw error;
    }
  });

  app.patch(
    "/admin/api/providers/:providerId",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      try {
        const providerId = (request.params as { providerId: string }).providerId;
        const input = providerUpdateSchema.parse(request.body);
        const provider = updateProvider(
          request.server.appCtx.database.sqlite,
          request.server.appCtx.config,
          providerId,
          input
        );

        if (!provider) {
          sendJsonError(reply, 404, "provider_not_found", "Provider 不存在");
          return;
        }

        reply.send({ item: provider });
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        if (isSqliteUniqueConstraintError(error)) {
          sendJsonError(reply, 409, "provider_name_conflict", "Provider 名称已存在");
          return;
        }

        throw error;
      }
    }
  );

  app.delete(
    "/admin/api/providers/:providerId",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      try {
        const providerId = (request.params as { providerId: string }).providerId;
        const result = deleteProvider(request.server.appCtx.database.sqlite, providerId);

        if (!result) {
          sendJsonError(reply, 404, "provider_not_found", "Provider 不存在");
          return;
        }

        reply.send(result);
      } catch {
        sendJsonError(reply, 500, "provider_delete_failed", "Provider 删除失败");
      }
    }
  );

  app.post(
    "/admin/api/providers/:providerId/test",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      const providerId = (request.params as { providerId: string }).providerId;
      const provider = getProviderById(
        request.server.appCtx.database.sqlite,
        request.server.appCtx.config,
        providerId
      );

      if (!provider) {
        sendJsonError(reply, 404, "provider_not_found", "Provider 不存在");
        return;
      }

      const result = await testProviderConnection(request.server.appCtx.fetchImpl, request.server.appCtx.config, provider);
      reply.send(result);
    }
  );
}
