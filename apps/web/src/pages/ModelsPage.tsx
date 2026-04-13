import type { Dispatch, SetStateAction } from "react";

import { api, type BindingItem, type BindingPayload, type ModelItem, type ProviderItem } from "../lib/api.ts";

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
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h3>新增模型别名</h3>
          <span className="muted">模型别名对外暴露给调用方</span>
        </div>
        <div className="form-grid">
          <label><span>模型别名</span><input value={newModel.alias} onChange={(event) => setNewModel((current) => ({ ...current, alias: event.target.value }))} /></label>
          <label><span>展示名称</span><input value={newModel.displayName} onChange={(event) => setNewModel((current) => ({ ...current, displayName: event.target.value }))} /></label>
        </div>
        <label className="inline"><input type="checkbox" checked={newModel.enabled} onChange={(event) => setNewModel((current) => ({ ...current, enabled: event.target.checked }))} /><span>创建后立即启用</span></label>
        <button type="button" className="primary" onClick={() => { void api.models.create(newModel).then(async () => { setNewModel(emptyModel); await refreshModels(); onNotice("模型别名已创建"); }).catch(onError); }}>保存模型</button>
      </section>

      {models.map((model) => (
        <section key={model.id} className="panel">
          <div className="panel-head">
            <div><h3>{model.alias}</h3><p className="muted">绑定数：{model.bindings.length}</p></div>
            <div className="action-row">
              <button type="button" className="secondary" onClick={() => { void api.models.update(model.id, { alias: model.alias, displayName: model.displayName, enabled: model.enabled }).then(async () => { await refreshModels(); onNotice(`模型 ${model.alias} 已更新`); }).catch(onError); }}>保存模型</button>
              <button type="button" className="ghost danger" onClick={() => { if (!window.confirm(`确认删除模型 ${model.alias} 及其全部绑定吗？`)) { return; } void api.models.remove(model.id).then(async () => { await refreshModels(); onNotice(`模型 ${model.alias} 已删除`); }).catch(onError); }}>删除模型</button>
            </div>
          </div>

          <div className="form-grid">
            <label><span>别名</span><input value={model.alias} onChange={(event) => updateModelField(model.id, "alias", event.target.value)} /></label>
            <label><span>展示名称</span><input value={model.displayName} onChange={(event) => updateModelField(model.id, "displayName", event.target.value)} /></label>
          </div>
          <label className="inline"><input type="checkbox" checked={model.enabled} onChange={(event) => updateModelField(model.id, "enabled", event.target.checked)} /><span>模型启用</span></label>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>顺序</th>
                  <th>Provider</th>
                  <th>上游模型名</th>
                  <th>输入价</th>
                  <th>输出价</th>
                  <th>启用</th>
                  <th>动作</th>
                </tr>
              </thead>
              <tbody>
                {model.bindings.map((binding, index) => (
                  <tr key={binding.id}>
                    <td><div className="action-row compact-row"><span>{index + 1}</span><button type="button" className="chip" onClick={() => moveBinding(model.id, index, -1)}>↑</button><button type="button" className="chip" onClick={() => moveBinding(model.id, index, 1)}>↓</button></div></td>
                    <td>{binding.providerName}</td>
                    <td><input value={binding.upstreamModel} onChange={(event) => updateBindingField(model.id, binding.id, "upstreamModel", event.target.value)} /></td>
                    <td><input type="number" step="0.0001" value={binding.inputPrice} onChange={(event) => updateBindingField(model.id, binding.id, "inputPrice", Number(event.target.value))} /></td>
                    <td><input type="number" step="0.0001" value={binding.outputPrice} onChange={(event) => updateBindingField(model.id, binding.id, "outputPrice", Number(event.target.value))} /></td>
                    <td><input type="checkbox" checked={binding.enabled} onChange={(event) => updateBindingField(model.id, binding.id, "enabled", event.target.checked)} /></td>
                    <td><div className="action-row"><button type="button" className="secondary" onClick={() => { void api.models.updateBinding(model.id, binding.id, { upstreamModel: binding.upstreamModel, inputPrice: binding.inputPrice, outputPrice: binding.outputPrice, enabled: binding.enabled }).then(async () => { await refreshModels(); onNotice(`绑定 ${binding.providerName} 已更新`); }).catch(onError); }}>保存</button><button type="button" className="ghost danger" onClick={() => { void api.models.removeBinding(model.id, binding.id).then(async () => { await refreshModels(); onNotice(`绑定 ${binding.providerName} 已移除`); }).catch(onError); }}>移除</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="action-row">
            <button type="button" className="secondary" onClick={() => { void api.models.applyRuntimeOrder(model.id, model.bindings.map((binding) => binding.id)).then(async () => { await refreshModels(); onNotice(`模型 ${model.alias} 的运行顺序已应用`); }).catch(onError); }}>应用当前顺序</button>
            <button type="button" className="ghost" onClick={() => { void api.models.saveDefaultOrder(model.id).then(async () => { await refreshModels(); onNotice(`模型 ${model.alias} 的默认顺序已保存`); }).catch(onError); }}>保存为默认启动顺序</button>
          </div>

          <div className="divider" />
          <div className="panel-head"><h4>新增绑定</h4></div>
          <div className="form-grid">
            <label>
              <span>Provider</span>
              <select value={bindingDrafts[model.id]?.providerId ?? providers[0]?.id ?? ""} onChange={(event) => setBindingDrafts((current) => ({ ...current, [model.id]: { ...(current[model.id] ?? emptyBinding), providerId: event.target.value } }))}>
                <option value="">请选择</option>
                {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
            </label>
            <label><span>上游模型名</span><input value={bindingDrafts[model.id]?.upstreamModel ?? ""} onChange={(event) => setBindingDrafts((current) => ({ ...current, [model.id]: { ...(current[model.id] ?? emptyBinding), providerId: current[model.id]?.providerId ?? providers[0]?.id ?? "", upstreamModel: event.target.value } }))} /></label>
            <label><span>输入价 / 百万 Tokens</span><input type="number" step="0.0001" value={bindingDrafts[model.id]?.inputPrice ?? 0} onChange={(event) => setBindingDrafts((current) => ({ ...current, [model.id]: { ...(current[model.id] ?? emptyBinding), providerId: current[model.id]?.providerId ?? providers[0]?.id ?? "", inputPrice: Number(event.target.value) } }))} /></label>
            <label><span>输出价 / 百万 Tokens</span><input type="number" step="0.0001" value={bindingDrafts[model.id]?.outputPrice ?? 0} onChange={(event) => setBindingDrafts((current) => ({ ...current, [model.id]: { ...(current[model.id] ?? emptyBinding), providerId: current[model.id]?.providerId ?? providers[0]?.id ?? "", outputPrice: Number(event.target.value) } }))} /></label>
          </div>
          <button type="button" className="primary" onClick={() => { const draft = bindingDrafts[model.id]; if (!draft) { setError("请先填写绑定信息"); return; } void api.models.addBinding(model.id, draft).then(async () => { setBindingDrafts((current) => ({ ...current, [model.id]: { ...emptyBinding, providerId: providers[0]?.id ?? "" } })); await refreshModels(); onNotice(`已为 ${model.alias} 新增绑定`); }).catch(onError); }}>添加绑定</button>
        </section>
      ))}
    </div>
  );
}
