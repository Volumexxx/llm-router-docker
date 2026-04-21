import { useEffect, useMemo, useState } from "react";

import { Drawer } from "../components/Drawer.tsx";
import {
  api,
  type BindingItem,
  type BindingPayload,
  type ModelBindings,
  type ModelItem,
  type ProviderItem,
  type ProviderProtocol
} from "../lib/api.ts";

interface ModelsPageProps {
  models: ModelItem[];
  providers: ProviderItem[];
  refreshModels: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (reason: unknown) => void;
  setError: (message: string) => void;
}

type ModelDraft = {
  alias: string;
  displayName: string;
  enabled: boolean;
};

type BindingDrafts = {
  openai: BindingPayload;
  anthropic: BindingPayload;
};

const emptyModelDraft: ModelDraft = {
  alias: "",
  displayName: "",
  enabled: true
};

function createEmptyBindingDraft(protocol: ProviderProtocol): BindingPayload {
  return {
    providerId: "",
    protocol,
    upstreamModel: "",
    inputPrice: 0,
    outputPrice: 0,
    enabled: true
  };
}

function cloneBindings(bindings: ModelBindings): ModelBindings {
  return {
    openai: [...bindings.openai],
    anthropic: [...bindings.anthropic]
  };
}

function getProvidersForProtocol(providers: ProviderItem[], protocol: ProviderProtocol): ProviderItem[] {
  return providers.filter((provider) =>
    protocol === "anthropic" ? Boolean(provider.anthropicConfig) : Boolean(provider.openaiConfig)
  );
}

function getBindingOrderByPriority(
  bindings: BindingItem[],
  priorityKey: "runtimePriority" | "defaultPriority"
): string[] {
  return [...bindings]
    .sort((left, right) => {
      if (left[priorityKey] !== right[priorityKey]) {
        return left[priorityKey] - right[priorityKey];
      }

      return left.id.localeCompare(right.id);
    })
    .map((binding) => binding.id);
}

function areOrdersEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function ModelsPage({
  models,
  providers,
  refreshModels,
  onNotice,
  onError,
  setError
}: ModelsPageProps) {
  const [newModel, setNewModel] = useState<ModelDraft>(emptyModelDraft);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedProtocol, setSelectedProtocol] = useState<ProviderProtocol>("openai");
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null);
  const [bindingEditor, setBindingEditor] = useState<ModelBindings | null>(null);
  const [bindingDrafts, setBindingDrafts] = useState<BindingDrafts>({
    openai: createEmptyBindingDraft("openai"),
    anthropic: createEmptyBindingDraft("anthropic")
  });

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId]
  );

  useEffect(() => {
    if (selectedModelId && !selectedModel) {
      setSelectedModelId(null);
      setModelDraft(null);
      setBindingEditor(null);
      return;
    }

    if (!selectedModel) {
      return;
    }

    setModelDraft({
      alias: selectedModel.alias,
      displayName: selectedModel.displayName,
      enabled: selectedModel.enabled
    });
    setBindingEditor(cloneBindings(selectedModel.bindings));
  }, [selectedModel, selectedModelId]);

  useEffect(() => {
    const openaiProviders = getProvidersForProtocol(providers, "openai");
    const anthropicProviders = getProvidersForProtocol(providers, "anthropic");

    setBindingDrafts((current) => ({
      openai: {
        ...current.openai,
        providerId:
          current.openai.providerId && openaiProviders.some((provider) => provider.id === current.openai.providerId)
            ? current.openai.providerId
            : (openaiProviders[0]?.id ?? "")
      },
      anthropic: {
        ...current.anthropic,
        providerId:
          current.anthropic.providerId &&
          anthropicProviders.some((provider) => provider.id === current.anthropic.providerId)
            ? current.anthropic.providerId
            : (anthropicProviders[0]?.id ?? "")
      }
    }));
  }, [providers]);

  const currentBindings = bindingEditor?.[selectedProtocol] ?? [];
  const runtimeOrder = getBindingOrderByPriority(currentBindings, "runtimePriority");
  const defaultOrder = getBindingOrderByPriority(currentBindings, "defaultPriority");
  const currentOrder = currentBindings.map((binding) => binding.id);
  const isCurrentOrderDirtyFromRuntime = !areOrdersEqual(currentOrder, runtimeOrder);
  const isCurrentOrderDirtyFromDefault = !areOrdersEqual(currentOrder, defaultOrder);
  const protocolProviders = getProvidersForProtocol(providers, selectedProtocol);
  const selectedBindingDraft = bindingDrafts[selectedProtocol];

  const openModelDrawer = (model: ModelItem) => {
    setSelectedModelId(model.id);
    setSelectedProtocol("openai");
    setModelDraft({
      alias: model.alias,
      displayName: model.displayName,
      enabled: model.enabled
    });
    setBindingEditor(cloneBindings(model.bindings));
  };

  const reorderBindings = (protocol: ProviderProtocol, bindingIds: string[]) => {
    setBindingEditor((current) => {
      if (!current) {
        return current;
      }

      const bindingById = new Map(current[protocol].map((binding) => [binding.id, binding]));
      const reordered = bindingIds
        .map((bindingId) => bindingById.get(bindingId))
        .filter((binding): binding is BindingItem => Boolean(binding));

      if (reordered.length !== current[protocol].length) {
        return current;
      }

      return {
        ...current,
        [protocol]: reordered
      };
    });
  };

  const moveBinding = (protocol: ProviderProtocol, index: number, direction: -1 | 1) => {
    setBindingEditor((current) => {
      if (!current) {
        return current;
      }

      const nextBindings = [...current[protocol]];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= nextBindings.length) {
        return current;
      }

      const [item] = nextBindings.splice(index, 1);
      nextBindings.splice(targetIndex, 0, item);

      return {
        ...current,
        [protocol]: nextBindings
      };
    });
  };

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>创建模型别名</h3>
            <p className="muted">模型 alias 对外统一暴露，OpenAI 与 Anthropic 各自拥有独立的绑定和顺序。</p>
          </div>
        </div>

        <div className="form-grid">
          <label>
            <span>模型别名</span>
            <input
              value={newModel.alias}
              onChange={(event) => setNewModel((current) => ({ ...current, alias: event.target.value }))}
              placeholder="例如：gpt-4o-mini"
            />
          </label>
          <label>
            <span>显示名称</span>
            <input
              value={newModel.displayName}
              onChange={(event) =>
                setNewModel((current) => ({ ...current, displayName: event.target.value }))
              }
              placeholder="例如：GPT 4o Mini"
            />
          </label>
        </div>

        <label className="inline">
          <input
            type="checkbox"
            checked={newModel.enabled}
            onChange={(event) => setNewModel((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span>创建后立即启用</span>
        </label>

        <div className="toolbar">
          <button
            type="button"
            className="primary"
            onClick={() => {
              void api.models
                .create(newModel)
                .then(async () => {
                  setNewModel(emptyModelDraft);
                  await refreshModels();
                  onNotice("模型别名已创建。");
                })
                .catch(onError);
            }}
          >
            创建模型
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>模型与路由</h3>
            <p className="muted">点击“配置”进入详情抽屉，在 OpenAI / Anthropic 标签下分别维护 binding。</p>
          </div>
          <span className="pill">{models.length} 个模型</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Alias</th>
                <th>显示名称</th>
                <th>状态</th>
                <th>绑定数</th>
                <th>已启用绑定</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {models.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="table-empty">还没有模型别名，先在上方创建一个。</div>
                  </td>
                </tr>
              ) : (
                models.map((model) => {
                  const allBindings = [...model.bindings.openai, ...model.bindings.anthropic];
                  const enabledBindingCount = allBindings.filter((binding) => binding.enabled).length;

                  return (
                    <tr key={model.id}>
                      <td>{model.alias}</td>
                      <td>{model.displayName}</td>
                      <td>
                        <span className={model.enabled ? "status-pill online" : "status-pill offline"}>
                          {model.enabled ? "启用中" : "已停用"}
                        </span>
                      </td>
                      <td>{allBindings.length}</td>
                      <td>{enabledBindingCount}</td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => openModelDrawer(model)}
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
        open={Boolean(selectedModel && modelDraft && bindingEditor)}
        size="xl"
        title={selectedModel ? `模型配置 · ${selectedModel.alias}` : ""}
        subtitle={
          selectedModel
            ? "基础信息全局共享，OpenAI 与 Anthropic 在各自标签页里维护绑定、顺序和新增入口。"
            : undefined
        }
        onClose={() => {
          setSelectedModelId(null);
          setModelDraft(null);
          setBindingEditor(null);
        }}
      >
        {selectedModel && modelDraft && bindingEditor ? (
          <div className="stack">
            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>基础设置</h4>
                  <p className="muted">模型 alias 对外共享，不区分协议。</p>
                </div>
              </div>

              <div className="form-grid">
                <label>
                  <span>模型别名</span>
                  <input
                    value={modelDraft.alias}
                    onChange={(event) => setModelDraft((current) => (current ? { ...current, alias: event.target.value } : current))}
                  />
                </label>
                <label>
                  <span>显示名称</span>
                  <input
                    value={modelDraft.displayName}
                    onChange={(event) =>
                      setModelDraft((current) => (current ? { ...current, displayName: event.target.value } : current))
                    }
                  />
                </label>
              </div>

              <label className="inline">
                <input
                  type="checkbox"
                  checked={modelDraft.enabled}
                  onChange={(event) =>
                    setModelDraft((current) => (current ? { ...current, enabled: event.target.checked } : current))
                  }
                />
                <span>模型启用</span>
              </label>

              <div className="toolbar">
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    void api.models
                      .update(selectedModel.id, modelDraft)
                      .then(async () => {
                        await refreshModels();
                        onNotice(`模型 ${modelDraft.alias} 已更新。`);
                      })
                      .catch(onError);
                  }}
                >
                  保存模型
                </button>
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() => {
                    if (!window.confirm(`确认删除模型 ${selectedModel.alias} 及其全部绑定吗？`)) {
                      return;
                    }

                    void api.models
                      .remove(selectedModel.id)
                      .then(async () => {
                        setSelectedModelId(null);
                        setModelDraft(null);
                        setBindingEditor(null);
                        await refreshModels();
                        onNotice(`模型 ${selectedModel.alias} 已删除。`);
                      })
                      .catch(onError);
                  }}
                >
                  删除模型
                </button>
              </div>
            </section>

            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>协议标签</h4>
                  <p className="muted">在不同协议标签下，绑定列表、顺序和新增入口彼此独立。</p>
                </div>
              </div>

              <div className="protocol-tabs">
                {(["openai", "anthropic"] as ProviderProtocol[]).map((protocol) => (
                  <button
                    key={protocol}
                    type="button"
                    className={selectedProtocol === protocol ? "chip active" : "chip"}
                    onClick={() => setSelectedProtocol(protocol)}
                  >
                    {protocol === "anthropic" ? "Anthropic" : "OpenAI"}
                  </button>
                ))}
              </div>
            </section>

            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>{selectedProtocol === "anthropic" ? "Anthropic 路由绑定" : "OpenAI 路由绑定"}</h4>
                  <p className="muted">当前标签内的排序越靠前，运行时优先级越高。</p>
                </div>
              </div>

              <div className="table-wrap drawer-table-wrap">
                <table className="binding-table">
                  <thead>
                    <tr>
                      <th>顺序</th>
                      <th>Provider</th>
                      <th>上游模型</th>
                      <th>输入价 / 百万 Tokens</th>
                      <th>输出价 / 百万 Tokens</th>
                      <th>启用</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentBindings.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="table-empty">
                            {selectedProtocol === "anthropic"
                              ? "当前模型还没有 Anthropic 路由绑定。"
                              : "当前模型还没有 OpenAI 路由绑定。"}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      currentBindings.map((binding, index) => (
                        <tr key={binding.id}>
                          <td>
                            <div className="binding-order-controls">
                              <span className="table-rank">{index + 1}</span>
                              <button
                                type="button"
                                className="chip"
                                onClick={() => moveBinding(selectedProtocol, index, -1)}
                              >
                                上移
                              </button>
                              <button
                                type="button"
                                className="chip"
                                onClick={() => moveBinding(selectedProtocol, index, 1)}
                              >
                                下移
                              </button>
                            </div>
                          </td>
                          <td>{binding.providerName}</td>
                          <td>
                            <input
                              value={binding.upstreamModel}
                              onChange={(event) =>
                                setBindingEditor((current) =>
                                  current
                                    ? {
                                        ...current,
                                        [selectedProtocol]: current[selectedProtocol].map((item) =>
                                          item.id === binding.id
                                            ? { ...item, upstreamModel: event.target.value }
                                            : item
                                        )
                                      }
                                    : current
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.0001"
                              value={binding.inputPrice}
                              onChange={(event) =>
                                setBindingEditor((current) =>
                                  current
                                    ? {
                                        ...current,
                                        [selectedProtocol]: current[selectedProtocol].map((item) =>
                                          item.id === binding.id
                                            ? { ...item, inputPrice: Number(event.target.value) }
                                            : item
                                        )
                                      }
                                    : current
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.0001"
                              value={binding.outputPrice}
                              onChange={(event) =>
                                setBindingEditor((current) =>
                                  current
                                    ? {
                                        ...current,
                                        [selectedProtocol]: current[selectedProtocol].map((item) =>
                                          item.id === binding.id
                                            ? { ...item, outputPrice: Number(event.target.value) }
                                            : item
                                        )
                                      }
                                    : current
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={binding.enabled}
                              onChange={(event) =>
                                setBindingEditor((current) =>
                                  current
                                    ? {
                                        ...current,
                                        [selectedProtocol]: current[selectedProtocol].map((item) =>
                                          item.id === binding.id
                                            ? { ...item, enabled: event.target.checked }
                                            : item
                                        )
                                      }
                                    : current
                                )
                              }
                            />
                          </td>
                          <td>
                            <div className="binding-actions">
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => {
                                  void api.models
                                    .updateBinding(selectedModel.id, binding.id, {
                                      upstreamModel: binding.upstreamModel,
                                      inputPrice: binding.inputPrice,
                                      outputPrice: binding.outputPrice,
                                      enabled: binding.enabled
                                    })
                                    .then(async () => {
                                      await refreshModels();
                                      onNotice(`绑定 ${binding.providerName} 已更新。`);
                                    })
                                    .catch(onError);
                                }}
                              >
                                保存
                              </button>
                              <button
                                type="button"
                                className="ghost danger"
                                onClick={() => {
                                  if (!window.confirm(`确认移除绑定 ${binding.providerName} 吗？`)) {
                                    return;
                                  }

                                  void api.models
                                    .removeBinding(selectedModel.id, binding.id)
                                    .then(async () => {
                                      await refreshModels();
                                      onNotice(`绑定 ${binding.providerName} 已移除。`);
                                    })
                                    .catch(onError);
                                }}
                              >
                                移除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="toolbar">
                <button
                  type="button"
                  className="secondary"
                  disabled={!isCurrentOrderDirtyFromRuntime}
                  onClick={() => {
                    void api.models
                      .applyRuntimeOrder(selectedModel.id, selectedProtocol, currentOrder)
                      .then(async () => {
                        await refreshModels();
                        onNotice(
                          `${selectedProtocol === "anthropic" ? "Anthropic" : "OpenAI"} 运行顺序已应用。`
                        );
                      })
                      .catch(onError);
                  }}
                >
                  应用当前顺序
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={!isCurrentOrderDirtyFromDefault}
                  onClick={() => reorderBindings(selectedProtocol, defaultOrder)}
                >
                  恢复默认
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={!isCurrentOrderDirtyFromDefault}
                  onClick={() => {
                    void api.models
                      .saveDefaultOrder(selectedModel.id, selectedProtocol, currentOrder)
                      .then(async () => {
                        await refreshModels();
                        onNotice(
                          `${selectedProtocol === "anthropic" ? "Anthropic" : "OpenAI"} 默认顺序已保存。`
                        );
                      })
                      .catch(onError);
                  }}
                >
                  保存默认
                </button>
              </div>
            </section>

            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>{selectedProtocol === "anthropic" ? "新增 Anthropic 绑定" : "新增 OpenAI 绑定"}</h4>
                  <p className="muted">Provider 下拉只显示当前协议已配置完成的逻辑 Provider。</p>
                </div>
              </div>

              <div className="form-grid">
                <label>
                  <span>Provider</span>
                  <select
                    value={selectedBindingDraft.providerId}
                    onChange={(event) =>
                      setBindingDrafts((current) => ({
                        ...current,
                        [selectedProtocol]: {
                          ...current[selectedProtocol],
                          providerId: event.target.value
                        }
                      }))
                    }
                  >
                    <option value="">请选择</option>
                    {protocolProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>上游模型名</span>
                  <input
                    value={selectedBindingDraft.upstreamModel}
                    onChange={(event) =>
                      setBindingDrafts((current) => ({
                        ...current,
                        [selectedProtocol]: {
                          ...current[selectedProtocol],
                          upstreamModel: event.target.value
                        }
                      }))
                    }
                  />
                </label>

                <label>
                  <span>输入价 / 百万 Tokens</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={selectedBindingDraft.inputPrice}
                    onChange={(event) =>
                      setBindingDrafts((current) => ({
                        ...current,
                        [selectedProtocol]: {
                          ...current[selectedProtocol],
                          inputPrice: Number(event.target.value)
                        }
                      }))
                    }
                  />
                </label>

                <label>
                  <span>输出价 / 百万 Tokens</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={selectedBindingDraft.outputPrice}
                    onChange={(event) =>
                      setBindingDrafts((current) => ({
                        ...current,
                        [selectedProtocol]: {
                          ...current[selectedProtocol],
                          outputPrice: Number(event.target.value)
                        }
                      }))
                    }
                  />
                </label>
              </div>

              <label className="inline">
                <input
                  type="checkbox"
                  checked={selectedBindingDraft.enabled}
                  onChange={(event) =>
                    setBindingDrafts((current) => ({
                      ...current,
                      [selectedProtocol]: {
                        ...current[selectedProtocol],
                        enabled: event.target.checked
                      }
                    }))
                  }
                />
                <span>创建后立即启用</span>
              </label>

              <div className="toolbar">
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    if (!selectedBindingDraft.providerId || !selectedBindingDraft.upstreamModel.trim()) {
                      setError("请先填写完整的 Provider 和上游模型名。");
                      return;
                    }

                    void api.models
                      .addBinding(selectedModel.id, selectedBindingDraft)
                      .then(async () => {
                        setBindingDrafts((current) => ({
                          ...current,
                          [selectedProtocol]: {
                            ...createEmptyBindingDraft(selectedProtocol),
                            providerId: protocolProviders[0]?.id ?? ""
                          }
                        }));
                        await refreshModels();
                        onNotice(
                          `${selectedProtocol === "anthropic" ? "Anthropic" : "OpenAI"} 绑定已新增。`
                        );
                      })
                      .catch(onError);
                  }}
                >
                  添加绑定
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
