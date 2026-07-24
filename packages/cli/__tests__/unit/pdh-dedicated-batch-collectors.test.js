import { describe, expect, it, vi } from "vitest";
import { runDedicatedBatchCollectors } from "../../src/lib/pdh-dedicated-batch-collectors.js";

function skipped(adapter = "social-bilibili") {
  return {
    adapter,
    status: "skipped",
    skipReason: "DEDICATED_COLLECTOR_REQUIRED",
    skipMessage: "host collector required",
  };
}

describe("runDedicatedBatchCollectors", () => {
  it("replaces a dedicated skip with the successful collector report", async () => {
    const report = {
      adapter: "social-bilibili",
      status: "ok",
      rawCount: 3,
      entityCounts: { events: 3 },
    };
    const hub = {
      registry: { onSyncEvent: vi.fn() },
      bilibiliAdbSync: vi.fn().mockResolvedValue({ ok: true, report }),
    };

    const results = await runDedicatedBatchCollectors(hub, [
      skipped(),
      { adapter: "local-files", status: "ok" },
    ]);

    expect(results).toEqual([report, { adapter: "local-files", status: "ok" }]);
    expect(hub.bilibiliAdbSync).toHaveBeenCalledWith({});
    expect(hub.registry.onSyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "sync.batch.dedicated.done",
        status: "ok",
      }),
    );
  });

  it("turns an attempted collector failure into an explicit error report", async () => {
    const hub = {
      registry: { onSyncEvent: vi.fn() },
      weiboAdbSync: vi.fn().mockResolvedValue({
        ok: false,
        reason: "WEIBO_COOKIES_INCOMPLETE",
        message: "login again",
      }),
    };

    const [report] = await runDedicatedBatchCollectors(hub, [
      skipped("social-weibo"),
    ]);

    expect(report).toMatchObject({
      adapter: "social-weibo",
      status: "error",
      rawCount: 0,
      error: "WEIBO_COOKIES_INCOMPLETE: login again",
      attemptCount: 0,
      retryCount: 0,
      retryExhausted: false,
      retryAfterMs: null,
      rateLimitReason: null,
    });
    expect(report).not.toHaveProperty("skipReason");
  });

  it("keeps a skip when this host does not expose its collector", async () => {
    const source = skipped("social-bilibili");
    const [report] = await runDedicatedBatchCollectors(
      { registry: { onSyncEvent: vi.fn() } },
      [source],
    );

    expect(report).toBe(source);
  });

  it("does not call collectors for ordinary readiness skips", async () => {
    const collect = vi.fn();
    const source = {
      adapter: "social-bilibili",
      status: "skipped",
      skipReason: "ADB_DEVICE_NEEDED",
    };

    const [report] = await runDedicatedBatchCollectors(
      {
        registry: { onSyncEvent: vi.fn() },
        bilibiliAdbSync: collect,
      },
      [source],
    );

    expect(report).toBe(source);
    expect(collect).not.toHaveBeenCalled();
  });
});
