import type { Dispatch, SetStateAction } from "react";

import type { ApiKeyItem, SystemStatus } from "../lib/api.ts";
import { formatDateTime, formatNumber } from "../lib/format.ts";

interface ApiKeyDraft {
  name: string;
  enabled: boolean;
}

interface SystemPageProps {
  systemStatus: SystemStatus | null;
  apiKeys: ApiKeyItem[];
  apiKeyDrafts: Record<string, ApiKeyDraft>;
  setApiKeyDrafts: Dispatch<SetStateAction<Record<string, ApiKeyDraft>>>;
  newApiKeyName: string;
  setNewApiKeyName: Dispatch<SetStateAction<string>>;
  createdApiKeyPlaintext: string | null;
  onCreateApiKey: () => void;
  onSaveApiKey: (apiKeyId: string) => void;
  onDeleteApiKey: (apiKeyId: string) => void;
}

export function SystemPage({
  systemStatus,
  apiKeys,
  apiKeyDrafts,
  setApiKeyDrafts,
  newApiKeyName,
  setNewApiKeyName,
  createdApiKeyPlaintext,
  onCreateApiKey,
  onSaveApiKey,
  onDeleteApiKey
}: SystemPageProps) {
  if (!systemStatus) {
    return null;
  }

  return (
    <div className="stack">
      <section className="metric-grid">
        <article className="panel">
          <span>服务就绪</span>
          <strong>{systemStatus.ready ? "Ready" : "Not Ready"}</strong>
        </article>
        <article className="panel">
          <span>可信代理</span>
          <strong>{systemStatus.trustProxy ? "已启用" : "未启用"}</strong>
        </article>
        <article className="panel">
          <span>可用 API Key</span>
          <strong>
            {formatNumber(systemStatus.activeApiKeyCount)} / {formatNumber(systemStatus.totalApiKeyCount)}
          </strong>
        </article>
        <article className="panel">
          <span>并发上限</span>
          <strong>{systemStatus.maxActiveProxyRequests}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>系统状态</h3>
        </div>
        <div className="detail-grid">
          <div>
            <span>推荐 API 地址</span>
            <strong>{systemStatus.recommendedApiBaseUrl}</strong>
          </div>
          <div>
            <span>推荐后台地址</span>
            <strong>{systemStatus.recommendedAdminUrl}</strong>
          </div>
          <div>
            <span>数据目录</span>
            <strong>{systemStatus.dataDir}</strong>
          </div>
          <div>
            <span>数据库文件</span>
            <strong>{systemStatus.dbPath}</strong>
          </div>
        </div>
        {systemStatus.warnings.length > 0 ? (
          <div className="warning-list">
            {systemStatus.warnings.map((warning) => (
              <p key={warning} className="feedback warning">
                {warning}
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>创建 API Key</h3>
          <span className="muted">系统会自动生成明文，只会在创建成功时展示一次。</span>
        </div>
        <label>
          <span>名称</span>
          <input
            value={newApiKeyName}
            onChange={(event) => setNewApiKeyName(event.target.value)}
            placeholder="例如：NAS-Home / iPhone / OpenWebUI"
          />
        </label>
        <button type="button" className="primary" onClick={onCreateApiKey}>
          创建 API Key
        </button>
        {createdApiKeyPlaintext ? (
          <div className="feedback warning">
            <strong>请立即保存这把新 Key：</strong>
            <div>
              <code>{createdApiKeyPlaintext}</code>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>API Key 管理</h3>
          <span className="muted">支持名称编辑、启用/停用与软删除，历史审计会保留快照。</span>
        </div>
        {apiKeys.length === 0 ? (
          <p className="muted">当前还没有可管理的 API Key，先创建第一把即可开始调用 `/v1/*`。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>掩码预览</th>
                  <th>启用</th>
                  <th>最近使用</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((apiKey) => {
                  const draft = apiKeyDrafts[apiKey.id] ?? {
                    name: apiKey.name,
                    enabled: apiKey.enabled
                  };

                  return (
                    <tr key={apiKey.id}>
                      <td>
                        <input
                          value={draft.name}
                          onChange={(event) =>
                            setApiKeyDrafts((current) => ({
                              ...current,
                              [apiKey.id]: {
                                ...draft,
                                name: event.target.value
                              }
                            }))
                          }
                        />
                      </td>
                      <td>{apiKey.maskedPreview}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={draft.enabled}
                          onChange={(event) =>
                            setApiKeyDrafts((current) => ({
                              ...current,
                              [apiKey.id]: {
                                ...draft,
                                enabled: event.target.checked
                              }
                            }))
                          }
                        />
                      </td>
                      <td>{apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt) : "-"}</td>
                      <td>{formatDateTime(apiKey.createdAt)}</td>
                      <td>
                        <div className="toolbar">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => onSaveApiKey(apiKey.id)}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => onDeleteApiKey(apiKey.id)}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
