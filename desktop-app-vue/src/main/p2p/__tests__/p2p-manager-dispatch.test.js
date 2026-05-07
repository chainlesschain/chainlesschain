/**
 * P2PManager wire-frame + dispatch unit tests
 *
 * Covers the helpers added to fix the broken gossip receive path:
 *   - encodeWireMessage: object / string / Uint8Array / Buffer / null
 *   - decodeWireMessage: JSON-line vs raw bytes
 *   - dispatchTypedMessage: gossip:* / call-* / message:typed / no-type passthrough
 *
 * These are pure helpers — no libp2p in this file. The 2-node end-to-end test
 * lives in __tests__/p2p-gossip-e2e.test.js.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import EventEmitter from "events";

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const P2PManager = require("../p2p-manager");
const { encodeWireMessage, decodeWireMessage, dispatchTypedMessage } =
  P2PManager;

describe("P2PManager wire-frame helpers", () => {
  describe("encodeWireMessage", () => {
    it("returns Uint8Array unchanged", () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const out = encodeWireMessage(bytes);
      expect(out).toBe(bytes);
    });

    it("converts Buffer to Uint8Array view without copy of content", () => {
      const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
      const out = encodeWireMessage(buf);
      expect(out).toBeInstanceOf(Uint8Array);
      expect(Array.from(out)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    });

    it("UTF-8 encodes plain strings", () => {
      const out = encodeWireMessage("hello 你好");
      // Realm-safe check: jsdom env can break cross-realm instanceof
      expect(out.constructor.name).toBe("Uint8Array");
      expect(new TextDecoder().decode(out)).toBe("hello 你好");
    });

    it("JSON-line encodes objects (with trailing newline)", () => {
      const out = encodeWireMessage({ type: "gossip:message", id: "abc" });
      const text = new TextDecoder().decode(out);
      expect(text.endsWith("\n")).toBe(true);
      expect(JSON.parse(text.slice(0, -1))).toEqual({
        type: "gossip:message",
        id: "abc",
      });
    });

    it("returns empty Uint8Array for null/undefined", () => {
      expect(encodeWireMessage(null).length).toBe(0);
      expect(encodeWireMessage(undefined).length).toBe(0);
    });
  });

  describe("decodeWireMessage", () => {
    it("returns kind=json for JSON-line bytes", () => {
      const bytes = encodeWireMessage({
        type: "gossip:subscribe",
        communityId: "c1",
      });
      const result = decodeWireMessage(bytes);
      expect(result.kind).toBe("json");
      expect(result.value).toEqual({
        type: "gossip:subscribe",
        communityId: "c1",
      });
    });

    it("returns kind=json for JSON without trailing newline (forgiving)", () => {
      const bytes = new TextEncoder().encode('{"type":"x"}');
      const result = decodeWireMessage(bytes);
      expect(result.kind).toBe("json");
      expect(result.value).toEqual({ type: "x" });
    });

    it("returns kind=raw for non-JSON-looking bytes (encrypted blobs)", () => {
      const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x01]);
      const result = decodeWireMessage(bytes);
      expect(result.kind).toBe("raw");
      expect(result.bytes).toBe(bytes);
    });

    it("returns kind=raw for malformed JSON that still starts with {", () => {
      const bytes = new TextEncoder().encode("{not valid json");
      const result = decodeWireMessage(bytes);
      expect(result.kind).toBe("raw");
    });

    it("returns kind=raw for empty input", () => {
      const result = decodeWireMessage(new Uint8Array(0));
      expect(result.kind).toBe("raw");
    });
  });

  describe("dispatchTypedMessage", () => {
    let emitter;

    beforeEach(() => {
      emitter = new EventEmitter();
    });

    it("dispatches gossip:message with merged fromPeerId", () => {
      const handler = vi.fn();
      emitter.on("gossip:message", handler);

      const result = dispatchTypedMessage(
        emitter,
        {
          type: "gossip:message",
          protocol: "/cc/gossip/1.0.0",
          data: {
            id: "msg-1",
            communityId: "c1",
            payload: { hi: 1 },
            sender: "peer-A",
          },
        },
        "peer-from-conn",
      );

      expect(result).toEqual({ dispatched: true, type: "gossip:message" });
      expect(handler).toHaveBeenCalledWith({
        id: "msg-1",
        communityId: "c1",
        payload: { hi: 1 },
        sender: "peer-A",
        fromPeerId: "peer-from-conn",
      });
    });

    it("dispatches gossip:subscribe with peerId + communityId", () => {
      const handler = vi.fn();
      emitter.on("gossip:subscribe", handler);

      dispatchTypedMessage(
        emitter,
        { type: "gossip:subscribe", peerId: "peer-A", communityId: "c1" },
        "peer-from-conn",
      );

      expect(handler).toHaveBeenCalledWith({
        peerId: "peer-A",
        communityId: "c1",
      });
    });

    it("falls back to fromPeerId when wire message lacks peerId", () => {
      const handler = vi.fn();
      emitter.on("gossip:unsubscribe", handler);

      dispatchTypedMessage(
        emitter,
        { type: "gossip:unsubscribe", communityId: "c1" },
        "peer-from-conn",
      );

      expect(handler).toHaveBeenCalledWith({
        peerId: "peer-from-conn",
        communityId: "c1",
      });
    });

    it("dispatches call-signaling under message:call-signaling", () => {
      const handler = vi.fn();
      emitter.on("message:call-signaling", handler);

      dispatchTypedMessage(emitter, {
        type: "call-signaling",
        data: { sdp: "..." },
      });

      expect(handler).toHaveBeenCalledWith({ sdp: "..." });
    });

    it("dispatches unknown typed messages under message:typed", () => {
      const handler = vi.fn();
      emitter.on("message:typed", handler);

      dispatchTypedMessage(emitter, {
        type: "knowledge:sync-request",
        payload: { since: 0 },
      });

      expect(handler).toHaveBeenCalledWith({
        type: "knowledge:sync-request",
        payload: { since: 0 },
      });
    });

    it("does not dispatch when type is missing", () => {
      const handler = vi.fn();
      emitter.on("message:typed", handler);
      emitter.on("gossip:message", handler);

      const result = dispatchTypedMessage(emitter, { foo: "bar" });

      expect(result).toEqual({ dispatched: false, type: null });
      expect(handler).not.toHaveBeenCalled();
    });

    it("does not dispatch when parsed is not an object", () => {
      const handler = vi.fn();
      emitter.on("message:typed", handler);

      expect(dispatchTypedMessage(emitter, null)).toEqual({
        dispatched: false,
        type: null,
      });
      expect(dispatchTypedMessage(emitter, "string")).toEqual({
        dispatched: false,
        type: null,
      });
      expect(dispatchTypedMessage(emitter, 42)).toEqual({
        dispatched: false,
        type: null,
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("encode + decode round-trip", () => {
    it("survives JSON-line round-trip and dispatches correctly", () => {
      const emitter = new EventEmitter();
      const handler = vi.fn();
      emitter.on("gossip:message", handler);

      const wire = {
        type: "gossip:message",
        protocol: "/chainlesschain/gossip/1.0.0",
        data: {
          id: "msg-xyz",
          communityId: "comm-42",
          payload: {
            type: "channel_message",
            channelId: "ch-1",
            message: { body: "hi" },
          },
          sender: "12D3KooWa...",
          timestamp: 1700000000000,
          ttl: 3600000,
          hops: 1,
        },
      };

      const bytes = encodeWireMessage(wire);
      const decoded = decodeWireMessage(bytes);
      expect(decoded.kind).toBe("json");

      dispatchTypedMessage(emitter, decoded.value, "peer-conn");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "msg-xyz",
          communityId: "comm-42",
          payload: expect.objectContaining({ type: "channel_message" }),
          sender: "12D3KooWa...",
          fromPeerId: "peer-conn",
        }),
      );
    });
  });
});
