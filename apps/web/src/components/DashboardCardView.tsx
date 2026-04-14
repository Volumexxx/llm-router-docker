import type { DashboardCard } from "../lib/api.ts";
import { formatCost, formatNumber } from "../lib/format.ts";
import { Sparkline } from "./Sparkline.tsx";

export function DashboardCardView({ title, card }: { title: string; card: DashboardCard }) {
  return (
    <article className="panel metric-card">
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="pill">{formatNumber(card.requests)} req</span>
      </div>

      <div className="metric-grid compact">
        <div>
          <span>Success</span>
          <strong>{formatNumber(card.successes)}</strong>
        </div>
        <div>
          <span>Failure</span>
          <strong>{formatNumber(card.failures)}</strong>
        </div>
        <div>
          <span>Input</span>
          <strong>{formatNumber(card.inputTokens)}</strong>
        </div>
        <div>
          <span>Output</span>
          <strong>{formatNumber(card.outputTokens)}</strong>
        </div>
        <div>
          <span>Cache</span>
          <strong>{formatNumber(card.cacheTokens)}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong>{formatNumber(card.totalTokens)}</strong>
        </div>
        <div>
          <span>Cost</span>
          <strong>{formatCost(card.estimatedCost)}</strong>
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
