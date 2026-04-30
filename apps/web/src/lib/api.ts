export interface ApiErrorShape {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(input, {
    credentials: "include",
    ...init,
    headers
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = (isJson ? await response.json() : await response.text()) as
    | T
    | ApiErrorShape
    | string;

  if (!response.ok) {
    const errorPayload = payload as ApiErrorShape;

    if (typeof payload === "string") {
      throw new ApiError(response.status, "request_failed", payload);
    }

    throw new ApiError(
      response.status,
      errorPayload.error?.code ?? "request_failed",
      errorPayload.error?.message ?? "Request failed"
    );
  }

  return payload as T;
}

export type ProviderProtocol = "openai" | "anthropic";

export interface OpenAiProviderConfigPayload {
  baseUrl: string;
  apiKey: string;
  testTimeoutMs: number;
}

export interface AnthropicProviderConfigPayload extends OpenAiProviderConfigPayload {
  apiVersion?: string | null;
}

export interface OpenAiProviderConfigUpdatePayload {
  baseUrl?: string;
  apiKey?: string;
  testTimeoutMs?: number;
}

export interface AnthropicProviderConfigUpdatePayload extends OpenAiProviderConfigUpdatePayload {
  apiVersion?: string | null;
}

export interface ProviderPayload {
  name: string;
  enabled: boolean;
  openai?: OpenAiProviderConfigPayload | null;
  anthropic?: AnthropicProviderConfigPayload | null;
}

export interface ProviderUpdatePayload {
  name?: string;
  enabled?: boolean;
  openai?: OpenAiProviderConfigUpdatePayload | null;
  anthropic?: AnthropicProviderConfigUpdatePayload | null;
}

export interface ProviderProtocolConfigItem {
  id: string;
  configured: true;
  protocol: ProviderProtocol;
  baseUrl: string;
  testTimeoutMs: number;
  apiVersion: string | null;
  apiKeyPreview: string | null;
}

export interface ProviderItem {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  openaiConfig: ProviderProtocolConfigItem | null;
  anthropicConfig: ProviderProtocolConfigItem | null;
}

export interface ProviderDeleteResult {
  success: true;
  providerId: string;
  providerName: string;
  removedBindingCount: number;
  affectedModelCount: number;
}

export interface ApiKeyMutationPayload {
  name: string;
  enabled?: boolean;
  allowedProviderIds?: string[];
  allowedModelAliasIds?: string[];
}

export interface ApiKeyItem {
  id: string;
  name: string;
  maskedPreview: string;
  enabled: boolean;
  deletedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  allowedProviderIds: string[];
  allowedModelAliasIds: string[];
  allProvidersAllowed: boolean;
  allModelsAllowed: boolean;
}

export interface BindingPayload {
  providerId: string;
  protocol: ProviderProtocol;
  upstreamModel: string;
  inputPrice: number;
  outputPrice: number;
  enabled: boolean;
}

export interface BindingItem extends BindingPayload {
  id: string;
  providerName: string;
  runtimePriority: number;
  defaultPriority: number;
}

export interface ModelBindings {
  openai: BindingItem[];
  anthropic: BindingItem[];
}

export interface ModelPayload {
  alias: string;
  displayName: string;
  enabled: boolean;
}

export interface ModelItem extends ModelPayload {
  id: string;
  bindings: ModelBindings;
}

export interface TrendPoint {
  label: string;
  requests: number;
  successes: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  estimatedCost: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
}

export interface DashboardCard {
  key: string;
  label: string;
  requests: number;
  successes: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  estimatedCost: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  trend: TrendPoint[];
}

export interface DashboardSummary {
  range: "day" | "week" | "month";
  windowStart: string;
  windowEnd: string;
  timezone: string;
  anchorDate: string;
  currentBucketIndex: number;
  overall: {
    requests: number;
    successes: number;
    failures: number;
    errorRate: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    totalTokens: number;
    estimatedCost: number;
    averageLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    missingUsageCount: number;
  };
  trend: TrendPoint[];
  providerCards: DashboardCard[];
  modelCards: DashboardCard[];
  apiKeyCards: DashboardCard[];
}

export interface DashboardFilters {
  providerId: string;
  modelAlias: string;
  apiKeyId: string;
}

export interface AuditItem {
  id: string;
  occurred_at: string;
  endpoint_type: string;
  provider_name: string | null;
  model_alias: string | null;
  upstream_model: string | null;
  api_key_id: string | null;
  api_key_name: string | null;
  api_key_masked_preview: string | null;
  status_category: string;
  http_status: number;
  latency_ms: number;
  input_tokens: number | null;
  cached_input_tokens: number;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost: number | null;
  error_summary: string | null;
  client_ip: string | null;
}

export interface AuditResponse {
  items: AuditItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface SystemStatus {
  ready: boolean;
  readyErrors: string[];
  dataDir: string;
  dbPath: string;
  timezone: string;
  externalBaseUrl: string | null;
  adminExternalBaseUrl: string | null;
  detectedBaseUrl: string;
  recommendedApiBaseUrl: string;
  recommendedAdminUrl: string;
  trustProxy: boolean;
  maxRequestBodySizeBytes: number;
  upstreamTimeoutMs: number;
  loginRateLimit: {
    windowMs: number;
    max: number;
  };
  apiRateLimit: {
    windowMs: number;
    max: number;
  };
  maxActiveProxyRequests: number;
  adminWhitelistEnabled: boolean;
  apiWhitelistEnabled: boolean;
  appliedMigrations: string[];
  activeApiKeyCount: number;
  totalApiKeyCount: number;
  warnings: string[];
}

export const api = {
  auth: {
    me: () =>
      request<{ user: { id: string; username: string } }>("/admin/api/auth/me", {
        method: "GET"
      }),
    login: (username: string, password: string) =>
      request<{ user: { id: string; username: string } }>("/admin/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      }),
    logout: () => request<{ success: boolean }>("/admin/api/auth/logout", { method: "POST" })
  },
  providers: {
    list: () => request<{ items: ProviderItem[] }>("/admin/api/providers", { method: "GET" }),
    create: (payload: ProviderPayload) =>
      request<{ item: ProviderItem }>("/admin/api/providers", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    update: (providerId: string, payload: ProviderUpdatePayload) =>
      request<{ item: ProviderItem }>(`/admin/api/providers/${providerId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    remove: (providerId: string) =>
      request<ProviderDeleteResult>(`/admin/api/providers/${providerId}`, {
        method: "DELETE"
      }),
    test: (providerId: string, protocol: ProviderProtocol) =>
      request<{
        success: boolean;
        statusCode: number | null;
        responseTimeMs: number;
        visibleModelCount: number | null;
        message: string;
      }>(`/admin/api/providers/${providerId}/test`, {
        method: "POST",
        body: JSON.stringify({ protocol })
      })
  },
  models: {
    list: () => request<{ items: ModelItem[] }>("/admin/api/models", { method: "GET" }),
    create: (payload: ModelPayload) =>
      request<{ item: ModelItem }>("/admin/api/models", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    update: (modelId: string, payload: Partial<ModelPayload>) =>
      request<{ item: ModelItem }>(`/admin/api/models/${modelId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    remove: (modelId: string) =>
      request<{ success: boolean }>(`/admin/api/models/${modelId}`, {
        method: "DELETE"
      }),
    addBinding: (modelId: string, payload: BindingPayload) =>
      request<{ item: ModelItem }>(`/admin/api/models/${modelId}/bindings`, {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    updateBinding: (
      modelId: string,
      bindingId: string,
      payload: Partial<BindingPayload> & { runtimePriority?: number; defaultPriority?: number }
    ) =>
      request<{ item: ModelItem }>(`/admin/api/models/${modelId}/bindings/${bindingId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    removeBinding: (modelId: string, bindingId: string) =>
      request<{ success: boolean }>(`/admin/api/models/${modelId}/bindings/${bindingId}`, {
        method: "DELETE"
      }),
    applyRuntimeOrder: (modelId: string, protocol: ProviderProtocol, bindingIds: string[]) =>
      request<{ item: ModelItem }>(`/admin/api/models/${modelId}/runtime-order/apply`, {
        method: "POST",
        body: JSON.stringify({ protocol, bindingIds })
      }),
    saveDefaultOrder: (modelId: string, protocol: ProviderProtocol, bindingIds: string[]) =>
      request<{ item: ModelItem }>(`/admin/api/models/${modelId}/runtime-order/save-default`, {
        method: "POST",
        body: JSON.stringify({ protocol, bindingIds })
      })
  },
  dashboard: {
    get: (range: "day" | "week" | "month", date?: string, filters?: Partial<DashboardFilters>) => {
      const params = new URLSearchParams({
        range
      });

      if (range === "day" && date) {
        params.set("date", date);
      }

      if (filters?.providerId) {
        params.set("providerId", filters.providerId);
      }

      if (filters?.modelAlias) {
        params.set("modelAlias", filters.modelAlias);
      }

      if (filters?.apiKeyId) {
        params.set("apiKeyId", filters.apiKeyId);
      }

      return request<DashboardSummary>(`/admin/api/dashboard?${params.toString()}`, { method: "GET" });
    }
  },
  audit: {
    list: (query: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== "") {
          params.set(key, String(value));
        }
      });
      return request<AuditResponse>(`/admin/api/audit?${params.toString()}`, { method: "GET" });
    }
  },
  security: {
    listApiKeys: (includeDeleted = false) =>
      request<{ items: ApiKeyItem[] }>(
        `/admin/api/security/api-keys?includeDeleted=${includeDeleted ? "true" : "false"}`,
        {
          method: "GET"
        }
      ),
    createApiKey: (payload: ApiKeyMutationPayload) =>
      request<{ item: ApiKeyItem; createdKeyPlaintext: string }>("/admin/api/security/api-keys", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    updateApiKey: (apiKeyId: string, payload: Partial<ApiKeyMutationPayload>) =>
      request<{ item: ApiKeyItem }>(`/admin/api/security/api-keys/${apiKeyId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    deleteApiKey: (apiKeyId: string) =>
      request<{ success: boolean }>(`/admin/api/security/api-keys/${apiKeyId}`, {
        method: "DELETE"
      })
  },
  system: {
    status: () => request<SystemStatus>("/admin/api/system/status", { method: "GET" })
  }
};
