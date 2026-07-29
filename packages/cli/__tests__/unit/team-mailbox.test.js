import { describe, it, expect } from "vitest";
import {
  TEAM_MAILBOX_ERROR_CODES,
  TeamMailbox,
} from "../../src/lib/agent-team/team-mailbox.js";

describe("TeamMailbox directed delivery", () => {
  it("delivers a direct message once and only to its recipient", () => {
    const mb = new TeamMailbox();
    mb.send({ from: "a", to: "b", body: "hi b" });
    expect(mb.pendingCount("c")).toBe(0); // not addressed to c
    const forB = mb.drain("b");
    expect(forB).toHaveLength(1);
    expect(forB[0].body).toBe("hi b");
    expect(mb.drain("b")).toHaveLength(0); // already delivered — cursor advanced
  });

  it("delivers a broadcast to every teammate except the sender, once each", () => {
    const mb = new TeamMailbox();
    mb.send({ from: "a", to: "*", body: "all hands" });
    expect(mb.drain("a")).toHaveLength(0); // sender never gets its own broadcast
    expect(mb.drain("b")).toHaveLength(1);
    expect(mb.drain("c")).toHaveLength(1);
    expect(mb.drain("b")).toHaveLength(0); // b already saw it
    expect(mb.drain("c")).toHaveLength(0);
  });

  it("peek does not advance the delivery cursor", () => {
    const mb = new TeamMailbox();
    mb.send({ from: "a", to: "b", body: "1" });
    expect(mb.peek("b")).toHaveLength(1);
    expect(mb.peek("b")).toHaveLength(1); // still pending
    expect(mb.drain("b")).toHaveLength(1);
    expect(mb.peek("b")).toHaveLength(0);
  });

  it("requires a recipient", () => {
    const mb = new TeamMailbox();
    expect(() => mb.send({ from: "a", body: "x" })).toThrow(/recipient/);
  });

  it("assigns monotonic ids independent of the clock", () => {
    let t = 5;
    const mb = new TeamMailbox({ now: () => t });
    const m1 = mb.send({ from: "a", to: "b", body: "1" });
    t = 3; // clock goes backwards — ids must not
    const m2 = mb.send({ from: "a", to: "b", body: "2" });
    expect(m2.id).toBe(m1.id + 1);
    expect(m1.ts).toBe(5);
    expect(m2.ts).toBe(3);
  });
});

describe("TeamMailbox snapshot/restore", () => {
  it("re-delivers only what a recipient had not yet drained", () => {
    const mb = new TeamMailbox();
    mb.send({ from: "a", to: "b", body: "first" });
    mb.drain("b"); // b has seen the first
    mb.send({ from: "a", to: "b", body: "second" }); // not yet drained
    const snap = mb.snapshot();

    const restored = TeamMailbox.restore(snap);
    const pending = restored.drain("b");
    expect(pending).toHaveLength(1);
    expect(pending[0].body).toBe("second");
    // A new message after restore keeps the id sequence monotonic.
    const m = restored.send({ from: "a", to: "b", body: "third" });
    expect(m.id).toBe(3);
  });

  it("preserves limits, recipients, byte usage, and lifetime counters", () => {
    const mb = new TeamMailbox({
      now: () => 10,
      maxMessageBytes: 512,
      maxMessages: 1,
      maxTotalBytes: 512,
      recipients: ["a", "b"],
    });
    mb.send({ from: "a", to: "b", body: "first" });
    mb.drain("b");
    mb.send({ from: "a", to: "b", body: "second" }); // compacts first

    const before = mb.status();
    const restored = TeamMailbox.restore(mb.snapshot(), { now: () => 20 });
    expect(restored.status()).toEqual(before);

    restored.drain("b");
    const third = restored.send({ from: "a", to: "b", body: "third" });
    expect(third.id).toBe(3);
    expect(restored.status().counters.compactedMessages).toBe(2);
  });

  it("fails closed on duplicate ids, invalid cursors, and over-capacity logs", () => {
    const mb = new TeamMailbox({
      maxMessageBytes: 512,
      maxMessages: 2,
      maxTotalBytes: 1024,
    });
    mb.send({ from: "a", to: "b", body: "one" });
    const duplicate = mb.snapshot();
    duplicate.log.push({ ...duplicate.log[0] });
    expect(() => TeamMailbox.restore(duplicate)).toThrowError(
      expect.objectContaining({
        code: TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
      }),
    );

    const badCursor = mb.snapshot();
    badCursor.delivered = [["b", 999]];
    expect(() => TeamMailbox.restore(badCursor)).toThrowError(
      expect.objectContaining({
        code: TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
      }),
    );

    const overCapacity = mb.snapshot();
    overCapacity.limits.maxMessages = 1;
    overCapacity.log.push({
      ...overCapacity.log[0],
      id: 2,
      body: "two",
    });
    expect(() => TeamMailbox.restore(overCapacity)).toThrowError(
      expect.objectContaining({
        code: TEAM_MAILBOX_ERROR_CODES.CAPACITY_EXCEEDED,
      }),
    );
  });
});

describe("TeamMailbox bounded backpressure", () => {
  it("rejects a missing recipient with the stable invalid-message code", () => {
    const mb = new TeamMailbox();
    expect(() => mb.send({ body: "missing recipient" })).toThrowError(
      expect.objectContaining({
        code: TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
      }),
    );
    expect(() => mb.send({ to: "b", body: () => "not JSON" })).toThrowError(
      expect.objectContaining({
        code: TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
      }),
    );
    expect(mb.status().counters.rejectedMessages).toBe(2);
  });

  it("rejects an oversized single message with a stable code", () => {
    const mb = new TeamMailbox({
      maxMessageBytes: 100,
      maxMessages: 10,
      maxTotalBytes: 1000,
    });

    let error;
    try {
      mb.send({ from: "a", to: "b", body: "x".repeat(200) });
    } catch (caught) {
      error = caught;
    }

    expect(error?.code).toBe(TEAM_MAILBOX_ERROR_CODES.MESSAGE_TOO_LARGE);
    expect(error?.messageBytes).toBeGreaterThan(error?.maxMessageBytes);
    expect(mb.size()).toBe(0);
    expect(mb.status().counters.rejectedMessages).toBe(1);
  });

  it("detaches admitted payloads so byte accounting cannot be mutated later", () => {
    const body = { text: "small" };
    const mb = new TeamMailbox({
      maxMessageBytes: 512,
      maxMessages: 2,
      maxTotalBytes: 1024,
    });
    const sent = mb.send({ from: "a", to: "b", body });
    const admittedBytes = mb.status().totalBytes;

    body.text = "x".repeat(5000);
    sent.body.text = "also mutated";

    expect(mb.log()[0].body).toEqual({ text: "small" });
    expect(mb.status().totalBytes).toBe(admittedBytes);
  });

  it("compacts a delivered direct message without waiting on unrelated recipients", () => {
    const mb = new TeamMailbox({
      maxMessages: 1,
      maxTotalBytes: 4096,
      recipients: ["b", "c"],
    });
    const first = mb.send({ from: "a", to: "b", body: "for b" });
    expect(mb.drain("b")).toEqual([first]);

    const second = mb.send({ from: "a", to: "c", body: "for c" });
    expect(mb.log()).toEqual([second]);
    expect(mb.status().counters).toMatchObject({
      acceptedMessages: 2,
      compactionRuns: 1,
      compactedMessages: 1,
    });
  });

  it("never compacts a broadcast until every registered recipient has drained it", () => {
    const mb = new TeamMailbox({
      maxMessages: 1,
      maxTotalBytes: 4096,
      recipients: ["a", "b", "c"],
    });
    const broadcast = mb.send({ from: "a", to: "*", body: "all hands" });
    mb.drain("b");

    let error;
    try {
      mb.send({ from: "a", to: "b", body: "must wait" });
    } catch (caught) {
      error = caught;
    }
    expect(error?.code).toBe(TEAM_MAILBOX_ERROR_CODES.CAPACITY_EXCEEDED);
    expect(mb.log()).toEqual([broadcast]); // no silent eviction
    expect(mb.drain("c")).toEqual([broadcast]);

    const next = mb.send({ from: "a", to: "b", body: "now it fits" });
    expect(next.id).toBe(2); // rejected sends do not consume ids
    expect(mb.log()).toEqual([next]);
  });

  it("uses safe compaction when the total-byte limit, not count, is full", () => {
    const now = () => 1;
    const probe = new TeamMailbox({ now });
    const sample = probe.send({ from: "a", to: "b", body: "payload" });
    const oneMessageBytes = Buffer.byteLength(JSON.stringify(sample), "utf8");
    const mb = new TeamMailbox({
      now,
      maxMessageBytes: oneMessageBytes + 32,
      maxMessages: 10,
      maxTotalBytes: oneMessageBytes + 32,
      recipients: ["b"],
    });

    mb.send({ from: "a", to: "b", body: "payload" });
    mb.drain("b");
    mb.send({ from: "a", to: "b", body: "payload" });

    expect(mb.size()).toBe(1);
    expect(mb.status().counters.compactedBytes).toBe(oneMessageBytes);
    expect(mb.status().totalBytes).toBe(oneMessageBytes);
  });

  it("reports pressure and usage without mutating the queue", () => {
    const mb = new TeamMailbox({
      now: () => 1,
      maxMessageBytes: 512,
      maxMessages: 2,
      maxTotalBytes: 4096,
      recipients: ["b"],
    });
    mb.send({ from: "a", to: "b", body: "one" });
    expect(mb.pressure()).toMatchObject({
      messageRatio: 0.5,
      level: "normal",
      full: false,
    });

    mb.send({ from: "a", to: "b", body: "two" });
    expect(mb.pressure()).toMatchObject({
      messageRatio: 1,
      level: "full",
      full: true,
    });
    expect(mb.status()).toMatchObject({
      messages: 2,
      registeredRecipients: 1,
      limits: {
        maxMessageBytes: 512,
        maxMessages: 2,
        maxTotalBytes: 4096,
      },
      counters: {
        acceptedMessages: 2,
        rejectedMessages: 0,
      },
    });
  });
});
