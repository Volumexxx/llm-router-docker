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
      userCards: [],
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

  function buildProviders() {
    return [
      {
        id: "provider-a",
        name: "Provider A",
        enabled: true,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
        openaiConfig: null,
        anthropicConfig: null
      },
      {
        id: "provider-b",
        name: "Provider B",
        enabled: true,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
        openaiConfig: null,
        anthropicConfig: null
      }
    ];
  }

  function buildModels() {
    return [
      {
        id: "model-a",
        alias: "gpt-4o-mini",
        displayName: "GPT 4o Mini",
        enabled: true,
        bindings: {
          openai: [],
          anthropic: []
        }
      },
      {
        id: "model-b",
        alias: "claude-sonnet",
        displayName: "claude-sonnet",
        enabled: true,
        bindings: {
          openai: [],
          anthropic: []
        }
      }
    ];
  }

  function buildApiKeys() {
    return [
      {
        id: "key-a",
        name: "mobile-client",
        maskedPreview: "lrk***123",
        enabled: true,
        deletedAt: null,
        lastUsedAt: null,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
        allowedProviderIds: [],
        allowedModelAliasIds: [],
        allProvidersAllowed: true,
        allModelsAllowed: true
      },
      {
        id: "key-b",
        name: "batch-client",
        maskedPreview: "lrk***456",
        enabled: false,
        deletedAt: "2026-04-20T00:00:00.000Z",
        lastUsedAt: null,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
        allowedProviderIds: [],
        allowedModelAliasIds: [],
        allProvidersAllowed: true,
        allModelsAllowed: true
      }
    ];
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

  it("renders window boundaries using dashboard timezone and keeps day controls in a secondary row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T03:22:03.000Z"));
    const dashboard = buildDashboard();

    const view = await render(
      <DashboardPage
        dashboard={dashboard}
        providers={buildProviders()}
        models={buildModels()}
        apiKeys={buildApiKeys()}
        dashboardFilters={{ providerId: "", modelAlias: "", apiKeyId: "" }}
        applyDashboardFilters={() => undefined}
        clearDashboardFilters={() => undefined}
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
    expect(view.container.querySelector(".dashboard-range-controls")?.textContent).toContain("Day");
    expect(view.container.querySelector(".dashboard-range-controls")?.textContent).toContain("Week");
    expect(view.container.querySelector(".dashboard-range-controls")?.textContent).toContain("Month");
    expect(view.container.querySelector(".dashboard-range-controls")?.textContent).not.toContain("日期");
    expect(view.container.querySelector(".dashboard-day-subrow")?.textContent).toContain("日期");

    const metricButtons = view.container.querySelectorAll(".table-value-button");
    expect(metricButtons.length).toBeGreaterThan(0);

    await click(metricButtons[0]!);

    expect(trendChartSpy).toHaveBeenCalled();
    expect(trendChartSpy.mock.calls.at(-1)?.[0]?.defaultSelectedIndex).toBe(11);
  });

  it("shows day-only date controls in a secondary row and lets users jump between historical dates and today", async () => {
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
        providers={buildProviders()}
        models={buildModels()}
        apiKeys={buildApiKeys()}
        dashboardFilters={{ providerId: "", modelAlias: "", apiKeyId: "" }}
        applyDashboardFilters={() => undefined}
        clearDashboardFilters={() => undefined}
        range="day"
        setRange={() => undefined}
        setDayDate={setDayDate}
      />
    );
    activeRenders.push(view);

    const rangeControls = view.container.querySelector(".dashboard-range-controls");
    const daySubrow = view.container.querySelector(".dashboard-day-subrow");
    const dateInput = view.container.querySelector('input[type="date"]');
    expect(rangeControls).not.toBeNull();
    expect(daySubrow).not.toBeNull();
    expect(dateInput).toBeInstanceOf(HTMLInputElement);
    expect(rangeControls?.contains(dateInput)).toBe(false);
    expect(daySubrow?.contains(dateInput)).toBe(true);

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
        providers={buildProviders()}
        models={buildModels()}
        apiKeys={buildApiKeys()}
        dashboardFilters={{ providerId: "", modelAlias: "", apiKeyId: "" }}
        applyDashboardFilters={() => undefined}
        clearDashboardFilters={() => undefined}
        range="day"
        setRange={() => undefined}
        setDayDate={setDayDate}
      />
    );

    expect(getButtonsByText(view.container, "今天")).toHaveLength(0);
  });

  it("only renders the secondary day controls in the day range", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T03:22:03.000Z"));
    const view = await render(
      <DashboardPage
        dashboard={buildDashboard({
          range: "week",
          currentBucketIndex: 2
        })}
        providers={buildProviders()}
        models={buildModels()}
        apiKeys={buildApiKeys()}
        dashboardFilters={{ providerId: "", modelAlias: "", apiKeyId: "" }}
        applyDashboardFilters={() => undefined}
        clearDashboardFilters={() => undefined}
        range="week"
        setRange={() => undefined}
        setDayDate={() => undefined}
      />
    );
    activeRenders.push(view);

    expect(getButtonsByText(view.container, "日期")).toHaveLength(0);
    expect(getButtonsByText(view.container, "今天")).toHaveLength(0);
    expect(view.container.querySelector('input[type="date"]')).toBeNull();
    expect(view.container.querySelector(".dashboard-day-subrow")).toBeNull();
  });

  it("renders provider/model/key filters with all options and applies the selected filter values", async () => {
    const applyDashboardFilters = vi.fn();
    const view = await render(
      <DashboardPage
        dashboard={buildDashboard()}
        providers={buildProviders()}
        models={buildModels()}
        apiKeys={buildApiKeys()}
        dashboardFilters={{ providerId: "", modelAlias: "", apiKeyId: "" }}
        applyDashboardFilters={applyDashboardFilters}
        clearDashboardFilters={() => undefined}
        range="day"
        setRange={() => undefined}
        setDayDate={() => undefined}
      />
    );
    activeRenders.push(view);

    const providerSelect = view.container.querySelector(
      'select[aria-label="Dashboard provider filter"]'
    ) as HTMLSelectElement | null;
    const modelSelect = view.container.querySelector(
      'select[aria-label="Dashboard model filter"]'
    ) as HTMLSelectElement | null;
    const apiKeySelect = view.container.querySelector(
      'select[aria-label="Dashboard api key filter"]'
    ) as HTMLSelectElement | null;

    expect(providerSelect?.options[0]?.textContent).toBe("全部");
    expect(modelSelect?.options[0]?.textContent).toBe("全部");
    expect(apiKeySelect?.options[0]?.textContent).toBe("全部");

    await act(async () => {
      providerSelect!.value = "provider-b";
      providerSelect!.dispatchEvent(new Event("change", { bubbles: true }));
      modelSelect!.value = "claude-sonnet";
      modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
      apiKeySelect!.value = "key-b";
      apiKeySelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await click(getButtonByText(view.container, "Apply Filters"));

    expect(applyDashboardFilters).toHaveBeenCalledWith({
      providerId: "provider-b",
      modelAlias: "claude-sonnet",
      apiKeyId: "key-b",
      userId: ""
    });
  });

  it("clears filters and keeps applied filter values selected across rerenders", async () => {
    const clearDashboardFilters = vi.fn();
    const appliedFilters = {
      providerId: "provider-a",
      modelAlias: "gpt-4o-mini",
      apiKeyId: "key-a"
    };
    const view = await render(
      <DashboardPage
        dashboard={buildDashboard()}
        providers={buildProviders()}
        models={buildModels()}
        apiKeys={buildApiKeys()}
        dashboardFilters={appliedFilters}
        applyDashboardFilters={() => undefined}
        clearDashboardFilters={clearDashboardFilters}
        range="day"
        setRange={() => undefined}
        setDayDate={() => undefined}
      />
    );
    activeRenders.push(view);

    const providerSelect = view.container.querySelector(
      'select[aria-label="Dashboard provider filter"]'
    ) as HTMLSelectElement | null;
    const modelSelect = view.container.querySelector(
      'select[aria-label="Dashboard model filter"]'
    ) as HTMLSelectElement | null;
    const apiKeySelect = view.container.querySelector(
      'select[aria-label="Dashboard api key filter"]'
    ) as HTMLSelectElement | null;

    expect(providerSelect?.value).toBe("provider-a");
    expect(modelSelect?.value).toBe("gpt-4o-mini");
    expect(apiKeySelect?.value).toBe("key-a");

    await view.rerender(
      <DashboardPage
        dashboard={buildDashboard({
          anchorDate: "2026-04-14"
        })}
        providers={buildProviders()}
        models={buildModels()}
        apiKeys={buildApiKeys()}
        dashboardFilters={appliedFilters}
        applyDashboardFilters={() => undefined}
        clearDashboardFilters={clearDashboardFilters}
        range="day"
        setRange={() => undefined}
        setDayDate={() => undefined}
      />
    );

    expect(providerSelect?.value).toBe("provider-a");
    expect(modelSelect?.value).toBe("gpt-4o-mini");
    expect(apiKeySelect?.value).toBe("key-a");

    await click(getButtonByText(view.container, "Clear Filters"));
    expect(clearDashboardFilters).toHaveBeenCalledTimes(1);
  });
});
