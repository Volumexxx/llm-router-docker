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
  return apiKey.deletedAt ? `${base} [已删除]` : base;
}

function formatAuditApiKey(
  item: AuditResponse["items"][number]
): string {
  if (item.api_key_name && item.api_key_masked_preview) {
    return `${item.api_key_name} (${item.api_key_masked_preview})`;
  }

  return item.api_key_name ?? item.api_key_masked_preview ?? "-";
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
          <h3>检索条件</h3>
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
            清空
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
              <option value="">全部</option>
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
              <option value="">全部</option>
              {apiKeys.map((apiKey) => (
                <option key={apiKey.id} value={apiKey.id}>
                  {formatApiKeyLabel(apiKey)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>模型别名</span>
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
            <span>状态</span>
            <select
              value={auditFilters.statusCategory}
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, statusCategory: event.target.value }))
              }
            >
              <option value="">全部</option>
              <option value="success">成功</option>
              <option value="unauthorized">未授权</option>
              <option value="configuration_error">配置错误</option>
              <option value="upstream_error">上游错误</option>
              <option value="network_error">网络错误</option>
              <option value="security_policy">安全策略</option>
            </select>
          </label>
          <label>
            <span>接口</span>
            <select
              value={auditFilters.endpointType}
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, endpointType: event.target.value }))
              }
            >
              <option value="">全部</option>
              <option value="model_list">模型列表</option>
              <option value="chat_completions">聊天补全</option>
              <option value="responses">Responses</option>
              <option value="admin_login">后台登录</option>
              <option value="security">安全事件</option>
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
          查询日志
        </button>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>审计结果</h3>
          <span className="pill">{audit?.pagination.total ?? 0} 条</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>接口</th>
                <th>Provider</th>
                <th>模型</th>
                <th>API Key</th>
                <th>状态</th>
                <th>HTTP</th>
                <th>延迟</th>
                <th>Tokens / 成本</th>
                <th>来源 IP</th>
                <th>摘要</th>
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
                  <td>
                    {formatNumber(item.total_tokens)} / {formatCost(item.estimated_cost)}
                  </td>
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
            上一页
          </button>
          <span>
            第 {audit?.pagination.page ?? 1} / {audit?.pagination.totalPages ?? 1} 页
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
            下一页
          </button>
        </div>
      </section>
    </div>
  );
}
