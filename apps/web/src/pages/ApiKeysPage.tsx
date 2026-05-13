import type { ApiKeyItem, SystemStatus } from "../lib/api.ts";
import { formatDateTime, formatNumber } from "../lib/format.ts";

interface ApiKeysPageProps {
  systemStatus: SystemStatus | null;
  apiKeys: ApiKeyItem[];
  newApiKeyName: string;
  setNewApiKeyName: (value: string) => void;
  createdApiKeyPlaintext: string | null;
  onCreateApiKey: () => void;
  onCopyApiKey: (apiKeyId: string) => void;
  onToggleApiKeyEnabled: (apiKeyId: string, enabled: boolean) => void;
  onDeleteApiKey: (apiKeyId: string) => void;
}

export function ApiKeysPage({
  systemStatus,
  apiKeys,
  newApiKeyName,
  setNewApiKeyName,
  createdApiKeyPlaintext,
  onCreateApiKey,
  onCopyApiKey,
  onToggleApiKeyEnabled,
  onDeleteApiKey
}: ApiKeysPageProps) {
  return (
    <div className="stack">
      <section className="panel hero-panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <p className="eyebrow">API Keys</p>
            <h3>API Keys</h3>
          </div>
        </div>

        <div className="metric-grid">
          <article className="stat-card">
            <span>推荐 API 地址</span>
            <strong>{systemStatus?.recommendedApiBaseUrl ?? "-"}</strong>
          </article>
          <article className="stat-card">
            <span>活跃 API Keys</span>
            <strong>
              {formatNumber(systemStatus?.activeApiKeyCount ?? 0)} /{" "}
              {formatNumber(systemStatus?.totalApiKeyCount ?? 0)}
            </strong>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>新增 API Key</h3>
            <p className="muted">Key 权限继承当前账号权限；这里只需要填写名称。</p>
          </div>
        </div>

        <div className="form-grid">
          <label>
            <span>名称</span>
            <input
              value={newApiKeyName}
              onChange={(event) => setNewApiKeyName(event.target.value)}
              placeholder="例如：默认 / OpenWebUI / iPhone"
            />
          </label>
        </div>

        <div className="toolbar">
          <button type="button" className="primary" onClick={onCreateApiKey}>
            创建 API Key
          </button>
        </div>

        {createdApiKeyPlaintext ? (
          <div className="created-key-panel">
            <div className="stack compact-stack">
              <strong>新建成功，仅展示一次</strong>
              <code className="secret-preview">{createdApiKeyPlaintext}</code>
              <p className="muted">后续可通过复制按钮重新写入剪贴板。</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>API Key 列表</h3>
            <p className="muted">列表只展示掩码；复制时会向后端取完整 Key。</p>
          </div>
          <span className="pill">{apiKeys.length} 把 Key</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>掩码预览</th>
                <th>状态</th>
                <th>最近使用</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {apiKeys.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="table-empty">当前账号还没有 API Key。</div>
                  </td>
                </tr>
              ) : (
                apiKeys.map((apiKey) => (
                  <tr key={apiKey.id}>
                    <td>{apiKey.name}</td>
                    <td>
                      <code>{apiKey.maskedPreview}</code>
                    </td>
                    <td>
                      <div className="inline">
                        <span className={apiKey.enabled ? "status-pill online" : "status-pill offline"}>
                          {apiKey.enabled ? "启用中" : "已停用"}
                        </span>
                        <label className="inline-toggle">
                          <input
                            type="checkbox"
                            checked={apiKey.enabled}
                            aria-label={`toggle-api-key-${apiKey.id}`}
                            onChange={(event) => onToggleApiKeyEnabled(apiKey.id, event.target.checked)}
                          />
                          <span>启用</span>
                        </label>
                      </div>
                    </td>
                    <td>{apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt) : "-"}</td>
                    <td>{formatDateTime(apiKey.createdAt)}</td>
                    <td>
                      <div className="toolbar">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => onCopyApiKey(apiKey.id)}
                        >
                          复制
                        </button>
                        <button
                          type="button"
                          className="ghost danger"
                          onClick={() => {
                            if (!window.confirm(`确认删除 API Key “${apiKey.name}” 吗？`)) {
                              return;
                            }
                            onDeleteApiKey(apiKey.id);
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
