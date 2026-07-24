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
    const duplicate = store.enqueueInbox({
      event_id: "evt-1",
      payload: { n: 2 },
    });

    expect(first).toMatchObject({ id: "evt-1", status: "pending" });
    expect(duplicate).toMatchObject({ id: "evt-1", duplicate: true });
    expect(store.listInbox()).toHaveLength(1);
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, "inbox.json"), "utf8")),
    ).toHaveLength(1);
  });

  it("claims once, then reclaims an expired lease", () => {
    store.enqueueInbox({ event_id: "evt-lease" });
    const first = store.claimInbox();
    expect(first).toHaveLength(1);
    expect(first[0].lease).toMatchObject({
      owner: "worker-a",
      expiresAt: 1100,
    });
    expect(store.claimInbox()).toEqual([]);

    now = 1101;
    const reclaimed = store.claimInbox();
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].attempts).toBe(2);
    expect(reclaimed[0].lease.fence).toBe(2);
  });

  it("renews a live fenced lease and rejects expired or stale holders", () => {
    store.enqueueInbox({ event_id: "evt-renew" });
    const [first] = store.claimInbox();
    expect(first.lease.fence).toBe(1);

    now = 1050;
    const renewed = store.renewInbox(first.id, {
      owner: first.lease.owner,
      fence: first.lease.fence,
    });
    expect(renewed.lease).toMatchObject({
      fence: 1,
      renewedAt: 1050,
      expiresAt: 1150,
    });

    now = 1151;
    expect(
      store.acknowledgeInbox(first.id, { stale: true }, {
        owner: first.lease.owner,
        fence: first.lease.fence,
      }),
    ).toBeNull();

    const [second] = store.claimInbox();
    expect(second.lease.fence).toBe(2);
    expect(
      store.renewInbox(second.id, {
        owner: first.lease.owner,
        fence: first.lease.fence,
      }),
    ).toBeNull();
    expect(
      store.acknowledgeInbox(second.id, { delivered: true }, {
        owner: second.lease.owner,
        fence: second.lease.fence,
      }),
    ).toMatchObject({ status: "done", result: { delivered: true } });
  });

  it("retries failures and moves exhausted records to dead letter", () => {
    store.enqueueOutbox({ event_id: "evt-fail" });
    const [claimed] = store.claimOutbox();
    const retry = store.fail("outbox", claimed.id, "temporary", {
      retryDelayMs: 50,
    });
    expect(retry).toMatchObject({ status: "pending", attempts: 1 });
    expect(store.claimOutbox()).toEqual([]);

    now = 1050;
    const [second] = store.claimOutbox();
    const dead = store.fail("outbox", second.id, "permanent", {
      retryDelayMs: 0,
    });
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
    const bounded = new EventRuntimeStore({
      dir,
      now: () => now,
      maxQueueLength: 1,
    });
    bounded.enqueueInbox({ event_id: "depth-1" });
    expect(() => bounded.enqueueInbox({ event_id: "depth-2" })).toThrow(
      /queue is full/,
    );
    expect(() => bounded.enqueueInbox({ event_id: "depth-2" })).toThrow(
      expect.objectContaining({ code: "CC_EVENT_RUNTIME_BACKPRESSURE" }),
    );
  });

  it("reports queue pressure, delayed work, expired leases, and capacity", () => {
    const bounded = new EventRuntimeStore({
      dir,
      now: () => now,
      owner: "observer",
      leaseMs: 100,
      maxQueueLength: 2,
    });
    bounded.enqueueInbox({ event_id: "active-1" });
    const [claimed] = bounded.claimInbox();
    bounded.enqueueInbox({ event_id: "active-2" });
    bounded.fail("inbox", "active-2", "retry later", { retryDelayMs: 200 });

    let health = bounded.getHealthSnapshot();
    expect(health).toMatchObject({
      schema: "chainlesschain.event-runtime-health.v1",
      pressure: "full",
      queueLimit: 2,
      queues: {
        inbox: {
          active: 2,
          processing: 1,
          delayed: 1,
          expiredLeases: 0,
          availableCapacity: 0,
          utilization: 1,
          pressure: "full",
        },
      },
    });

    now = 1101;
    health = bounded.getHealthSnapshot();
    expect(health.queues.inbox.expiredLeases).toBe(1);
    expect(health.queues.inbox.oldestActiveAgeMs).toBe(101);
    expect(claimed.lease.owner).toBe("observer");
  });
});
