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

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN");
}
