import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { Drawer } from "../components/Drawer.tsx";
import type { ApiKeyItem, ModelItem, ProviderItem, SystemStatus } from "../lib/api.ts";
import { formatDateTime, formatNumber } from "../lib/format.ts";

type ApiKeyDraft = {
  name: string;
  enabled: boolean;
  allProvidersAllowed: boolean;
  allowedProviderIds: string[];
  allModelsAllowed: boolean;
  allowedModelAliasIds: string[];
};

interface SystemPageProps {
  systemStatus: SystemStatus | null;
  providers: ProviderItem[];
  models: ModelItem[];
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

function toggleId(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function summarizeScope(
  ids: string[],
  items: Array<{ id: string; label: string }>,
  emptyLabel: string
): string {
  if (ids.length === 0) {
    return emptyLabel;
  }

  const labels = ids
    .map((id) => items.find((item) => item.id === id)?.label)
    .filter((label): label is string => Boolean(label));

  return labels.length > 0 ? labels.join("、") : emptyLabel;
}

function ScopeEditor({
  title,
  emptyLabel,
  items,
  selectedIds,
  allSelected,
  onToggle,
  onAllowAll
}: {
  title: string;
  emptyLabel: string;
  items: Array<{ id: string; label: string; hint?: string }>;
  selectedIds: string[];
  allSelected: boolean;
  onToggle: (id: string) => void;
  onAllowAll: () => void;
}) {
  return (
    <div className="scope-card">
      <div className="panel-head">
        <h4>{title}</h4>
        <span className="pill">{allSelected ? emptyLabel : `已选 ${selectedIds.length} 项`}</span>
      </div>

      <div className="scope-card-actions">
        <button type="button" className={allSelected ? "chip active" : "chip"} onClick={onAllowAll}>
          全部可用
        </button>
      </div>

      {items.length === 0 ? (
        <p className="muted">当前还没有可选项目。</p>
      ) : (
        <div className="checkbox-list">
          {items.map((item) => (
            <label key={item.id} className="checkbox-item">
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              <span>
                <strong>{item.label}</strong>
                {item.hint ? <small className="muted">{item.hint}</small> : null}
              </span>
            </label>
          ))}
        </div>
      )}

      <p className="muted">Key 级范围仅保留用于历史兼容。</p>
    </div>
  );
}

export function SystemPage({
  systemStatus,
  providers,
  models,
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
  const [selectedApiKeyId, setSelectedApiKeyId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const providerOptions = useMemo(
    () =>
      providers.map((provider) => ({
        id: provider.id,
        label: provider.name,
        hint:
          provider.openaiConfig && provider.anthropicConfig
            ? "OpenAI / Anthropic"
            : provider.anthropicConfig
              ? "Anthropic"
              : provider.openaiConfig
                ? "OpenAI"
                : "Unconfigured"
      })),
    [providers]
  );

  const modelOptions = useMemo(
    () =>
      models.map((model) => ({
        id: model.id,
        label: model.alias,
        hint: model.displayName
      })),
    [models]
  );

  const selectedApiKey = useMemo(
    () => apiKeys.find((item) => item.id === selectedApiKeyId) ?? null,
    [apiKeys, selectedApiKeyId]
  );

  useEffect(() => {
    if (selectedApiKeyId && !selectedApiKey) {
      setSelectedApiKeyId(null);
    }
  }, [selectedApiKey, selectedApiKeyId]);

  useEffect(() => {
    setCopyFeedback(null);
  }, [createdApiKeyPlaintext]);

  if (!systemStatus) {
    return null;
  }

  const selectedDraft = selectedApiKey
    ? (apiKeyDrafts[selectedApiKey.id] ?? {
        name: selectedApiKey.name,
        enabled: selectedApiKey.enabled,
        allProvidersAllowed: selectedApiKey.allProvidersAllowed,
        allowedProviderIds: selectedApiKey.allowedProviderIds,
        allModelsAllowed: selectedApiKey.allModelsAllowed,
        allowedModelAliasIds: selectedApiKey.allowedModelAliasIds
      })
    : null;

  const effectiveProviderIds =
    selectedDraft && selectedDraft.allProvidersAllowed
      ? providerOptions.map((provider) => provider.id)
      : (selectedDraft?.allowedProviderIds ?? []);

  const effectiveModelIds =
    selectedDraft && selectedDraft.allModelsAllowed
      ? modelOptions.map((model) => model.id)
      : (selectedDraft?.allowedModelAliasIds ?? []);

  const updateSelectedDraft = (patch: Partial<ApiKeyDraft>) => {
    if (!selectedApiKey || !selectedDraft) {
      return;
    }

    setApiKeyDrafts((current) => ({
      ...current,
      [selectedApiKey.id]: {
        ...selectedDraft,
        ...patch
      }
    }));
  };

  return (
    <div className="stack">
      <section className="panel hero-panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <p className="eyebrow">System Telemetry</p>
            <h3>系统状态</h3>
            <p className="muted">部署健康、代理模式和 API Key 配置状态一屏查看。</p>
          </div>
        </div>

        <div className="metric-grid">
          <article className="stat-card">
            <span>服务状态</span>
            <strong>{systemStatus.ready ? "Ready" : "Not Ready"}</strong>
          </article>
          <article className="stat-card">
            <span>Trusted Proxy</span>
            <strong>{systemStatus.trustProxy ? "已启用" : "未启用"}</strong>
          </article>
          <article className="stat-card">
            <span>活跃 API Keys</span>
            <strong>
              {formatNumber(systemStatus.activeApiKeyCount)} / {formatNumber(systemStatus.totalApiKeyCount)}
            </strong>
          </article>
          <article className="stat-card">
            <span>最大并发代理</span>
            <strong>{formatNumber(systemStatus.maxActiveProxyRequests)}</strong>
          </article>
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
          <div className="stack compact-stack">
            <h3>创建 API Key</h3>
            <p className="muted">
              新建后默认支持全部 Provider 与 Model，如需收紧范围，再到详情抽屉里勾选白名单。
            </p>
          </div>
        </div>

        <div className="form-grid">
          <label>
            <span>名称</span>
            <input
              value={newApiKeyName}
              onChange={(event) => setNewApiKeyName(event.target.value)}
              placeholder="例如：NAS 家庭网关 / OpenWebUI / iPhone"
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
              <p className="muted">请立即复制保存，后续详情页无法再次查看旧明文。</p>
            </div>

            <div className="toolbar">
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(createdApiKeyPlaintext);
                    setCopyFeedback("已复制到剪贴板。");
                  } catch {
                    setCopyFeedback("当前环境不支持自动复制，请手动复制上方明文。");
                  }
                }}
              >
                复制明文
              </button>
              {copyFeedback ? <span className="muted">{copyFeedback}</span> : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>API Key 列表</h3>
            <p className="muted">摘要页只显示关键状态，详细权限配置在右侧抽屉中维护。</p>
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
                <th>Provider 范围</th>
                <th>Model 范围</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {apiKeys.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="table-empty">还没有可用的 API Key，先在上方创建第一把。</div>
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
                      <span className={apiKey.enabled ? "status-pill online" : "status-pill offline"}>
                        {apiKey.enabled ? "启用中" : "已停用"}
                      </span>
                    </td>
                    <td>{apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt) : "-"}</td>
                    <td>
                      {summarizeScope(apiKey.allowedProviderIds, providerOptions, "全部 Provider")}
                    </td>
                    <td>{summarizeScope(apiKey.allowedModelAliasIds, modelOptions, "全部模型")}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setSelectedApiKeyId(apiKey.id)}
                      >
                        配置
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Drawer
        open={Boolean(selectedApiKey)}
        size="wide"
        title={selectedApiKey ? `API Key 配置 · ${selectedApiKey.name}` : ""}
        subtitle={
          selectedApiKey
            ? "先按 API Key 权限过滤候选绑定，再在剩余 binding 内按 runtime priority 选择最优路由。"
            : undefined
        }
        onClose={() => setSelectedApiKeyId(null)}
      >
        {selectedApiKey && selectedDraft ? (
          <div className="stack">
            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>基本信息</h4>
                  <p className="muted">旧 Key 明文不可回看，当前仅展示掩码预览与使用状态。</p>
                </div>
                <span className="pill">{selectedApiKey.maskedPreview}</span>
              </div>

              <div className="form-grid">
                <label>
                  <span>名称</span>
                  <input
                    value={selectedDraft.name}
                    onChange={(event) =>
                      setApiKeyDrafts((current) => ({
                        ...current,
                        [selectedApiKey.id]: {
                          ...selectedDraft,
                          name: event.target.value
                        }
                      }))
                    }
                  />
                </label>

                <label className="inline-toggle">
                  <span>启用状态</span>
                  <input
                    type="checkbox"
                    checked={selectedDraft.enabled}
                    onChange={(event) =>
                      setApiKeyDrafts((current) => ({
                        ...current,
                        [selectedApiKey.id]: {
                          ...selectedDraft,
                          enabled: event.target.checked
                        }
                      }))
                    }
                  />
                </label>
              </div>

              <div className="detail-grid">
                <div>
                  <span>创建时间</span>
                  <strong>{formatDateTime(selectedApiKey.createdAt)}</strong>
                </div>
                <div>
                  <span>最近使用</span>
                  <strong>
                    {selectedApiKey.lastUsedAt ? formatDateTime(selectedApiKey.lastUsedAt) : "-"}
                  </strong>
                </div>
                <div>
                  <span>Provider 范围</span>
                  <strong>
                    {summarizeScope(effectiveProviderIds, providerOptions, "全部 Provider")}
                  </strong>
                </div>
                <div>
                  <span>Model 范围</span>
                  <strong>
                    {summarizeScope(effectiveModelIds, modelOptions, "全部模型")}
                  </strong>
                </div>
              </div>
            </section>

            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>权限范围</h4>
                  <p className="muted">
                    不勾选表示该维度放开。最终可路由目标 = Provider 白名单与模型白名单的交集。
                  </p>
                </div>
              </div>

              <div className="scope-grid">
                <ScopeEditor
                  title="Allowed Providers"
                  emptyLabel="全部 Provider"
                  items={providerOptions}
                  selectedIds={effectiveProviderIds}
                  allSelected={selectedDraft.allProvidersAllowed}
                  onToggle={(providerId) =>
                    updateSelectedDraft({
                      allProvidersAllowed: false,
                      allowedProviderIds: toggleId(effectiveProviderIds, providerId)
                    })
                  }
                  onAllowAll={() =>
                    updateSelectedDraft({
                      allProvidersAllowed: true,
                      allowedProviderIds: []
                    })
                  }
                />

                <ScopeEditor
                  title="Allowed Models"
                  emptyLabel="全部模型"
                  items={modelOptions}
                  selectedIds={effectiveModelIds}
                  allSelected={selectedDraft.allModelsAllowed}
                  onToggle={(modelId) =>
                    updateSelectedDraft({
                      allModelsAllowed: false,
                      allowedModelAliasIds: toggleId(effectiveModelIds, modelId)
                    })
                  }
                  onAllowAll={() =>
                    updateSelectedDraft({
                      allModelsAllowed: true,
                      allowedModelAliasIds: []
                    })
                  }
                />
              </div>

              <div className="toolbar">
                <button
                  type="button"
                  className="primary"
                  onClick={() => onSaveApiKey(selectedApiKey.id)}
                >
                  保存配置
                </button>
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() => {
                    if (!window.confirm(`确认删除 API Key “${selectedApiKey.name}” 吗？`)) {
                      return;
                    }

                    onDeleteApiKey(selectedApiKey.id);
                    setSelectedApiKeyId(null);
                  }}
                >
                  删除 Key
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
