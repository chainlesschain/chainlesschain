/**
 * ExtendedTools._addTime — month add/subtract clamps to month-end.
 *
 * Bug: the "month" branch did `result.setMonth(getMonth() + amount)` preserving
 * the day, so adding/subtracting months across a month-end overflowed
 * (Jan 31 + 1 month -> Feb 31 -> Mar 3) instead of clamping to Feb 28/29 like
 * every standard date library (date-fns/moment). Powers the user-facing date
 * add/subtract operations.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

const ExtendedTools = require("../../../src/main/ai-engine/extended-tools.js");

const ymd = (d) => [d.getFullYear(), d.getMonth(), d.getDate()];

describe("ExtendedTools._addTime month-end clamp", () => {
  it("clamps Jan 31 + 1 month to Feb 29 (leap), not Mar 3", () => {
    const r = ExtendedTools._addTime(new Date(2024, 0, 31), 1, "month");
    expect(ymd(r)).toEqual([2024, 1, 29]); // Feb 29
  });

  it("clamps Jan 31 + 1 month to Feb 28 (non-leap)", () => {
    const r = ExtendedTools._addTime(new Date(2023, 0, 31), 1, "month");
    expect(ymd(r)).toEqual([2023, 1, 28]); // Feb 28
  });

  it("clamps Mar 31 - 1 month to Feb 29 (subtract)", () => {
    const r = ExtendedTools._addTime(new Date(2024, 2, 31), -1, "month");
    expect(ymd(r)).toEqual([2024, 1, 29]); // Feb 29
  });

  it("clamps Mar 31 + 1 month to Apr 30", () => {
    const r = ExtendedTools._addTime(new Date(2024, 2, 31), 1, "month");
    expect(ymd(r)).toEqual([2024, 3, 30]); // Apr 30
  });

  it("keeps the day for a mid-month date", () => {
    const r = ExtendedTools._addTime(new Date(2024, 0, 15), 1, "month");
    expect(ymd(r)).toEqual([2024, 1, 15]); // Feb 15
  });

  it("clamps Feb 29 + 1 year to Feb 28 (non-leap), not Mar 1", () => {
    const r = ExtendedTools._addTime(new Date(2024, 1, 29), 1, "year");
    expect(ymd(r)).toEqual([2025, 1, 28]); // Feb 28 2025
  });

  it("returns to Feb 29 when the target year is a leap year (+4)", () => {
    const r = ExtendedTools._addTime(new Date(2024, 1, 29), 4, "year");
    expect(ymd(r)).toEqual([2028, 1, 29]); // Feb 29 2028
  });

  it("leaves a non-leap-day year add unchanged", () => {
    const r = ExtendedTools._addTime(new Date(2024, 0, 31), 1, "year");
    expect(ymd(r)).toEqual([2025, 0, 31]); // Jan 31 2025
  });
});
