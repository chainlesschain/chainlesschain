/**
 * calculateNextTrigger — monthly reminder month-end drift regression.
 *
 * Bug: the monthly branch did `nextTime.setMonth(getMonth()+1)` preserving the
 * day, inside a `while (nextTime <= now)` loop that mutates nextTime in place.
 * For a reminder on day 29-31, setMonth overflows (Jan 31 -> Feb 31 -> Mar 3),
 * and because the loop keeps advancing the *overflowed* date, every later month
 * becomes the 3rd — the reminder day permanently drifts (31 -> 3).
 *
 * Fix anchors on the original day-of-month each iteration and clamps to the
 * target month's last day, so the day never drifts.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { calculateNextTrigger } = require("../real-implementations.js");

describe("calculateNextTrigger monthly (month-end, no drift)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a day-31 monthly reminder anchored (no drift to day 3)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 3, 10, 12, 0, 0)); // now = Apr 10 2024
    // Reminder anchored on Jan 31; advance monthly past Feb/Mar to first future.
    const next = new Date(
      calculateNextTrigger("2024-01-31T09:00:00", "monthly"),
    );
    // 旧实现漂移到 5 月 3 日(getMonth 4/getDate 3); 修复后锚定 31 → 4 月裁到 30 日
    expect(next.getMonth()).toBe(3); // April
    expect(next.getDate()).toBe(30); // clamped (April has 30 days)
  });

  it("returns to the anchor day in a long month (Feb clamp -> Mar 31)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 2, 10, 12, 0, 0)); // now = Mar 10 2024
    const next = new Date(
      calculateNextTrigger("2024-01-31T09:00:00", "monthly"),
    );
    expect(next.getMonth()).toBe(2); // March
    expect(next.getDate()).toBe(31); // back to anchor day (March has 31)
  });

  it("is unaffected for a mid-month reminder", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 1, 10, 12, 0, 0)); // now = Feb 10 2024
    const next = new Date(
      calculateNextTrigger("2024-01-15T09:00:00", "monthly"),
    );
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(15);
  });

  it("clamps a Feb-29 yearly reminder to Feb 28 in a non-leap year (no drift to Mar 1)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 15, 12, 0, 0)); // now = Jan 15 2025
    const next = new Date(
      calculateNextTrigger("2024-02-29T09:00:00", "yearly"),
    );
    // 旧实现 setFullYear 溢出到 3/1 (getMonth 2); 修复后裁到 2/28 (getMonth 1)
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(28);
  });
});
