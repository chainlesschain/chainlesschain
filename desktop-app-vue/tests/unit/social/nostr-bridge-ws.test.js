/**
 * NostrBridge WebSocket Integration Tests
 *
 * Covers the real WebSocket implementation:
 * - connectRelay(): creates real WebSocket, wires open/close/error/message handlers
 * - _handleRelayMessage(): parses NIP-01 EVENT, EOSE, OK, NOTICE messages
 * - _storeIncomingEvent(): stores received events in DB
 * - _scheduleReconnect(): exponential backoff reconnect logic
 * - _cancelReconnect(): cancels pending reconnect timers
 * - publishEvent(): sends via ws.send() to connected relays
 * - disconnectRelay(): cancels reconnect on intentional disconnect
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import EventEmitter from "events";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock uuid ────────────────────────────────────────────────────────────────
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ─── Mock crypto ──────────────────────────────────────────────────────────────
vi.mock("crypto", () => {
  const hashDigest = "a".repeat(64);
  return {
    default: {
      randomBytes: (n) => ({
        toString: () => "b".repeat(n * 2),
      }),
      createHash: () => ({
        update: () => ({
          digest: () => hashDigest,
        }),
      }),
    },
    randomBytes: (n) => ({
      toString: () => "b".repeat(n * 2),
    }),
    createHash: () => ({
      update: () => ({
        digest: () => hashDigest,
      }),
    }),
  };
});

// ─── Mock WebSocket ──────────────────────────────────────────────────────────
class MockWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.sentMessages = [];
    this._terminated = false;
    MockWebSocket._lastInstance = this;
    MockWebSocket._instances.push(this);
  }

  send(data) {
    if (this.readyState !== 1) {
      throw new Error("WebSocket is not open");
    }
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    this.emit("close");
  }

  terminate() {
    this._terminated = true;
    this.readyState = 3;
  }

  // Simulate successful connection
  _simulateOpen() {
    this.readyState = 1; // OPEN
    this.emit("open");
  }

  _simulateMessage(data) {
    this.emit("message", JSON.stringify(data));
  }

  _simulateError(err) {
    this.emit("error", err);
  }

  _simulateClose() {
    this.readyState = 3;
    this.emit("close");
  }
}

MockWebSocket.OPEN = 1;
MockWebSocket._instances = [];
MockWebSocket._lastInstance = null;

vi.mock("ws", () => ({
  default: MockWebSocket,
  WebSocket: MockWebSocket,
}));

// ─── DB mock ──────────────────────────────────────────────────────────────────
let mockRunStmt, mockAllStmt, mockDb;

beforeEach(() => {
  uuidCounter = 0;
  MockWebSocket._instances = [];
  MockWebSocket._lastInstance = null;
  vi.useFakeTimers();

  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (
        sql.includes("INSERT") ||
        sql.includes("UPDATE") ||
        sql.includes("DELETE")
      ) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Module under test ──────────────────────────────────────────────────────
let NostrBridge;

beforeEach(async () => {
  const mod = await import("../../../src/main/social/nostr-bridge.js");
  NostrBridge = mod.NostrBridge;
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("NostrBridge WebSocket", () => {
  let bridge;

  beforeEach(async () => {
    bridge = new NostrBridge({ db: mockDb });
    await bridge.initialize();
    await bridge.addRelay("wss://relay.example.com");
  });

  // ── connectRelay ─────────────────────────────────────────────────────────
  describe("connectRelay()", () => {
    it("should create a WebSocket and resolve on open", async () => {
      const connectPromise = bridge.connectRelay("wss://relay.example.com");
      const ws = MockWebSocket._lastInstance;
      expect(ws).toBeTruthy();
      expect(ws.url).toBe("wss://relay.example.com");

      ws._simulateOpen();

      const result = await connectPromise;
      expect(result.success).toBe(true);
      expect(result.status).toBe("connected");
    });

    it("should set relay status to connected after open", async () => {
      const connectPromise = bridge.connectRelay("wss://relay.example.com");
      MockWebSocket._lastInstance._simulateOpen();
      await connectPromise;

      const relay = bridge._relays.get("wss://relay.example.com");
      expect(relay.status).toBe("connected");
      expect(relay.ws).toBeTruthy();
    });

    it("should emit relay:connecting and relay:connected events", async () => {
      const connectingHandler = vi.fn();
      const connectedHandler = vi.fn();
      bridge.on("relay:connecting", connectingHandler);
      bridge.on("relay:connected", connectedHandler);

      const connectPromise = bridge.connectRelay("wss://relay.example.com");
      expect(connectingHandler).toHaveBeenCalledWith({
        url: "wss://relay.example.com",
      });

      MockWebSocket._lastInstance._simulateOpen();
      await connectPromise;
      expect(connectedHandler).toHaveBeenCalledWith({
        url: "wss://relay.example.com",
      });
    });

    it("should update database on successful connection", async () => {
      const connectPromise = bridge.connectRelay("wss://relay.example.com");
      MockWebSocket._lastInstance._simulateOpen();
      await connectPromise;

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE nostr_relays SET status"),
      );
    });

    it("should return already connected if relay is connected", async () => {
      const connectPromise = bridge.connectRelay("wss://relay.example.com");
      MockWebSocket._lastInstance._simulateOpen();
      await connectPromise;

      const result = await bridge.connectRelay("wss://relay.example.com");
      expect(result.message).toBe("Already connected");
    });

    it("should throw for unknown relay URL", async () => {
      await expect(bridge.connectRelay("wss://unknown.com")).rejects.toThrow(
        "Relay not found",
      );
    });

    it("should reset reconnect attempts on successful connection", async () => {
      bridge._reconnectAttempts.set("wss://relay.example.com", 5);
      const connectPromise = bridge.connectRelay("wss://relay.example.com");
      MockWebSocket._lastInstance._simulateOpen();
      await connectPromise;

      expect(bridge._reconnectAttempts.has("wss://relay.example.com")).toBe(
        false,
      );
    });
  });

  // ── _handleRelayMessage ──────────────────────────────────────────────────
  describe("_handleRelayMessage()", () => {
    it("should emit event:received for EVENT messages", () => {
      const handler = vi.fn();
      bridge.on("event:received", handler);

      const event = {
        id: "evt-1",
        pubkey: "pk1",
        kind: 1,
        content: "hello",
        tags: [],
        sig: "sig1",
        created_at: 100,
      };
      bridge._handleRelayMessage(
        "wss://relay.example.com",
        JSON.stringify(["EVENT", "sub-1", event]),
      );

      expect(handler).toHaveBeenCalledWith({
        event,
        subscriptionId: "sub-1",
        relayUrl: "wss://relay.example.com",
      });
    });

    it("should emit subscription:eose for EOSE messages", () => {
      const handler = vi.fn();
      bridge.on("subscription:eose", handler);

      bridge._handleRelayMessage(
        "wss://relay.example.com",
        JSON.stringify(["EOSE", "sub-1"]),
      );

      expect(handler).toHaveBeenCalledWith({
        subscriptionId: "sub-1",
        relayUrl: "wss://relay.example.com",
      });
    });

    it("should emit event:status for OK messages", () => {
      const handler = vi.fn();
      bridge.on("event:status", handler);

      bridge._handleRelayMessage(
        "wss://relay.example.com",
        JSON.stringify(["OK", "evt-1", true, ""]),
      );

      expect(handler).toHaveBeenCalledWith({
        eventId: "evt-1",
        accepted: true,
        reason: "",
        relayUrl: "wss://relay.example.com",
      });
    });

    it("should emit relay:notice for NOTICE messages", () => {
      const handler = vi.fn();
      bridge.on("relay:notice", handler);

      bridge._handleRelayMessage(
        "wss://relay.example.com",
        JSON.stringify(["NOTICE", "rate limited"]),
      );

      expect(handler).toHaveBeenCalledWith({
        notice: "rate limited",
        relayUrl: "wss://relay.example.com",
      });
    });

    it("should handle Buffer input", () => {
      const handler = vi.fn();
      bridge.on("relay:notice", handler);

      const buf = Buffer.from(JSON.stringify(["NOTICE", "hello"]));
      bridge._handleRelayMessage("wss://relay.example.com", buf);

      expect(handler).toHaveBeenCalled();
    });

    it("should not throw on malformed JSON", () => {
      expect(() => {
        bridge._handleRelayMessage("wss://relay.example.com", "not json");
      }).not.toThrow();
    });

    it("should ignore non-array messages", () => {
      const handler = vi.fn();
      bridge.on("event:received", handler);

      bridge._handleRelayMessage(
        "wss://relay.example.com",
        JSON.stringify({ type: "invalid" }),
      );
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── _storeIncomingEvent ─────────────────────────────────────────────────
  describe("_storeIncomingEvent()", () => {
    it("should insert event into database", () => {
      const event = {
        id: "evt-1",
        pubkey: "pk1",
        kind: 1,
        content: "test",
        tags: [["p", "pk2"]],
        sig: "sig1",
        created_at: 100,
      };
      bridge._storeIncomingEvent(event, "wss://relay.example.com");

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR IGNORE INTO nostr_events"),
      );
      expect(mockRunStmt.run).toHaveBeenCalledWith(
        "evt-1",
        "pk1",
        1,
        "test",
        JSON.stringify([["p", "pk2"]]),
        "sig1",
        100,
        "wss://relay.example.com",
      );
    });

    it("should not throw when database is not available", () => {
      const noBridge = new NostrBridge(null);
      expect(() =>
        noBridge._storeIncomingEvent({ id: "x" }, "url"),
      ).not.toThrow();
    });
  });

  // ── _scheduleReconnect ──────────────────────────────────────────────────
  describe("_scheduleReconnect()", () => {
    it("should set a reconnect timer", () => {
      bridge._scheduleReconnect("wss://relay.example.com");
      expect(bridge._reconnectTimers.has("wss://relay.example.com")).toBe(true);
    });

    it("should use exponential backoff", () => {
      bridge._scheduleReconnect("wss://relay.example.com");
      expect(bridge._reconnectAttempts.get("wss://relay.example.com")).toBe(1);

      bridge._cancelReconnect("wss://relay.example.com");
      bridge._reconnectAttempts.set("wss://relay.example.com", 1);
      bridge._scheduleReconnect("wss://relay.example.com");
      expect(bridge._reconnectAttempts.get("wss://relay.example.com")).toBe(2);
    });

    it("should not schedule if relay was removed", () => {
      bridge._relays.delete("wss://relay.example.com");
      bridge._scheduleReconnect("wss://relay.example.com");
      expect(bridge._reconnectTimers.has("wss://relay.example.com")).toBe(
        false,
      );
    });
  });

  // ── _cancelReconnect ────────────────────────────────────────────────────
  describe("_cancelReconnect()", () => {
    it("should clear reconnect timer and attempts", () => {
      bridge._scheduleReconnect("wss://relay.example.com");
      expect(bridge._reconnectTimers.has("wss://relay.example.com")).toBe(true);

      bridge._cancelReconnect("wss://relay.example.com");
      expect(bridge._reconnectTimers.has("wss://relay.example.com")).toBe(
        false,
      );
      expect(bridge._reconnectAttempts.has("wss://relay.example.com")).toBe(
        false,
      );
    });

    it("should be safe to call when no timer exists", () => {
      expect(() =>
        bridge._cancelReconnect("wss://nonexistent.com"),
      ).not.toThrow();
    });
  });

  // ── publishEvent with real ws.send ──────────────────────────────────────
  describe("publishEvent() with WebSocket", () => {
    it("should call ws.send() on connected relays", async () => {
      const connectPromise = bridge.connectRelay("wss://relay.example.com");
      MockWebSocket._lastInstance._simulateOpen();
      await connectPromise;

      const result = await bridge.publishEvent({
        kind: 1,
        content: "hello nostr",
      });
      expect(result.success).toBe(true);
      expect(result.sentCount).toBe(1);

      const ws = MockWebSocket._lastInstance;
      expect(ws.sentMessages.length).toBe(1);
      const sent = JSON.parse(ws.sentMessages[0]);
      expect(sent[0]).toBe("EVENT");
      expect(sent[1].content).toBe("hello nostr");
      expect(sent[1].kind).toBe(1);
    });

    it("should not send to disconnected relays", async () => {
      const result = await bridge.publishEvent({ kind: 1, content: "test" });
      expect(result.sentCount).toBe(0);
    });
  });

  // ── disconnectRelay ─────────────────────────────────────────────────────
  describe("disconnectRelay() with WebSocket", () => {
    it("should cancel reconnect on intentional disconnect", async () => {
      const connectPromise = bridge.connectRelay("wss://relay.example.com");
      MockWebSocket._lastInstance._simulateOpen();
      await connectPromise;

      bridge._scheduleReconnect("wss://relay.example.com");
      expect(bridge._reconnectTimers.has("wss://relay.example.com")).toBe(true);

      await bridge.disconnectRelay("wss://relay.example.com");
      expect(bridge._reconnectTimers.has("wss://relay.example.com")).toBe(
        false,
      );
    });

    it("should remove WebSocket listeners before closing", async () => {
      const connectPromise = bridge.connectRelay("wss://relay.example.com");
      const ws = MockWebSocket._lastInstance;
      ws._simulateOpen();
      await connectPromise;

      const removeListenersSpy = vi.spyOn(ws, "removeAllListeners");
      await bridge.disconnectRelay("wss://relay.example.com");
      expect(removeListenersSpy).toHaveBeenCalledWith("close");
    });
  });

  // ── Auto-reconnect on unexpected close ──────────────────────────────────
  describe("auto-reconnect", () => {
    it("should schedule reconnect when WebSocket closes unexpectedly", async () => {
      const connectPromise = bridge.connectRelay("wss://relay.example.com");
      const ws = MockWebSocket._lastInstance;
      ws._simulateOpen();
      await connectPromise;

      // Simulate unexpected close
      ws.readyState = 3;
      ws.emit("close");

      expect(bridge._reconnectTimers.has("wss://relay.example.com")).toBe(true);
    });
  });
});
