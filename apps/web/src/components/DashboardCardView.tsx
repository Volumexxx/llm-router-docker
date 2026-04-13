import type { DashboardCard } from "../lib/api.ts";
import { formatNumber } from "../lib/format.ts";
import { Sparkline } from "./Sparkline.tsx";

export function DashboardCardView({ title, card }: { title: string; card: DashboardCard }) {
  return (
    <article className="panel metric-card">
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="pill">{card.requests} req</span>
      </div>
      <div className="metric-grid compact">
        <div>
          <span>成功</span>
          <strong>{formatNumber(card.successes)}</strong>
        </div>
        <div>
          <span>失败</span>
          <strong>{formatNumber(card.failures)}</strong>
        </div>
        <div>
          <span>Tokens</span>
          <strong>{formatNumber(card.totalTokens)}</strong>
        </div>
        <div>
          <span>P95</span>
          <strong>{formatNumber(card.p95LatencyMs)} ms</strong>
        </div>
      </div>
      <Sparkline points={card.trend} />
    </article>
  );
}
