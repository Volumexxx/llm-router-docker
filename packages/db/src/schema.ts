import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const providers = sqliteTable(
  "providers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    testTimeoutMs: integer("test_timeout_ms").notNull().default(10000),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    nameUnique: uniqueIndex("providers_name_unique").on(table.name)
  })
);

export const modelAliases = sqliteTable(
  "model_aliases",
  {
    id: text("id").primaryKey(),
    alias: text("alias").notNull(),
    displayName: text("display_name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    aliasUnique: uniqueIndex("model_aliases_alias_unique").on(table.alias)
  })
);

export const modelBindings = sqliteTable(
  "model_bindings",
  {
    id: text("id").primaryKey(),
    modelAliasId: text("model_alias_id").notNull(),
    providerId: text("provider_id").notNull(),
    upstreamModel: text("upstream_model").notNull(),
    inputPrice: real("input_price").notNull().default(0),
    outputPrice: real("output_price").notNull().default(0),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    runtimePriority: integer("runtime_priority").notNull().default(0),
    defaultPriority: integer("default_priority").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    modelProviderUnique: uniqueIndex("model_bindings_model_provider_unique").on(
      table.modelAliasId,
      table.providerId
    ),
    modelPriorityIndex: index("model_bindings_model_priority_index").on(
      table.modelAliasId,
      table.runtimePriority
    )
  })
);

export const adminUsers = sqliteTable(
  "admin_users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    usernameUnique: uniqueIndex("admin_users_username_unique").on(table.username)
  })
);

export const adminSessions = sqliteTable("admin_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  userAgent: text("user_agent"),
  ip: text("ip")
});

export const systemSettings = sqliteTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  occurredAt: text("occurred_at").notNull(),
  endpointType: text("endpoint_type").notNull(),
  providerId: text("provider_id"),
  providerName: text("provider_name"),
  modelAlias: text("model_alias"),
  upstreamModel: text("upstream_model"),
  isStream: integer("is_stream", { mode: "boolean" }).notNull().default(false),
  statusCategory: text("status_category").notNull(),
  httpStatus: integer("http_status").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  estimatedCost: real("estimated_cost"),
  errorCode: text("error_code"),
  errorSummary: text("error_summary"),
  clientIp: text("client_ip"),
  userAgent: text("user_agent")
});

export const migrationState = sqliteTable("migration_state", {
  version: text("version").primaryKey(),
  appliedAt: text("applied_at").notNull()
});
