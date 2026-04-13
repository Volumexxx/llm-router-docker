import type { FastifyInstance } from "fastify";

import { gatewayRotateSchema } from "../../../../../packages/shared/src/index.ts";
import { sendValidationError } from "../../lib/http.ts";
import { hashCredential } from "../../security/crypto.ts";
import { enforceAdminIpAllowlist, requireAdminSession } from "../../security/auth.ts";
import { setSetting } from "../../services/settings.ts";

export async function registerAdminSecurityRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/admin/api/security/gateway-key",
    { preHandler: [enforceAdminIpAllowlist, requireAdminSession] },
    async (request, reply) => {
      try {
        const input = gatewayRotateSchema.parse(request.body);
        const hashed = await hashCredential(input.newGatewayApiKey);
        setSetting(request.server.appCtx.database.sqlite, "gateway_api_key_hash", hashed);
        request.server.appCtx.state.gatewayApiKeyHash = hashed;

        reply.send({
          success: true,
          rotatedAt: new Date().toISOString()
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
