import type { Dispatch, SetStateAction } from "react";

import { api, type ProviderItem, type ProviderPayload } from "../lib/api.ts";

interface ProvidersPageProps {
  providers: ProviderItem[];
  providerSecrets: Record<string, string>;
  setProviderSecrets: Dispatch<SetStateAction<Record<string, string>>>;
  newProvider: ProviderPayload;
  setNewProvider: Dispatch<SetStateAction<ProviderPayload>>;
  updateProviderField: (
    providerId: string,
    field: keyof ProviderItem,
    value: string | boolean | number | null
  ) => void;
  refreshProviders: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (reason: unknown) => void;
}

function getCreatePlaceholder(protocol: ProviderPayload["protocol"]): string {
  return protocol === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1";
}

export function ProvidersPage({
  providers,
  providerSecrets,
  setProviderSecrets,
  newProvider,
  setNewProvider,
  updateProviderField,
  refreshProviders,
  onNotice,
  onError
}: ProvidersPageProps) {
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>新增 Provider</h3>
            <p className="muted">
              支持 OpenAI 兼容上游和 Anthropic / Claude 协议上游。Anthropic 建议直接填写
              `https://api.anthropic.com`，系统会自动补全所需路径。
            </p>
          </div>
        </div>

        <div className="form-grid">
          <label>
            <span>名称</span>
            <input
              value={newProvider.name}
              onChange={(event) =>
                setNewProvider((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="例如：OpenAI / Claude / NAS Proxy"
            />
          </label>

          <label>
            <span>协议类型</span>
            <select
              value={newProvider.protocol}
              onChange={(event) =>
                setNewProvider((current) => ({
                  ...current,
                  protocol: event.target.value as "openai" | "anthropic",
                  apiVersion:
                    event.target.value === "anthropic"
                      ? current.apiVersion ?? "2023-06-01"
                      : null
                }))
              }
            >
              <option value="openai">OpenAI Compatible</option>
              <option value="anthropic">Anthropic / Claude</option>
            </select>
          </label>

          <label>
            <span>接口地址</span>
            <input
              value={newProvider.baseUrl}
              onChange={(event) =>
                setNewProvider((current) => ({ ...current, baseUrl: event.target.value }))
              }
              placeholder={getCreatePlaceholder(newProvider.protocol)}
            />
          </label>

          <label>
            <span>真实 API Key</span>
            <input
              type="password"
              value={newProvider.apiKey}
              onChange={(event) =>
                setNewProvider((current) => ({ ...current, apiKey: event.target.value }))
              }
            />
          </label>

          {newProvider.protocol === "anthropic" ? (
            <label>
              <span>Anthropic API Version</span>
              <input
                value={newProvider.apiVersion ?? "2023-06-01"}
                onChange={(event) =>
                  setNewProvider((current) => ({ ...current, apiVersion: event.target.value }))
                }
                placeholder="2023-06-01"
              />
            </label>
          ) : null}

          <label>
            <span>测试超时(ms)</span>
            <input
              type="number"
              step="1000"
              value={newProvider.testTimeoutMs}
              onChange={(event) =>
                setNewProvider((current) => ({
                  ...current,
                  testTimeoutMs: Number(event.target.value)
                }))
              }
            />
          </label>
        </div>

        <label className="inline">
          <input
            type="checkbox"
            checked={newProvider.enabled}
            onChange={(event) =>
              setNewProvider((current) => ({ ...current, enabled: event.target.checked }))
            }
          />
          <span>创建后立即启用</span>
        </label>

        <div className="toolbar">
          <button
            type="button"
            className="primary"
            onClick={() => {
              void api.providers
                .create(newProvider)
                .then(async () => {
                  setNewProvider({
                    name: "",
                    baseUrl: "",
                    apiKey: "",
                    protocol: "openai",
                    apiVersion: null,
                    enabled: true,
                    testTimeoutMs: 10000
                  });
                  await refreshProviders();
                  onNotice("Provider 已创建。");
                })
                .catch(onError);
            }}
          >
            创建 Provider
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>Provider 管理</h3>
            <p className="muted">
              支持直接编辑协议、地址、密钥与测试版本，并可在线验证连通性。
            </p>
          </div>
          <span className="pill">{providers.length} 个 Provider</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>协议</th>
                <th>接口地址</th>
                <th>Key 预览 / 替换</th>
                <th>API Version</th>
                <th>测试超时</th>
                <th>启用</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="table-empty">还没有 Provider，先在上方新增一个。</div>
                  </td>
                </tr>
              ) : (
                providers.map((provider) => (
                  <tr key={provider.id}>
                    <td>
                      <input
                        value={provider.name}
                        onChange={(event) =>
                          updateProviderField(provider.id, "name", event.target.value)
                        }
                      />
                    </td>
                    <td>
                      <select
                        value={provider.protocol}
                        onChange={(event) =>
                          updateProviderField(
                            provider.id,
                            "protocol",
                            event.target.value as "openai" | "anthropic"
                          )
                        }
                      >
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                      </select>
                    </td>
                    <td>
                      <input
                        value={provider.baseUrl}
                        onChange={(event) =>
                          updateProviderField(provider.id, "baseUrl", event.target.value)
                        }
                      />
                    </td>
                    <td>
                      <div className="stack compact-stack">
                        <code>{provider.apiKeyPreview ?? "-"}</code>
                        <input
                          type="password"
                          placeholder="留空则不替换"
                          value={providerSecrets[provider.id] ?? ""}
                          onChange={(event) =>
                            setProviderSecrets((current) => ({
                              ...current,
                              [provider.id]: event.target.value
                            }))
                          }
                        />
                      </div>
                    </td>
                    <td>
                      {provider.protocol === "anthropic" ? (
                        <input
                          value={provider.apiVersion ?? "2023-06-01"}
                          onChange={(event) =>
                            updateProviderField(provider.id, "apiVersion", event.target.value)
                          }
                        />
                      ) : (
                        <code>-</code>
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        step="1000"
                        value={provider.testTimeoutMs}
                        onChange={(event) =>
                          updateProviderField(
                            provider.id,
                            "testTimeoutMs",
                            Number(event.target.value)
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={provider.enabled}
                        onChange={(event) =>
                          updateProviderField(provider.id, "enabled", event.target.checked)
                        }
                      />
                    </td>
                    <td>
                      <div className="action-row">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            void api.providers
                              .update(provider.id, {
                                name: provider.name,
                                baseUrl: provider.baseUrl,
                                protocol: provider.protocol,
                                apiVersion:
                                  provider.protocol === "anthropic"
                                    ? provider.apiVersion ?? "2023-06-01"
                                    : null,
                                enabled: provider.enabled,
                                testTimeoutMs: provider.testTimeoutMs,
                                ...(providerSecrets[provider.id]
                                  ? { apiKey: providerSecrets[provider.id] }
                                  : {})
                              })
                              .then(async () => {
                                setProviderSecrets((current) => ({
                                  ...current,
                                  [provider.id]: ""
                                }));
                                await refreshProviders();
                                onNotice(`Provider ${provider.name} 已更新。`);
                              })
                              .catch(onError);
                          }}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            void api.providers
                              .test(provider.id)
                              .then((result) => {
                                onNotice(
                                  `${provider.name} 连接${result.success ? "成功" : "失败"}，耗时 ${
                                    result.responseTimeMs
                                  }ms，消息：${result.message}`
                                );
                              })
                              .catch(onError);
                          }}
                        >
                          测试连接
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
