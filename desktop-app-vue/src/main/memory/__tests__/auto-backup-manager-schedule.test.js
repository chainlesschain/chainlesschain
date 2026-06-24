/**
 * AutoBackupManager._calculateNextRun — monthly month-end regression.
 *
 * Bug: the monthly branch did `next.setMonth(next.getMonth() + 1)` before
 * setting day_of_month. When "now" lands on a day the *next* month doesn't have
 * (29-31), setMonth overflows — Jan 31 -> Feb 31 -> Mar 3 — so the month silently
 * jumps two forward and the next backup was scheduled in March instead of
 * February (a whole month skipped). Fix sets the day to 1 before advancing.
 *
 * _calculateNextRun reads no `this` state (only the schedule arg + new Date()),
 * so we invoke it via the prototype with a dummy `this` — no DB/fs construction.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { AutoBackupManager } = require("../auto-backup-manager.js");

const calcNextRun = (schedule) =>
  AutoBackupManager.prototype._calculateNextRun.call({}, schedule);

describe("AutoBackupManager._calculateNextRun monthly (month-end)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances to the immediately-following month even when today is the 31st", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 31, 12, 0, 0)); // Jan 31 2024
    const next = new Date(
      calcNextRun({ frequency: "monthly", day_of_month: 15, hour: 3 }),
    );
    // 旧实现 setMonth 溢出 -> 3 月(getMonth()===2); 修复后应为 2 月(===1)
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(15);
  });

  it("handles day-30 month-ends (Jan 30 -> Feb, not Mar)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 30, 12, 0, 0)); // Jan 30 2024
    const next = new Date(
      calcNextRun({ frequency: "monthly", day_of_month: 1, hour: 3 }),
    );
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(1);
  });

  it("is unaffected for a mid-month current date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 12, 0, 0)); // Jan 15 2024
    const next = new Date(
      calcNextRun({ frequency: "monthly", day_of_month: 15, hour: 3 }),
    );
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(15);
  });
});
