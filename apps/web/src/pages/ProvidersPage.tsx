import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { Drawer } from "../components/Drawer.tsx";
import { api, type ModelItem, type ProviderItem, type ProviderPayload } from "../lib/api.ts";

const ANTHROPIC_DEFAULT_API_VERSION = "2023-06-01";

type ProviderDraft = Omit<ProviderPayload, "apiKey"> & {
  apiVersion: string | null;
};

type ProviderImpact = {
  bindingCount: number;
  enabledBindingCount: number;
  modelCount: number;
};

interface ProvidersPageProps {
  providers: ProviderItem[];
  models: ModelItem[];
  newProvider: ProviderPayload;
  setNewProvider: Dispatch<SetStateAction<ProviderPayload>>;
  refreshProviders: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshApiKeys: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (reason: unknown) => void;
}

function getCreatePlaceholder(protocol: ProviderPayload["protocol"]): string {
  return protocol === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1";
}

function getProtocolLabel(protocol: ProviderPayload["protocol"]): string {
  return protocol === "anthropic" ? "Anthropic / Claude" : "OpenAI Compatible";
}

function buildProviderDraft(provider: ProviderItem): ProviderDraft {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
    apiVersion:
      provider.protocol === "anthropic"
        ? (provider.apiVersion ?? ANTHROPIC_DEFAULT_API_VERSION)
        : null,
    enabled: provider.enabled,
    testTimeoutMs: provider.testTimeoutMs
  };
}

function getEmptyImpact(): ProviderImpact {
  return {
    bindingCount: 0,
    enabledBindingCount: 0,
    modelCount: 0
  };
}

export function ProvidersPage({
  providers,
  models,
  newProvider,
  setNewProvider,
  refreshProviders,
  refreshModels,
  refreshApiKeys,
  onNotice,
  onError
}: ProvidersPageProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [isReplacingKey, setIsReplacingKey] = useState(false);
  const [replacementApiKey, setReplacementApiKey] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [busyAction, setBusyAction] = useState<"save" | "test" | "delete" | null>(null);

  const providerImpactMap = useMemo(() => {
    const impactMap = new Map<
      string,
      {
        bindingCount: number;
        enabledBindingCount: number;
        modelIds: Set<string>;
      }
    >();

    models.forEach((model) => {
      model.bindings.forEach((binding) => {
        const current = impactMap.get(binding.providerId) ?? {
          bindingCount: 0,
          enabledBindingCount: 0,
          modelIds: new Set<string>()
        };

        current.bindingCount += 1;
        current.enabledBindingCount += binding.enabled ? 1 : 0;
        current.modelIds.add(model.id);
        impactMap.set(binding.providerId, current);
      });
    });

    return impactMap;
  }, [models]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  );

  const selectedImpact = useMemo(() => {
    if (!selectedProvider) {
      return getEmptyImpact();
    }

    const impact = providerImpactMap.get(selectedProvider.id);
    return impact
      ? {
          bindingCount: impact.bindingCount,
          enabledBindingCount: impact.enabledBindingCount,
          modelCount: impact.modelIds.size
        }
      : getEmptyImpact();
  }, [providerImpactMap, selectedProvider]);

  useEffect(() => {
    if (selectedProviderId && !selectedProvider) {
      setSelectedProviderId(null);
      setDraft(null);
      setIsReplacingKey(false);
      setReplacementApiKey("");
      setDeleteConfirmation("");
      setBusyAction(null);
    }
  }, [selectedProvider, selectedProviderId]);

  const openProviderDrawer = (provider: ProviderItem) => {
    setSelectedProviderId(provider.id);
    setDraft(buildProviderDraft(provider));
    setIsReplacingKey(false);
    setReplacementApiKey("");
    setDeleteConfirmation("");
    setBusyAction(null);
  };

  const closeDrawer = () => {
    setSelectedProviderId(null);
    setDraft(null);
    setIsReplacingKey(false);
    setReplacementApiKey("");
    setDeleteConfirmation("");
    setBusyAction(null);
  };

  const updateDraft = (patch: Partial<ProviderDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

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
                      ? (current.apiVersion ?? ANTHROPIC_DEFAULT_API_VERSION)
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
                value={newProvider.apiVersion ?? ANTHROPIC_DEFAULT_API_VERSION}
                onChange={(event) =>
                  setNewProvider((current) => ({ ...current, apiVersion: event.target.value }))
                }
                placeholder={ANTHROPIC_DEFAULT_API_VERSION}
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
              列表页只���留摘要信息，点击“配置”进入右侧抽屉编辑、测试连通性或删除 Provider。
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
                <th>Key 预览</th>
                <th>状态</th>
                <th>引用影响</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="table-empty">还没有 Provider，先在上方创建第一个。</div>
                  </td>
                </tr>
              ) : (
                providers.map((provider) => {
                  const impact = providerImpactMap.get(provider.id);
                  const bindingCount = impact?.bindingCount ?? 0;
                  const enabledBindingCount = impact?.enabledBindingCount ?? 0;
                  const modelCount = impact?.modelIds.size ?? 0;

                  return (
                    <tr key={provider.id}>
                      <td>
                        <div className="table-entity">
                          <strong>{provider.name}</strong>
                          <small className="muted">
                            {provider.protocol === "anthropic" && provider.apiVersion
                              ? `API Version ${provider.apiVersion}`
                              : "兼容 OpenAI / Responses / Chat Completions"}
                          </small>
                        </div>
                      </td>
                      <td>
                        <div className="table-entity">
                          <strong>{getProtocolLabel(provider.protocol)}</strong>
                          <small className="muted">
                            {provider.protocol === "anthropic"
                              ? "原生 Anthropic 协议"
                              : "OpenAI 兼容协议"}
                          </small>
                        </div>
                      </td>
                      <td>{provider.baseUrl}</td>
                      <td>
                        <code>{provider.apiKeyPreview ?? "-"}</code>
                      </td>
                      <td>
                        <span className={provider.enabled ? "status-pill online" : "status-pill offline"}>
                          {provider.enabled ? "启用中" : "已停用"}
                        </span>
                      </td>
                      <td>
                        <div className="table-entity">
                          <strong>{bindingCount} 条 binding</strong>
                          <small className="muted">
                            {modelCount} 个模型，{enabledBindingCount} 条已启用
                          </small>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => openProviderDrawer(provider)}
                        >
                          配置
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Drawer
        open={Boolean(selectedProvider && draft)}
        size="wide"
        title={draft ? `Provider 配置 · ${draft.name}` : ""}
        subtitle={
          selectedProvider
            ? "在抽屉里维护 Provider 基本信息、敏感 Key 替换、连通性测试和删除确认。"
            : undefined
        }
        onClose={closeDrawer}
      >
        {selectedProvider && draft ? (
          <div className="stack">
            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>基础配置</h4>
                  <p className="muted">更新名称、协议、接口地址、超时和启用状态。</p>
                </div>
                <span className={draft.enabled ? "status-pill online" : "status-pill offline"}>
                  {draft.enabled ? "启用中" : "已停用"}
                </span>
              </div>

              <div className="form-grid">
                <label>
                  <span>名称</span>
                  <input
                    value={draft.name}
                    onChange={(event) => updateDraft({ name: event.target.value })}
                  />
                </label>

                <label>
                  <span>协议类型</span>
                  <select
                    value={draft.protocol}
                    onChange={(event) => {
                      const protocol = event.target.value as "openai" | "anthropic";
                      updateDraft({
                        protocol,
                        apiVersion:
                          protocol === "anthropic"
                            ? (draft.apiVersion ?? ANTHROPIC_DEFAULT_API_VERSION)
                            : null
                      });
                    }}
                  >
                    <option value="openai">OpenAI Compatible</option>
                    <option value="anthropic">Anthropic / Claude</option>
                  </select>
                </label>

                <label>
                  <span>接口地址</span>
                  <input
                    value={draft.baseUrl}
                    onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                    placeholder={getCreatePlaceholder(draft.protocol)}
                  />
                </label>

                <label>
                  <span>测试超时(ms)</span>
                  <input
                    type="number"
                    step="1000"
                    value={draft.testTimeoutMs}
                    onChange={(event) =>
                      updateDraft({ testTimeoutMs: Number(event.target.value) })
                    }
                  />
                </label>

                {draft.protocol === "anthropic" ? (
                  <label>
                    <span>Anthropic API Version</span>
                    <input
                      value={draft.apiVersion ?? ANTHROPIC_DEFAULT_API_VERSION}
                      onChange={(event) => updateDraft({ apiVersion: event.target.value })}
                      placeholder={ANTHROPIC_DEFAULT_API_VERSION}
                    />
                  </label>
                ) : null}
              </div>

              <label className="inline">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => updateDraft({ enabled: event.target.checked })}
                />
                <span>Provider 启用</span>
              </label>
            </section>

            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>Key 与引用影响</h4>
                  <p className="muted">默认只展示掩码预览，敏感 Key 替换动作单独展开。</p>
                </div>
                <span className="pill">{selectedProvider.apiKeyPreview ?? "未设置 Key"}</span>
              </div>

              <div className="stack compact-stack">
                <code className="secret-preview">{selectedProvider.apiKeyPreview ?? "暂无已保存 Key"}</code>

                {isReplacingKey ? (
                  <div className="stack">
                    <label>
                      <span>新的 API Key</span>
                      <input
                        type="password"
                        placeholder="输入新的 API Key"
                        value={replacementApiKey}
                        onChange={(event) => setReplacementApiKey(event.target.value)}
                      />
                    </label>

                    <div className="provider-secret-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setIsReplacingKey(false);
                          setReplacementApiKey("");
                        }}
                      >
                        取消更换
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="provider-secret-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setIsReplacingKey(true)}
                    >
                      更换 Key
                    </button>
                  </div>
                )}
              </div>

              <div className="detail-grid">
                <div>
                  <span>绑定数量</span>
                  <strong>{selectedImpact.bindingCount} 条 binding</strong>
                </div>
                <div>
                  <span>启用中的 binding</span>
                  <strong>{selectedImpact.enabledBindingCount} 条</strong>
                </div>
                <div>
                  <span>关联模型</span>
                  <strong>{selectedImpact.modelCount} 个模型</strong>
                </div>
                <div>
                  <span>保存语义</span>
                  <strong>{replacementApiKey ? "将写入新 Key" : "空值不会替换旧 Key"}</strong>
                </div>
              </div>

              <p className="muted">连接测试使用当前已保存配置。若刚修改了字段，请先保存再测试。</p>
            </section>

            <section className="panel panel-elevated provider-danger-panel">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>保存、测试与删除</h4>
                  <p className="muted">删除会自动移除关联 binding，但不会删除模型别名或历史审计日志。</p>
                </div>
              </div>

              <div className="toolbar">
                <button
                  type="button"
                  className="primary"
                  disabled={busyAction !== null}
                  onClick={() => {
                    setBusyAction("save");

                    void api.providers
                      .update(selectedProvider.id, {
                        name: draft.name,
                        baseUrl: draft.baseUrl,
                        protocol: draft.protocol,
                        apiVersion:
                          draft.protocol === "anthropic"
                            ? (draft.apiVersion ?? ANTHROPIC_DEFAULT_API_VERSION)
                            : null,
                        enabled: draft.enabled,
                        testTimeoutMs: draft.testTimeoutMs,
                        ...(replacementApiKey ? { apiKey: replacementApiKey } : {})
                      })
                      .then(async (response) => {
                        setDraft(buildProviderDraft(response.item));
                        setIsReplacingKey(false);
                        setReplacementApiKey("");
                        await Promise.all([refreshProviders(), refreshModels()]);
                        onNotice(`Provider ${response.item.name} 已更新。`);
                      })
                      .catch(onError)
                      .finally(() => setBusyAction(null));
                  }}
                >
                  保存配置
                </button>

                <button
                  type="button"
                  className="ghost"
                  disabled={busyAction !== null}
                  onClick={() => {
                    setBusyAction("test");

                    void api.providers
                      .test(selectedProvider.id)
                      .then((result) => {
                        onNotice(
                          `${selectedProvider.name} 连接${result.success ? "成功" : "失败"}，耗时 ${
                            result.responseTimeMs
                          }ms，消息：${result.message}`
                        );
                      })
                      .catch(onError)
                      .finally(() => setBusyAction(null));
                  }}
                >
                  测试连接
                </button>
              </div>

              <p className="feedback warning">
                这次删除将移除 {selectedImpact.bindingCount} 条 binding，影响 {selectedImpact.modelCount}{" "}
                个模型。
              </p>

              <label>
                <span>输入当前已保存名称 “{selectedProvider.name}” 以确认删除</span>
                <input
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  placeholder="请输入 Provider 名称以确认删除"
                />
              </label>

              <div className="toolbar">
                <button
                  type="button"
                  className="ghost danger"
                  disabled={busyAction !== null || deleteConfirmation.trim() !== selectedProvider.name}
                  onClick={() => {
                    setBusyAction("delete");

                    void api.providers
                      .remove(selectedProvider.id)
                      .then(async (result) => {
                        closeDrawer();
                        await Promise.all([refreshProviders(), refreshModels(), refreshApiKeys()]);
                        onNotice(
                          `Provider ${result.providerName} 已删除，移除 ${result.removedBindingCount} 条 binding，影响 ${result.affectedModelCount} 个模型。`
                        );
                      })
                      .catch(onError)
                      .finally(() => setBusyAction(null));
                  }}
                >
                  删除 Provider
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
