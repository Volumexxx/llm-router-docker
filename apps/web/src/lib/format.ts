export function formatNumber(value: number | null | undefined): string {
  if (value == null) {
    return "-";
  }

  return Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2
  }).format(value);
}

export function formatCost(value: number | null | undefined): string {
  if (value == null) {
    return "-";
  }

  return `$${value.toFixed(6)}`;
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value == null) {
    return "-";
  }

  return `${Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits
  }).format(value)}%`;
}

export function formatDuration(value: number | null | undefined): string {
  if (value == null) {
    return "-";
  }

  return `${formatNumber(value)} ms`;
}

export function formatDateTime(value: string, timezone?: string): string {
  return new Date(value).toLocaleString("zh-CN", timezone ? { timeZone: timezone } : undefined);
}

export function formatDate(value: string | Date, timezone?: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts: Partial<Record<"year" | "month" | "day", string>> = {};

  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date)) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      parts[part.type] = part.value;
    }
  }

  return `${parts.year ?? "0000"}-${parts.month ?? "01"}-${parts.day ?? "01"}`;
}
