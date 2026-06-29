/**
 * WebhookManager — delivery-counter persistence tests
 *
 * Regression for: _deliver() incremented deliveryCount / lastDelivery /
 * failCount in memory only, so _loadWebhooksFromDB reverted them to stale DB
 * values on the next restart (listWebhooks reports those counters).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { WebhookManager } = require("../webhook-manager");

function createMockDatabase() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prep),
    _prep: prep,
  };
}

describe("WebhookManager — delivery counter persistence", () => {
  let mgr;
  let db;

  beforeEach(() => {
    db = createMockDatabase();
    mgr = new WebhookManager({ db });
  });

  it("persists deliveryCount after a successful delivery", async () => {
    const wh = mgr.registerWebhook({
      url: "https://example.com/hook",
      events: ["evt"],
    });
    const persistSpy = vi.spyOn(mgr, "_persistWebhook");
    vi.spyOn(mgr, "_httpPost").mockResolvedValue({ statusCode: 200 });

    await mgr._deliver(wh, "evt", { foo: 1 });

    expect(wh.deliveryCount).toBe(1);
    // Without this the counter is memory-only → reverts on _loadWebhooksFromDB.
    expect(persistSpy).toHaveBeenCalledWith(wh);
  });

  it("persists failCount after retries are exhausted", async () => {
    const wh = mgr.registerWebhook({
      url: "https://example.com/hook",
      events: ["evt"],
    });
    mgr.config.maxRetries = 0; // give up immediately, no retry timer
    const persistSpy = vi.spyOn(mgr, "_persistWebhook");
    vi.spyOn(mgr, "_httpPost").mockRejectedValue(new Error("boom"));

    await mgr._deliver(wh, "evt", {});

    expect(wh.failCount).toBe(1);
    expect(persistSpy).toHaveBeenCalledWith(wh);
  });
});
