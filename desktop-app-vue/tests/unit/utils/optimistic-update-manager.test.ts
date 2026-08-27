import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  getOptimisticUpdateManager,
  OptimisticUpdateManager,
  type StateSnapshot,
} from "@/utils/optimistic-update-manager";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const managers: OptimisticUpdateManager[] = [];

function createManager(
  options: ConstructorParameters<typeof OptimisticUpdateManager>[0] = {},
) {
  const manager = new OptimisticUpdateManager(options);
  managers.push(manager);
  return manager;
}

afterEach(() => {
  managers.splice(0).forEach((manager) => manager.destroy());
  vi.useRealTimers();
});

describe("optimistic-update-manager bounds and lifecycle", () => {
  it("admits only the configured number of retained updates", async () => {
    const manager = createManager({
      maxPendingUpdates: 2,
      cleanupDelayMs: 0,
    });
    const firstApi = deferred<string>();
    const secondApi = deferred<string>();

    const first = manager.update({
      entity: "first",
      mutation: vi.fn(),
      apiCall: () => firstApi.promise,
    });
    const second = manager.update({
      entity: "second",
      mutation: vi.fn(),
      apiCall: () => secondApi.promise,
    });

    await expect(
      manager.update({
        entity: "third",
        mutation: vi.fn(),
        apiCall: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      scope: "optimistic_updates",
      limit: { maxPendingUpdates: 2 },
    });

    firstApi.resolve("one");
    secondApi.resolve("two");
    await expect(first).resolves.toMatchObject({ result: "one" });
    await expect(second).resolves.toMatchObject({ result: "two" });
    expect(manager.getStats().pendingUpdates).toBe(0);
  });

  it("retries only the API call and stops at the configured limit", async () => {
    const manager = createManager({
      maxRetries: 2,
      retryDelay: 0,
      cleanupDelayMs: 0,
    });
    const mutation = vi.fn();
    const apiCall = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockResolvedValue("done");

    await expect(
      manager.update({ entity: "retry", mutation, apiCall }),
    ).resolves.toMatchObject({ status: "committed", result: "done" });

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(apiCall).toHaveBeenCalledTimes(3);
    expect(manager.getStats()).toMatchObject({
      totalUpdates: 1,
      successfulUpdates: 1,
      failedUpdates: 0,
    });
    expect(Number.isFinite(manager.getStats().averageResponseTime)).toBe(true);
  });

  it("rolls back once after bounded retries are exhausted", async () => {
    const manager = createManager({
      maxRetries: 2,
      retryDelay: 0,
      cleanupDelayMs: 0,
    });
    const mutation = vi.fn();
    const rollback = vi.fn();
    const apiCall = vi.fn().mockRejectedValue(new Error("unavailable"));

    await expect(
      manager.update({ entity: "failure", mutation, apiCall, rollback }),
    ).rejects.toThrow("unavailable");

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(apiCall).toHaveBeenCalledTimes(3);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it("bounds the offline queue before applying another mutation", async () => {
    const manager = createManager({
      maxOfflineQueueSize: 1,
      cleanupDelayMs: 0,
    });
    window.dispatchEvent(new Event("offline"));
    const firstMutation = vi.fn();

    await expect(
      manager.update({
        entity: "offline-one",
        mutation: firstMutation,
        apiCall: vi.fn(),
      }),
    ).resolves.toMatchObject({ status: "queued", offline: true });
    expect(firstMutation).toHaveBeenCalledTimes(1);

    const rejectedMutation = vi.fn();
    await expect(
      manager.update({
        entity: "offline-two",
        mutation: rejectedMutation,
        apiCall: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      scope: "optimistic_offline_queue",
      limit: { maxOfflineQueueSize: 1 },
    });
    expect(rejectedMutation).not.toHaveBeenCalled();
    expect(manager.getStats().offlineQueueSize).toBe(1);
  });

  it("shares one offline drain while processing is active", async () => {
    const manager = createManager({ cleanupDelayMs: 0 });
    window.dispatchEvent(new Event("offline"));
    const apiResult = deferred<string>();
    const apiCall = vi.fn(() => apiResult.promise);

    await manager.update({
      entity: "queued",
      mutation: vi.fn(),
      apiCall,
    });
    window.dispatchEvent(new Event("online"));
    const secondDrain = manager.processOfflineQueue();
    let secondDrainSettled = false;
    void secondDrain.then(() => {
      secondDrainSettled = true;
    });

    expect(apiCall).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(secondDrainSettled).toBe(false);
    apiResult.resolve("synced");
    await secondDrain;
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(manager.getStats()).toMatchObject({
      offlineQueueSize: 0,
      successfulUpdates: 1,
    });
  });

  it("bounds event subscriptions and supports idempotent unsubscribe", async () => {
    const manager = createManager({
      maxEventHandlersPerType: 1,
      cleanupDelayMs: 0,
    });
    const handler = vi.fn();
    const subscription = manager.on("success", handler);
    expect(subscription.accepted).toBe(true);
    expect(manager.on("success", vi.fn())).toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      limit: { maxEventHandlersPerType: 1 },
    });

    await manager.update({
      entity: "event-one",
      mutation: vi.fn(),
      apiCall: async () => "one",
    });
    expect(handler).toHaveBeenCalledTimes(1);

    subscription.unsubscribe?.();
    subscription.unsubscribe?.();
    await manager.update({
      entity: "event-two",
      mutation: vi.fn(),
      apiCall: async () => "two",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("evicts old conflicts and rejects oversized retained payloads", async () => {
    const manager = createManager({
      maxConflicts: 1,
      maxConflictPayloadBytes: 32,
      cleanupDelayMs: 0,
    });
    const firstApi = deferred<void>();
    const secondApi = deferred<void>();
    const first = manager.update({
      entity: "a",
      mutation: vi.fn(),
      apiCall: () => firstApi.promise,
    });
    const second = manager.update({
      entity: "b",
      mutation: vi.fn(),
      apiCall: () => secondApi.promise,
    });
    await vi.waitFor(() => {
      expect(manager.detectConflict("a", { value: "one" })).not.toBeNull();
    });
    const incoming = { value: "two" };
    const retainedConflict = manager.detectConflict("b", incoming);
    incoming.value = "changed outside";
    expect(retainedConflict?.incomingData).toEqual({ value: "two" });
    expect(manager.getStats().conflictsCount).toBe(1);
    expect(() => manager.detectConflict("b", "x".repeat(17))).toThrowError(
      expect.objectContaining({
        code: "INVALID_ARGUMENT",
        scope: "optimistic_conflict_payload",
      }),
    );

    firstApi.resolve();
    secondApi.resolve();
    await Promise.all([first, second]);
  });

  it("rejects oversized batches and snapshots before mutation", async () => {
    const manager = createManager({ maxBatchSize: 2 });
    const config = {
      entity: "batch",
      mutation: vi.fn(),
      apiCall: vi.fn(),
    };
    await expect(
      manager.batchUpdate([config, config, config]),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      scope: "optimistic_update_batch",
      limit: { maxBatchSize: 2 },
    });

    class LargeSnapshotManager extends OptimisticUpdateManager {
      createSnapshot(entity: string): StateSnapshot {
        return { entity, timestamp: Date.now(), data: "x".repeat(64) };
      }
    }
    const snapshotManager = new LargeSnapshotManager({ maxSnapshotBytes: 32 });
    managers.push(snapshotManager);
    const mutation = vi.fn();
    await expect(
      snapshotManager.update({
        entity: "snapshot",
        mutation,
        apiCall: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      scope: "optimistic_update_snapshot",
      limit: { maxSnapshotBytes: 32 },
    });
    expect(mutation).not.toHaveBeenCalled();
  });

  it("settles a retry wait with cancellation during destroy", async () => {
    const manager = createManager({ maxRetries: 2, retryDelay: 60_000 });
    const apiCall = vi.fn().mockRejectedValue(new Error("retry"));
    const update = manager.update({
      entity: "cancel",
      mutation: vi.fn(),
      apiCall,
    });
    const rejection = expect(update).rejects.toMatchObject({
      code: "CANCELED",
      scope: "optimistic_updates",
    });

    await vi.waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1));
    manager.destroy();
    await rejection;
  });
});

describe("optimistic-update-manager singleton behavior", () => {
  let manager: OptimisticUpdateManager;

  beforeEach(() => {
    manager = getOptimisticUpdateManager({
      retryOnFailure: false,
      enableOfflineQueue: true,
      enableUndoRedo: true,
      debug: false,
    });
    manager.clear();
    window.dispatchEvent(new Event("online"));
  });

  afterEach(() => {
    manager.destroy();
  });

  it("applies the mutation, commits through the API, and updates stats", async () => {
    const before = manager.getStats().successfulUpdates;
    const mutation = vi.fn();
    const result = await manager.update({
      entity: "todo",
      mutation,
      apiCall: async () => "SERVER_OK",
    });

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "committed",
      result: "SERVER_OK",
    });
    expect(manager.getStats().successfulUpdates).toBe(before + 1);
  });

  it("emits a success event", async () => {
    const onSuccess = vi.fn();
    expect(manager.on("success", onSuccess).accepted).toBe(true);
    await manager.update({
      entity: "event",
      mutation: async () => {},
      apiCall: async () => 1,
    });
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "event", result: 1 }),
    );
  });

  it("rolls back with the custom handler and rethrows API failures", async () => {
    const beforeRollback = manager.getStats().rolledBackUpdates;
    const beforeFailure = manager.getStats().failedUpdates;
    const rollback = vi.fn();
    const onFailure = vi.fn();

    await expect(
      manager.update({
        entity: "failure",
        mutation: async () => {},
        apiCall: async () => {
          throw new Error("network down");
        },
        rollback,
        onFailure,
      }),
    ).rejects.toThrow("network down");

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(manager.getStats().rolledBackUpdates).toBe(beforeRollback + 1);
    expect(manager.getStats().failedUpdates).toBe(beforeFailure + 1);
  });

  it("queues without calling the API while offline", async () => {
    window.dispatchEvent(new Event("offline"));
    const apiCall = vi.fn().mockResolvedValue("unused");
    const result = await manager.update({
      entity: "offline",
      mutation: async () => {},
      apiCall,
    });

    expect(result).toMatchObject({ status: "queued", offline: true });
    expect(apiCall).not.toHaveBeenCalled();
    expect(manager.getStats().offlineQueueSize).toBe(1);
  });

  it("undoes the last update and returns null when history is empty", async () => {
    await manager.update({
      entity: "undo",
      mutation: async () => {},
      apiCall: async () => 1,
    });
    expect(manager.getStats().undoStackSize).toBe(1);
    expect(await manager.undo()).not.toBeNull();
    expect(manager.getStats()).toMatchObject({
      undoStackSize: 0,
      redoStackSize: 1,
    });

    manager.clear();
    await expect(manager.undo()).resolves.toBeNull();
  });

  it("reports bounded state and clear resets retained collections", async () => {
    expect(manager.getStats()).toMatchObject({
      isOnline: true,
      offlineQueueSize: 0,
      undoStackSize: 0,
    });
    await manager.update({
      entity: "clear",
      mutation: async () => {},
      apiCall: async () => 1,
    });
    manager.clear();
    expect(manager.getStats()).toMatchObject({
      pendingUpdates: 0,
      offlineQueueSize: 0,
      undoStackSize: 0,
      redoStackSize: 0,
      conflictsCount: 0,
    });
  });
});
