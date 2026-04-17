import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { click, getButtonByText, getButtonsByText, render } from "../test/render.tsx";
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

  function buildDashboard(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      range: "day" as const,
      windowStart: "2026-04-14T16:00:00.000Z",
      windowEnd: "2026-04-15T15:59:59.999Z",
      timezone: "Asia/Shanghai",
      anchorDate: "2026-04-15",
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
      apiKeyCards: [],
      ...overrides
    };
  }

  afterEach(async () => {
    vi.useRealTimers();
    trendChartSpy.mockReset();

    while (activeRenders.length > 0) {
      const current = activeRenders.pop();
      if (current) {
        await current.unmount();
      }
    }
  });

  it("renders window boundaries using dashboard timezone and forwards current bucket selection", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T03:22:03.000Z"));
    const dashboard = buildDashboard();

    const view = await render(
      <DashboardPage
        dashboard={dashboard}
        range="day"
        setRange={() => undefined}
        setDayDate={() => undefined}
      />
    );
    activeRenders.push(view);

    expect(view.container.textContent).toContain("2026/4/15 00:00:00");
    expect(view.container.textContent).toContain("2026/4/15 23:59:59");
    expect(getButtonsByText(view.container, "今天")).toHaveLength(0);
    expect(getButtonByText(view.container, "日期")).toBeTruthy();

    const metricButtons = view.container.querySelectorAll(".table-value-button");
    expect(metricButtons.length).toBeGreaterThan(0);

    await click(metricButtons[0]!);

    expect(trendChartSpy).toHaveBeenCalled();
    expect(trendChartSpy.mock.calls.at(-1)?.[0]?.defaultSelectedIndex).toBe(11);
  });

  it("shows day-only date controls and lets users jump between historical dates and today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T03:22:03.000Z"));
    const setDayDate = vi.fn();
    const historicalDashboard = buildDashboard({
      anchorDate: "2026-04-14",
      currentBucketIndex: 23,
      windowStart: "2026-04-13T16:00:00.000Z",
      windowEnd: "2026-04-14T15:59:59.999Z"
    });
    const view = await render(
      <DashboardPage
        dashboard={historicalDashboard}
        range="day"
        setRange={() => undefined}
        setDayDate={setDayDate}
      />
    );
    activeRenders.push(view);

    const dateInput = view.container.querySelector('input[type="date"]');
    expect(dateInput).toBeInstanceOf(HTMLInputElement);

    const showPickerSpy = vi.fn();
    Object.defineProperty(dateInput as HTMLInputElement, "showPicker", {
      configurable: true,
      value: showPickerSpy
    });

    await click(getButtonByText(view.container, "日期"));
    expect(showPickerSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(dateInput, "2026-04-13");
      (dateInput as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true }));
      (dateInput as HTMLInputElement).dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(setDayDate).toHaveBeenCalledWith("2026-04-13");

    await click(getButtonByText(view.container, "今天"));
    expect(setDayDate).toHaveBeenCalledWith("2026-04-15");

    const metricButtons = view.container.querySelectorAll(".table-value-button");
    await click(metricButtons[0]!);
    expect(trendChartSpy.mock.calls.at(-1)?.[0]?.defaultSelectedIndex).toBe(23);

    await view.rerender(
      <DashboardPage
        dashboard={buildDashboard()}
        range="day"
        setRange={() => undefined}
        setDayDate={setDayDate}
      />
    );

    expect(getButtonsByText(view.container, "今天")).toHaveLength(0);
  });

  it("only renders date controls in the day range", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T03:22:03.000Z"));
    const view = await render(
      <DashboardPage
        dashboard={buildDashboard({
          range: "week",
          currentBucketIndex: 2
        })}
        range="week"
        setRange={() => undefined}
        setDayDate={() => undefined}
      />
    );
    activeRenders.push(view);

    expect(getButtonsByText(view.container, "日期")).toHaveLength(0);
    expect(getButtonsByText(view.container, "今天")).toHaveLength(0);
    expect(view.container.querySelector('input[type="date"]')).toBeNull();
  });
});
