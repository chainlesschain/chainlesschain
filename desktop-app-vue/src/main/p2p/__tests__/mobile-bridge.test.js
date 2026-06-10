/**
 * MobileBridge — Plan A.1 Phase 4 LRU dedup unit tests
 *
 * Covers the gap left by commit fc3752360 (which shipped the 47-line LRU
 * implementation in `bridgeToLibp2p` but no test). §5.1 of
 * `docs/design/Android_Remote_Terminal_Plan_A1.md` explicitly lists this as
 * a required unit test.
 *
 * Behaviour under test:
 *  1. Second arrival of the same `payload.id` for a `chainlesschain:command:request`
 *     is dropped → `message-from-mobile` emits exactly once.
 *  2. Distinct ids both pass.
 *  3. `command:request` (short alias) is also de-dup'd.
 *  4. Frame types outside the dedup whitelist (notifications, plain forwards,
 *     reverse RPC responses) are never short-circuited.
 *  5. After TTL (30s default) the same id can re-enter.
 *  6. When the map exceeds 128 entries, the oldest insertion is evicted —
 *     letting the oldest id pass again on its next arrival.
 *
 * Mocks: heavy native deps (`ws`, `wrtc-compat`) are mocked at module level so
 * the suite can run on any host (Windows dev box → CI Linux).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock heavy native deps ───────────────────────────────────────────────────
// `ws` is only used by signaling connection (`connect()`); we never call it.
// A stub class avoids a runtime crash if a future regression starts touching it.
vi.mock("ws", () => ({
  default: class StubWebSocket {},
  WebSocket: class StubWebSocket {},
}));

// `wrtc-compat` wraps `node-datachannel`. Marking it unavailable keeps the
// `if (!wrtcAvailable)` warn branch silent (logger is already a vi.fn()).
vi.mock("../wrtc-compat", () => ({
  default: { available: false, loadError: new Error("test stub") },
  available: false,
  loadError: new Error("test stub"),
}));

// ─── Module under test ────────────────────────────────────────────────────────
const MobileBridge = require("../mobile-bridge");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createBridge(overrides = {}) {
  const p2pManager = {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    broadcast: vi.fn(),
    getConnectedPeers: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
  };
  // Lower max for capacity-eviction test; otherwise the suite would need
  // 129 frames per assertion which inflates runtime needlessly.
  const bridge = new MobileBridge(p2pManager, overrides);
  return { bridge, p2pManager };
}

/** Build a `chainlesschain:command:request` frame as Android would send it. */
function commandRequestFrame(id, method = "terminal.create") {
  return JSON.stringify({
    type: "chainlesschain:command:request",
    payload: {
      id,
      method,
      params: {},
    },
  });
}

/** Collect every `message-from-mobile` event emitted by the bridge. */
function captureEmits(bridge) {
  const events = [];
  bridge.on("message-from-mobile", (e) => events.push(e));
  return events;
}

describe("MobileBridge — Plan A.1 Phase 4 LRU dedup", () => {
  describe("inbound command:request dedup", () => {
    let bridge;
    let p2pManager;
    let events;

    beforeEach(() => {
      ({ bridge, p2pManager } = createBridge());
      events = captureEmits(bridge);
    });

    it("emits exactly once when the same requestId arrives twice", async () => {
      const frame = commandRequestFrame("req-1");
      await bridge.bridgeToLibp2p("mobile-A", frame);
      await bridge.bridgeToLibp2p("mobile-A", frame);

      expect(events).toHaveLength(1);
      expect(events[0].mobilePeerId).toBe("mobile-A");
      expect(events[0].message.payload.id).toBe("req-1");
    });

    it("emits twice for two distinct requestIds", async () => {
      await bridge.bridgeToLibp2p("mobile-A", commandRequestFrame("req-1"));
      await bridge.bridgeToLibp2p("mobile-A", commandRequestFrame("req-2"));

      expect(events).toHaveLength(2);
      expect(events.map((e) => e.message.payload.id)).toEqual([
        "req-1",
        "req-2",
      ]);
    });

    it("dedups the `command:request` short-alias type as well", async () => {
      const frame = JSON.stringify({
        type: "command:request",
        payload: { id: "req-short", method: "ai.chat", params: {} },
      });
      await bridge.bridgeToLibp2p("mobile-A", frame);
      await bridge.bridgeToLibp2p("mobile-A", frame);

      expect(events).toHaveLength(1);
    });

    it("does NOT dedup frames outside the whitelist (e.g. plain notification)", async () => {
      // Pair-ack / generic events / plain forwards have their own handlers
      // and must not be short-circuited by the request LRU.
      const notif = JSON.stringify({
        type: "chainlesschain:event",
        payload: { id: "ev-1", event: "terminal.stdout", chunk: "hi" },
      });
      await bridge.bridgeToLibp2p("mobile-A", notif);
      await bridge.bridgeToLibp2p("mobile-A", notif);

      expect(events).toHaveLength(2);
    });

    it("does NOT dedup JSON-RPC 2.0 reverse responses (own handler path)", async () => {
      // jsonrpc:"2.0" responses are intercepted *before* the dedup check
      // (mobile-bridge.js:910-931) and short-circuit via pendingReverseRpc.
      // No pending entry → message simply falls through to dedup, but type
      // isn't `command:request` so it should still emit twice.
      const resp = JSON.stringify({
        jsonrpc: "2.0",
        id: "ignored",
        result: { ok: true },
      });
      await bridge.bridgeToLibp2p("mobile-A", resp);
      await bridge.bridgeToLibp2p("mobile-A", resp);

      expect(events).toHaveLength(2);
    });
  });

  describe("TTL expiration", () => {
    it("admits the same id again after the 30s TTL window elapses", async () => {
      const { bridge } = createBridge();
      const events = captureEmits(bridge);

      // Shrink the TTL so the test stays fast. The map and gc helper both
      // read this property each call, so mutation is safe post-construction.
      // 200ms (was 50ms): a 50ms window flaked under load because the two
      // awaited bridge calls below could themselves span >50ms, expiring the
      // TTL before the dedup assertion and admitting the duplicate.
      bridge.RECENT_MOBILE_REQUEST_TTL_MS = 200;

      await bridge.bridgeToLibp2p("mobile-A", commandRequestFrame("req-ttl"));
      expect(events).toHaveLength(1);

      // Still inside TTL → drop.
      await bridge.bridgeToLibp2p("mobile-A", commandRequestFrame("req-ttl"));
      expect(events).toHaveLength(1);

      // Wait past the TTL so the id is evicted and admissible again.
      await new Promise((r) => setTimeout(r, 260));

      await bridge.bridgeToLibp2p("mobile-A", commandRequestFrame("req-ttl"));
      expect(events).toHaveLength(2);
    });
  });

  describe("capacity eviction (128 entries)", () => {
    it("evicts the oldest entry when MAX is exceeded, letting it pass again", async () => {
      // Cap at 4 so we don't need 129 frames per case.
      const { bridge } = createBridge();
      bridge.RECENT_MOBILE_REQUEST_MAX = 4;
      const events = captureEmits(bridge);

      // Fill the LRU to its cap with ids r1..r4.
      for (let i = 1; i <= 4; i++) {
        await bridge.bridgeToLibp2p("mobile-A", commandRequestFrame(`r${i}`));
      }
      expect(events).toHaveLength(4);

      // r5 arrives — pushes r1 out of the LRU (eldest dropped).
      await bridge.bridgeToLibp2p("mobile-A", commandRequestFrame("r5"));
      expect(events).toHaveLength(5);

      // r1 should be admissible again now that it's no longer in the map.
      // (re-inserting r1 pushes the map over MAX again and evicts the next-
      // eldest, r2 — so r2 is also no longer in the map after this step.)
      await bridge.bridgeToLibp2p("mobile-A", commandRequestFrame("r1"));
      expect(events).toHaveLength(6);

      // r3 is still resident (map is now {r3, r4, r5, r1}) → drop.
      await bridge.bridgeToLibp2p("mobile-A", commandRequestFrame("r3"));
      expect(events).toHaveLength(6);
    });
  });

  describe("sendToMobile transport priority (Plan A.1 §3.3 + Phase 4)", () => {
    // Phase 4 design: when DC is OPEN, send via DataChannel only; when DC is
    // not ready, fall back to LAN signaling + public-relay DOUBLE-send for
    // stability (and the Android-side LRU handles dedup on receive).

    let bridge;
    let dcSend;
    let signalingSend;
    let relaySend;

    beforeEach(() => {
      ({ bridge } = createBridge());
      dcSend = vi.fn();
      signalingSend = vi.fn();
      relaySend = vi.fn();

      // `send()` is the signaling-WS path. Replace it with a spy so we don't
      // need a real WebSocket.
      bridge.send = signalingSend;

      // Public-relay double-send is dispatched through `global.__ccRelayClient`.
      global.__ccRelayClient = { send: relaySend };
    });

    afterEach(() => {
      delete global.__ccRelayClient;
    });

    it("DC OPEN → DataChannel.send only, signaling + relay untouched", async () => {
      bridge.dataChannels.set("mobile-A", { readyState: "open", send: dcSend });

      await bridge.sendToMobile("mobile-A", { hello: "world" });

      expect(dcSend).toHaveBeenCalledTimes(1);
      expect(dcSend).toHaveBeenCalledWith(JSON.stringify({ hello: "world" }));
      expect(signalingSend).not.toHaveBeenCalled();
      expect(relaySend).not.toHaveBeenCalled();
    });

    it("accepts multiple werift-compatible readyState shapes (1, 'Open', 'OPEN')", async () => {
      // mobile-bridge.js:997-1002 normalises across werift's quirky shapes
      // and node-datachannel's W3C values.
      for (const ready of [1, "Open", "OPEN", "open"]) {
        dcSend.mockClear();
        signalingSend.mockClear();
        relaySend.mockClear();
        bridge.dataChannels.set("mobile-A", {
          readyState: ready,
          send: dcSend,
        });
        await bridge.sendToMobile("mobile-A", { ready });
        expect(dcSend).toHaveBeenCalledTimes(1);
        expect(signalingSend).not.toHaveBeenCalled();
        expect(relaySend).not.toHaveBeenCalled();
      }
    });

    it("DC missing → fallback to LAN signaling AND public-relay double-send", async () => {
      // No entry in this.dataChannels at all.
      await bridge.sendToMobile("mobile-A", { fallback: true });

      expect(dcSend).not.toHaveBeenCalled();
      expect(signalingSend).toHaveBeenCalledTimes(1);
      expect(signalingSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "message",
          to: "mobile-A",
          payload: { fallback: true },
        }),
      );
      expect(relaySend).toHaveBeenCalledTimes(1);
      expect(relaySend).toHaveBeenCalledWith(
        "mobile-A",
        expect.objectContaining({
          type: "message",
          payload: { fallback: true },
        }),
      );
    });

    it("DC CLOSED state → still fallback (readyState 'closed')", async () => {
      bridge.dataChannels.set("mobile-A", {
        readyState: "closed",
        send: dcSend,
      });

      await bridge.sendToMobile("mobile-A", { closed: true });

      expect(dcSend).not.toHaveBeenCalled();
      expect(signalingSend).toHaveBeenCalledTimes(1);
      expect(relaySend).toHaveBeenCalledTimes(1);
    });

    it("missing relay client → signaling-only fallback does not throw", async () => {
      delete global.__ccRelayClient;
      await expect(
        bridge.sendToMobile("mobile-A", { onlySignaling: true }),
      ).resolves.not.toThrow();
      expect(signalingSend).toHaveBeenCalledTimes(1);
      expect(relaySend).not.toHaveBeenCalled();
    });
  });

  describe("guard rails", () => {
    it("ignores malformed JSON without crashing or emitting", async () => {
      const { bridge } = createBridge();
      const events = captureEmits(bridge);

      await bridge.bridgeToLibp2p("mobile-A", "{not valid json");

      expect(events).toHaveLength(0);
    });

    it("does not dedup when payload.id is missing", async () => {
      // Without an id we can't key the LRU, so the frame must always pass
      // through to handleMobileCommand (which has its own routing logic).
      const { bridge } = createBridge();
      const events = captureEmits(bridge);
      const noId = JSON.stringify({
        type: "chainlesschain:command:request",
        payload: { method: "ai.chat", params: {} },
      });
      await bridge.bridgeToLibp2p("mobile-A", noId);
      await bridge.bridgeToLibp2p("mobile-A", noId);

      expect(events).toHaveLength(2);
    });
  });
});

describe("MobileBridge — FAMILY-60 family.time responder", () => {
  let bridge;
  let sendSpy;

  beforeEach(() => {
    ({ bridge } = createBridge());
    sendSpy = vi.fn();
    bridge.send = sendSpy;
  });

  it("replies to a family.time.request with parentEpochMs + matching requestId", async () => {
    await bridge.handleP2PMessage({
      from: "mobile-child",
      payload: {
        type: "chainlesschain:family:time:request",
        requestId: "time-req-1",
      },
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = sendSpy.mock.calls[0][0];
    expect(sent.type).toBe("message");
    expect(sent.to).toBe("mobile-child");
    expect(sent.payload.type).toBe("chainlesschain:family:time:response");
    expect(sent.payload.requestId).toBe("time-req-1");
    expect(sent.payload.parentEpochMs).toBeTypeOf("number");
    // Sanity: a real epoch-ms wall clock (after 2020-09-13).
    expect(sent.payload.parentEpochMs).toBeGreaterThan(1_600_000_000_000);
  });

  it("does NOT bridge a time request to libp2p", async () => {
    const bridgeSpy = vi
      .spyOn(bridge, "bridgeToLibp2p")
      .mockResolvedValue(undefined);

    await bridge.handleP2PMessage({
      from: "mobile-child",
      payload: { type: "chainlesschain:family:time:request", requestId: "r" },
    });

    expect(bridgeSpy).not.toHaveBeenCalled();
  });

  it("bridges non-time P2P messages normally (responder is scoped)", async () => {
    const bridgeSpy = vi
      .spyOn(bridge, "bridgeToLibp2p")
      .mockResolvedValue(undefined);

    await bridge.handleP2PMessage({
      from: "mobile-child",
      payload: { type: "chainlesschain:event", payload: { event: "x" } },
    });

    expect(sendSpy).not.toHaveBeenCalled();
    expect(bridgeSpy).toHaveBeenCalledTimes(1);
  });
});
