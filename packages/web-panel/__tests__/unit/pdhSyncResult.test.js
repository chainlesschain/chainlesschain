import { describe, expect, it } from "vitest";
import {
  analyzeSyncReport,
  analyzeSyncReports,
  selectImportantSyncReport,
  syncEntityTotal,
} from "../../src/utils/pdhSyncResult.js";

function report(overrides = {}) {
  return {
    adapter: "source-a",
    status: "ok",
    rawCount: 2,
    invalidCount: 0,
    entityCounts: {
      events: 1,
      persons: 1,
      places: 0,
      items: 0,
      topics: 0,
    },
    error: null,
    ...overrides,
  };
}

describe("pdhSyncResult", () => {
  it("counts every UnifiedSchema entity kind", () => {
    expect(
      syncEntityTotal(
        report({
          entityCounts: {
            events: 1,
            persons: 2,
            places: 3,
            items: 4,
            topics: 5,
          },
        }),
      ),
    ).toBe(15);
  });

  it("classifies a normal report as success", () => {
    expect(analyzeSyncReport(report())).toMatchObject({
      kind: "success",
      level: "success",
      completed: true,
      total: 2,
    });
  });

  it("treats unhealthy/error reports as failures even when no exception was thrown", () => {
    expect(
      analyzeSyncReport(
        report({
          status: "unhealthy",
          rawCount: 0,
          entityCounts: {},
          error: "DB_NOT_PULLED",
        }),
      ),
    ).toMatchObject({
      kind: "failed",
      completed: false,
      error: "DB_NOT_PULLED",
    });
    expect(
      analyzeSyncReport(report({ status: "error", error: "parse failed" })),
    ).toMatchObject({ kind: "failed", error: "parse failed" });
  });

  it("rejects a progress envelope masquerading as a final report", () => {
    expect(analyzeSyncReport({ phase: "fetching", current: 1 })).toMatchObject({
      kind: "failed",
      status: "invalid",
      completed: false,
    });
  });

  it("distinguishes empty and partially invalid successful runs", () => {
    expect(
      analyzeSyncReport(
        report({
          rawCount: 0,
          entityCounts: {},
        }),
      ).kind,
    ).toBe("empty");
    expect(
      analyzeSyncReport(
        report({
          rawCount: 3,
          invalidCount: 2,
          entityCounts: { events: 1 },
        }),
      ),
    ).toMatchObject({ kind: "partial", total: 1, invalidCount: 2 });
  });

  it("treats an incomplete pagination checkpoint as partial", () => {
    expect(
      analyzeSyncReport(
        report({
          watermarkDeferred: true,
          pageBudget: 10,
          nextPageBudget: 20,
          scanDeferredCount: 1,
          watermarkLookbackMs: 86_400_000,
          collectionSinceWatermark: "1700000000000",
        }),
      ),
    ).toMatchObject({
      kind: "partial",
      level: "warning",
      completed: true,
      watermarkDeferred: true,
      pageBudget: 10,
      nextPageBudget: 20,
      scanDeferredCount: 1,
      watermarkLookbackMs: 86_400_000,
      collectionSinceWatermark: "1700000000000",
      total: 2,
    });
  });

  it("preserves retry recovery and persistent rate-limit metadata", () => {
    expect(
      analyzeSyncReport(
        report({
          attemptCount: 3,
          retryCount: 2,
          totalRetryDelayMs: 1500,
          retryExhausted: false,
          sourceRequestCount: 4,
          sourceRequestThrottleMs: 20_000,
          sourceRequestRateLimitRemainingMinute: 2,
          sourceRequestRateLimitRemainingDay: 196,
        }),
      ),
    ).toMatchObject({
      kind: "success",
      attemptCount: 3,
      retryCount: 2,
      totalRetryDelayMs: 1500,
      retryExhausted: false,
      sourceRequestCount: 4,
      sourceRequestThrottleMs: 20_000,
      sourceRequestRateLimitRemainingMinute: 2,
      sourceRequestRateLimitRemainingDay: 196,
    });

    expect(
      analyzeSyncReport(
        report({
          status: "rate_limited",
          rawCount: 0,
          entityCounts: {},
          error: "retry later",
          retryAfterMs: 45_000,
          rateLimitReason: "per_minute",
          rateLimitRemainingMinute: 0,
          rateLimitRemainingDay: 12,
        }),
      ),
    ).toMatchObject({
      kind: "failed",
      retryAfterMs: 45_000,
      rateLimitReason: "per_minute",
      rateLimitRemainingMinute: 0,
      rateLimitRemainingDay: 12,
    });
  });

  it("surfaces raw archive durability failures without treating them as complete", () => {
    expect(
      analyzeSyncReport(
        report({
          status: "error",
          rawCount: 5,
          archivedRawCount: 4,
          archiveFailureCount: 1,
          checkpointCommitted: false,
          error: "raw archive incomplete",
        }),
      ),
    ).toMatchObject({
      kind: "failed",
      completed: false,
      rawCount: 5,
      archivedRawCount: 4,
      archiveFailureCount: 1,
      checkpointCommitted: false,
      error: "raw archive incomplete",
    });
  });

  it("treats readiness-aware skips as informational rather than failed syncs", () => {
    const skipped = report({
      adapter: "needs-file",
      status: "skipped",
      rawCount: 0,
      entityCounts: {},
      skipReason: "NO_INPUT",
      skipMessage: "需要选择快照文件",
    });
    expect(analyzeSyncReport(skipped)).toMatchObject({
      kind: "skipped",
      level: "info",
      completed: true,
      skipReason: "NO_INPUT",
      error: null,
    });
    expect(analyzeSyncReports([skipped])).toMatchObject({
      level: "info",
      completed: true,
      skipped: 1,
      failed: 0,
    });
    expect(selectImportantSyncReport([skipped])).toBe(skipped);
  });

  it("summarizes sync-all without hiding failed adapters", () => {
    const reports = [
      report({ adapter: "ok" }),
      report({ adapter: "empty", rawCount: 0, entityCounts: {} }),
      report({
        adapter: "skipped",
        status: "skipped",
        rawCount: 0,
        entityCounts: {},
        skipReason: "NO_INPUT",
      }),
      report({
        adapter: "bad",
        status: "unhealthy",
        rawCount: 0,
        entityCounts: {},
        error: "NO_INPUT",
      }),
    ];
    expect(analyzeSyncReports(reports)).toMatchObject({
      level: "warning",
      completed: false,
      totalReports: 4,
      success: 1,
      empty: 1,
      skipped: 1,
      failed: 1,
    });
    expect(selectImportantSyncReport(reports).adapter).toBe("bad");
  });
});
