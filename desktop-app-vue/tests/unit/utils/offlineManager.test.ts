/**
 * offlineManager 测试 — src/renderer/utils/offlineManager.ts
 *
 * Default-export singleton. Exercises the offline action queue, failure
 * re-queueing, network listeners (driven via window online/offline events) and
 * the useOffline composable. The constructor's 30s ping interval never fires in
 * a test, so it's left alone; queue/online state is reset per test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import offlineManager, {
  OFFLINE_MANAGER_LIMITS,
  useOffline,
} from "@/utils/offlineManager";

beforeEach(() => {
  localStorage.clear();
  offlineManager.clearQueue();
  offlineManager.isOnline.value = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("rejects actions after the bounded queue reaches capacity", () => {
    const action = vi.fn().mockResolvedValue(undefined);
    for (
      let index = 0;
      index < OFFLINE_MANAGER_LIMITS.maxQueueItems;
      index += 1
    ) {
      expect(offlineManager.addToQueue(action)).toMatchObject({
        accepted: true,
      });
    }
    expect(offlineManager.addToQueue(action)).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "offline_queue",
    });
    expect(offlineManager.offlineQueue.value).toHaveLength(
      OFFLINE_MANAGER_LIMITS.maxQueueItems,
    );
  });

  it("shares concurrent drains and reserves a failed action's queue slot", async () => {
    let rejectActive: (error: Error) => void = () => {};
    const active = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectActive = reject;
        }),
    );
    offlineManager.addToQueue(active);
    const firstDrain = offlineManager.processQueue();
    const secondDrain = offlineManager.processQueue();
    expect(active).toHaveBeenCalledTimes(1);

    const queued = vi.fn().mockResolvedValue(undefined);
    for (
      let index = 0;
      index < OFFLINE_MANAGER_LIMITS.maxQueueItems - 1;
      index += 1
    ) {
      expect(offlineManager.addToQueue(queued).accepted).toBe(true);
    }
    expect(offlineManager.addToQueue(queued)).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
    });

    rejectActive(new Error("retry later"));
    await Promise.all([firstDrain, secondDrain]);
    expect(offlineManager.offlineQueue.value).toHaveLength(
      OFFLINE_MANAGER_LIMITS.maxQueueItems,
    );
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

  it("deduplicates listeners and rejects new listeners at capacity", () => {
    const listeners = Array.from(
      { length: OFFLINE_MANAGER_LIMITS.maxListeners },
      () => vi.fn(),
    );
    listeners.forEach((listener) => {
      expect(offlineManager.addListener(listener).accepted).toBe(true);
    });
    expect(offlineManager.addListener(listeners[0])).toMatchObject({
      accepted: true,
    });
    const overflow = vi.fn();
    expect(offlineManager.addListener(overflow)).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "offline_listeners",
    });
    listeners.forEach((listener) => offlineManager.removeListener(listener));
  });
});

describe("offlineManager — connection checks", () => {
  it("shares one in-flight ping across concurrent callers", async () => {
    let resolveFetch: (response: { ok: boolean }) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = offlineManager.checkConnection();
    const second = offlineManager.checkConnection();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch({ ok: true });
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
