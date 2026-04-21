import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  providerCreateSchema,
  providerProtocolSchema,
  providerUpdateSchema
} from "../../../../../packages/shared/src/index.ts";
import { sendJsonError, sendValidationError } from "../../lib/http.ts";
import { enforceAdminIpAllowlist, requireAdminSession } from "../../security/auth.ts";
import {
  createProvider,
  deleteProvider,
  getProviderById,
  getProviderProtocolConfig,
  isSqliteUniqueConstraintError,
  listProviders,
  ProviderConfigRequiredError,
  ProviderProtocolConfigConflictError,
  ProviderProtocolConfigIncompleteError,
  updateProvider
} from "../../services/providers.ts";
import { testProviderConnection } from "../../services/provider-client.ts";

const providerTestSchema = z.object({
  protocol: providerProtocolSchema
});

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
        sendJsonError(reply, 409, "provider_name_conflict", "Provider already exists");
        return;
      }

      if (error instanceof ProviderConfigRequiredError) {
        sendJsonError(reply, 400, "provider_config_required", error.message);
        return;
      }

      if (error instanceof ProviderProtocolConfigIncompleteError) {
        sendJsonError(reply, 400, "provider_protocol_config_incomplete", error.message);
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
          sendJsonError(reply, 404, "provider_not_found", "Provider not found");
          return;
        }

        reply.send({ item: provider });
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        if (isSqliteUniqueConstraintError(error)) {
          sendJsonError(reply, 409, "provider_name_conflict", "Provider already exists");
          return;
        }

        if (error instanceof ProviderConfigRequiredError) {
          sendJsonError(reply, 400, "provider_config_required", error.message);
          return;
        }

        if (error instanceof ProviderProtocolConfigIncompleteError) {
          sendJsonError(reply, 400, "provider_protocol_config_incomplete", error.message);
          return;
        }

        if (error instanceof ProviderProtocolConfigConflictError) {
          sendJsonError(
            reply,
            409,
            "provider_protocol_config_in_use",
            `${error.protocol} config is still referenced by ${error.bindingCount} binding(s) across ${error.modelCount} model(s)`
          );
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
          sendJsonError(reply, 404, "provider_not_found", "Provider not found");
          return;
        }

        reply.send(result);
      } catch {
        sendJsonError(reply, 500, "provider_delete_failed", "Provider delete failed");
      }
    }
  );

  app.post(
    "/admin/api/providers/:providerId/test",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      try {
        const providerId = (request.params as { providerId: string }).providerId;
        const input = providerTestSchema.parse(request.body ?? {});
        const provider = getProviderById(
          request.server.appCtx.database.sqlite,
          request.server.appCtx.config,
          providerId
        );

        if (!provider) {
          sendJsonError(reply, 404, "provider_not_found", "Provider not found");
          return;
        }

        const protocolConfig = getProviderProtocolConfig(
          request.server.appCtx.database.sqlite,
          request.server.appCtx.config,
          providerId,
          input.protocol
        );

        if (!protocolConfig) {
          sendJsonError(
            reply,
            404,
            "provider_protocol_config_not_found",
            `${input.protocol} config is not configured for this provider`
          );
          return;
        }

        const result = await testProviderConnection(
          request.server.appCtx.fetchImpl,
          request.server.appCtx.config,
          {
            baseUrl: protocolConfig.baseUrl,
            apiKey: protocolConfig.apiKey,
            protocol: protocolConfig.protocol,
            apiVersion: protocolConfig.apiVersion,
            testTimeoutMs: protocolConfig.testTimeoutMs
          }
        );
        reply.send(result);
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        throw error;
      }
    }
  );
}
