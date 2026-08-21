import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_MESSAGE_FABRIC_ERROR_CODES,
  SESSION_MESSAGE_FABRIC_LIMITS,
  SESSION_MESSAGE_FABRIC_PROJECTION_SCHEMA,
  SessionMessageFabric,
} from "../../src/lib/session-message-fabric.js";

const temporaryDirectories = [];

function fixture(options = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-session-message-fabric-"),
  );
  temporaryDirectories.push(directory);
  return new SessionMessageFabric({
    statePath: path.join(directory, "state.json"),
    ...options,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("SessionMessageFabric authority and policy", () => {
  it("assigns unique canonical names and creates a fresh epoch after reuse", () => {
    const fabric = fixture();
    const first = fabric.register({
      sessionId: "session-a",
      machineId: "host-a",
      name: "Alice",
    });
    expect(first.name).toBe("alice");
    expect(first.address).toMatch(/^cc-session:\/\/host-a\/@alice\?epoch=/u);

    expect(() =>
      fabric.register({
        sessionId: "session-b",
        machineId: "host-b",
        name: "alice",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: SESSION_MESSAGE_FABRIC_ERROR_CODES.NAME_CONFLICT,
      }),
    );

    fabric.register({ sessionId: "sender", name: "sender" });
    fabric.send({ from: "sender", to: "alice", body: "old" });
    fabric.unregister("alice");
    const second = fabric.register({
      sessionId: "session-a",
      machineId: "host-a",
      name: "alice",
    });
    expect(second.epoch).not.toBe(first.epoch);
    expect(fabric.inbox("alice")).toEqual([]);
    expect(
      fabric.send({
        from: "sender",
        to: first.address,
        body: "stale address",
        messageId: "stale-address",
      }),
    ).toMatchObject({ status: "refused", reason: "unknown_recipient" });
  });

  it("applies accept, hold and refuse through one durable receipt contract", () => {
    const fabric = fixture();
    fabric.register({ sessionId: "sender", name: "sender" });
    fabric.register({ sessionId: "target", name: "target", idle: false });

    expect(
      fabric.send({
        from: "sender",
        to: "target",
        body: "accepted",
        messageId: "accepted-1",
      }),
    ).toMatchObject({ status: "delivered", reason: null });

    fabric.setPolicy("target", "hold");
    expect(
      fabric.send({
        from: "sender",
        to: "target",
        body: "held",
        messageId: "held-2",
      }),
    ).toMatchObject({ status: "held", reason: "policy_hold" });
    expect(fabric.inbox("target").map((message) => message.body)).toEqual([
      "accepted",
    ]);

    fabric.setPolicy("target", "accept");
    expect(fabric.inbox("target").map((message) => message.body)).toEqual([
      "accepted",
      "held",
    ]);

    fabric.inbox("target", { acknowledge: true });
    fabric.setPolicy("target", "refuse");
    expect(
      fabric.send({
        from: "sender",
        to: "target",
        body: "denied",
        messageId: "refused-3",
      }),
    ).toMatchObject({ status: "refused", reason: "policy_refuse" });
    expect(fabric.inbox("target")).toEqual([]);
  });

  it("rejects unknown recipients without leaking an earlier name's history", () => {
    const fabric = fixture();
    fabric.register({ sessionId: "sender", name: "sender" });
    expect(
      fabric.send({
        from: "sender",
        to: "missing",
        body: "private",
        messageId: "missing-1",
      }),
    ).toMatchObject({ status: "refused", reason: "unknown_recipient" });
    fabric.register({ sessionId: "later", name: "missing" });
    expect(fabric.inbox("missing")).toEqual([]);
  });
});

describe("SessionMessageFabric ordering, recovery and bounds", () => {
  it("buffers out-of-order messages, deduplicates retries and survives restart", () => {
    const fabric = fixture();
    fabric.register({ sessionId: "sender", name: "sender" });
    fabric.register({ sessionId: "target", name: "target" });

    expect(
      fabric.send({
        from: "sender",
        to: "target",
        body: "second",
        messageId: "message-2",
        sequence: 2,
      }),
    ).toMatchObject({ status: "held", reason: "out_of_order" });
    expect(fabric.inbox("target")).toEqual([]);

    const firstReceipt = fabric.send({
      from: "sender",
      to: "target",
      body: "first",
      messageId: "message-1",
      sequence: 1,
    });
    expect(firstReceipt.status).toBe("delivered");
    expect(
      fabric.send({
        from: "sender",
        to: "target",
        body: "first",
        messageId: "message-1",
        sequence: 1,
      }),
    ).toEqual(firstReceipt);

    const restored = new SessionMessageFabric({ statePath: fabric.statePath });
    expect(restored.inbox("target").map((message) => message.body)).toEqual([
      "first",
      "second",
    ]);
    expect(
      restored.receipts("sender").map((receipt) => receipt.status),
    ).toEqual(["delivered", "delivered"]);
  });

  it("returns full for the 101st pending message and accepts after drain", () => {
    const fabric = fixture();
    fabric.register({ sessionId: "sender", name: "sender" });
    fabric.register({ sessionId: "target", name: "target" });
    for (let index = 1; index <= 100; index += 1) {
      expect(
        fabric.send({
          from: "sender",
          to: "target",
          body: index,
          messageId: `message-${index}`,
        }).status,
      ).toBe("delivered");
    }
    expect(
      fabric.send({
        from: "sender",
        to: "target",
        body: 101,
        messageId: "message-101",
      }),
    ).toMatchObject({ status: "full", reason: "queue_capacity" });

    expect(fabric.inbox("target", { acknowledge: true })).toHaveLength(100);
    expect(
      fabric.send({
        from: "sender",
        to: "target",
        body: "retry",
        messageId: "message-101-retry",
        sequence: 101,
      }).status,
    ).toBe("delivered");
  });

  it("pre-rejects a 256 KiB + 1 payload before changing durable state", () => {
    const fabric = fixture();
    fabric.register({ sessionId: "sender", name: "sender" });
    fabric.register({ sessionId: "target", name: "target" });
    const before = fabric.projection().revision;
    const envelopeOverhead = Buffer.byteLength(
      JSON.stringify({ subject: null, body: "" }),
      "utf8",
    );
    const body = "x".repeat(
      SESSION_MESSAGE_FABRIC_LIMITS.maxMessageBytes + 1 - envelopeOverhead,
    );
    expect(() =>
      fabric.send({ from: "sender", to: "target", body }),
    ).toThrowError(
      expect.objectContaining({
        code: SESSION_MESSAGE_FABRIC_ERROR_CODES.MESSAGE_TOO_LARGE,
      }),
    );
    expect(fabric.projection().revision).toBe(before);
  });

  it("expires durable backlog and reports the terminal receipt", () => {
    let now = 1_000;
    const fabric = fixture({ now: () => now });
    fabric.register({ sessionId: "sender", name: "sender" });
    fabric.register({
      sessionId: "target",
      name: "target",
      policy: "hold",
    });
    fabric.send({
      from: "sender",
      to: "target",
      body: "short lived",
      messageId: "expiring",
      ttlMs: 10,
    });
    now += 11;
    expect(fabric.inbox("target")).toEqual([]);
    expect(fabric.receipts("sender")).toContainEqual(
      expect.objectContaining({
        messageId: "expiring",
        status: "expired",
        reason: "ttl_expired",
      }),
    );
  });
});

describe("SessionMessageFabric idle and IDE projection", () => {
  it("emits notify_when_idle exactly once, including after inbox acknowledgement", () => {
    let now = 10;
    const fabric = fixture({ now: () => now });
    fabric.register({ sessionId: "sender", name: "sender" });
    fabric.register({ sessionId: "target", name: "target", idle: false });
    fabric.send({
      from: "sender",
      to: "target",
      body: "ping",
      messageId: "idle-watch",
      notifyWhenIdle: true,
    });
    fabric.inbox("target", { acknowledge: true });

    now += 1;
    expect(fabric.setIdle("target", true)).toEqual({
      idle: true,
      notifications: 1,
    });
    now += 1;
    expect(fabric.setIdle("target", true)).toEqual({
      idle: true,
      notifications: 0,
    });
    const [receipt] = fabric.receipts("sender");
    expect(receipt.idleNotifiedAt).toBe(11);
  });

  it("keeps offline delivery durable and exposes bounded CLI-owned projection", () => {
    const fabric = fixture();
    fabric.register({ sessionId: "sender", name: "sender" });
    fabric.register({ sessionId: "target-session", name: "target" });
    fabric.disconnect("target");
    expect(
      fabric.send({ from: "sender", to: "target", body: "offline" }).status,
    ).toBe("delivered");
    fabric.reconnect("target");
    expect(fabric.inbox("target")[0].body).toBe("offline");

    expect(fabric.projection()).toMatchObject({
      schema: SESSION_MESSAGE_FABRIC_PROJECTION_SCHEMA,
      version: 1,
      authority: "cli",
      limits: {
        maxMessageBytes: 256 * 1024,
        maxPendingPerRecipient: 100,
      },
      endpoints: expect.arrayContaining([
        expect.objectContaining({
          sessionId: "target-session",
          name: "target",
          online: true,
          unread: 1,
          held: 0,
        }),
      ]),
    });
  });

  it("fails closed on stale CAS revisions and a tampered state digest", () => {
    const fabric = fixture();
    fabric.register({ sessionId: "target", name: "target" });
    const revision = fabric.projection().revision;
    fabric.setIdle("target", false, { expectedRevision: revision });
    expect(() =>
      fabric.setPolicy("target", "hold", { expectedRevision: revision }),
    ).toThrowError(
      expect.objectContaining({
        code: SESSION_MESSAGE_FABRIC_ERROR_CODES.STALE_REVISION,
      }),
    );

    const state = JSON.parse(fs.readFileSync(fabric.statePath, "utf8"));
    state.endpoints[0].policy = "refuse";
    fs.writeFileSync(fabric.statePath, JSON.stringify(state));
    expect(() => fabric.projection()).toThrowError(
      expect.objectContaining({
        code: SESSION_MESSAGE_FABRIC_ERROR_CODES.STATE_CORRUPT,
      }),
    );
  });
});
