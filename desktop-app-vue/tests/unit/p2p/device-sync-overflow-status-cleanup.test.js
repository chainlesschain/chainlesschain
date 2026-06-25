/**
 * DeviceSyncManager — queue-overflow status cleanup.
 *
 * Bug: on overflow, queueMessage `deviceQueue.shift()` dropped the oldest queued
 * message but left its entry in `messageStatus` (a Map persisted via
 * saveMessageStatus). Each overflow eviction leaked one PENDING status entry
 * that nothing ever reaps (the sync timer only delivers), so messageStatus grew
 * unbounded in memory and on disk over the app's lifetime. Fix deletes the
 * evicted message's status entry.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  DeviceSyncManager,
} = require("../../../src/main/p2p/device-sync-manager.js");

describe("DeviceSyncManager queue-overflow status cleanup", () => {
  it("deletes the evicted message's status entry on overflow", async () => {
    const m = new DeviceSyncManager({ maxQueueSize: 2 });
    m.saveMessageQueue = vi.fn(async () => {});
    m.saveMessageStatus = vi.fn(async () => {});

    await m.queueMessage("dev1", { id: "m1", content: "a" });
    await m.queueMessage("dev1", { id: "m2", content: "b" });
    // queue is now full (2); the next enqueue evicts the oldest (m1)
    await m.queueMessage("dev1", { id: "m3", content: "c" });

    const queue = m.messageQueue.get("dev1");
    expect(queue.map((x) => x.id)).toEqual(["m2", "m3"]); // m1 evicted
    expect(m.messageStatus.has("m1")).toBe(false); // status cleaned (the fix)
    expect(m.messageStatus.has("m2")).toBe(true);
    expect(m.messageStatus.has("m3")).toBe(true);
  });
});
