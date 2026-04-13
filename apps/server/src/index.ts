import { buildApp } from "./app.ts";

const app = await buildApp();

const { config } = app.appCtx;

app.log.info(
  {
    host: config.host,
    port: config.port,
    dataDir: config.dataDir,
    trustProxy: config.trustProxy,
    externalBaseUrl: config.externalBaseUrl,
    adminExternalBaseUrl: config.adminExternalBaseUrl,
    adminWhitelistEnabled: config.adminCidrs.length > 0,
    apiWhitelistEnabled: config.apiCidrs.length > 0,
    maxRequestBodySizeBytes: config.maxRequestBodySizeBytes,
    upstreamTimeoutMs: config.upstreamTimeoutMs
  },
  "Starting LLM Router Docker service"
);

try {
  await app.listen({
    host: config.host,
    port: config.port
  });
} catch (error) {
  app.log.error(error, "Failed to start server");
  process.exit(1);
}
