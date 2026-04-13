import type { Dispatch, SetStateAction } from "react";

import type { SystemStatus } from "../lib/api.ts";

interface SystemPageProps {
  systemStatus: SystemStatus | null;
  newGatewayKey: string;
  setNewGatewayKey: Dispatch<SetStateAction<string>>;
  onRotateGatewayKey: () => void;
}

export function SystemPage({
  systemStatus,
  newGatewayKey,
  setNewGatewayKey,
  onRotateGatewayKey
}: SystemPageProps) {
  if (!systemStatus) {
    return null;
  }

  return (
    <div className="stack">
      <section className="metric-grid">
        <article className="panel"><span>服务就绪</span><strong>{systemStatus.ready ? "Ready" : "Not Ready"}</strong></article>
        <article className="panel"><span>可信代理</span><strong>{systemStatus.trustProxy ? "已启用" : "未启用"}</strong></article>
        <article className="panel"><span>网关 Key</span><strong>{systemStatus.gatewayKeyConfigured ? "已配置" : "缺失"}</strong></article>
        <article className="panel"><span>并发上限</span><strong>{systemStatus.maxActiveProxyRequests}</strong></article>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>系统状态</h3></div>
        <div className="detail-grid">
          <div><span>推荐 API 地址</span><strong>{systemStatus.recommendedApiBaseUrl}</strong></div>
          <div><span>推荐后台地址</span><strong>{systemStatus.recommendedAdminUrl}</strong></div>
          <div><span>数据目录</span><strong>{systemStatus.dataDir}</strong></div>
          <div><span>数据库文件</span><strong>{systemStatus.dbPath}</strong></div>
        </div>
        {systemStatus.warnings.length > 0 ? <div className="warning-list">{systemStatus.warnings.map((warning) => <p key={warning} className="feedback warning">{warning}</p>)}</div> : null}
      </section>

      <section className="panel">
        <div className="panel-head"><h3>轮换网关 API Key</h3><span className="muted">不会影响已有 Provider 与模型配置</span></div>
        <label><span>新的网关 Key</span><input type="password" value={newGatewayKey} onChange={(event) => setNewGatewayKey(event.target.value)} /></label>
        <button type="button" className="primary" onClick={onRotateGatewayKey}>更新网关 Key</button>
      </section>
    </div>
  );
}
