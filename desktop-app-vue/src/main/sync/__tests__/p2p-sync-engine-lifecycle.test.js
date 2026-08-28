import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const P2PSyncEngine = require("../p2p-sync-engine.js");

function createEngine(p2pManager = new EventEmitter()) {
  const didManager = {
    getDefaultIdentity: vi.fn().mockResolvedValue(null),
  };
  return new P2PSyncEngine({}, didManager, p2pManager);
}

describe("P2PSyncEngine lifecycle", () => {
  it("owns one detachable P2P listener per sync event", async () => {
    const p2pManager = new EventEmitter();
    const engine = createEngine(p2pManager);

    await engine.initialize();
    await engine.initialize();

    for (const eventName of [
      "sync:request",
      "sync:response",
      "sync:change",
      "sync:conflict",
    ]) {
      expect(p2pManager.listenerCount(eventName), eventName).toBe(1);
    }

    await engine.close();
    await engine.close();
    for (const eventName of [
      "sync:request",
      "sync:response",
      "sync:change",
      "sync:conflict",
    ]) {
      expect(p2pManager.listenerCount(eventName), eventName).toBe(0);
    }
    expect(() => engine.startAutoSync("org-closed")).toThrow(/已关闭/);
  });

  it("waits for an admitted source handler before close resolves", async () => {
    const p2pManager = new EventEmitter();
    const engine = createEngine(p2pManager);
    let release;
    let markStarted;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    engine.handleSyncRequest = vi.fn(async () => {
      markStarted();
      await pending;
    });
    await engine.initialize();

    p2pManager.emit("sync:request", { request_id: "request-1" });
    await started;
    let closed = false;
    const closing = engine.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    release();
    await closing;
    expect(engine.handleSyncRequest).toHaveBeenCalledTimes(1);
  });

  it("stops timers, cancels collectors, and drains coalesced background work", async () => {
    const engine = createEngine();
    let release;
    let markStarted;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    engine.sync = vi.fn(async () => {
      markStarted();
      await pending;
    });
    engine.processQueue = vi.fn();
    const cancel = vi.fn();
    engine.pendingRequests.set("request-1", { cancel });

    engine.startAutoSync("org-1");
    await started;
    const closing = engine.close();
    expect(engine.syncTimer).toBeNull();
    expect(engine.queueTimer).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(engine.pendingRequests.size).toBe(0);

    release();
    await closing;
    expect(engine.backgroundTasks.size).toBe(0);
  });
});
