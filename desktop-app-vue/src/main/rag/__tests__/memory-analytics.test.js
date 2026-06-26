// @vitest-environment node

/**
 * MemoryAnalytics — unit tests
 *
 * Focused on _aggregateByWeek's robustness to corrupt date rows. The
 * daily_notes_metadata.date column is a free TEXT field with no CHECK, so a
 * single blank/malformed value used to make toISOString() throw a RangeError
 * that aborted the whole weekly aggregation — and getTrends's outer try/catch
 * then silently dropped the daily + search trends too.
 */

import { describe, it, expect } from "vitest";
import { vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { MemoryAnalytics } = require("../memory-analytics.js");

describe("MemoryAnalytics._aggregateByWeek", () => {
  // _aggregateByWeek is a pure method (never touches this.db); a stub DB just
  // satisfies the constructor's required-param guard.
  const analytics = new MemoryAnalytics({ database: {} });

  it("skips invalid/blank date rows instead of throwing, aggregating only valid ones", () => {
    const dailyData = [
      { date: "2026-02-02", word_count: 100, conversation_count: 2 },
      { date: "", word_count: 999 }, // blank → Invalid Date (used to throw)
      { date: "not-a-date", word_count: 999 }, // malformed → Invalid Date
      { word_count: 999 }, // undefined date → Invalid Date
      { date: "2026-02-03", word_count: 50, conversation_count: 1 },
    ];

    let result;
    expect(() => {
      result = analytics._aggregateByWeek(dailyData);
    }).not.toThrow();

    // Robust to week-boundary placement: assert totals across all buckets.
    const totalWords = result.wordCount.reduce((a, b) => a + b, 0);
    const totalConversations = result.conversationCount.reduce(
      (a, b) => a + b,
      0,
    );
    const totalDaysActive = result.daysActive.reduce((a, b) => a + b, 0);

    // Only the two valid rows count — the three 999-word invalid rows are skipped.
    expect(totalWords).toBe(150);
    expect(totalConversations).toBe(3);
    expect(totalDaysActive).toBe(2);
  });

  it("returns empty aggregation for empty input", () => {
    const result = analytics._aggregateByWeek([]);
    expect(result.labels).toEqual([]);
    expect(result.wordCount).toEqual([]);
  });
});
