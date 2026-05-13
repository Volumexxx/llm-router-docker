import type { FastifyInstance, FastifyRequest } from "fastify";

import type { createSqliteConnection } from "../../../packages/db/src/index.ts";

import type { RuntimeConfig } from "./config.ts";
import type { MemoryRateLimiter } from "./security/rate-limit.ts";

export interface GatewayApiKeyContext {
  id: string;
  name: string;
  maskedPreview: string;
  userId: string;
  userDisplayName: string;
  allowedProviderIds: string[] | null;
  allowedModelAliasIds: string[] | null;
}

export interface RuntimeState {
  ready: boolean;
  readyErrors: string[];
  appliedMigrations: string[];
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

export interface ConsoleUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  status: "pending" | "approved" | "rejected" | "disabled";
}

export type AdminSessionUser = ConsoleUser;

declare module "fastify" {
  interface FastifyInstance {
    appCtx: AppContext;
  }

  interface FastifyRequest {
    currentUser: ConsoleUser | null;
    adminUser: AdminSessionUser | null;
    gatewayApiKey: GatewayApiKeyContext | null;
  }
}

export type FastifyApp = FastifyInstance;
export type FastifyReq = FastifyRequest;
