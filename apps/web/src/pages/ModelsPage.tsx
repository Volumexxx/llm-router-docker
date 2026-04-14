import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { Drawer } from "../components/Drawer.tsx";
import {
  api,
  type BindingItem,
  type BindingPayload,
  type ModelItem,
  type ProviderItem
} from "../lib/api.ts";

interface ModelsPageProps {
  models: ModelItem[];
  providers: ProviderItem[];
  newModel: {
    alias: string;
    displayName: string;
    enabled: boolean;
  };
  setNewModel: Dispatch<
    SetStateAction<{
      alias: string;
      displayName: string;
      enabled: boolean;
    }>
  >;
  bindingDrafts: Record<string, BindingPayload>;
  setBindingDrafts: Dispatch<SetStateAction<Record<string, BindingPayload>>>;
  updateModelField: (modelId: string, field: keyof ModelItem, value: string | boolean) => void;
  updateBindingField: (
    modelId: string,
    bindingId: string,
    field: keyof BindingItem,
    value: string | boolean | number
  ) => void;
  moveBinding: (modelId: string, index: number, direction: -1 | 1) => void;
  refreshModels: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (reason: unknown) => void;
  setError: (message: string) => void;
}

const emptyModel = {
  alias: "",
  displayName: "",
  enabled: true
};

const emptyBinding: BindingPayload = {
  providerId: "",
  upstreamModel: "",
  inputPrice: 0,
  outputPrice: 0,
  enabled: true
};

export function ModelsPage({
  models,
  providers,
  newModel,
  setNewModel,
  bindingDrafts,
  setBindingDrafts,
  updateModelField,
  updateBindingField,
  moveBinding,
  refreshModels,
  onNotice,
  onError,
  setError
}: ModelsPageProps) {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId]
  );

  useEffect(() => {
    if (selectedModelId && !selectedModel) {
      setSelectedModelId(null);
    }
  }, [selectedModel, selectedModelId]);

  const ensureBindingDraft = (modelId: string) => {
    setBindingDrafts((current) => {
      if (current[modelId]) {
        return current;
      }

      return {
        ...current,
        [modelId]: {
          ...emptyBinding,
          providerId: providers[0]?.id ?? ""
        }
      };
    });
  };

  const openModelDrawer = (modelId: string) => {
    ensureBindingDraft(modelId);
    setSelectedModelId(modelId);
  };

  const selectedDraft = selectedModel ? bindingDrafts[selectedModel.id] : null;

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>创建模型别名</h3>
            <p className="muted">模型别名会暴露给外部调用方，具体路由绑定在二级配置抽屉中管理。</p>
          </div>
        </div>

        <div className="form-grid">
          <label>
            <span>模型别名</span>
            <input
              value={newModel.alias}
              onChange={(event) =>
                setNewModel((current) => ({ ...current, alias: event.target.value }))
              }
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
              placeholder="例如：GPT-4o Mini"
            />
          </label>
        </div>

        <label className="inline">
          <input
            type="checkbox"
            checked={newModel.enabled}
            onChange={(event) =>
              setNewModel((current) => ({ ...current, enabled: event.target.checked }))
            }
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
                  setNewModel(emptyModel);
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
            <p className="muted">列表页展示摘要信息，点击“配置”进入模型详情抽屉。</p>
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
                  const enabledBindingCount = model.bindings.filter((binding) => binding.enabled).length;
                  return (
                    <tr key={model.id}>
                      <td>{model.alias}</td>
                      <td>{model.displayName}</td>
                      <td>
                        <span className={model.enabled ? "status-pill online" : "status-pill offline"}>
                          {model.enabled ? "启用中" : "已停用"}
                        </span>
                      </td>
                      <td>{model.bindings.length}</td>
                      <td>{enabledBindingCount}</td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => openModelDrawer(model.id)}
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
        open={Boolean(selectedModel)}
        title={selectedModel ? `模型配置 · ${selectedModel.alias}` : ""}
        subtitle={
          selectedModel
            ? "在当前抽屉中维护模型基本信息、Provider 绑定与优先级顺序。"
            : undefined
        }
        onClose={() => setSelectedModelId(null)}
      >
        {selectedModel ? (
          <div className="stack">
            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>基础设置</h4>
                  <p className="muted">更新模型别名、显示名和启用状态。</p>
                </div>
              </div>

              <div className="form-grid">
                <label>
                  <span>模型别名</span>
                  <input
                    value={selectedModel.alias}
                    onChange={(event) =>
                      updateModelField(selectedModel.id, "alias", event.target.value)
                    }
                  />
                </label>
                <label>
                  <span>显示名称</span>
                  <input
                    value={selectedModel.displayName}
                    onChange={(event) =>
                      updateModelField(selectedModel.id, "displayName", event.target.value)
                    }
                  />
                </label>
              </div>

              <label className="inline">
                <input
                  type="checkbox"
                  checked={selectedModel.enabled}
                  onChange={(event) =>
                    updateModelField(selectedModel.id, "enabled", event.target.checked)
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
                      .update(selectedModel.id, {
                        alias: selectedModel.alias,
                        displayName: selectedModel.displayName,
                        enabled: selectedModel.enabled
                      })
                      .then(async () => {
                        await refreshModels();
                        onNotice(`模型 ${selectedModel.alias} 已更新。`);
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
                  <h4>路由绑定</h4>
                  <p className="muted">运行顺序越靠前，优先级越高。先拖动顺序，再点击“应用当前顺序”。</p>
                </div>
              </div>

              <div className="table-wrap">
                <table>
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
                    {selectedModel.bindings.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="table-empty">当前模型还没有绑定任何 Provider。</div>
                        </td>
                      </tr>
                    ) : (
                      selectedModel.bindings.map((binding, index) => (
                        <tr key={binding.id}>
                          <td>
                            <div className="action-row compact-row">
                              <span className="table-rank">{index + 1}</span>
                              <button
                                type="button"
                                className="chip"
                                onClick={() => moveBinding(selectedModel.id, index, -1)}
                              >
                                上移
                              </button>
                              <button
                                type="button"
                                className="chip"
                                onClick={() => moveBinding(selectedModel.id, index, 1)}
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
                                updateBindingField(
                                  selectedModel.id,
                                  binding.id,
                                  "upstreamModel",
                                  event.target.value
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
                                updateBindingField(
                                  selectedModel.id,
                                  binding.id,
                                  "inputPrice",
                                  Number(event.target.value)
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
                                updateBindingField(
                                  selectedModel.id,
                                  binding.id,
                                  "outputPrice",
                                  Number(event.target.value)
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={binding.enabled}
                              onChange={(event) =>
                                updateBindingField(
                                  selectedModel.id,
                                  binding.id,
                                  "enabled",
                                  event.target.checked
                                )
                              }
                            />
                          </td>
                          <td>
                            <div className="action-row">
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
                  onClick={() => {
                    void api.models
                      .applyRuntimeOrder(
                        selectedModel.id,
                        selectedModel.bindings.map((binding) => binding.id)
                      )
                      .then(async () => {
                        await refreshModels();
                        onNotice(`模型 ${selectedModel.alias} 的运行顺序已应用。`);
                      })
                      .catch(onError);
                  }}
                >
                  应用当前顺序
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void api.models
                      .saveDefaultOrder(selectedModel.id)
                      .then(async () => {
                        await refreshModels();
                        onNotice(`模型 ${selectedModel.alias} 的默认顺序已保存。`);
                      })
                      .catch(onError);
                  }}
                >
                  另存为默认顺序
                </button>
              </div>
            </section>

            <section className="panel panel-elevated">
              <div className="panel-head">
                <div className="stack compact-stack">
                  <h4>新增绑定</h4>
                  <p className="muted">配置完后会自动加入当前模型的绑定列表。</p>
                </div>
              </div>

              <div className="form-grid">
                <label>
                  <span>Provider</span>
                  <select
                    value={selectedDraft?.providerId ?? providers[0]?.id ?? ""}
                    onChange={(event) =>
                      setBindingDrafts((current) => ({
                        ...current,
                        [selectedModel.id]: {
                          ...(current[selectedModel.id] ?? emptyBinding),
                          providerId: event.target.value
                        }
                      }))
                    }
                  >
                    <option value="">请选择</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>上游模型名</span>
                  <input
                    value={selectedDraft?.upstreamModel ?? ""}
                    onChange={(event) =>
                      setBindingDrafts((current) => ({
                        ...current,
                        [selectedModel.id]: {
                          ...(current[selectedModel.id] ?? emptyBinding),
                          providerId: current[selectedModel.id]?.providerId ?? providers[0]?.id ?? "",
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
                    value={selectedDraft?.inputPrice ?? 0}
                    onChange={(event) =>
                      setBindingDrafts((current) => ({
                        ...current,
                        [selectedModel.id]: {
                          ...(current[selectedModel.id] ?? emptyBinding),
                          providerId: current[selectedModel.id]?.providerId ?? providers[0]?.id ?? "",
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
                    value={selectedDraft?.outputPrice ?? 0}
                    onChange={(event) =>
                      setBindingDrafts((current) => ({
                        ...current,
                        [selectedModel.id]: {
                          ...(current[selectedModel.id] ?? emptyBinding),
                          providerId: current[selectedModel.id]?.providerId ?? providers[0]?.id ?? "",
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
                  checked={selectedDraft?.enabled ?? true}
                  onChange={(event) =>
                    setBindingDrafts((current) => ({
                      ...current,
                      [selectedModel.id]: {
                        ...(current[selectedModel.id] ?? emptyBinding),
                        providerId: current[selectedModel.id]?.providerId ?? providers[0]?.id ?? "",
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
                    const draft = bindingDrafts[selectedModel.id];
                    if (!draft?.providerId || !draft.upstreamModel.trim()) {
                      setError("请先填写完整的 Provider 和上游模型名。");
                      return;
                    }

                    void api.models
                      .addBinding(selectedModel.id, draft)
                      .then(async () => {
                        setBindingDrafts((current) => ({
                          ...current,
                          [selectedModel.id]: {
                            ...emptyBinding,
                            providerId: providers[0]?.id ?? ""
                          }
                        }));
                        await refreshModels();
                        onNotice(`已为 ${selectedModel.alias} 新增绑定。`);
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
