import { describe, expect, it } from "vitest";

const {
  HARD_RSS_FETCHER_LIMITS,
  createRSSFetcherLimits,
  truncateUtf8,
} = require("../../../src/main/api/rss-fetcher-boundaries.js");

describe("RSS fetcher limit contract", () => {
  it("clamps every configurable value at its hard ceiling", () => {
    const limits = createRSSFetcherLimits(
      Object.fromEntries(
        Object.keys(HARD_RSS_FETCHER_LIMITS).map((key) => [
          key,
          Number.MAX_SAFE_INTEGER,
        ]),
      ),
    );

    expect(limits).toEqual(HARD_RSS_FETCHER_LIMITS);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it("keeps dependent byte budgets internally consistent", () => {
    const limits = createRSSFetcherLimits({
      maxCacheBytes: 1,
      maxFeedBytes: 1,
      maxBatchRetainedBytes: 1,
      maxTextBytes: 32,
      maxUrlBytes: 128,
    });

    expect(limits.maxCacheBytes).toBeGreaterThan(limits.maxFeedBytes);
    expect(limits.maxBatchRetainedBytes).toBeGreaterThanOrEqual(
      limits.maxFeedBytes,
    );
  });

  it("truncates without emitting broken UTF-8", () => {
    const value = truncateUtf8("😀😀😀", 9);

    expect(value).toBe("😀😀");
    expect(Buffer.byteLength(value, "utf8")).toBeLessThanOrEqual(9);
    expect(value).not.toContain("�");
  });
});
