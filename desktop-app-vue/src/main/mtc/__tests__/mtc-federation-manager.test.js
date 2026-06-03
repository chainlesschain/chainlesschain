/**
 * MtcFederationManager unit tests
 *
 * Covers Phase B1 transport-layer wrapper using a mocked Libp2pTransport
 * (subscribeRaw / publishRaw / connect / close). The real-libp2p e2e is
 * Phase B3 in `__tests__/mtc-federation-roundtrip.test.js`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  MtcFederationManager,
  topicForCommunity,
  TOPIC_PREFIX,
  TOPIC_SUFFIX,
} = require("../mtc-federation-manager.js");

function createMockTransport() {
  const handlers = new Map(); // topic → handler
  return {
    publishRaw: vi.fn(async (topic, bytes) => ({
      recipients: handlers.has(topic) ? 1 : 0,
      _topic: topic,
      _bytes: bytes,
    })),
    subscribeRaw: vi.fn((topic, handler) => {
      handlers.set(topic, handler);
      return () => {
        if (handlers.get(topic) === handler) {
          handlers.delete(topic);
        }
      };
    }),
    connect: vi.fn(async () => undefined),
    multiaddrs: vi.fn(() => ["/ip4/127.0.0.1/tcp/12345/p2p/12D3KooWMock"]),
    peerIdString: vi.fn(() => "12D3KooWMock"),
    close: vi.fn(async () => undefined),

    // Test helpers (not part of the real Libp2pTransport API):
    _fire(topic, bytes) {
      const h = handlers.get(topic);
      if (h) {
        h(bytes);
      }
    },
    _handlers: handlers,
  };
}

function makeBytes(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}

describe("MtcFederationManager", () => {
  let transport;
  let mgr;

  beforeEach(async () => {
    transport = createMockTransport();
    mgr = new MtcFederationManager({
      transportFactory: async () => transport,
    });
    await mgr.initialize();
  });

  describe("topicForCommunity helper", () => {
    it("formats correctly", () => {
      expect(topicForCommunity("c1")).toBe("cc.community.c1.events");
      expect(TOPIC_PREFIX).toBe("cc.community.");
      expect(TOPIC_SUFFIX).toBe(".events");
    });

    it("rejects empty / non-string", () => {
      expect(() => topicForCommunity("")).toThrow(TypeError);
      expect(() => topicForCommunity(null)).toThrow(TypeError);
      expect(() => topicForCommunity(42)).toThrow(TypeError);
    });
  });

  describe("initialize / lifecycle", () => {
    it("is idempotent", async () => {
      await mgr.initialize();
      await mgr.initialize();
      expect(mgr.isInitialized()).toBe(true);
    });

    it("throws if used before initialize", async () => {
      const fresh = new MtcFederationManager({
        transportFactory: async () => transport,
      });
      await expect(fresh.publishCommunityEvent("c1", { a: 1 })).rejects.toThrow(
        /not initialized/,
      );
      await expect(fresh.subscribeCommunity("c1", () => {})).rejects.toThrow(
        /not initialized/,
      );
    });

    it("close() tears down transport + unsubscribes all + idempotent", async () => {
      await mgr.subscribeCommunity("c1", () => {});
      await mgr.subscribeCommunity("c2", () => {});
      expect(mgr.getSubscriptions().sort()).toEqual(["c1", "c2"]);
      await mgr.close();
      expect(transport.close).toHaveBeenCalledOnce();
      expect(mgr.isInitialized()).toBe(false);
      expect(mgr.getSubscriptions()).toEqual([]);
      // idempotent
      await mgr.close();
    });

    it("throws on use after close", async () => {
      await mgr.close();
      await expect(mgr.publishCommunityEvent("c1", { a: 1 })).rejects.toThrow(
        /closed/,
      );
    });
  });

  describe("publishCommunityEvent", () => {
    it("encodes JSON and calls transport.publishRaw on the right topic", async () => {
      await mgr.publishCommunityEvent("c1", {
        type: "channel_message",
        channelId: "ch1",
        message: { id: "m1", body: "hi" },
      });
      expect(transport.publishRaw).toHaveBeenCalledOnce();
      const [topic, bytes] = transport.publishRaw.mock.calls[0];
      expect(topic).toBe("cc.community.c1.events");
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect(decoded).toEqual({
        type: "channel_message",
        channelId: "ch1",
        message: { id: "m1", body: "hi" },
      });
    });

    it("rejects non-object payloads", async () => {
      await expect(mgr.publishCommunityEvent("c1", "string")).rejects.toThrow(
        TypeError,
      );
      await expect(mgr.publishCommunityEvent("c1", null)).rejects.toThrow(
        TypeError,
      );
    });

    it("returns recipients count from transport", async () => {
      await mgr.subscribeCommunity("c1", () => {});
      const result = await mgr.publishCommunityEvent("c1", { type: "x" });
      expect(result.recipients).toBe(1);
    });
  });

  describe("subscribeCommunity", () => {
    it("decodes JSON and dispatches to handler", async () => {
      const handler = vi.fn();
      await mgr.subscribeCommunity("c1", handler);
      transport._fire(
        "cc.community.c1.events",
        makeBytes({ type: "channel_message", channelId: "ch1" }),
      );
      expect(handler).toHaveBeenCalledWith({
        type: "channel_message",
        channelId: "ch1",
      });
    });

    it("idempotent — second subscribe replaces handler not topic", async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      await mgr.subscribeCommunity("c1", h1);
      await mgr.subscribeCommunity("c1", h2);
      // Only one subscribeRaw call total
      expect(transport.subscribeRaw).toHaveBeenCalledOnce();
      transport._fire("cc.community.c1.events", makeBytes({ type: "x" }));
      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalledOnce();
    });

    it("malformed JSON does not crash, handler not called", async () => {
      const handler = vi.fn();
      await mgr.subscribeCommunity("c1", handler);
      transport._fire(
        "cc.community.c1.events",
        new TextEncoder().encode("not json"),
      );
      expect(handler).not.toHaveBeenCalled();
    });

    it("handler exception is swallowed (other handlers continue)", async () => {
      const h1 = vi.fn(() => {
        throw new Error("boom");
      });
      await mgr.subscribeCommunity("c1", h1);
      // Should not throw
      transport._fire("cc.community.c1.events", makeBytes({ type: "x" }));
      expect(h1).toHaveBeenCalledOnce();
    });

    it("rejects non-function handler", async () => {
      await expect(mgr.subscribeCommunity("c1", "not-a-fn")).rejects.toThrow(
        TypeError,
      );
    });
  });

  describe("unsubscribeCommunity", () => {
    it("removes handler + calls returned unsub fn", async () => {
      const handler = vi.fn();
      await mgr.subscribeCommunity("c1", handler);
      mgr.unsubscribeCommunity("c1");
      expect(mgr.getSubscriptions()).toEqual([]);
      // Verify the underlying transport handler is gone
      expect(transport._handlers.has("cc.community.c1.events")).toBe(false);
      transport._fire("cc.community.c1.events", makeBytes({ type: "x" }));
      expect(handler).not.toHaveBeenCalled();
    });

    it("idempotent on unknown communityId", () => {
      expect(() => mgr.unsubscribeCommunity("never-subscribed")).not.toThrow();
    });
  });

  describe("connectPeer + multiaddrs / peerIdString", () => {
    it("delegates to transport", async () => {
      await mgr.connectPeer("/ip4/127.0.0.1/tcp/9999/p2p/12D3KooWPeer");
      expect(transport.connect).toHaveBeenCalledWith(
        "/ip4/127.0.0.1/tcp/9999/p2p/12D3KooWPeer",
      );
      expect(mgr.multiaddrs()).toEqual([
        "/ip4/127.0.0.1/tcp/12345/p2p/12D3KooWMock",
      ]);
      expect(mgr.peerIdString()).toBe("12D3KooWMock");
    });
  });
});
