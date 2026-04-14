import { useMemo, useState } from "react";

import { Modal } from "../components/Modal.tsx";
import { TrendChart } from "../components/TrendChart.tsx";
import type { DashboardCard, DashboardSummary, TrendPoint } from "../lib/api.ts";
import {
  formatCost,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent
} from "../lib/format.ts";

interface DashboardPageProps {
  dashboard: DashboardSummary | null;
  range: "day" | "week" | "month";
  setRange: (range: "day" | "week" | "month") => void;
}

type DashboardTabId = "provider" | "model" | "apiKey";
type SortDirection = "asc" | "desc";
type MetricKey =
  | "requests"
  | "successes"
  | "failures"
  | "errorRate"
  | "inputTokens"
  | "outputTokens"
  | "cacheTokens"
  | "totalTokens"
  | "estimatedCost"
  | "averageLatencyMs"
  | "p95LatencyMs";
type SortKey = "label" | MetricKey;

type ChartState = {
  title: string;
  description: string;
  metricKey: MetricKey;
  series: Array<{
    label: string;
    color: string;
    points: Array<{
      label: string;
      value: number;
    }>;
  }>;
};

type SortState = {
  key: SortKey;
  direction: SortDirection;
};

const chartPalette = [
  "#42f5d7",
  "#4ea8ff",
  "#f7b955",
  "#ff6f91",
  "#8d7dff",
  "#7af0a0",
  "#ff8e4f",
  "#7ee8ff"
];

const metricConfig: Record<
  MetricKey,
  {
    label: string;
    format: (value: number) => string;
    getRowValue: (card: DashboardCard) => number;
    getTrendValue: (point: TrendPoint) => number;
  }
> = {
  requests: {
    label: "请求数",
    format: formatNumber,
    getRowValue: (card) => card.requests,
    getTrendValue: (point) => point.requests
  },
  successes: {
    label: "成功数",
    format: formatNumber,
    getRowValue: (card) => card.successes,
    getTrendValue: (point) => point.successes
  },
  failures: {
    label: "失败数",
    format: formatNumber,
    getRowValue: (card) => card.failures,
    getTrendValue: (point) => point.failures
  },
  errorRate: {
    label: "错误率",
    format: (value) => formatPercent(value, 2),
    getRowValue: (card) => (card.requests > 0 ? (card.failures / card.requests) * 100 : 0),
    getTrendValue: (point) => (point.requests > 0 ? (point.failures / point.requests) * 100 : 0)
  },
  inputTokens: {
    label: "输入 Tokens",
    format: formatNumber,
    getRowValue: (card) => card.inputTokens,
    getTrendValue: (point) => point.inputTokens
  },
  outputTokens: {
    label: "输出 Tokens",
    format: formatNumber,
    getRowValue: (card) => card.outputTokens,
    getTrendValue: (point) => point.outputTokens
  },
  cacheTokens: {
    label: "缓存 Tokens",
    format: formatNumber,
    getRowValue: (card) => card.cacheTokens,
    getTrendValue: (point) => point.cacheTokens
  },
  totalTokens: {
    label: "总 Tokens",
    format: formatNumber,
    getRowValue: (card) => card.totalTokens,
    getTrendValue: (point) => point.totalTokens
  },
  estimatedCost: {
    label: "预估成本",
    format: formatCost,
    getRowValue: (card) => card.estimatedCost,
    getTrendValue: (point) => point.estimatedCost
  },
  averageLatencyMs: {
    label: "平均延迟",
    format: formatDuration,
    getRowValue: (card) => card.averageLatencyMs,
    getTrendValue: (point) => point.averageLatencyMs
  },
  p95LatencyMs: {
    label: "P95 延迟",
    format: formatDuration,
    getRowValue: (card) => card.p95LatencyMs,
    getTrendValue: (point) => point.p95LatencyMs
  }
};

const dashboardTabs: Array<{
  id: DashboardTabId;
  label: string;
  getCards: (dashboard: DashboardSummary) => DashboardCard[];
}> = [
  {
    id: "provider",
    label: "Provider",
    getCards: (dashboard) => dashboard.providerCards
  },
  {
    id: "model",
    label: "Model",
    getCards: (dashboard) => dashboard.modelCards
  },
  {
    id: "apiKey",
    label: "Key",
    getCards: (dashboard) => dashboard.apiKeyCards
  }
];

function nextSortState(current: SortState, key: SortKey): SortState {
  if (current.key !== key) {
    return {
      key,
      direction: key === "label" ? "asc" : "desc"
    };
  }

  return {
    key,
    direction: current.direction === "asc" ? "desc" : "asc"
  };
}

export function DashboardPage({ dashboard, range, setRange }: DashboardPageProps) {
  const [activeTab, setActiveTab] = useState<DashboardTabId>("provider");
  const [sortStateByTab, setSortStateByTab] = useState<Record<DashboardTabId, SortState>>({
    provider: { key: "requests", direction: "desc" },
    model: { key: "requests", direction: "desc" },
    apiKey: { key: "requests", direction: "desc" }
  });
  const [chartState, setChartState] = useState<ChartState | null>(null);

  const currentTab = dashboardTabs.find((item) => item.id === activeTab) ?? dashboardTabs[0];
  const currentSort = sortStateByTab[activeTab];

  const sortedRows = useMemo(() => {
    if (!dashboard) {
      return [];
    }

    const rows = [...currentTab.getCards(dashboard)];

    rows.sort((left, right) => {
      if (currentSort.key === "label") {
        const result = left.label.localeCompare(right.label, "zh-CN");
        return currentSort.direction === "asc" ? result : result * -1;
      }

      const leftValue = metricConfig[currentSort.key].getRowValue(left);
      const rightValue = metricConfig[currentSort.key].getRowValue(right);
      const result = leftValue - rightValue;
      return currentSort.direction === "asc" ? result : result * -1;
    });

    return rows;
  }, [currentSort, currentTab, dashboard]);

  if (!dashboard) {
    return null;
  }

  const handleSort = (key: SortKey) => {
    setSortStateByTab((current) => ({
      ...current,
      [activeTab]: nextSortState(current[activeTab], key)
    }));
  };

  const openSingleMetricChart = (card: DashboardCard, metricKey: MetricKey) => {
    const config = metricConfig[metricKey];
    setChartState({
      title: `${card.label} · ${config.label} 趋势`,
      description: `当前范围：${range === "day" ? "Day" : range === "week" ? "Week" : "Month"}。点击表格中的任意数值可查看单对象趋势。`,
      metricKey,
      series: [
        {
          label: card.label,
          color: chartPalette[0],
          points: card.trend.map((point) => ({
            label: point.label,
            value: config.getTrendValue(point)
          }))
        }
      ]
    });
  };

  const openComparisonChart = (metricKey: MetricKey) => {
    const config = metricConfig[metricKey];
    setChartState({
      title: `${currentTab.label} · ${config.label} 趋势对比`,
      description: "展示当前排序结果前 8 项的时间趋势对比。",
      metricKey,
      series: sortedRows.slice(0, 8).map((card, index) => ({
        label: card.label,
        color: chartPalette[index % chartPalette.length],
        points: card.trend.map((point) => ({
          label: point.label,
          value: config.getTrendValue(point)
        }))
      }))
    });
  };

  const metricColumns: MetricKey[] = [
    "requests",
    "successes",
    "failures",
    "errorRate",
    "inputTokens",
    "outputTokens",
    "cacheTokens",
    "totalTokens",
    "estimatedCost",
    "averageLatencyMs",
    "p95LatencyMs"
  ];

  return (
    <div className="stack">
      <section className="panel hero-panel">
        <div className="toolbar cluster-between">
          <div className="stack compact-stack">
            <p className="eyebrow">Metrics Command Center</p>
            <h3>运行指标总览</h3>
            <p className="muted">
              {formatDateTime(dashboard.windowStart)} - {formatDateTime(dashboard.windowEnd)}
            </p>
          </div>

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
        </div>

        <div className="metric-grid">
          <article className="stat-card">
            <span>总请求</span>
            <strong>{formatNumber(dashboard.overall.requests)}</strong>
          </article>
          <article className="stat-card">
            <span>成功 / 失败</span>
            <strong>
              {formatNumber(dashboard.overall.successes)} / {formatNumber(dashboard.overall.failures)}
            </strong>
          </article>
          <article className="stat-card">
            <span>错误率</span>
            <strong>{formatPercent(dashboard.overall.errorRate * 100, 2)}</strong>
          </article>
          <article className="stat-card">
            <span>输入 Tokens</span>
            <strong>{formatNumber(dashboard.overall.inputTokens)}</strong>
          </article>
          <article className="stat-card">
            <span>输出 Tokens</span>
            <strong>{formatNumber(dashboard.overall.outputTokens)}</strong>
          </article>
          <article className="stat-card">
            <span>缓存 Tokens</span>
            <strong>{formatNumber(dashboard.overall.cacheTokens)}</strong>
          </article>
          <article className="stat-card">
            <span>总 Tokens</span>
            <strong>{formatNumber(dashboard.overall.totalTokens)}</strong>
          </article>
          <article className="stat-card">
            <span>预估成本</span>
            <strong>{formatCost(dashboard.overall.estimatedCost)}</strong>
          </article>
          <article className="stat-card">
            <span>平均延迟</span>
            <strong>{formatDuration(dashboard.overall.averageLatencyMs)}</strong>
          </article>
          <article className="stat-card">
            <span>P50 / P95</span>
            <strong>
              {formatNumber(dashboard.overall.p50LatencyMs)} / {formatNumber(dashboard.overall.p95LatencyMs)}
              <small> ms</small>
            </strong>
          </article>
          <article className="stat-card">
            <span>缺失 Usage</span>
            <strong>{formatNumber(dashboard.overall.missingUsageCount)}</strong>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar cluster-between">
          <div className="stack compact-stack">
            <h3>维度分析</h3>
            <p className="muted">
              默认按请求数排序。点击数值单元格查看单对象趋势，点击列表头的“趋势”查看分签对比曲线。
            </p>
          </div>

          <div className="toolbar">
            {dashboardTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "chip active" : "chip"}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrap dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="header-button" onClick={() => handleSort("label")}>
                    名称
                    <span className="sort-indicator">
                      {currentSort.key === "label" ? (currentSort.direction === "asc" ? "↑" : "↓") : "·"}
                    </span>
                  </button>
                </th>
                {metricColumns.map((metricKey) => {
                  const isActive = currentSort.key === metricKey;
                  return (
                    <th key={metricKey}>
                      <div className="header-cell">
                        <button
                          type="button"
                          className="header-button"
                          onClick={() => handleSort(metricKey)}
                        >
                          {metricConfig[metricKey].label}
                          <span className="sort-indicator">
                            {isActive ? (currentSort.direction === "asc" ? "↑" : "↓") : "·"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="mini-action"
                          onClick={() => openComparisonChart(metricKey)}
                        >
                          趋势
                        </button>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={metricColumns.length + 1}>
                    <div className="table-empty">当前范围内暂无统计数据。</div>
                  </td>
                </tr>
              ) : (
                sortedRows.map((card) => (
                  <tr key={`${activeTab}-${card.key}`}>
                    <td>
                      <div className="table-entity">
                        <strong>{card.label}</strong>
                        <small className="muted">点击右侧数值查看趋势</small>
                      </div>
                    </td>
                    {metricColumns.map((metricKey) => (
                      <td key={`${card.key}-${metricKey}`}>
                        <button
                          type="button"
                          className="table-value-button"
                          onClick={() => openSingleMetricChart(card, metricKey)}
                        >
                          {metricConfig[metricKey].format(metricConfig[metricKey].getRowValue(card))}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={Boolean(chartState)}
        title={chartState?.title ?? ""}
        description={chartState?.description}
        onClose={() => setChartState(null)}
      >
        {chartState ? (
          <TrendChart
            series={chartState.series}
            valueFormatter={(value) => metricConfig[chartState.metricKey].format(value)}
          />
        ) : null}
      </Modal>
    </div>
  );
}
