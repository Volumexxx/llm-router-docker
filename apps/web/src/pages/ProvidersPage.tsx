import { useMemo, useState } from "react";

import { Drawer } from "../components/Drawer.tsx";
import { Modal } from "../components/Modal.tsx";
import {
  api,
  type AnthropicProviderConfigPayload,
  type AnthropicProviderConfigUpdatePayload,
  type ModelItem,
  type OpenAiProviderConfigPayload,
  type OpenAiProviderConfigUpdatePayload,
  type ProviderItem,
  type ProviderPayload,
  type ProviderProtocol,
  type ProviderUpdatePayload
} from "../lib/api.ts";

const ANTHROPIC_DEFAULT_API_VERSION = "2023-06-01";

type ProviderProtocolDraft = {
  baseUrl: string;
  apiKey: string;
  testTimeoutMs: number;
  apiVersion: string | null;
};

type ProviderDraft = {
  name: string;
  enabled: boolean;
  openai: ProviderProtocolDraft;
  anthropic: ProviderProtocolDraft;
};

interface ProvidersPageProps {
  providers: ProviderItem[];
  models: ModelItem[];
  refreshProviders: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshApiKeys: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (reason: unknown) => void;
}

type ProviderImpact = {
  bindingCount: number;
  enabledBindingCount: number;
  modelCount: number;
};

const emptyProtocolDraft = (): ProviderProtocolDraft => ({
  baseUrl: "",
  apiKey: "",
  testTimeoutMs: 10000,
  apiVersion: ANTHROPIC_DEFAULT_API_VERSION
});

const emptyProviderDraft = (): ProviderDraft => ({
  name: "",
  enabled: true,
  openai: emptyProtocolDraft(),
  anthropic: emptyProtocolDraft()
});

function buildProviderDraft(provider: ProviderItem): ProviderDraft {
  return {
    name: provider.name,
    enabled: provider.enabled,
    openai: {
      baseUrl: provider.openaiConfig?.baseUrl ?? "",
      apiKey: "",
      testTimeoutMs: provider.openaiConfig?.testTimeoutMs ?? 10000,
      apiVersion: null
    },
    anthropic: {
      baseUrl: provider.anthropicConfig?.baseUrl ?? "",
      apiKey: "",
      testTimeoutMs: provider.anthropicConfig?.testTimeoutMs ?? 10000,
      apiVersion: provider.anthropicConfig?.apiVersion ?? ANTHROPIC_DEFAULT_API_VERSION
    }
  };
}

function getProtocolLabel(protocol: ProviderProtocol): string {
  return protocol === "anthropic" ? "Anthropic" : "OpenAI";
}

function getConfiguredSummary(provider: ProviderItem): string {
  if (provider.openaiConfig && provider.anthropicConfig) {
    return "已配置 OpenAI / Anthropic";
  }

  if (provider.anthropicConfig) {
    return "仅 Anthropic";
  }

  if (provider.openaiConfig) {
    return "仅 OpenAI";
  }

  return "未配置协议";
}

function getProviderImpact(models: ModelItem[], providerId: string): ProviderImpact {
  let bindingCount = 0;
  let enabledBindingCount = 0;
  let modelCount = 0;

  for (const model of models) {
    const bindings = [...model.bindings.openai, ...model.bindings.anthropic];
    const matched = bindings.filter((binding) => binding.providerId === providerId);
    if (matched.length === 0) {
      continue;
    }

    bindingCount += matched.length;
    enabledBindingCount += matched.filter((binding) => binding.enabled).length;
    modelCount += 1;
  }

  return {
    bindingCount,
    enabledBindingCount,
    modelCount
  };
}

function hasAnyProtocolInput(draft: ProviderProtocolDraft): boolean {
  return Boolean(draft.baseUrl.trim() || draft.apiKey.trim());
}

function assertProtocolNameAndConfig(protocol: ProviderProtocol, draft: ProviderProtocolDraft): void {
  if (!draft.baseUrl.trim()) {
    throw new Error(`${getProtocolLabel(protocol)} 接口地址不能为空。`);
  }

  if (!draft.apiKey.trim()) {
    throw new Error(`${getProtocolLabel(protocol)} API Key 不能为空。`);
  }
}

function buildOpenAiCreatePayload(
  draft: ProviderProtocolDraft
): OpenAiProviderConfigPayload | undefined {
  if (!hasAnyProtocolInput(draft)) {
    return undefined;
  }

  assertProtocolNameAndConfig("openai", draft);

  return {
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    testTimeoutMs: draft.testTimeoutMs
  };
}

function buildAnthropicCreatePayload(
  draft: ProviderProtocolDraft
): AnthropicProviderConfigPayload | undefined {
  if (!hasAnyProtocolInput(draft)) {
    return undefined;
  }

  assertProtocolNameAndConfig("anthropic", draft);

  return {
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    testTimeoutMs: draft.testTimeoutMs,
    apiVersion: draft.apiVersion?.trim() || ANTHROPIC_DEFAULT_API_VERSION
  };
}

function buildOpenAiUpdatePayload(
  draft: ProviderProtocolDraft,
  hasExistingConfig: boolean
): OpenAiProviderConfigUpdatePayload | undefined {
  if (!hasExistingConfig && !hasAnyProtocolInput(draft)) {
    return undefined;
  }

  if (!hasExistingConfig) {
    assertProtocolNameAndConfig("openai", draft);
    return {
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      testTimeoutMs: draft.testTimeoutMs
    };
  }

  if (!draft.baseUrl.trim()) {
    throw new Error("OpenAI 接口地址不能为空。");
  }

  return {
    baseUrl: draft.baseUrl.trim(),
    testTimeoutMs: draft.testTimeoutMs,
    ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {})
  };
}

function buildAnthropicUpdatePayload(
  draft: ProviderProtocolDraft,
  hasExistingConfig: boolean
): AnthropicProviderConfigUpdatePayload | undefined {
  if (!hasExistingConfig && !hasAnyProtocolInput(draft)) {
    return undefined;
  }

  if (!hasExistingConfig) {
    assertProtocolNameAndConfig("anthropic", draft);
    return {
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      testTimeoutMs: draft.testTimeoutMs,
      apiVersion: draft.apiVersion?.trim() || ANTHROPIC_DEFAULT_API_VERSION
    };
  }

  if (!draft.baseUrl.trim()) {
    throw new Error("Anthropic 接口地址不能为空。");
  }

  return {
    baseUrl: draft.baseUrl.trim(),
    testTimeoutMs: draft.testTimeoutMs,
    apiVersion: draft.apiVersion?.trim() || ANTHROPIC_DEFAULT_API_VERSION,
    ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {})
  };
}

function ConfigSection({
  title,
  protocol,
  draft,
  configuredConfig,
  allowEmpty = false,
  onChange
}: {
  title: string;
  protocol: ProviderProtocol;
  draft: ProviderProtocolDraft;
  configuredConfig: ProviderItem["openaiConfig"] | ProviderItem["anthropicConfig"] | null;
  allowEmpty?: boolean;
  onChange: (patch: Partial<ProviderProtocolDraft>) => void;
}) {
  return (
    <section className="panel panel-elevated protocol-config-panel">
      <div className="panel-head">
        <div className="stack compact-stack">
          <h4>{title}</h4>
          <p className="muted">
            {configuredConfig
              ? "已配置，可更新接口地址、超时和 API Key；留空不会覆盖当前 Key。"
              : allowEmpty
                ? "可留空；创建时至少完整填写一个协议配置。"
                : "当前未配置，保存后即可启用该协议。"}
          </p>
        </div>
        <span className="pill">
          {configuredConfig
            ? configuredConfig.apiKeyPreview ?? "已配置"
            : allowEmpty
              ? "可留空"
              : "未配置"}
        </span>
      </div>

      <div className="form-grid">
        <label>
          <span>接口地址</span>
          <input
            value={draft.baseUrl}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
            placeholder={protocol === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
          />
        </label>

        <label>
          <span>API Key</span>
          <input
            type="password"
            autoComplete="new-password"
            value={draft.apiKey}
            onChange={(event) => onChange({ apiKey: event.target.value })}
            placeholder="输入上游 API Key"
          />
        </label>

        <label>
          <span>测试超时 (ms)</span>
          <input
            type="number"
            step="1000"
            value={draft.testTimeoutMs}
            onChange={(event) => onChange({ testTimeoutMs: Number(event.target.value) })}
          />
        </label>

        {protocol === "anthropic" ? (
          <label>
            <span>Anthropic API Version</span>
            <input
              value={draft.apiVersion ?? ANTHROPIC_DEFAULT_API_VERSION}
              onChange={(event) => onChange({ apiVersion: event.target.value })}
              placeholder={ANTHROPIC_DEFAULT_API_VERSION}
            />
          </label>
        ) : null}
      </div>
    </section>
  );
}

export function ProvidersPage({
  providers,
  models,
  refreshProviders,
  refreshModels,
  refreshApiKeys,
  onNotice,
  onError
}: ProvidersPageProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<ProviderDraft>(emptyProviderDraft);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedProviderSnapshot, setSelectedProviderSnapshot] = useState<ProviderItem | null>(null);
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const providerImpactMap = useMemo(
    () => new Map(providers.map((provider) => [provider.id, getProviderImpact(models, provider.id)])),
    [models, providers]
  );

  const selectedProviderFromProps = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  );

  const selectedProvider =
    selectedProviderSnapshot?.id === selectedProviderId
      ? selectedProviderSnapshot
      : selectedProviderFromProps;

  const selectedImpact = selectedProvider
    ? (providerImpactMap.get(selectedProvider.id) ?? {
        bindingCount: 0,
        enabledBindingCount: 0,
        modelCount: 0
      })
    : {
        bindingCount: 0,
        enabledBindingCount: 0,
        modelCount: 0
      };

  const updateCreateDraftProtocol = (protocol: ProviderProtocol, patch: Partial<ProviderProtocolDraft>) => {
    setCreateDraft((current) => ({
      ...current,
      [protocol]: {
        ...current[protocol],
        ...patch
      }
    }));
  };

  const updateDraftProtocol = (protocol: ProviderProtocol, patch: Partial<ProviderProtocolDraft>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            [protocol]: {
              ...current[protocol],
              ...patch
            }
          }
        : current
    );
  };

  const openProviderDrawer = (provider: ProviderItem) => {
    setSelectedProviderId(provider.id);
    setSelectedProviderSnapshot(provider);
    setDraft(buildProviderDraft(provider));
    setDeleteConfirmation("");
    setBusyAction(null);
  };

  const closeDrawer = () => {
    setSelectedProviderId(null);
    setSelectedProviderSnapshot(null);
    setDraft(null);
    setDeleteConfirmation("");
    setBusyAction(null);
  };

  const handleCreate = () => {
    if (!createDraft.name.trim()) {
      throw new Error("Provider 名称不能为空。");
    }

    const payload: ProviderPayload = {
      name: createDraft.name.trim(),
      enabled: createDraft.enabled,
      openai: buildOpenAiCreatePayload(createDraft.openai),
      anthropic: buildAnthropicCreatePayload(createDraft.anthropic)
    };

    if (!payload.openai && !payload.anthropic) {
      throw new Error("至少需要完整填写一个协议配置。");
    }

    setBusyAction("create");
    void api.providers
      .create(payload)
      .then(async () => {
        setIsCreateModalOpen(false);
        setCreateDraft(emptyProviderDraft());
        await refreshProviders();
        onNotice("Provider 已创建。");
      })
      .catch(onError)
      .finally(() => setBusyAction(null));
  };

  const handleSave = (provider: ProviderItem, currentDraft: ProviderDraft) => {
    if (!currentDraft.name.trim()) {
      throw new Error("Provider 名称不能为空。");
    }

    const payload: ProviderUpdatePayload = {
      name: currentDraft.name.trim(),
      enabled: currentDraft.enabled,
      openai: buildOpenAiUpdatePayload(currentDraft.openai, Boolean(provider.openaiConfig)),
      anthropic: buildAnthropicUpdatePayload(currentDraft.anthropic, Boolean(provider.anthropicConfig))
    };

    if (!payload.openai && !payload.anthropic) {
      throw new Error("至少保留一个协议配置。");
    }

    setBusyAction("save");
    void api.providers
      .update(provider.id, payload)
      .then(async (response) => {
        setSelectedProviderSnapshot(response.item);
        setDraft(buildProviderDraft(response.item));
        await Promise.all([refreshProviders(), refreshModels()]);
        onNotice(`Provider ${response.item.name} 已保存。`);
      })
      .catch(onError)
      .finally(() => setBusyAction(null));
  };

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>Provider 管理</h3>
            <p className="muted">
              一个逻辑 Provider 下可以分别维护 OpenAI 与 Anthropic 两套连接配置，便于按协议独立路由。
            </p>
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setCreateDraft(emptyProviderDraft());
              setIsCreateModalOpen(true);
            }}
          >
            新增 Provider
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>状态</th>
                <th>引用影响</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="table-empty">还没有 Provider，先创建一个逻辑 Provider。</div>
                  </td>
                </tr>
              ) : (
                providers.map((provider) => {
                  const impact = providerImpactMap.get(provider.id) ?? {
                    bindingCount: 0,
                    enabledBindingCount: 0,
                    modelCount: 0
                  };

                  return (
                    <tr key={provider.id}>
                      <td>
                        <div className="table-entity">
                          <strong>{provider.name}</strong>
                          <small className="muted">{getConfiguredSummary(provider)}</small>
                        </div>
                      </td>
                      <td>
                        <span className={provider.enabled ? "status-pill online" : "status-pill offline"}>
                          {provider.enabled ? "启用中" : "已停用"}
                        </span>
                      </td>
                      <td>
                        <div className="table-entity">
                          <strong>{impact.bindingCount} 条 binding</strong>
                          <small className="muted">
                            {impact.modelCount} 个模型，{impact.enabledBindingCount} 条已启用
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

      <Modal
        open={isCreateModalOpen}
        title="新增 Provider"
        description="名称是逻辑 Provider 名称。OpenAI 与 Anthropic 两个协议区块允许留空，但至少完整填写一个。"
        onClose={() => setIsCreateModalOpen(false)}
      >
        <div className="stack">
          <section className="panel panel-elevated">
            <div className="form-grid">
              <label>
                <span>名称</span>
                <input
                  value={createDraft.name}
                  onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：Official / Proxy / Backup"
                />
              </label>
            </div>

            <label className="inline">
              <input
                type="checkbox"
                checked={createDraft.enabled}
                onChange={(event) => setCreateDraft((current) => ({ ...current, enabled: event.target.checked }))}
              />
              <span>创建后立即启用</span>
            </label>
          </section>

          <ConfigSection
            title="OpenAI 配置"
            protocol="openai"
            draft={createDraft.openai}
            configuredConfig={null}
            allowEmpty
            onChange={(patch) => updateCreateDraftProtocol("openai", patch)}
          />

          <ConfigSection
            title="Anthropic 配置"
            protocol="anthropic"
            draft={createDraft.anthropic}
            configuredConfig={null}
            allowEmpty
            onChange={(patch) => updateCreateDraftProtocol("anthropic", patch)}
          />

          <div className="toolbar">
            <button
              type="button"
              className="primary"
              disabled={busyAction !== null}
              onClick={() => {
                try {
                  handleCreate();
                } catch (error) {
                  onError(error);
                }
              }}
            >
              创建 Provider
            </button>
          </div>
        </div>
      </Modal>

      <Drawer
        open={Boolean(selectedProvider && draft)}
        size="wide"
        title={draft ? `Provider 配置 · ${draft.name || selectedProvider?.name || ""}` : ""}
        subtitle={
          selectedProvider
            ? "逻辑 Provider 的名称和总开关在这里维护；OpenAI / Anthropic 两套协议配置分别独立保存和测试。"
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
                  <p className="muted">管理逻辑 Provider 的名称与启用状态。</p>
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
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, name: event.target.value } : current))
                    }
                  />
                </label>
              </div>

              <label className="inline">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, enabled: event.target.checked } : current))
                  }
                />
                <span>Provider 启用</span>
              </label>
            </section>

            <ConfigSection
              title="OpenAI 配置"
              protocol="openai"
              draft={draft.openai}
              configuredConfig={selectedProvider.openaiConfig}
              onChange={(patch) => updateDraftProtocol("openai", patch)}
            />

            <ConfigSection
              title="Anthropic 配置"
              protocol="anthropic"
              draft={draft.anthropic}
              configuredConfig={selectedProvider.anthropicConfig}
              onChange={(patch) => updateDraftProtocol("anthropic", patch)}
            />

            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>引用影响</h4>
                  <p className="muted">删除整个 Provider 会移除其所有协议 binding，但不会删除模型 alias 或审计记录。</p>
                </div>
              </div>

              <div className="detail-grid">
                <div>
                  <span>绑定数量</span>
                  <strong>{selectedImpact.bindingCount} 条 binding</strong>
                </div>
                <div>
                  <span>已启用 binding</span>
                  <strong>{selectedImpact.enabledBindingCount} 条</strong>
                </div>
                <div>
                  <span>关联模型</span>
                  <strong>{selectedImpact.modelCount} 个模型</strong>
                </div>
                <div>
                  <span>配置摘要</span>
                  <strong>{getConfiguredSummary(selectedProvider)}</strong>
                </div>
              </div>

              <div className="toolbar">
                <button
                  type="button"
                  className="primary"
                  disabled={busyAction !== null}
                  onClick={() => {
                    try {
                      handleSave(selectedProvider, draft);
                    } catch (error) {
                      onError(error);
                    }
                  }}
                >
                  保存配置
                </button>

                <button
                  type="button"
                  className="secondary"
                  disabled={busyAction !== null || !selectedProvider.openaiConfig}
                  onClick={() => {
                    setBusyAction("test-openai");
                    void api.providers
                      .test(selectedProvider.id, "openai")
                      .then((result) => {
                        onNotice(
                          `OpenAI 测试${result.success ? "成功" : "失败"}，耗时 ${result.responseTimeMs}ms：${result.message}`
                        );
                      })
                      .catch(onError)
                      .finally(() => setBusyAction(null));
                  }}
                >
                  测试 OpenAI
                </button>

                <button
                  type="button"
                  className="secondary"
                  disabled={busyAction !== null || !selectedProvider.anthropicConfig}
                  onClick={() => {
                    setBusyAction("test-anthropic");
                    void api.providers
                      .test(selectedProvider.id, "anthropic")
                      .then((result) => {
                        onNotice(
                          `Anthropic 测试${result.success ? "成功" : "失败"}，耗时 ${result.responseTimeMs}ms：${result.message}`
                        );
                      })
                      .catch(onError)
                      .finally(() => setBusyAction(null));
                  }}
                >
                  测试 Anthropic
                </button>
              </div>
            </section>

            <section className="panel panel-elevated provider-danger-panel">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>删除 Provider</h4>
                  <p className="muted">删除后会同步移除这个逻辑 Provider 关联的所有 binding。</p>
                </div>
              </div>

              <p className="feedback warning">
                本次删除将移除 {selectedImpact.bindingCount} 条 binding，影响 {selectedImpact.modelCount} 个模型。
              </p>

              <label>
                <span>输入当前 Provider 名称 “{selectedProvider.name}” 以确认删除</span>
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
