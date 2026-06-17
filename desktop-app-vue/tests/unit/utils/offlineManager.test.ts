/**
 * offlineManager 测试 — src/renderer/utils/offlineManager.ts
 *
 * Default-export singleton. Exercises the offline action queue, failure
 * re-queueing, network listeners (driven via window online/offline events) and
 * the useOffline composable. The constructor's 30s ping interval never fires in
 * a test, so it's left alone; queue/online state is reset per test.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import offlineManager, { useOffline } from "@/utils/offlineManager";

beforeEach(() => {
  localStorage.clear();
  offlineManager.clearQueue();
  offlineManager.isOnline.value = true;
});

describe("offlineManager — queue", () => {
  it("runs queued actions on processQueue and empties the queue", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    offlineManager.addToQueue(fn);
    expect(offlineManager.offlineQueue.value).toHaveLength(1);
    await offlineManager.processQueue();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(offlineManager.offlineQueue.value).toHaveLength(0);
  });

  it("re-queues an action that throws", async () => {
    const bad = vi.fn().mockRejectedValue(new Error("boom"));
    offlineManager.addToQueue(bad);
    await offlineManager.processQueue();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(offlineManager.offlineQueue.value).toHaveLength(1); // failed → back in queue
  });

  it("clearQueue empties the queue", () => {
    offlineManager.addToQueue(vi.fn().mockResolvedValue(undefined));
    offlineManager.clearQueue();
    expect(offlineManager.offlineQueue.value).toHaveLength(0);
  });
});

describe("offlineManager — network listeners", () => {
  it("flips online state and notifies listeners on window events", () => {
    const l = vi.fn();
    offlineManager.addListener(l);
    try {
      window.dispatchEvent(new Event("offline"));
      expect(offlineManager.isOnline.value).toBe(false);
      expect(l).toHaveBeenCalledWith("offline", false);
      l.mockClear();
      window.dispatchEvent(new Event("online"));
      expect(offlineManager.isOnline.value).toBe(true);
      expect(l).toHaveBeenCalledWith("online", true);
    } finally {
      offlineManager.removeListener(l);
    }
  });

  it("removeListener stops further notifications", () => {
    const l = vi.fn();
    offlineManager.addListener(l);
    offlineManager.removeListener(l);
    window.dispatchEvent(new Event("offline"));
    expect(l).not.toHaveBeenCalled();
  });
});

describe("offlineManager — useOffline composable", () => {
  it("exposes reactive online/offline state and routes queue ops", () => {
    const o = useOffline();
    offlineManager.isOnline.value = true;
    expect(o.isOnline.value).toBe(true);
    expect(o.isOffline.value).toBe(false);
    offlineManager.isOnline.value = false;
    expect(o.isOffline.value).toBe(true);

    o.addToQueue(vi.fn().mockResolvedValue(undefined));
    expect(o.offlineQueue.value.length).toBeGreaterThan(0);
    o.clearQueue();
    expect(o.offlineQueue.value).toHaveLength(0);
  });
});
