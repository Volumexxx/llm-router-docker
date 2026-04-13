export function Sparkline({ points }: { points: { label: string; requests: number }[] }) {
  const max = Math.max(...points.map((point) => point.requests), 1);
  const width = 240;
  const height = 64;

  const path = points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - (point.requests / max) * (height - 8) - 4;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sparkline" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
