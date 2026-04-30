import { useEffect, useMemo, useState } from "react";

interface TrendChartSeries {
  label: string;
  color: string;
  points: Array<{
    label: string;
    value: number;
  }>;
}

interface TrendChartProps {
  series: TrendChartSeries[];
  valueFormatter: (value: number) => string;
  defaultSelectedIndex?: number;
}

const CHART_WIDTH = 920;
const CHART_HEIGHT = 360;
const PADDING = {
  top: 24,
  right: 24,
  bottom: 52,
  left: 72
};

function pickTickIndices(length: number, maxTicks: number): number[] {
  if (length <= maxTicks) {
    return Array.from({ length }, (_, index) => index);
  }

  const step = Math.max(1, Math.floor((length - 1) / (maxTicks - 1)));
  const indices = new Set<number>();

  for (let index = 0; index < length; index += step) {
    indices.add(index);
  }

  indices.add(length - 1);
  return Array.from(indices).sort((left, right) => left - right);
}

export function TrendChart({ series, valueFormatter, defaultSelectedIndex }: TrendChartProps) {
  const normalizedSeries = useMemo(
    () => series.filter((item) => item.points.length > 0),
    [series]
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectionFingerprint = useMemo(
    () =>
      normalizedSeries
        .map((item) => `${item.label}:${item.points.map((point) => `${point.label}:${point.value}`).join("|")}`)
        .join("||"),
    [normalizedSeries]
  );

  useEffect(() => {
    const maxIndex = Math.max((normalizedSeries[0]?.points.length ?? 1) - 1, 0);
    const nextIndex =
      typeof defaultSelectedIndex === "number"
        ? Math.min(Math.max(defaultSelectedIndex, 0), maxIndex)
        : maxIndex;
    setSelectedIndex(nextIndex);
  }, [defaultSelectedIndex, selectionFingerprint, normalizedSeries]);

  if (normalizedSeries.length === 0) {
    return <div className="chart-empty">当前没有可展示的趋势数据。</div>;
  }

  const labels = normalizedSeries[0]?.points.map((point) => point.label) ?? [];
  const values = normalizedSeries.flatMap((item) => item.points.map((point) => point.value));
  const maxValue = Math.max(...values, 1);
  const gridTicks = Array.from({ length: 5 }, (_, index) => Math.round((maxValue / 4) * index));
  const labelIndices = pickTickIndices(labels.length, 6);
  const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const resolvedSelectedIndex = Math.min(selectedIndex, Math.max(labels.length - 1, 0));
  const detailItems = normalizedSeries
    .map((item) => {
      const point = item.points[resolvedSelectedIndex];
      if (!point) {
        return null;
      }

      return {
        label: item.label,
        color: item.color,
        value: point.value
      };
    })
    .filter((item): item is { label: string; color: string; value: number } => item !== null);
  const selectedLabel = labels[resolvedSelectedIndex] ?? "";
  const isComparisonChart = detailItems.length > 1;
  const bucketWidth = innerWidth / Math.max(labels.length, 1);
  const groupPadding = Math.min(18, bucketWidth * 0.18);
  const usableGroupWidth = Math.max(bucketWidth - groupPadding * 2, 12);
  const seriesGap =
    normalizedSeries.length > 1 ? Math.min(8, usableGroupWidth * 0.12) : 0;
  const barWidth = Math.max(
    (usableGroupWidth - seriesGap * Math.max(normalizedSeries.length - 1, 0)) /
      Math.max(normalizedSeries.length, 1),
    6
  );

  return (
    <div className="chart-shell">
      <svg
        className="trend-chart"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label="Metric trend chart"
      >
        <rect
          x={PADDING.left}
          y={PADDING.top}
          width={innerWidth}
          height={innerHeight}
          rx="20"
          className="trend-chart-frame"
        />

        {gridTicks.map((tickValue, index) => {
          const y = PADDING.top + innerHeight - (tickValue / Math.max(maxValue, 1)) * innerHeight;
          return (
            <g key={`${tickValue}-${index}`}>
              <line
                x1={PADDING.left}
                x2={CHART_WIDTH - PADDING.right}
                y1={y}
                y2={y}
                className="trend-chart-grid"
              />
              <text x={PADDING.left - 12} y={y + 4} textAnchor="end" className="trend-chart-axis">
                {valueFormatter(tickValue)}
              </text>
            </g>
          );
        })}

        {labels.length > 0 ? (
          <rect
            x={PADDING.left + bucketWidth * resolvedSelectedIndex}
            y={PADDING.top}
            width={bucketWidth}
            height={innerHeight}
            rx="18"
            className="trend-chart-selection-band"
          />
        ) : null}

        {labelIndices.map((labelIndex) => {
          const x = PADDING.left + bucketWidth * labelIndex + bucketWidth / 2;
          return (
            <text
              key={`${labels[labelIndex]}-${labelIndex}`}
              x={x}
              y={CHART_HEIGHT - 18}
              textAnchor="middle"
              className="trend-chart-axis"
            >
              {labels[labelIndex]}
            </text>
          );
        })}

        {normalizedSeries.map((item, seriesIndex) =>
          item.points.map((point, index) => {
            const valueRatio = point.value / Math.max(maxValue, 1);
            const height = point.value > 0 ? Math.max(valueRatio * innerHeight, 4) : 2;
            const x =
              PADDING.left +
              bucketWidth * index +
              groupPadding +
              seriesIndex * (barWidth + seriesGap);
            const y = PADDING.top + innerHeight - height;
            const isSelected = index === resolvedSelectedIndex;

            return (
              <g
                key={`${item.label}-${point.label}`}
                className="trend-chart-bar-button"
                role="button"
                tabIndex={0}
                aria-label={`查看 ${item.label} 在 ${point.label} 的详情`}
                onClick={() => setSelectedIndex(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedIndex(index);
                  }
                }}
              >
                <rect
                  x={PADDING.left + bucketWidth * index}
                  y={PADDING.top}
                  width={bucketWidth}
                  height={innerHeight}
                  className="trend-chart-bar-hitbox"
                />
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  rx="10"
                  fill={item.color}
                  className={isSelected ? "trend-chart-bar is-selected" : "trend-chart-bar"}
                />
              </g>
            );
          })
        )}
      </svg>

      <div className="chart-detail-panel" aria-live="polite">
        <div className="chart-detail-grid">
          <article className="chart-detail-card chart-detail-card-accent">
            <span>时间标签</span>
            <strong>{selectedLabel}</strong>
          </article>
          {detailItems.map((item) => (
            <article key={item.label} className="chart-detail-card">
              <span>{isComparisonChart ? item.label : "当前值"}</span>
              <strong style={{ color: item.color }}>{valueFormatter(item.value)}</strong>
            </article>
          ))}
        </div>
      </div>

      <div className="chart-legend">
        {normalizedSeries.map((item) => (
          <div key={item.label} className="chart-legend-item">
            <span className="chart-legend-swatch" style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
