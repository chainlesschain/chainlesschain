import { describe, expect, it, vi } from "vitest";

const {
  DeviceSyncBoundaryError,
  cloneBoundedMessage,
  readBoundedJsonFile,
  resolveDeviceSyncLimits,
} = require("../device-sync-boundaries");
const { DeviceSyncManager } = require("../device-sync-manager");

function smallLimits(overrides = {}) {
  return {
    maxQueueSize: 2,
    maxDevices: 2,
    maxTotalMessages: 3,
    maxMessageBytes: 512,
    maxQueueBytes: 1_024,
    maxTotalQueueBytes: 2_048,
    maxStatusEntries: 3,
    maxStatusBytes: 256,
    maxDeviceIdBytes: 64,
    maxPersistedBytes: 4_096,
    ...overrides,
  };
}

describe("device sync boundaries", () => {
  it("validates related limits and clones admitted messages", () => {
    const limits = resolveDeviceSyncLimits(smallLimits());
    const source = { nested: { value: 1 } };
    const admitted = cloneBoundedMessage(source, limits);
    source.nested.value = 2;

    expect(admitted.value).toEqual({ nested: { value: 1 } });
    expect(() =>
      resolveDeviceSyncLimits(smallLimits({ maxQueueSize: 4 })),
    ).toThrow(/maxQueueSize/);
    expect(() =>
      cloneBoundedMessage({ data: "x".repeat(600) }, limits),
    ).toThrow(DeviceSyncBoundaryError);
  });

  it("checks persisted byte size before parsing", async () => {
    const fsp = {
      stat: vi.fn(async () => ({ size: 5_000 })),
      readFile: vi.fn(),
    };
    await expect(
      readBoundedJsonFile(fsp, "queue.json", smallLimits()),
    ).rejects.toMatchObject({ code: "DEVICE_SYNC_FILE_TOO_LARGE" });
    expect(fsp.readFile).not.toHaveBeenCalled();
  });
});

describe("DeviceSyncManager bounded queue", () => {
  it("evicts per-device oldest entries while bounding devices and bytes", async () => {
    const manager = new DeviceSyncManager({ limits: smallLimits() });
    const first = { id: "m1", content: { value: 1 } };
    await manager.queueMessage("device-a", first);
    first.content.value = 99;
    await manager.queueMessage("device-a", { id: "m2", content: "two" });
    await manager.queueMessage("device-a", { id: "m3", content: "three" });

    expect(manager.getDeviceQueue("device-a").map(({ id }) => id)).toEqual([
      "m2",
      "m3",
    ]);
    expect(manager.messageStatus.has("m1")).toBe(false);
    expect(manager.getStatistics().totalMessages).toBe(2);
    expect(manager.getStatistics().totalQueueBytes).toBeGreaterThan(0);
    const snapshot = manager.getDeviceQueue("device-a");
    snapshot[0].content = "mutated";
    expect(manager.getDeviceQueue("device-a")[0].content).toBe("two");

    await manager.queueMessage("device-b", { id: "m4", content: "four" });
    await expect(
      manager.queueMessage("device-c", { id: "m5", content: "five" }),
    ).rejects.toMatchObject({ code: "DEVICE_SYNC_DEVICE_CAPACITY" });
    await manager.close();
  });

  it("keeps generated identity and retained device state isolated from callers", async () => {
    const manager = new DeviceSyncManager({ limits: smallLimits() });
    const messageId = await manager.queueMessage("device-a", {
      id: "",
      content: "generated",
    });
    expect(messageId).toMatch(/^msg-/);
    expect(manager.getDeviceQueue("device-a")[0].id).toBe(messageId);

    manager.updateDeviceStatus("device-a", { nested: { online: true } });
    const snapshot = manager.getDeviceStatus("device-a");
    snapshot.nested.online = false;
    expect(manager.getDeviceStatus("device-a").nested.online).toBe(true);
    await manager.close();
  });

  it("coalesces sync calls and awaits one delivery at a time", async () => {
    const manager = new DeviceSyncManager({ limits: smallLimits() });
    await manager.queueMessage("device-a", { id: "m1", content: "one" });
    await manager.queueMessage("device-a", { id: "m2", content: "two" });

    let active = 0;
    let maximumActive = 0;
    const delivered = [];
    manager.setDeliveryHandler(async ({ message }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      delivered.push(message.id);
      active -= 1;
    });

    await Promise.all([
      manager.syncDevice("device-a"),
      manager.syncDevice("device-a"),
    ]);
    expect(delivered).toEqual(["m1", "m2"]);
    expect(maximumActive).toBe(1);
    await manager.close();
    await expect(
      manager.queueMessage("device-a", { id: "late", content: "late" }),
    ).rejects.toThrow(/closed/);
  });
});
