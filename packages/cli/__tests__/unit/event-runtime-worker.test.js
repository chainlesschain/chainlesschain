import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventRuntimeWorker } from "../../src/lib/event-runtime-worker.js";
import { EventRuntimeStore } from "../../src/lib/event-runtime-store.js";

describe("EventRuntimeWorker", () => {
  it("drains inbox and outbox with ack and preserves failures for retry", async () => {
    const calls = [];
    const records = {
      inbox: [{ id: "in-1", event: { kind: "inbox" } }],
      outbox: [{ id: "out-1", event: { kind: "outbox" } }],
    };
    const store = {
      claimInbox: () => records.inbox.splice(0),
      claimOutbox: () => records.outbox.splice(0),
      acknowledgeInbox: (id, result) => calls.push(["in-ack", id, result]),
      acknowledgeOutbox: (id, result) => calls.push(["out-ack", id, result]),
      fail: (queue, id, error) => calls.push(["fail", queue, id, error]),
    };
    const worker = new EventRuntimeWorker({
      store,
      onInbox: async (event) => ({ received: event.kind }),
      onOutbox: async () => {
        throw new Error("temporary delivery");
      },
    });

    const stats = await worker.runOnce();
    expect(stats).toEqual({
      inboxClaimed: 1,
      inboxAcked: 1,
      inboxFailed: 0,
      inboxLeaseLost: 0,
      outboxClaimed: 1,
      outboxAcked: 0,
      outboxFailed: 1,
      outboxLeaseLost: 0,
    });
    expect(calls).toEqual([
      ["in-ack", "in-1", { received: "inbox" }],
      ["fail", "outbox", "out-1", "temporary delivery"],
    ]);
  });

  it("supports deterministic bounded daemon ticks", async () => {
    let runs = 0;
    const worker = new EventRuntimeWorker({
      store: {
        claimInbox: () => [],
        claimOutbox: () => [],
      },
      sleep: async () => {},
    });
    worker.runOnce = async () => {
      runs += 1;
      return {
        inboxClaimed: 0,
        inboxAcked: 0,
        inboxFailed: 0,
        inboxLeaseLost: 0,
        outboxClaimed: 0,
        outboxAcked: 0,
        outboxFailed: 0,
        outboxLeaseLost: 0,
      };
    };
    await expect(worker.run({ maxTicks: 3 })).resolves.toMatchObject({
      ticks: 3,
    });
    expect(runs).toBe(3);
  });

  it("reports a lease lost when another host settles first", async () => {
    const worker = new EventRuntimeWorker({
      store: {
        claimInbox: () => [
          {
            id: "stolen",
            event: { value: 1 },
            lease: { owner: "host-a" },
          },
        ],
        claimOutbox: () => [],
        acknowledgeInbox: () => null,
      },
      onInbox: async () => ({ delivered: true }),
    });

    await expect(worker.runOnce()).resolves.toMatchObject({
      inboxClaimed: 1,
      inboxAcked: 0,
      inboxFailed: 0,
      inboxLeaseLost: 1,
    });
  });

  it("renews long-running work with the claim fence before settlement", async () => {
    const calls = [];
    let renewTick;
    const store = {
      leaseMs: 90,
      claimInbox: () => [
        {
          id: "long",
          event: { value: 1 },
          lease: { owner: "host-a", fence: 7, expiresAt: 1090 },
        },
      ],
      claimOutbox: () => [],
      renewInbox: (id, options) => {
        calls.push(["renew", id, options]);
        return { id, lease: { ...options, expiresAt: 1180 } };
      },
      acknowledgeInbox: (id, result, options) => {
        calls.push(["ack", id, result, options]);
        return { id, status: "done" };
      },
    };
    const worker = new EventRuntimeWorker({
      store,
      setIntervalFn: (fn) => {
        renewTick = fn;
        return { unref() {} };
      },
      clearIntervalFn: () => {},
      onInbox: async () => {
        renewTick();
        return { delivered: true };
      },
    });

    await expect(worker.runOnce()).resolves.toMatchObject({
      inboxAcked: 1,
      inboxLeaseLost: 0,
    });
    expect(calls).toEqual([
      ["renew", "long", { owner: "host-a", fence: 7 }],
      [
        "ack",
        "long",
        { delivered: true },
        { owner: "host-a", fence: 7 },
      ],
    ]);
  });

  it("does not settle after lease renewal loses its fence", async () => {
    let renewTick;
    let acknowledged = false;
    const worker = new EventRuntimeWorker({
      store: {
        leaseMs: 90,
        claimInbox: () => [
          {
            id: "lost",
            event: {},
            lease: { owner: "host-a", fence: 1, expiresAt: 1090 },
          },
        ],
        claimOutbox: () => [],
        renewInbox: () => null,
        acknowledgeInbox: () => {
          acknowledged = true;
        },
      },
      setIntervalFn: (fn) => {
        renewTick = fn;
        return { unref() {} };
      },
      clearIntervalFn: () => {},
      onInbox: async () => {
        renewTick();
        return { delivered: true };
      },
    });

    await expect(worker.runOnce()).resolves.toMatchObject({
      inboxAcked: 0,
      inboxLeaseLost: 1,
    });
    expect(acknowledged).toBe(false);
  });

  it("recovers an expired lease across owners and rejects stale settlement", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-event-recovery-"));
    let now = 1000;
    try {
      const firstHost = new EventRuntimeStore({
        dir,
        now: () => now,
        owner: "host-a",
        leaseMs: 100,
      });
      const recoveryHost = new EventRuntimeStore({
        dir,
        now: () => now,
        owner: "host-b",
        leaseMs: 100,
      });
      firstHost.enqueueInbox({ event_id: "recover-me", value: 1 });
      const [abandoned] = firstHost.claimInbox();
      expect(abandoned.lease.owner).toBe("host-a");

      now = 1101;
      expect(recoveryHost.getHealthSnapshot().queues.inbox.expiredLeases).toBe(
        1,
      );
      let staleAck;
      let staleFail;
      const worker = new EventRuntimeWorker({
        store: recoveryHost,
        now: () => now,
        onInbox: async (_event, record) => {
          staleAck = firstHost.acknowledgeInbox(
            record.id,
            { host: "a" },
            { owner: abandoned.lease.owner },
          );
          staleFail = firstHost.fail("inbox", record.id, "late failure", {
            owner: abandoned.lease.owner,
          });
          return { host: "b" };
        },
      });

      await expect(worker.runOnce()).resolves.toMatchObject({
        inboxClaimed: 1,
        inboxAcked: 1,
        inboxLeaseLost: 0,
      });
      expect(staleAck).toBeNull();
      expect(staleFail).toBeNull();
      expect(recoveryHost.listInbox()[0]).toMatchObject({
        status: "done",
        attempts: 2,
        result: { host: "b" },
      });
      expect(recoveryHost.getHealthSnapshot().queues.inbox).toMatchObject({
        active: 0,
        done: 1,
        expiredLeases: 0,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
