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
}

const CHART_WIDTH = 920;
const CHART_HEIGHT = 360;
const PADDING = {
  top: 24,
  right: 24,
  bottom: 52,
  left: 72
};

function createLinePath(values: number[], max: number, pointCount: number): string {
  const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  return values
    .map((value, index) => {
      const x = PADDING.left + (innerWidth * index) / Math.max(pointCount - 1, 1);
      const y = PADDING.top + innerHeight - (value / Math.max(max, 1)) * innerHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

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

export function TrendChart({ series, valueFormatter }: TrendChartProps) {
  const normalizedSeries = series.filter((item) => item.points.length > 0);

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

        {labelIndices.map((labelIndex) => {
          const x = PADDING.left + (innerWidth * labelIndex) / Math.max(labels.length - 1, 1);
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

        {normalizedSeries.map((item) => {
          const path = createLinePath(
            item.points.map((point) => point.value),
            maxValue,
            item.points.length
          );

          return (
            <g key={item.label}>
              <path d={path} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" />
              {item.points.map((point, index) => {
                const x = PADDING.left + (innerWidth * index) / Math.max(item.points.length - 1, 1);
                const y =
                  PADDING.top + innerHeight - (point.value / Math.max(maxValue, 1)) * innerHeight;

                return <circle key={`${item.label}-${point.label}`} cx={x} cy={y} r="3.5" fill={item.color} />;
              })}
            </g>
          );
        })}
      </svg>

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
