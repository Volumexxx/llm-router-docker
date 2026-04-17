import { describe, expect, it } from "vitest";

import { formatDate } from "./format.ts";

describe("formatDate", () => {
  it("formats a timestamp into YYYY-MM-DD for the requested timezone", () => {
    expect(formatDate("2026-04-14T15:59:59.999Z", "Asia/Shanghai")).toBe("2026-04-14");
    expect(formatDate("2026-04-14T16:00:00.000Z", "Asia/Shanghai")).toBe("2026-04-15");
  });

  it("keeps month and day boundaries stable for Date inputs", () => {
    expect(formatDate(new Date("2026-04-30T15:59:59.999Z"), "Asia/Shanghai")).toBe("2026-04-30");
    expect(formatDate(new Date("2026-04-30T16:00:00.000Z"), "Asia/Shanghai")).toBe("2026-05-01");
    expect(formatDate(new Date("2026-04-30T23:59:59.999Z"), "UTC")).toBe("2026-04-30");
  });
});
