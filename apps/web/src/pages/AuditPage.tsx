import type { Dispatch, SetStateAction } from "react";

import type { ApiKeyItem, AuditResponse, ProviderItem, UserItem } from "../lib/api.ts";
import { formatCost, formatDateTime, formatDuration, formatNumber } from "../lib/format.ts";

interface AuditPageProps {
  providers: ProviderItem[];
  apiKeys: ApiKeyItem[];
  users?: UserItem[];
  isAdmin?: boolean;
  modelAliasOptions: string[];
  audit: AuditResponse | null;
  auditFilters: {
    providerId: string;
    apiKeyId: string;
    userId: string;
    modelAlias: string;
    statusCategory: string;
    endpointType: string;
    page: number;
  };
  setAuditFilters: Dispatch<
    SetStateAction<{
      providerId: string;
      apiKeyId: string;
      userId: string;
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
      userId: string;
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

function formatAuditApiKey(item: AuditResponse["items"][number]): string {
  if (item.api_key_name && item.api_key_masked_preview) {
    return `${item.api_key_name} (${item.api_key_masked_preview})`;
  }

  return item.api_key_name ?? item.api_key_masked_preview ?? "-";
}

function formatTokenBreakdown(item: AuditResponse["items"][number]): string {
  return [
    `输入 ${formatNumber(item.input_tokens)}`,
    `输出 ${formatNumber(item.output_tokens)}`,
    `缓存 ${formatNumber(item.cached_input_tokens)}`,
    `总量 ${formatNumber(item.total_tokens)}`,
    `成本 ${formatCost(item.estimated_cost)}`
  ].join(" / ");
}

export function AuditPage({
  providers,
  apiKeys,
  users = [],
  isAdmin = true,
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
          <div className="stack compact-stack">
            <h3>审计筛选</h3>
            <p className="muted">按 Provider、API Key、模型别名、状态和接口类型快速检索。</p>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const nextFilters = {
                providerId: "",
                apiKeyId: "",
                userId: "",
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
          {isAdmin ? (
          <label>
            <span>User</span>
            <select
              value={auditFilters.userId ?? ""}
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, userId: event.target.value }))
              }
            >
              <option value="">全部</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </label>
          ) : null}

          {isAdmin ? (
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
          ) : null}

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
              list="audit-model-aliases"
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, modelAlias: event.target.value }))
              }
            />
            <datalist id="audit-model-aliases">
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
            <span>接口类型</span>
            <select
              value={auditFilters.endpointType}
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, endpointType: event.target.value }))
              }
            >
              <option value="">全部</option>
              <option value="model_list">模型列表</option>
              <option value="chat_completions">Chat Completions</option>
              <option value="messages">Messages</option>
              <option value="responses">Responses</option>
              <option value="admin_login">后台登录</option>
              <option value="security">安全事件</option>
            </select>
          </label>
        </div>

        <div className="toolbar">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setAuditFilters((current) => ({ ...current, page: 1 }));
              void refreshAudit(1, { page: 1 }).catch(onError);
            }}
          >
            查询审计
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>审计结果</h3>
            <p className="muted">默认按时间倒序，展示请求来源、状态、Token 和成本摘要。</p>
          </div>
          <span className="pill">{audit?.pagination.total ?? 0} 条记录</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>接口</th>
                {isAdmin ? <th>User</th> : null}
                {isAdmin ? <th>Provider</th> : null}
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
              {audit?.items.length ? (
                audit.items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.occurred_at)}</td>
                    <td>{item.endpoint_type}</td>
                    {isAdmin ? <td>{item.user_display_name ?? "-"}</td> : null}
                    {isAdmin ? <td>{item.provider_name ?? "-"}</td> : null}
                    <td>{item.model_alias ?? item.upstream_model ?? "-"}</td>
                    <td>{formatAuditApiKey(item)}</td>
                    <td>{item.status_category}</td>
                    <td>{item.http_status}</td>
                    <td>{formatDuration(item.latency_ms)}</td>
                    <td>{formatTokenBreakdown(item)}</td>
                    <td>{item.client_ip ?? "-"}</td>
                    <td>{item.error_summary ?? "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={isAdmin ? 12 : 10}>
                    <div className="table-empty">当前筛选条件下没有审计记录。</div>
                  </td>
                </tr>
              )}
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
