import type { VisibleModelItem } from "../lib/api.ts";

interface UserModelsPageProps {
  models: VisibleModelItem[];
  onRefresh: () => void;
}

export function UserModelsPage({ models, onRefresh }: UserModelsPageProps) {
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div className="stack compact-stack">
            <h3>可用模型</h3>
            <p className="muted">这里展示当前账号权限下可使用的模型名称。</p>
          </div>
          <button type="button" className="secondary" onClick={onRefresh}>
            刷新
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>模型名称</th>
                <th>显示名称</th>
                <th>协议</th>
              </tr>
            </thead>
            <tbody>
              {models.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    <div className="table-empty">当前账号暂无可用模型。</div>
                  </td>
                </tr>
              ) : (
                models.map((model) => (
                  <tr key={model.alias}>
                    <td>{model.alias}</td>
                    <td>{model.displayName}</td>
                    <td>{model.protocols.map((protocol) => (protocol === "anthropic" ? "Anthropic" : "OpenAI")).join(" / ")}</td>
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
