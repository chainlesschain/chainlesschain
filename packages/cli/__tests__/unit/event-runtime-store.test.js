import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventRuntimeStore } from "../../src/lib/event-runtime-store.js";

describe("EventRuntimeStore", () => {
  let dir;
  let now;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-event-runtime-"));
    now = 1000;
    store = new EventRuntimeStore({
      dir,
      now: () => now,
      owner: "worker-a",
      leaseMs: 100,
      maxAttempts: 2,
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("persists inbox records and deduplicates by event id", () => {
    const first = store.enqueueInbox({ event_id: "evt-1", payload: { n: 1 } });
    const duplicate = store.enqueueInbox({ event_id: "evt-1", payload: { n: 2 } });

    expect(first).toMatchObject({ id: "evt-1", status: "pending" });
    expect(duplicate).toMatchObject({ id: "evt-1", duplicate: true });
    expect(store.listInbox()).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "inbox.json"), "utf8"))).toHaveLength(1);
  });

  it("claims once, then reclaims an expired lease", () => {
    store.enqueueInbox({ event_id: "evt-lease" });
    const first = store.claimInbox();
    expect(first).toHaveLength(1);
    expect(first[0].lease).toMatchObject({ owner: "worker-a", expiresAt: 1100 });
    expect(store.claimInbox()).toEqual([]);

    now = 1101;
    const reclaimed = store.claimInbox();
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].attempts).toBe(2);
  });

  it("retries failures and moves exhausted records to dead letter", () => {
    store.enqueueOutbox({ event_id: "evt-fail" });
    const [claimed] = store.claimOutbox();
    const retry = store.fail("outbox", claimed.id, "temporary", { retryDelayMs: 50 });
    expect(retry).toMatchObject({ status: "pending", attempts: 1 });
    expect(store.claimOutbox()).toEqual([]);

    now = 1050;
    const [second] = store.claimOutbox();
    const dead = store.fail("outbox", second.id, "permanent", { retryDelayMs: 0 });
    expect(dead).toMatchObject({ status: "dead", attempts: 2 });
    expect(store.listOutbox({ status: "dead" })).toHaveLength(1);
  });

  it("acknowledges an inbox event and preserves the result", () => {
    store.enqueueInbox({ event_id: "evt-done" });
    const [claimed] = store.claimInbox();
    const done = store.acknowledgeInbox(claimed.id, { delivered: true });
    expect(done).toMatchObject({ status: "done", result: { delivered: true } });
    expect(store.listInbox({ status: "pending" })).toHaveLength(0);
  });

  it("fails closed when active queue depth reaches the backpressure limit", () => {
    const bounded = new EventRuntimeStore({ dir, now: () => now, maxQueueLength: 1 });
    bounded.enqueueInbox({ event_id: "depth-1" });
    expect(() => bounded.enqueueInbox({ event_id: "depth-2" })).toThrow(
      /queue is full/,
    );
    expect(() => bounded.enqueueInbox({ event_id: "depth-2" })).toThrow(
      expect.objectContaining({ code: "CC_EVENT_RUNTIME_BACKPRESSURE" }),
    );
  });
});
