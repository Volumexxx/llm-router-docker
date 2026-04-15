import { afterEach, describe, expect, it } from "vitest";

import { TrendChart } from "./TrendChart.tsx";
import { click, render } from "../test/render.tsx";

describe("TrendChart", () => {
  const activeRenders: Array<{ unmount: () => Promise<void> }> = [];

  afterEach(async () => {
    while (activeRenders.length > 0) {
      const current = activeRenders.pop();
      if (current) {
        await current.unmount();
      }
    }
  });

  it("shows the last point details by default and switches details when a point is clicked", async () => {
    const view = await render(
      <TrendChart
        series={[
          {
            label: "Requests",
            color: "#42f5d7",
            points: [
              { label: "09:00", value: 12 },
              { label: "10:00", value: 18 },
              { label: "11:00", value: 24 }
            ]
          }
        ]}
        valueFormatter={(value) => `${value} req`}
      />
    );
    activeRenders.push(view);

    expect(view.container.textContent).toContain("11:00");
    expect(view.container.textContent).toContain("24 req");

    const pointButtons = view.container.querySelectorAll(".trend-chart-point-button");
    expect(pointButtons).toHaveLength(3);

    await click(pointButtons[0]!);

    expect(view.container.textContent).toContain("09:00");
    expect(view.container.textContent).toContain("12 req");
    expect(view.container.querySelectorAll(".trend-chart-point.is-selected")).toHaveLength(1);
  });

  it("supports selecting a specific bucket by default", async () => {
    const view = await render(
      <TrendChart
        series={[
          {
            label: "Requests",
            color: "#42f5d7",
            points: [
              { label: "00:00", value: 3 },
              { label: "01:00", value: 8 },
              { label: "02:00", value: 13 }
            ]
          }
        ]}
        valueFormatter={(value) => `${value} req`}
        defaultSelectedIndex={1}
      />
    );
    activeRenders.push(view);

    expect(view.container.textContent).toContain("01:00");
    expect(view.container.textContent).toContain("8 req");
  });

  it("shows all series values for the selected bucket in comparison mode", async () => {
    const view = await render(
      <TrendChart
        series={[
          {
            label: "Provider A",
            color: "#42f5d7",
            points: [
              { label: "Mon", value: 30 },
              { label: "Tue", value: 42 },
              { label: "Wed", value: 54 }
            ]
          },
          {
            label: "Provider B",
            color: "#4ea8ff",
            points: [
              { label: "Mon", value: 21 },
              { label: "Tue", value: 33 },
              { label: "Wed", value: 39 }
            ]
          }
        ]}
        valueFormatter={(value) => `${value} tok`}
      />
    );
    activeRenders.push(view);

    expect(view.container.textContent).toContain("Wed");
    expect(view.container.textContent).toContain("54 tok");
    expect(view.container.textContent).toContain("39 tok");
    expect(view.container.querySelectorAll(".trend-chart-point.is-selected")).toHaveLength(2);

    const pointButtons = view.container.querySelectorAll(".trend-chart-point-button");
    await click(pointButtons[0]!);

    expect(view.container.textContent).toContain("Mon");
    expect(view.container.textContent).toContain("30 tok");
    expect(view.container.textContent).toContain("21 tok");
    expect(view.container.querySelectorAll(".trend-chart-point.is-selected")).toHaveLength(2);
  });
});
