/**
 * Regression test: RealtimeCollabManager.destroy() releases all held resources.
 * Without it the per-lock setTimeout handles in lockExpiryTimers keep firing (and
 * their closures pin `this`) after the manager is discarded.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(),
}));

const {
  RealtimeCollabManager,
} = require("../../../src/main/collaboration/realtime-collab-manager.js");

describe("RealtimeCollabManager.destroy", () => {
  it("clears lock-expiry timers, lock/subscriber maps, and listeners", () => {
    const mgr = new RealtimeCollabManager(null);

    // Simulate held state.
    const timer = setTimeout(() => {}, 100_000);
    mgr.lockExpiryTimers.set("lock1", timer);
    mgr.activeLocks.set("doc1", [{ lockId: "lock1" }]);
    mgr.documentSubscribers.set("doc1", new Set([() => {}]));
    mgr.on("some-event", () => {});

    mgr.destroy();

    expect(mgr.lockExpiryTimers.size).toBe(0);
    expect(mgr.activeLocks.size).toBe(0);
    expect(mgr.documentSubscribers.size).toBe(0);
    expect(mgr.listenerCount("some-event")).toBe(0);

    clearTimeout(timer); // safety; destroy already cleared it
  });
});
