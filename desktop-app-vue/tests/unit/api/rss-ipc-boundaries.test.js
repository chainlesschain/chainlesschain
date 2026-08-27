import { describe, expect, it } from "vitest";
const {
  HARD_RSS_IPC_LIMITS,
  RSSIPCBoundaryError,
  assertBoundedString,
  boundedQueryLimit,
  boundedQueryOffset,
  createRSSIPCLimits,
  normalizeFeedUpdates,
} = require("../../../src/main/api/rss-ipc-boundaries.js");

describe("RSS IPC boundaries", () => {
  it("clamps hostile numeric configuration to immutable hard limits", () => {
    const limits = createRSSIPCLimits(
      Object.fromEntries(
        Object.keys(HARD_RSS_IPC_LIMITS).map((key) => [
          key,
          Number.MAX_SAFE_INTEGER,
        ]),
      ),
    );

    expect(limits).toEqual(HARD_RSS_IPC_LIMITS);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it("bounds query windows and rejects oversized identifiers", () => {
    expect(boundedQueryLimit(Infinity, 20, 100)).toBe(20);
    expect(boundedQueryLimit(1000, 20, 100)).toBe(100);
    expect(boundedQueryOffset(-1, 1000)).toBe(0);
    expect(boundedQueryOffset(5000, 1000)).toBe(1000);
    expect(() => assertBoundedString("x".repeat(9), "rss_id", 8)).toThrow(
      RSSIPCBoundaryError,
    );
  });

  it("allows only fixed update columns and normalizes sync frequency", () => {
    const limits = createRSSIPCLimits();
    const normalized = normalizeFeedUpdates(
      { category: null, update_frequency: 1, status: "active" },
      limits,
      () => true,
    );

    expect(normalized).toEqual([
      ["category", null],
      ["update_frequency", limits.minSyncSeconds],
      ["status", "active"],
    ]);
    let boundaryError;
    try {
      normalizeFeedUpdates({ "title = NULL --": "bad" }, limits, () => true);
    } catch (error) {
      boundaryError = error;
    }
    expect(boundaryError).toMatchObject({
      code: "INVALID_ARGUMENT",
      scope: "rss_feed_update_field",
    });
  });
});
