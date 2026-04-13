import type { FastifyInstance } from "fastify";

import {
  bindingCreateSchema,
  bindingUpdateSchema,
  modelAliasCreateSchema,
  modelAliasUpdateSchema,
  runtimeOrderSchema
} from "../../../../../packages/shared/src/index.ts";
import { sendJsonError, sendValidationError } from "../../lib/http.ts";
import { enforceAdminIpAllowlist, requireAdminSession } from "../../security/auth.ts";
import {
  applyRuntimeOrder,
  createBinding,
  createModelAlias,
  deleteBinding,
  deleteModelAlias,
  getModelById,
  listModels,
  saveRuntimeOrderAsDefault,
  updateBinding,
  updateModelAlias
} from "../../services/models.ts";
import { isSqliteUniqueConstraintError } from "../../services/providers.ts";

export async function registerAdminModelRoutes(app: FastifyInstance): Promise<void> {
  const protectedHandlers = [enforceAdminIpAllowlist, requireAdminSession];

  app.get("/admin/api/models", { preHandler: protectedHandlers }, async (request) => ({
    items: listModels(request.server.appCtx.database.sqlite)
  }));

  app.post("/admin/api/models", { preHandler: protectedHandlers }, async (request, reply) => {
    try {
      const input = modelAliasCreateSchema.parse(request.body);
      const item = createModelAlias(request.server.appCtx.database.sqlite, input);
      reply.code(201).send({ item });
    } catch (error) {
      if (sendValidationError(reply, error)) {
        return;
      }

      if (isSqliteUniqueConstraintError(error)) {
        sendJsonError(reply, 409, "model_alias_conflict", "模型别名已存在");
        return;
      }

      throw error;
    }
  });

  app.patch("/admin/api/models/:modelId", { preHandler: protectedHandlers }, async (request, reply) => {
    try {
      const modelId = (request.params as { modelId: string }).modelId;
      const input = modelAliasUpdateSchema.parse(request.body);
      const item = updateModelAlias(request.server.appCtx.database.sqlite, modelId, input);

      if (!item) {
        sendJsonError(reply, 404, "model_not_found", "模型不存在");
        return;
      }

      reply.send({ item });
    } catch (error) {
      if (sendValidationError(reply, error)) {
        return;
      }

      if (isSqliteUniqueConstraintError(error)) {
        sendJsonError(reply, 409, "model_alias_conflict", "模型别名已存在");
        return;
      }

      throw error;
    }
  });

  app.delete("/admin/api/models/:modelId", { preHandler: protectedHandlers }, async (request, reply) => {
    const modelId = (request.params as { modelId: string }).modelId;
    const deleted = deleteModelAlias(request.server.appCtx.database.sqlite, modelId);

    if (!deleted) {
      sendJsonError(reply, 404, "model_not_found", "模型不存在");
      return;
    }

    reply.send({ success: true });
  });

  app.post(
    "/admin/api/models/:modelId/bindings",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      try {
        const modelId = (request.params as { modelId: string }).modelId;
        const input = bindingCreateSchema.parse(request.body);
        const item = createBinding(request.server.appCtx.database.sqlite, modelId, input);

        if (!item) {
          sendJsonError(reply, 404, "model_not_found", "模型不存在");
          return;
        }

        reply.code(201).send({ item });
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        if (isSqliteUniqueConstraintError(error)) {
          sendJsonError(reply, 409, "binding_conflict", "同一个模型下的 Provider 绑定不能重复");
          return;
        }

        throw error;
      }
    }
  );

  app.patch(
    "/admin/api/models/:modelId/bindings/:bindingId",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      try {
        const { modelId, bindingId } = request.params as { modelId: string; bindingId: string };
        const input = bindingUpdateSchema.parse(request.body);
        const item = updateBinding(request.server.appCtx.database.sqlite, modelId, bindingId, input);

        if (!item) {
          sendJsonError(reply, 404, "binding_not_found", "模型绑定不存在");
          return;
        }

        reply.send({ item });
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        throw error;
      }
    }
  );

  app.delete(
    "/admin/api/models/:modelId/bindings/:bindingId",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      const { modelId, bindingId } = request.params as { modelId: string; bindingId: string };
      const deleted = deleteBinding(request.server.appCtx.database.sqlite, modelId, bindingId);

      if (!deleted) {
        sendJsonError(reply, 404, "binding_not_found", "模型绑定不存在");
        return;
      }

      reply.send({ success: true });
    }
  );

  app.post(
    "/admin/api/models/:modelId/runtime-order/apply",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      try {
        const modelId = (request.params as { modelId: string }).modelId;
        const input = runtimeOrderSchema.parse(request.body);
        const model = getModelById(request.server.appCtx.database.sqlite, modelId);

        if (!model) {
          sendJsonError(reply, 404, "model_not_found", "模型不存在");
          return;
        }

        const modelBindingIds = model.bindings.map((binding) => binding.id).sort();
        const requestedIds = [...input.bindingIds].sort();

        if (modelBindingIds.length !== requestedIds.length || modelBindingIds.some((id, index) => id !== requestedIds[index])) {
          sendJsonError(reply, 400, "binding_order_invalid", "运行时顺序必须包含该模型的全部绑定");
          return;
        }

        const item = applyRuntimeOrder(request.server.appCtx.database.sqlite, modelId, input.bindingIds);
        reply.send({ item });
      } catch (error) {
        if (sendValidationError(reply, error)) {
          return;
        }

        throw error;
      }
    }
  );

  app.post(
    "/admin/api/models/:modelId/runtime-order/save-default",
    { preHandler: protectedHandlers },
    async (request, reply) => {
      const modelId = (request.params as { modelId: string }).modelId;
      const item = saveRuntimeOrderAsDefault(request.server.appCtx.database.sqlite, modelId);

      if (!item) {
        sendJsonError(reply, 404, "model_not_found", "模型不存在");
        return;
      }

      reply.send({ item });
    }
  );
}
