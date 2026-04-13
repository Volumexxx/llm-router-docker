import type { DashboardSummary } from "../lib/api.ts";
import { formatCost, formatDateTime, formatNumber } from "../lib/format.ts";
import { DashboardCardView } from "../components/DashboardCardView.tsx";
import { Sparkline } from "../components/Sparkline.tsx";

interface DashboardPageProps {
  dashboard: DashboardSummary | null;
  range: "day" | "week" | "month";
  setRange: (range: "day" | "week" | "month") => void;
}

export function DashboardPage({ dashboard, range, setRange }: DashboardPageProps) {
  if (!dashboard) {
    return null;
  }

  return (
    <div className="stack">
      <div className="toolbar">
        {(["day", "week", "month"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={range === value ? "chip active" : "chip"}
            onClick={() => setRange(value)}
          >
            {value === "day" ? "按日" : value === "week" ? "按周" : "按月"}
          </button>
        ))}
      </div>

      <section className="metric-grid">
        <article className="panel">
          <span>请求总数</span>
          <strong>{formatNumber(dashboard.overall.requests)}</strong>
        </article>
        <article className="panel">
          <span>成功 / 失败</span>
          <strong>
            {formatNumber(dashboard.overall.successes)} / {formatNumber(dashboard.overall.failures)}
          </strong>
        </article>
        <article className="panel">
          <span>总成本</span>
          <strong>{formatCost(dashboard.overall.estimatedCost)}</strong>
        </article>
        <article className="panel">
          <span>P95 延迟</span>
          <strong>{formatNumber(dashboard.overall.p95LatencyMs)} ms</strong>
        </article>
      </section>

      <article className="panel">
        <div className="panel-head">
          <h3>总体趋势</h3>
          <span className="muted">
            {formatDateTime(dashboard.windowStart)} - {formatDateTime(dashboard.windowEnd)}
          </span>
        </div>
        <Sparkline points={dashboard.trend} />
        <div className="legend">
          <span>平均延迟 {formatNumber(dashboard.overall.averageLatencyMs)} ms</span>
          <span>P50 {formatNumber(dashboard.overall.p50LatencyMs)} ms</span>
          <span>缺失 usage {formatNumber(dashboard.overall.missingUsageCount)}</span>
        </div>
      </article>

      <section className="stack">
        <div className="panel-head">
          <h3>Provider 排行</h3>
        </div>
        <div className="card-grid">
          {dashboard.providerCards.slice(0, 6).map((card) => (
            <DashboardCardView key={card.key} title={card.label} card={card} />
          ))}
        </div>
      </section>

      <section className="stack">
        <div className="panel-head">
          <h3>模型排行</h3>
        </div>
        <div className="card-grid">
          {dashboard.modelCards.slice(0, 6).map((card) => (
            <DashboardCardView key={card.key} title={card.label} card={card} />
          ))}
        </div>
      </section>

      <section className="stack">
        <div className="panel-head">
          <h3>API Key 排行</h3>
        </div>
        <div className="card-grid">
          {dashboard.apiKeyCards.slice(0, 6).map((card) => (
            <DashboardCardView key={card.key} title={card.label} card={card} />
          ))}
        </div>
      </section>
    </div>
  );
}
