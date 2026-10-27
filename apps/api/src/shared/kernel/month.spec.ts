import { describe, expect, it } from "vitest";

import { currentMonth, monthRange } from "./month.js";

describe("budget months (India time)", () => {
  it("roll over at midnight IST, not UTC", () => {
    expect(currentMonth(new Date("2026-10-31T18:29:59Z"))).toBe("2026-10");
    expect(currentMonth(new Date("2026-10-31T18:30:00Z"))).toBe("2026-11");
  });

  it("span from the 1st to the next 1st, across the year end too", () => {
    expect(monthRange("2026-12")).toEqual({
      start: new Date("2026-11-30T18:30:00Z"),
      end: new Date("2026-12-31T18:30:00Z"),
    });
  });
});
