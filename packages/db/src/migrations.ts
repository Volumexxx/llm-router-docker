export interface SqlMigration {
  version: string;
  sql: string;
}

export const migrations: SqlMigration[] = [
  {
    version: "001_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL UNIQUE,
        base_url TEXT NOT NULL,
        api_key_encrypted TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        test_timeout_ms INTEGER NOT NULL DEFAULT 10000,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_aliases (
        id TEXT PRIMARY KEY NOT NULL,
        alias TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_bindings (
        id TEXT PRIMARY KEY NOT NULL,
        model_alias_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        upstream_model TEXT NOT NULL,
        input_price REAL NOT NULL DEFAULT 0,
        output_price REAL NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        runtime_priority INTEGER NOT NULL DEFAULT 0,
        default_priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(model_alias_id, provider_id),
        FOREIGN KEY(model_alias_id) REFERENCES model_aliases(id) ON DELETE CASCADE,
        FOREIGN KEY(provider_id) REFERENCES providers(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        user_agent TEXT,
        ip TEXT,
        FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY NOT NULL,
        request_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        endpoint_type TEXT NOT NULL,
        provider_id TEXT,
        provider_name TEXT,
        model_alias TEXT,
        upstream_model TEXT,
        is_stream INTEGER NOT NULL DEFAULT 0,
        status_category TEXT NOT NULL,
        http_status INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        estimated_cost REAL,
        error_code TEXT,
        error_summary TEXT,
        client_ip TEXT,
        user_agent TEXT
      );

      CREATE TABLE IF NOT EXISTS migration_state (
        version TEXT PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_model_bindings_model_priority
      ON model_bindings(model_alias_id, runtime_priority);

      CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred_at
      ON audit_logs(occurred_at);

      CREATE INDEX IF NOT EXISTS idx_audit_logs_provider_id
      ON audit_logs(provider_id);

      CREATE INDEX IF NOT EXISTS idx_audit_logs_model_alias
      ON audit_logs(model_alias);

      CREATE INDEX IF NOT EXISTS idx_audit_logs_status_category
      ON audit_logs(status_category);

      CREATE INDEX IF NOT EXISTS idx_audit_logs_endpoint_type
      ON audit_logs(endpoint_type);
    `
  },
  {
    version: "002_api_keys",
    sql: `
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        masked_preview TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      ALTER TABLE audit_logs ADD COLUMN api_key_id TEXT;
      ALTER TABLE audit_logs ADD COLUMN api_key_name TEXT;
      ALTER TABLE audit_logs ADD COLUMN api_key_masked_preview TEXT;

      CREATE INDEX IF NOT EXISTS idx_api_keys_enabled_deleted
      ON api_keys(enabled, deleted_at);

      CREATE INDEX IF NOT EXISTS idx_api_keys_created_at
      ON api_keys(created_at);

      CREATE INDEX IF NOT EXISTS idx_audit_logs_api_key_id
      ON audit_logs(api_key_id);
    `
  },
  {
    version: "003_api_key_scopes_and_cache_tokens",
    sql: `
      CREATE TABLE IF NOT EXISTS api_key_provider_scopes (
        api_key_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(api_key_id, provider_id),
        FOREIGN KEY(api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE,
        FOREIGN KEY(provider_id) REFERENCES providers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS api_key_model_scopes (
        api_key_id TEXT NOT NULL,
        model_alias_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(api_key_id, model_alias_id),
        FOREIGN KEY(api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE,
        FOREIGN KEY(model_alias_id) REFERENCES model_aliases(id) ON DELETE CASCADE
      );

      ALTER TABLE audit_logs ADD COLUMN cached_input_tokens INTEGER;

      CREATE INDEX IF NOT EXISTS idx_api_key_provider_scopes_provider_id
      ON api_key_provider_scopes(provider_id);

      CREATE INDEX IF NOT EXISTS idx_api_key_model_scopes_model_alias_id
      ON api_key_model_scopes(model_alias_id);
    `
  }
];
