import type { FastifyInstance, FastifyRequest } from "fastify";

import type { createSqliteConnection } from "../../../packages/db/src/index.ts";

import type { MemoryRateLimiter } from "./security/rate-limit.ts";
import type { RuntimeConfig } from "./config.ts";

export interface RuntimeState {
  ready: boolean;
  readyErrors: string[];
  appliedMigrations: string[];
  gatewayApiKeyHash: string | null;
  activeProxyRequests: number;
  loginLimiter: MemoryRateLimiter;
  apiLimiter: MemoryRateLimiter;
}

export interface AppContext {
  config: RuntimeConfig;
  database: ReturnType<typeof createSqliteConnection>;
  state: RuntimeState;
  fetchImpl: typeof fetch;
}

export interface AdminSessionUser {
  id: string;
  username: string;
}

declare module "fastify" {
  interface FastifyInstance {
    appCtx: AppContext;
  }

  interface FastifyRequest {
    adminUser: AdminSessionUser | null;
  }
}

export type FastifyApp = FastifyInstance;
export type FastifyReq = FastifyRequest;
