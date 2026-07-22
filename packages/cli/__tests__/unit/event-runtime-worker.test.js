import { describe, expect, it } from "vitest";
import { EventRuntimeWorker } from "../../src/lib/event-runtime-worker.js";

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
      outboxClaimed: 1,
      outboxAcked: 0,
      outboxFailed: 1,
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
        outboxClaimed: 0,
        outboxAcked: 0,
        outboxFailed: 0,
      };
    };
    await expect(worker.run({ maxTicks: 3 })).resolves.toMatchObject({ ticks: 3 });
    expect(runs).toBe(3);
  });
});
