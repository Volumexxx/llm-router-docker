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

export interface ProviderPayload {
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  testTimeoutMs: number;
}

export interface ProviderItem {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  testTimeoutMs: number;
  apiKeyPreview: string | null;
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

export interface ModelPayload {
  alias: string;
  displayName: string;
  enabled: boolean;
}

export interface ModelItem extends ModelPayload {
  id: string;
  bindings: BindingItem[];
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
    update: (providerId: string, payload: Partial<ProviderPayload>) =>
      request<{ item: ProviderItem }>(`/admin/api/providers/${providerId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    test: (providerId: string) =>
      request<{
        success: boolean;
        statusCode: number | null;
        responseTimeMs: number;
        visibleModelCount: number | null;
        message: string;
      }>(`/admin/api/providers/${providerId}/test`, {
        method: "POST"
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
    applyRuntimeOrder: (modelId: string, bindingIds: string[]) =>
      request<{ item: ModelItem }>(`/admin/api/models/${modelId}/runtime-order/apply`, {
        method: "POST",
        body: JSON.stringify({ bindingIds })
      }),
    saveDefaultOrder: (modelId: string, bindingIds: string[]) =>
      request<{ item: ModelItem }>(`/admin/api/models/${modelId}/runtime-order/save-default`, {
        method: "POST",
        body: JSON.stringify({ bindingIds })
      })
  },
  dashboard: {
    get: (range: "day" | "week" | "month") =>
      request<DashboardSummary>(`/admin/api/dashboard?range=${range}`, { method: "GET" })
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
