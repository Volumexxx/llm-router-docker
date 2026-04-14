import { DashboardCardView } from "../components/DashboardCardView.tsx";
import type { DashboardSummary } from "../lib/api.ts";
import { formatCost, formatDateTime, formatNumber } from "../lib/format.ts";
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
            {value === "day" ? "Day" : value === "week" ? "Week" : "Month"}
          </button>
        ))}
      </div>

      <section className="metric-grid">
        <article className="panel">
          <span>Total Requests</span>
          <strong>{formatNumber(dashboard.overall.requests)}</strong>
        </article>
        <article className="panel">
          <span>Success / Failure</span>
          <strong>
            {formatNumber(dashboard.overall.successes)} / {formatNumber(dashboard.overall.failures)}
          </strong>
        </article>
        <article className="panel">
          <span>Uncached Input</span>
          <strong>{formatNumber(dashboard.overall.inputTokens)}</strong>
        </article>
        <article className="panel">
          <span>Output</span>
          <strong>{formatNumber(dashboard.overall.outputTokens)}</strong>
        </article>
        <article className="panel">
          <span>Cache</span>
          <strong>{formatNumber(dashboard.overall.cacheTokens)}</strong>
        </article>
        <article className="panel">
          <span>Total Tokens</span>
          <strong>{formatNumber(dashboard.overall.totalTokens)}</strong>
        </article>
        <article className="panel">
          <span>Estimated Cost</span>
          <strong>{formatCost(dashboard.overall.estimatedCost)}</strong>
        </article>
        <article className="panel">
          <span>P95 Latency</span>
          <strong>{formatNumber(dashboard.overall.p95LatencyMs)} ms</strong>
        </article>
      </section>

      <article className="panel">
        <div className="panel-head">
          <h3>Overall Trend</h3>
          <span className="muted">
            {formatDateTime(dashboard.windowStart)} - {formatDateTime(dashboard.windowEnd)}
          </span>
        </div>
        <Sparkline points={dashboard.trend} />
        <div className="legend">
          <span>Average latency {formatNumber(dashboard.overall.averageLatencyMs)} ms</span>
          <span>P50 {formatNumber(dashboard.overall.p50LatencyMs)} ms</span>
          <span>Missing usage {formatNumber(dashboard.overall.missingUsageCount)}</span>
          <span>Error rate {formatNumber(dashboard.overall.errorRate * 100)}%</span>
        </div>
      </article>

      <section className="stack">
        <div className="panel-head">
          <h3>Provider Ranking</h3>
        </div>
        <div className="card-grid">
          {dashboard.providerCards.slice(0, 6).map((card) => (
            <DashboardCardView key={card.key} title={card.label} card={card} />
          ))}
        </div>
      </section>

      <section className="stack">
        <div className="panel-head">
          <h3>Model Ranking</h3>
        </div>
        <div className="card-grid">
          {dashboard.modelCards.slice(0, 6).map((card) => (
            <DashboardCardView key={card.key} title={card.label} card={card} />
          ))}
        </div>
      </section>

      <section className="stack">
        <div className="panel-head">
          <h3>API Key Ranking</h3>
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
