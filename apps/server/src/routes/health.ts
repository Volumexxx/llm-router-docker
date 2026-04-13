import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health/live", async () => ({
    status: "live",
    timestamp: new Date().toISOString()
  }));

  app.get("/health/ready", async (request, reply) => {
    const { state } = request.server.appCtx;

    if (!state.ready) {
      reply.code(503);
    }

    return {
      status: state.ready ? "ready" : "not_ready",
      checks: {
        database: true,
        migrationsApplied: state.appliedMigrations,
        gatewayKeyConfigured: Boolean(state.gatewayApiKeyHash),
        encryptionKeyLoaded: Boolean(request.server.appCtx.config.configEncryptionKey),
        errors: state.readyErrors
      }
    };
  });
}
