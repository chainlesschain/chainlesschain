import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const OrganizationManager = require("../organization-manager.js");

describe("OrganizationManager lifecycle", () => {
  it("detaches owned network listeners and waits for admitted knowledge work", async () => {
    const manager = new OrganizationManager({ exec: vi.fn() }, {}, {});
    manager.setupP2PEventListeners();
    for (const eventName of [
      "member:online",
      "member:offline",
      "member:discovered",
      "knowledge:event",
      "broadcast:received",
    ]) {
      expect(manager.orgP2PNetwork.listenerCount(eventName), eventName).toBe(1);
    }

    let release;
    let markStarted;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    manager.handleKnowledgeEvent = vi.fn(async () => {
      markStarted();
      await pending;
    });
    const cleanup = vi
      .spyOn(manager.orgP2PNetwork, "cleanup")
      .mockResolvedValue(undefined);

    manager.orgP2PNetwork.emit("knowledge:event", {
      orgId: "org-1",
      type: "knowledge:update",
      data: {},
    });
    await started;
    let closed = false;
    const closing = manager.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    release();
    await closing;
    await manager.close();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(manager.orgP2PNetwork.eventNames()).toEqual([]);
  });
});
