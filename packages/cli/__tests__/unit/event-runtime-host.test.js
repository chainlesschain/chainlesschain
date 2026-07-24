import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventRuntimeStore } from "../../src/lib/event-runtime-store.js";
import {
  EventRuntimeHost,
  _resetDefaultEventRuntimeHostForTests,
  startDefaultEventRuntimeHost,
} from "../../src/lib/event-runtime-host.js";

const dirs = [];

afterEach(() => {
  delete process.env.CC_EVENT_RUNTIME_DURABLE;
  _resetDefaultEventRuntimeHostForTests();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-event-host-"));
  dirs.push(dir);
  return new EventRuntimeStore({ dir, owner: "host-test" });
}

describe("EventRuntimeHost", () => {
  it("routes durable inbox and outbox records and acknowledges both", async () => {
    const runtimeStore = store();
    const host = new EventRuntimeHost({ store: runtimeStore });
    const seen = [];
    host.registerHandler(
      async (event) => {
        seen.push(["inbox", event.value]);
        return { accepted: true };
      },
      { queue: "inbox", type: "task.ready", origin: "agenda" },
    );
    host.registerHandler(
      async (event) => {
        seen.push(["outbox", event.value]);
      },
      { queue: "outbox" },
    );
    runtimeStore.enqueueInbox({
      event_id: "in-1",
      type: "task.ready",
      origin: "agenda",
      value: 1,
    });
    runtimeStore.enqueueOutbox({
      event_id: "out-1",
      type: "delivery",
      value: 2,
    });

    await expect(host.runOnce()).resolves.toMatchObject({
      inboxAcked: 1,
      outboxAcked: 1,
    });
    expect(seen).toEqual([
      ["inbox", 1],
      ["outbox", 2],
    ]);
    expect(runtimeStore.listInbox({ status: "done" })).toHaveLength(1);
    expect(runtimeStore.listOutbox({ status: "done" })).toHaveLength(1);
  });

  it("retries required events until a handler becomes available", async () => {
    const runtimeStore = store();
    const host = new EventRuntimeHost({
      store: runtimeStore,
      worker: null,
    });
    host.worker.retryDelayMs = 0;
    runtimeStore.enqueueInbox({
      event_id: "needs-handler",
      type: "secure.delivery",
      origin: "system",
      requiresHandler: true,
    });

    await expect(host.runOnce()).resolves.toMatchObject({ inboxFailed: 1 });
    expect(runtimeStore.listInbox()[0].status).toBe("pending");

    host.registerHandler(() => ({ delivered: true }), {
      type: "secure.delivery",
    });
    await expect(host.runOnce()).resolves.toMatchObject({ inboxAcked: 1 });
    expect(runtimeStore.listInbox()[0]).toMatchObject({ status: "done" });
  });

  it("owns a non-overlapping, stoppable lifecycle", async () => {
    const callbacks = [];
    const cleared = [];
    let runs = 0;
    let timerId = 0;
    const host = new EventRuntimeHost({
      store: store(),
      worker: {
        runOnce: async () => {
          runs += 1;
          return { inboxClaimed: 0, outboxClaimed: 0 };
        },
      },
      setTimeoutFn: (callback) => {
        callbacks.push(callback);
        timerId += 1;
        return { id: timerId, unref() {} };
      },
      clearTimeoutFn: (timer) => cleared.push(timer.id),
    });

    expect(host.start({ immediate: false })).toBe(true);
    expect(host.start()).toBe(false);
    expect(callbacks).toHaveLength(1);
    await callbacks.shift()();
    expect(runs).toBe(1);
    expect(callbacks).toHaveLength(1);
    await host.stop();
    expect(cleared).toEqual([2]);
    expect(host.status().running).toBe(false);
  });

  it("starts the default host only under the durable feature gate", async () => {
    expect(startDefaultEventRuntimeHost({ store: store() })).toBeNull();
    process.env.CC_EVENT_RUNTIME_DURABLE = "1";
    const host = startDefaultEventRuntimeHost({
      store: store(),
      immediate: false,
    });
    expect(host).toBeInstanceOf(EventRuntimeHost);
    expect(host.status().running).toBe(true);
    await host.stop();
  });
});
