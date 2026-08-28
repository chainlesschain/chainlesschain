import { afterEach, describe, expect, it, vi } from "vitest";
import EventEmitter from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({ v4: () => "generated-message-id" }));

const { GossipProtocol, LRUCache } = require("../gossip-protocol");
const {
  GossipBoundaryError,
  createGossipBoundaries,
} = require("../gossip-boundaries");

const protocols = [];

function createP2PManager(overrides = {}) {
  const manager = new EventEmitter();
  manager.peerId = "peer-local";
  manager.getConnectedPeers = vi.fn().mockReturnValue([]);
  manager.sendMessage = vi.fn().mockResolvedValue({ success: true });
  Object.assign(manager, overrides);
  return manager;
}

function createProtocol(options = {}, p2pOverrides = {}) {
  const p2pManager = createP2PManager(p2pOverrides);
  const protocol = new GossipProtocol(p2pManager, options);
  protocols.push(protocol);
  return { p2pManager, protocol };
}

function message(overrides = {}) {
  return {
    id: "message-1",
    communityId: "community-1",
    payload: { type: "channel_message", content: "hello" },
    sender: "peer-sender",
    timestamp: Date.now(),
    ttl: 60_000,
    hops: 0,
    ...overrides,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(protocols.splice(0).map((protocol) => protocol.destroy()));
});

describe("gossip boundaries", () => {
  it("rejects unknown, invalid, and inconsistent boundary configuration", () => {
    expect(() => createGossipBoundaries({ typo: 1 })).toThrowError(
      expect.objectContaining({ code: "ERR_GOSSIP_BOUNDARY_CONFIG" }),
    );
    expect(() => createGossipBoundaries({ fanout: 0 })).toThrow(
      /positive integer/i,
    );
    expect(() =>
      createGossipBoundaries({ fanout: 2, maxPeersPerCommunity: 1 }),
    ).toThrow(/fanout must not exceed/i);
    expect(() =>
      createGossipBoundaries({ fanout: 2, maxConcurrentSends: 1 }),
    ).toThrow(/fanout must not exceed/i);
    expect(() =>
      createGossipBoundaries({
        maxAnnouncementPeers: 2,
        maxConnectedPeers: 1,
      }),
    ).toThrow(/announcement/i);
  });

  it("keeps the deduplication cache at its exact capacity", () => {
    const cache = new LRUCache(2);
    cache.set("one");
    cache.set("two");
    expect(cache.has("one")).toBe(true);
    cache.set("three");

    expect(cache.size).toBe(2);
    expect(cache.has("two")).toBe(false);
    expect(cache.has("one")).toBe(true);
    expect(cache.has("three")).toBe(true);
  });

  it("bounds local and peer subscriptions transactionally", () => {
    const { protocol } = createProtocol({
      boundaries: {
        maxSubscriptions: 1,
        maxPeerCommunities: 1,
        maxPeersPerCommunity: 1,
        fanout: 1,
      },
    });

    protocol.subscribe("community-1");
    expect(() => protocol.subscribe("community-2")).toThrow(
      /subscription capacity/i,
    );
    protocol.handlePeerSubscribe("peer-1", "community-1");
    expect(() => protocol.handlePeerSubscribe("peer-2", "community-1")).toThrow(
      /peer capacity/i,
    );
    expect(() => protocol.handlePeerSubscribe("peer-1", "community-2")).toThrow(
      /peer-community capacity/i,
    );

    expect(protocol.getSubscriptions()).toEqual(["community-1"]);
    expect([...protocol.peerSubscriptions.keys()]).toEqual(["community-1"]);
    expect([...protocol.peerSubscriptions.get("community-1")]).toEqual([
      "peer-1",
    ]);
  });

  it("rejects oversized and malformed messages before retaining their IDs", async () => {
    const { protocol } = createProtocol({
      boundaries: { maxMessageBytes: 256 },
    });
    protocol.subscribe("community-1");

    await expect(
      protocol.handleIncomingMessage(
        message({ payload: { content: "x".repeat(512) } }),
      ),
    ).rejects.toMatchObject({ code: "ERR_GOSSIP_MESSAGE_TOO_LARGE" });
    await expect(
      protocol.handleIncomingMessage(message({ hops: -1 })),
    ).rejects.toMatchObject({ code: "ERR_GOSSIP_MESSAGE_INVALID" });

    expect(protocol.seenMessages.size).toBe(0);
  });

  it("does not spend deduplication capacity on expired or unsubscribed input", async () => {
    const now = Date.now();
    const { protocol } = createProtocol({ now: () => now });
    protocol.subscribe("community-1");

    await protocol.handleIncomingMessage(
      message({ id: "expired", timestamp: now - 60_001, ttl: 60_000 }),
    );
    await protocol.handleIncomingMessage(
      message({ id: "not-local", communityId: "community-2", timestamp: now }),
    );

    expect(protocol.seenMessages.size).toBe(0);
  });

  it("enforces a send deadline and releases send admission", async () => {
    vi.useFakeTimers();
    const { protocol } = createProtocol(
      { boundaries: { sendDeadlineMs: 5 } },
      { sendMessage: vi.fn(() => new Promise(() => {})) },
    );
    const forwarding = protocol.forward("peer-1", message());
    const rejected = expect(forwarding).rejects.toMatchObject({
      code: "ERR_GOSSIP_DEADLINE",
    });
    await vi.advanceTimersByTimeAsync(6);

    await rejected;
    expect(protocol.getStats().activeSends).toBe(0);
  });

  it("cancels pending sends and removes exact P2P listeners on destroy", async () => {
    let resolveSend;
    const sendMessage = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    const { p2pManager, protocol } = createProtocol({}, { sendMessage });
    await protocol.initialize();
    await protocol.initialize();
    expect(p2pManager.listenerCount("gossip:message")).toBe(1);

    const forwarding = protocol.forward("peer-1", message());
    const rejected = expect(forwarding).rejects.toMatchObject({
      code: "ERR_GOSSIP_DESTROYED",
    });
    await vi.waitFor(() => expect(resolveSend).toBeTypeOf("function"));
    await protocol.destroy();

    await rejected;
    expect(p2pManager.listenerCount("gossip:message")).toBe(0);
    expect(p2pManager.listenerCount("gossip:subscribe")).toBe(0);
    expect(p2pManager.listenerCount("gossip:unsubscribe")).toBe(0);
    resolveSend({ success: true });
    expect(() => protocol.subscribe("community-2")).toThrow(
      GossipBoundaryError,
    );
  });

  it("caps and normalizes the connected peer snapshot", () => {
    const { protocol } = createProtocol(
      { boundaries: { maxConnectedPeers: 2, maxAnnouncementPeers: 2 } },
      {
        getConnectedPeers: vi
          .fn()
          .mockReturnValue([
            "peer-1",
            { id: "peer-1" },
            { peerId: { toString: () => "peer-2" } },
            "peer-3",
          ]),
      },
    );

    expect(protocol.getConnectedPeers()).toEqual(["peer-1", "peer-2"]);
  });

  it("keeps application shutdown wired to the production instance", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const mainSource = readFileSync(
      path.resolve(testDirectory, "..", "..", "index.js"),
      "utf8",
    );
    expect(mainSource).toContain(
      "this.gossipProtocol = instances.gossipProtocol",
    );
    expect(mainSource).toContain(
      "cleanupOwnedManagers(this, SOCIAL_COLLAB_MANAGER_CLEANUP",
    );
    const policySource = readFileSync(
      path.resolve(
        testDirectory,
        "..",
        "..",
        "bootstrap",
        "social-startup-policy.js",
      ),
      "utf8",
    );
    expect(policySource).toContain('["gossipProtocol", "destroy"]');
  });
});
