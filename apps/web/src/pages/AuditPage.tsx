import type { Dispatch, SetStateAction } from "react";

import type { ApiKeyItem, AuditResponse, ProviderItem } from "../lib/api.ts";
import { formatCost, formatDateTime, formatNumber } from "../lib/format.ts";

interface AuditPageProps {
  providers: ProviderItem[];
  apiKeys: ApiKeyItem[];
  modelAliasOptions: string[];
  audit: AuditResponse | null;
  auditFilters: {
    providerId: string;
    apiKeyId: string;
    modelAlias: string;
    statusCategory: string;
    endpointType: string;
    page: number;
  };
  setAuditFilters: Dispatch<
    SetStateAction<{
      providerId: string;
      apiKeyId: string;
      modelAlias: string;
      statusCategory: string;
      endpointType: string;
      page: number;
    }>
  >;
  refreshAudit: (
    page?: number,
    overrides?: Partial<{
      providerId: string;
      apiKeyId: string;
      modelAlias: string;
      statusCategory: string;
      endpointType: string;
      page: number;
    }>
  ) => Promise<void>;
  onError: (reason: unknown) => void;
}

function formatApiKeyLabel(apiKey: ApiKeyItem): string {
  const base = `${apiKey.name} (${apiKey.maskedPreview})`;
  return apiKey.deletedAt ? `${base} [deleted]` : base;
}

function formatAuditApiKey(item: AuditResponse["items"][number]): string {
  if (item.api_key_name && item.api_key_masked_preview) {
    return `${item.api_key_name} (${item.api_key_masked_preview})`;
  }

  return item.api_key_name ?? item.api_key_masked_preview ?? "-";
}

function formatTokenBreakdown(item: AuditResponse["items"][number]): string {
  return [
    `In ${formatNumber(item.input_tokens)}`,
    `Out ${formatNumber(item.output_tokens)}`,
    `Cache ${formatNumber(item.cached_input_tokens)}`,
    `Total ${formatNumber(item.total_tokens)}`,
    `Cost ${formatCost(item.estimated_cost)}`
  ].join(" / ");
}

export function AuditPage({
  providers,
  apiKeys,
  modelAliasOptions,
  audit,
  auditFilters,
  setAuditFilters,
  refreshAudit,
  onError
}: AuditPageProps) {
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h3>Filters</h3>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const nextFilters = {
                providerId: "",
                apiKeyId: "",
                modelAlias: "",
                statusCategory: "",
                endpointType: "",
                page: 1
              };
              setAuditFilters(nextFilters);
              void refreshAudit(1, nextFilters).catch(onError);
            }}
          >
            Clear
          </button>
        </div>

        <div className="form-grid">
          <label>
            <span>Provider</span>
            <select
              value={auditFilters.providerId}
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, providerId: event.target.value }))
              }
            >
              <option value="">All</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>API Key</span>
            <select
              value={auditFilters.apiKeyId}
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, apiKeyId: event.target.value }))
              }
            >
              <option value="">All</option>
              {apiKeys.map((apiKey) => (
                <option key={apiKey.id} value={apiKey.id}>
                  {formatApiKeyLabel(apiKey)}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Model Alias</span>
            <input
              value={auditFilters.modelAlias}
              list="model-aliases"
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, modelAlias: event.target.value }))
              }
            />
            <datalist id="model-aliases">
              {modelAliasOptions.map((alias) => (
                <option key={alias} value={alias} />
              ))}
            </datalist>
          </label>

          <label>
            <span>Status</span>
            <select
              value={auditFilters.statusCategory}
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, statusCategory: event.target.value }))
              }
            >
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="unauthorized">Unauthorized</option>
              <option value="configuration_error">Configuration Error</option>
              <option value="upstream_error">Upstream Error</option>
              <option value="network_error">Network Error</option>
              <option value="security_policy">Security Policy</option>
            </select>
          </label>

          <label>
            <span>Endpoint</span>
            <select
              value={auditFilters.endpointType}
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, endpointType: event.target.value }))
              }
            >
              <option value="">All</option>
              <option value="model_list">Model List</option>
              <option value="chat_completions">Chat Completions</option>
              <option value="responses">Responses</option>
              <option value="admin_login">Admin Login</option>
              <option value="security">Security</option>
            </select>
          </label>
        </div>

        <button
          type="button"
          className="primary"
          onClick={() => {
            setAuditFilters((current) => ({ ...current, page: 1 }));
            void refreshAudit(1, { page: 1 }).catch(onError);
          }}
        >
          Search
        </button>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Audit Results</h3>
          <span className="pill">{audit?.pagination.total ?? 0} rows</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Endpoint</th>
                <th>Provider</th>
                <th>Model</th>
                <th>API Key</th>
                <th>Status</th>
                <th>HTTP</th>
                <th>Latency</th>
                <th>Tokens / Cost</th>
                <th>Client IP</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {audit?.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.occurred_at)}</td>
                  <td>{item.endpoint_type}</td>
                  <td>{item.provider_name ?? "-"}</td>
                  <td>{item.model_alias ?? item.upstream_model ?? "-"}</td>
                  <td>{formatAuditApiKey(item)}</td>
                  <td>{item.status_category}</td>
                  <td>{item.http_status}</td>
                  <td>{formatNumber(item.latency_ms)} ms</td>
                  <td>{formatTokenBreakdown(item)}</td>
                  <td>{item.client_ip ?? "-"}</td>
                  <td>{item.error_summary ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <button
            type="button"
            className="secondary"
            disabled={!audit || audit.pagination.page <= 1}
            onClick={() => {
              const nextPage = Math.max(1, auditFilters.page - 1);
              setAuditFilters((current) => ({ ...current, page: nextPage }));
              void refreshAudit(nextPage, { page: nextPage }).catch(onError);
            }}
          >
            Previous
          </button>

          <span>
            Page {audit?.pagination.page ?? 1} / {audit?.pagination.totalPages ?? 1}
          </span>

          <button
            type="button"
            className="secondary"
            disabled={!audit || audit.pagination.page >= audit.pagination.totalPages}
            onClick={() => {
              const nextPage = auditFilters.page + 1;
              setAuditFilters((current) => ({ ...current, page: nextPage }));
              void refreshAudit(nextPage, { page: nextPage }).catch(onError);
            }}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}
