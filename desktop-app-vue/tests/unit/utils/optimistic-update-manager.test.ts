/**
 * optimistic-update-manager 测试 — src/renderer/utils/optimistic-update-manager.ts
 *
 * Only the getOptimisticUpdateManager() singleton is exported (state persists,
 * stats accumulate, options fixed at first call), so: set options once, clear()
 * per test, assert stat deltas, drive online/offline via window events.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getOptimisticUpdateManager } from "@/utils/optimistic-update-manager";

let mgr: any;
beforeEach(() => {
  mgr = getOptimisticUpdateManager({
    retryOnFailure: false,
    enableOfflineQueue: true,
    enableUndoRedo: true,
    debug: false,
  });
  mgr.clear();
  window.dispatchEvent(new Event("online")); // baseline online
});

describe("optimistic-update-manager — update success", () => {
  it("applies the mutation, commits via apiCall, returns the result", async () => {
    const before = mgr.getStats().successfulUpdates;
    let applied = false;
    const r = await mgr.update({
      entity: "todo",
      mutation: async () => {
        applied = true;
      },
      apiCall: async () => "SERVER_OK",
    });
    expect(applied).toBe(true);
    expect(r).toMatchObject({ status: "committed", result: "SERVER_OK" });
    expect(mgr.getStats().successfulUpdates).toBe(before + 1);
  });

  it("emits a success event", async () => {
    const onSuccess = vi.fn();
    mgr.on("success", onSuccess);
    await mgr.update({
      entity: "e",
      mutation: async () => {},
      apiCall: async () => 1,
    });
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "e", result: 1 }),
    );
  });
});

describe("optimistic-update-manager — failure + rollback", () => {
  it("rolls back (custom) on apiCall failure and rethrows", async () => {
    const beforeRb = mgr.getStats().rolledBackUpdates;
    const beforeFail = mgr.getStats().failedUpdates;
    let rolledBack = false;
    const onFailure = vi.fn();
    await expect(
      mgr.update({
        entity: "e",
        mutation: async () => {},
        apiCall: async () => {
          throw new Error("network down");
        },
        rollback: async () => {
          rolledBack = true;
        },
        onFailure,
      }),
    ).rejects.toThrow("network down");
    expect(rolledBack).toBe(true);
    expect(onFailure).toHaveBeenCalled();
    expect(mgr.getStats().rolledBackUpdates).toBe(beforeRb + 1);
    expect(mgr.getStats().failedUpdates).toBe(beforeFail + 1);
  });
});

describe("optimistic-update-manager — offline queue", () => {
  it("queues the update without calling the API when offline", async () => {
    window.dispatchEvent(new Event("offline"));
    const apiCall = vi.fn().mockResolvedValue("x");
    const r = await mgr.update({
      entity: "e",
      mutation: async () => {},
      apiCall,
    });
    expect(r).toMatchObject({ status: "queued", offline: true });
    expect(apiCall).not.toHaveBeenCalled();
    expect(mgr.getStats().offlineQueueSize).toBe(1);
    window.dispatchEvent(new Event("online")); // restore
  });
});

describe("optimistic-update-manager — undo", () => {
  it("undo rolls back the last applied update; returns null when empty", async () => {
    await mgr.update({
      entity: "e",
      mutation: async () => {},
      apiCall: async () => 1,
    });
    expect(mgr.getStats().undoStackSize).toBe(1);
    const undone = await mgr.undo();
    expect(undone).not.toBeNull();
    expect(mgr.getStats().undoStackSize).toBe(0);
    expect(mgr.getStats().redoStackSize).toBe(1);

    mgr.clear();
    expect(await mgr.undo()).toBeNull();
  });
});

describe("optimistic-update-manager — getStats + clear", () => {
  it("reports queue/stack sizes and online flag; clear resets them", async () => {
    const stats = mgr.getStats();
    expect(stats).toHaveProperty("pendingUpdates");
    expect(stats).toHaveProperty("offlineQueueSize");
    expect(stats).toHaveProperty("undoStackSize");
    expect(stats.isOnline).toBe(true);
    await mgr.update({
      entity: "e",
      mutation: async () => {},
      apiCall: async () => 1,
    });
    mgr.clear();
    expect(mgr.getStats().undoStackSize).toBe(0);
    expect(mgr.getStats().offlineQueueSize).toBe(0);
  });
});
