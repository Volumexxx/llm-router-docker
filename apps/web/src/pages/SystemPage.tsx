import type { Dispatch, SetStateAction } from "react";

import type { ApiKeyItem, ModelItem, ProviderItem, SystemStatus } from "../lib/api.ts";
import { formatDateTime, formatNumber } from "../lib/format.ts";

type ApiKeyDraft = {
  name: string;
  enabled: boolean;
  allowedProviderIds: string[];
  allowedModelAliasIds: string[];
};

interface SystemPageProps {
  systemStatus: SystemStatus | null;
  providers: ProviderItem[];
  models: ModelItem[];
  apiKeys: ApiKeyItem[];
  apiKeyDrafts: Record<string, ApiKeyDraft>;
  setApiKeyDrafts: Dispatch<SetStateAction<Record<string, ApiKeyDraft>>>;
  newApiKeyDraft: ApiKeyDraft;
  setNewApiKeyDraft: Dispatch<SetStateAction<ApiKeyDraft>>;
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

  return labels.length > 0 ? labels.join(", ") : emptyLabel;
}

function ScopeEditor({
  title,
  emptyLabel,
  items,
  selectedIds,
  onToggle
}: {
  title: string;
  emptyLabel: string;
  items: Array<{ id: string; label: string; hint?: string }>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="scope-box">
      <div className="panel-head">
        <h4>{title}</h4>
        <span className="pill">{selectedIds.length === 0 ? emptyLabel : `${selectedIds.length} selected`}</span>
      </div>
      {items.length === 0 ? (
        <p className="muted">No selectable items yet.</p>
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
      <p className="muted">Leave everything unchecked to allow all.</p>
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
  newApiKeyDraft,
  setNewApiKeyDraft,
  createdApiKeyPlaintext,
  onCreateApiKey,
  onSaveApiKey,
  onDeleteApiKey
}: SystemPageProps) {
  if (!systemStatus) {
    return null;
  }

  const providerOptions = providers.map((provider) => ({
    id: provider.id,
    label: provider.name,
    hint: provider.baseUrl
  }));
  const modelOptions = models.map((model) => ({
    id: model.id,
    label: model.alias,
    hint: model.displayName
  }));

  return (
    <div className="stack">
      <section className="metric-grid">
        <article className="panel">
          <span>Service</span>
          <strong>{systemStatus.ready ? "Ready" : "Not Ready"}</strong>
        </article>
        <article className="panel">
          <span>Trusted Proxy</span>
          <strong>{systemStatus.trustProxy ? "Enabled" : "Disabled"}</strong>
        </article>
        <article className="panel">
          <span>Active API Keys</span>
          <strong>
            {formatNumber(systemStatus.activeApiKeyCount)} / {formatNumber(systemStatus.totalApiKeyCount)}
          </strong>
        </article>
        <article className="panel">
          <span>Max Active Proxies</span>
          <strong>{systemStatus.maxActiveProxyRequests}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>System Status</h3>
        </div>
        <div className="detail-grid">
          <div>
            <span>Recommended API Base</span>
            <strong>{systemStatus.recommendedApiBaseUrl}</strong>
          </div>
          <div>
            <span>Recommended Admin URL</span>
            <strong>{systemStatus.recommendedAdminUrl}</strong>
          </div>
          <div>
            <span>Data Directory</span>
            <strong>{systemStatus.dataDir}</strong>
          </div>
          <div>
            <span>Database</span>
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
          <h3>Create API Key</h3>
          <span className="muted">The plaintext is shown only once after creation.</span>
        </div>

        <div className="form-grid">
          <label>
            <span>Name</span>
            <input
              value={newApiKeyDraft.name}
              onChange={(event) =>
                setNewApiKeyDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="For example: NAS Home / iPhone / OpenWebUI"
            />
          </label>
        </div>

        <div className="scope-grid">
          <ScopeEditor
            title="Allowed Providers"
            emptyLabel="All providers"
            items={providerOptions}
            selectedIds={newApiKeyDraft.allowedProviderIds}
            onToggle={(providerId) =>
              setNewApiKeyDraft((current) => ({
                ...current,
                allowedProviderIds: toggleId(current.allowedProviderIds, providerId)
              }))
            }
          />

          <ScopeEditor
            title="Allowed Models"
            emptyLabel="All models"
            items={modelOptions}
            selectedIds={newApiKeyDraft.allowedModelAliasIds}
            onToggle={(modelId) =>
              setNewApiKeyDraft((current) => ({
                ...current,
                allowedModelAliasIds: toggleId(current.allowedModelAliasIds, modelId)
              }))
            }
          />
        </div>

        <p className="feedback warning">
          Routing rule: bindings are filtered by this key's Provider/Model scopes first, then the
          router picks the remaining binding with the smallest runtime priority.
        </p>

        <button type="button" className="primary" onClick={onCreateApiKey}>
          Create API Key
        </button>

        {createdApiKeyPlaintext ? (
          <div className="feedback warning">
            <strong>Save this key now.</strong>
            <div>
              <code>{createdApiKeyPlaintext}</code>
            </div>
          </div>
        ) : null}
      </section>

      <section className="stack">
        <div className="panel-head">
          <h3>API Key Management</h3>
          <span className="muted">
            Edit name, enable state, Provider scope and Model scope. Leaving scopes empty means
            unrestricted access on that dimension.
          </span>
        </div>

        {apiKeys.length === 0 ? (
          <section className="panel">
            <p className="muted">
              No API key exists yet. Create the first key above before calling `/v1/*`.
            </p>
          </section>
        ) : (
          apiKeys.map((apiKey) => {
            const draft = apiKeyDrafts[apiKey.id] ?? {
              name: apiKey.name,
              enabled: apiKey.enabled,
              allowedProviderIds: apiKey.allowedProviderIds,
              allowedModelAliasIds: apiKey.allowedModelAliasIds
            };

            return (
              <section key={apiKey.id} className="panel">
                <div className="panel-head">
                  <div>
                    <h3>{apiKey.name}</h3>
                    <p className="muted">
                      {apiKey.maskedPreview} · created {formatDateTime(apiKey.createdAt)}
                    </p>
                  </div>
                  <span className="pill">{apiKey.enabled ? "Enabled" : "Disabled"}</span>
                </div>

                <div className="form-grid">
                  <label>
                    <span>Name</span>
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
                  </label>

                  <label className="inline-toggle">
                    <span>Enabled</span>
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
                  </label>
                </div>

                <div className="detail-grid">
                  <div>
                    <span>Last Used</span>
                    <strong>{apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt) : "-"}</strong>
                  </div>
                  <div>
                    <span>Provider Scope</span>
                    <strong>
                      {summarizeScope(
                        draft.allowedProviderIds,
                        providerOptions,
                        "All providers"
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Model Scope</span>
                    <strong>
                      {summarizeScope(draft.allowedModelAliasIds, modelOptions, "All models")}
                    </strong>
                  </div>
                </div>

                <div className="scope-grid">
                  <ScopeEditor
                    title="Allowed Providers"
                    emptyLabel="All providers"
                    items={providerOptions}
                    selectedIds={draft.allowedProviderIds}
                    onToggle={(providerId) =>
                      setApiKeyDrafts((current) => ({
                        ...current,
                        [apiKey.id]: {
                          ...draft,
                          allowedProviderIds: toggleId(draft.allowedProviderIds, providerId)
                        }
                      }))
                    }
                  />

                  <ScopeEditor
                    title="Allowed Models"
                    emptyLabel="All models"
                    items={modelOptions}
                    selectedIds={draft.allowedModelAliasIds}
                    onToggle={(modelId) =>
                      setApiKeyDrafts((current) => ({
                        ...current,
                        [apiKey.id]: {
                          ...draft,
                          allowedModelAliasIds: toggleId(draft.allowedModelAliasIds, modelId)
                        }
                      }))
                    }
                  />
                </div>

                <div className="toolbar">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onSaveApiKey(apiKey.id)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="secondary danger"
                    onClick={() => onDeleteApiKey(apiKey.id)}
                  >
                    Delete
                  </button>
                </div>
              </section>
            );
          })
        )}
      </section>
    </div>
  );
}
