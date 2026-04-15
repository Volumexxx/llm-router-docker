import { afterEach, describe, expect, it, vi } from "vitest";

import { click, render } from "../test/render.tsx";
import { DashboardPage } from "./DashboardPage.tsx";

const trendChartSpy = vi.fn();

vi.mock("../components/TrendChart.tsx", () => ({
  TrendChart: (props: {
    defaultSelectedIndex?: number;
    series: Array<{ label: string; points: Array<{ label: string; value: number }> }>;
  }) => {
    trendChartSpy(props);
    return <div data-testid="trend-chart-mock">trend-chart</div>;
  }
}));

describe("DashboardPage", () => {
  const activeRenders: Array<{ unmount: () => Promise<void> }> = [];

  afterEach(async () => {
    trendChartSpy.mockReset();

    while (activeRenders.length > 0) {
      const current = activeRenders.pop();
      if (current) {
        await current.unmount();
      }
    }
  });

  it("renders window boundaries using dashboard timezone and forwards current bucket selection", async () => {
    const dashboard = {
      range: "day" as const,
      windowStart: "2026-04-14T16:00:00.000Z",
      windowEnd: "2026-04-15T15:59:59.999Z",
      timezone: "Asia/Shanghai",
      currentBucketIndex: 11,
      overall: {
        requests: 1,
        successes: 1,
        failures: 0,
        errorRate: 0,
        inputTokens: 12,
        outputTokens: 4,
        cacheTokens: 0,
        totalTokens: 16,
        estimatedCost: 0,
        averageLatencyMs: 120,
        p50LatencyMs: 120,
        p95LatencyMs: 120,
        missingUsageCount: 0
      },
      trend: [
        {
          label: "00:00",
          requests: 0,
          successes: 0,
          failures: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
          averageLatencyMs: 0,
          p95LatencyMs: 0
        }
      ],
      providerCards: [
        {
          key: "provider-a",
          label: "Provider A",
          requests: 1,
          successes: 1,
          failures: 0,
          inputTokens: 12,
          outputTokens: 4,
          cacheTokens: 0,
          totalTokens: 16,
          estimatedCost: 0,
          averageLatencyMs: 120,
          p95LatencyMs: 120,
          trend: [
            {
              label: "00:00",
              requests: 1,
              successes: 1,
              failures: 0,
              inputTokens: 12,
              outputTokens: 4,
              cacheTokens: 0,
              totalTokens: 16,
              estimatedCost: 0,
              averageLatencyMs: 120,
              p95LatencyMs: 120
            }
          ]
        }
      ],
      modelCards: [],
      apiKeyCards: []
    };

    const view = await render(
      <DashboardPage dashboard={dashboard} range="day" setRange={() => undefined} />
    );
    activeRenders.push(view);

    expect(view.container.textContent).toContain("2026/4/15 00:00:00");
    expect(view.container.textContent).toContain("2026/4/15 23:59:59");

    const metricButtons = view.container.querySelectorAll(".table-value-button");
    expect(metricButtons.length).toBeGreaterThan(0);

    await click(metricButtons[0]!);

    expect(trendChartSpy).toHaveBeenCalled();
    expect(trendChartSpy.mock.calls.at(-1)?.[0]?.defaultSelectedIndex).toBe(11);
  });
});
