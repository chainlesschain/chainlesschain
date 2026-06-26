// @vitest-environment node

/**
 * MessageManager.sendMessage — sentMessages leak regression.
 *
 * sentMessages is only ever read/deleted on the ack (receiveAck) and retry
 * (handleAckTimeout) paths, which run only for requireAck messages. Storing
 * EVERY sent message (the default is requireAck:false) meant non-ack entries
 * accumulated forever (cleanup() teardown aside) — an unbounded leak over a
 * long session. They must only be tracked when requireAck is set.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const MessageManager = require("../message-manager.js");

describe("MessageManager sentMessages tracking", () => {
  let mgr;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new MessageManager();
    mgr.sendImmediately = vi.fn().mockResolvedValue(undefined);
    mgr.queueMessage = vi.fn();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does NOT retain non-ack messages in sentMessages", async () => {
    await mgr.sendMessage("peer", { type: "a" }); // default requireAck:false
    await mgr.sendMessage("peer", { type: "b" });
    expect(mgr.sentMessages.size).toBe(0);
  });

  it("retains requireAck messages for ack/retry tracking", async () => {
    await mgr.sendMessage(
      "peer",
      { type: "c" },
      { requireAck: true, immediate: true },
    );
    expect(mgr.sentMessages.size).toBe(1);
  });

  it("cleanupExpiredData prunes a stale sentMessages entry past the TTL", async () => {
    // Simulate an interrupted-retry leftover: a stale requireAck entry.
    mgr.sentMessages.set("old", {
      message: {},
      peerId: "p",
      sentAt: Date.now() - 6 * 60 * 1000, // older than the 5-min TTL
      retries: 0,
    });
    mgr.sentMessages.set("fresh", {
      message: {},
      peerId: "p",
      sentAt: Date.now(),
      retries: 0,
    });

    mgr.cleanupExpiredData();

    expect(mgr.sentMessages.has("old")).toBe(false);
    expect(mgr.sentMessages.has("fresh")).toBe(true);
  });
});
