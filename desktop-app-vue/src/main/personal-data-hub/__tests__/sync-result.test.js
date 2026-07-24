import { describe, expect, it, vi } from "vitest";

const {
  finalizeOneClickSyncReport,
  runDedicatedBatchCollectors,
} = require("../sync-result.js");

describe("desktop PDH one-click sync result", () => {
  it("accepts only successful Registry reports", () => {
    const report = {
      adapter: "social-bilibili",
      status: "ok",
      entityCounts: { events: 1 },
    };
    expect(finalizeOneClickSyncReport(report)).toEqual({ ok: true, report });
  });

  it.each([
    [{ status: "unhealthy", error: "NO_INPUT" }, "NO_INPUT"],
    [{ status: "error", error: "vault failed" }, "vault failed"],
    [null, "registry sync returned status=invalid"],
  ])(
    "surfaces Registry failures through the ADB contract",
    (report, message) => {
      expect(finalizeOneClickSyncReport(report)).toMatchObject({
        ok: false,
        reason: "SYNC_FAILED",
        message,
        report,
      });
    },
  );
});

describe("desktop PDH dedicated batch collectors", () => {
  it("replaces a host-collector skip with its successful report", async () => {
    const report = {
      adapter: "social-bilibili",
      status: "ok",
      rawCount: 2,
      entityCounts: { events: 2 },
    };
    const hub = {
      registry: { onSyncEvent: vi.fn() },
      bilibiliAdbSync: vi.fn().mockResolvedValue({ ok: true, report }),
    };

    const results = await runDedicatedBatchCollectors(hub, [
      {
        adapter: "social-bilibili",
        status: "skipped",
        skipReason: "DEDICATED_COLLECTOR_REQUIRED",
      },
    ]);

    expect(results).toEqual([report]);
    expect(hub.bilibiliAdbSync).toHaveBeenCalledWith({});
  });

  it("returns an explicit error report when a host collector fails", async () => {
    const hub = {
      registry: { onSyncEvent: vi.fn() },
      xhsAdbSync: vi.fn().mockResolvedValue({
        ok: false,
        reason: "XHS_COOKIES_INCOMPLETE",
        message: "login again",
      }),
    };

    const [report] = await runDedicatedBatchCollectors(hub, [
      {
        adapter: "social-xiaohongshu",
        status: "skipped",
        skipReason: "DEDICATED_COLLECTOR_REQUIRED",
      },
    ]);

    expect(report).toMatchObject({
      adapter: "social-xiaohongshu",
      status: "error",
      error: "XHS_COOKIES_INCOMPLETE: login again",
      watermarkDeferred: false,
      checkpointCommitted: false,
      pageBudget: null,
      nextPageBudget: null,
      scanDeferredCount: 0,
      attemptCount: 0,
      retryCount: 0,
      totalRetryDelayMs: 0,
      retryExhausted: false,
      retryAfterMs: null,
      rateLimitReason: null,
      rateLimitRemainingMinute: null,
      rateLimitRemainingDay: null,
      sourceRequestCount: 0,
      sourceRequestThrottleMs: 0,
      sourceRequestRateLimitRemainingMinute: null,
      sourceRequestRateLimitRemainingDay: null,
    });
  });
});
