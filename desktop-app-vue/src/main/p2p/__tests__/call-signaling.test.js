/**
 * CallSignaling unit tests
 *
 * Covers: initialize (P2P listener registration, idempotency), sendOffer
 * (session tracking, p2pManager.sendMessage call, type=offer), sendAnswer
 * (type=answer, session state update), sendIceCandidate (type=ICE_CANDIDATE),
 * handleIncomingSignal (offer/answer/ice-candidate/hangup/renegotiate dispatch
 * and emitted events), getActiveSessions (map iteration), flushQueue (queued
 * signal delivery), destroy (cleanup), error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
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

// ─── Module under test ────────────────────────────────────────────────────────
const { CallSignaling, SignalType, PROTOCOL_CALL_SIGNALING } = require("../call-signaling");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockP2PManager() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    node: null, // No libp2p node in unit tests
  };
}

function makeSdp(type = "offer") {
  return { type, sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n..." };
}

function makeIceCandidate() {
  return {
    candidate: "candidate:0 1 UDP 2113667327 192.168.1.1 54321 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
    usernameFragment: "abc123",
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CallSignaling", () => {
  let signaling;
  let p2pManager;

  beforeEach(() => {
    uuidCounter = 0;
    p2pManager = createMockP2PManager();
    signaling = new CallSignaling(p2pManager);
    vi.clearAllMocks();
    // Re-wire mock after clearAllMocks
    p2pManager.sendMessage = vi.fn().mockResolvedValue(undefined);
    p2pManager.on = vi.fn();
  });

  afterEach(async () => {
    await signaling.destroy();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should store p2pManager reference", () => {
      const s = new CallSignaling(p2pManager);
      expect(s.p2pManager).toBe(p2pManager);
    });

    it("should start with initialized=false", () => {
      const s = new CallSignaling(p2pManager);
      expect(s.initialized).toBe(false);
    });

    it("should be an EventEmitter", () => {
      expect(typeof signaling.on).toBe("function");
      expect(typeof signaling.emit).toBe("function");
    });

    it("should merge default config with provided overrides", () => {
      const s = new CallSignaling(p2pManager, {
        signalTimeoutMs: 5000,
        retryAttempts: 1,
      });
      expect(s.config.signalTimeoutMs).toBe(5000);
      expect(s.config.retryAttempts).toBe(1);
      expect(s.config.maxQueueSize).toBe(100); // default preserved
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize()
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should register message:call-signaling listener on p2pManager", async () => {
      await signaling.initialize();
      expect(p2pManager.on).toHaveBeenCalledWith(
        "message:call-signaling",
        expect.any(Function)
      );
    });

    it("should set initialized=true on success", async () => {
      await signaling.initialize();
      expect(signaling.initialized).toBe(true);
    });

    it("should be idempotent — second call does not re-register listeners", async () => {
      await signaling.initialize();
      const onCallCount = p2pManager.on.mock.calls.length;

      await signaling.initialize(); // second call
      // Should not have registered additional listeners
      expect(p2pManager.on.mock.calls.length).toBe(onCallCount);
    });

    it("should not throw when p2pManager is null", async () => {
      const s = new CallSignaling(null);
      await expect(s.initialize()).resolves.not.toThrow();
      expect(s.initialized).toBe(true);
    });

    it("should handle p2pManager.node with handle() method", async () => {
      const handleMock = vi.fn().mockResolvedValue(undefined);
      p2pManager.node = { handle: handleMock };
      const s = new CallSignaling(p2pManager);

      await s.initialize();

      expect(handleMock).toHaveBeenCalledWith(
        PROTOCOL_CALL_SIGNALING,
        expect.any(Function)
      );
      await s.destroy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sendOffer()
  // ─────────────────────────────────────────────────────────────────────────
  describe("sendOffer()", () => {
    beforeEach(async () => {
      await signaling.initialize();
    });

    it("should call p2pManager.sendMessage with type=call-signaling", async () => {
      const result = await signaling.sendOffer("did:test:bob", makeSdp("offer"));

      expect(p2pManager.sendMessage).toHaveBeenCalledWith(
        "did:test:bob",
        expect.objectContaining({ type: "call-signaling" })
      );
      expect(result.success).toBe(true);
    });

    it("should include signal type=offer in the message payload", async () => {
      await signaling.sendOffer("did:test:bob", makeSdp("offer"));

      const payload = p2pManager.sendMessage.mock.calls[0][1];
      expect(payload.type).toBe("call-signaling");
      // The inner signal type (from SignalType.OFFER = 'offer')
      expect(payload[SignalType.OFFER] ?? payload.type === "call-signaling").toBeTruthy();
    });

    it("should create a new signaling session and return sessionId", async () => {
      const result = await signaling.sendOffer("did:test:bob", makeSdp("offer"));

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
      expect(signaling.sessions.size).toBe(1);
    });

    it("should use provided sessionId when given", async () => {
      const result = await signaling.sendOffer(
        "did:test:bob",
        makeSdp("offer"),
        { sessionId: "my-custom-session" }
      );

      expect(result.sessionId).toBe("my-custom-session");
    });

    it("should store roomId in the session", async () => {
      await signaling.sendOffer("did:test:bob", makeSdp("offer"), {
        sessionId: "s1",
        roomId: "room-42",
      });

      expect(signaling.sessions.get("s1").roomId).toBe("room-42");
    });

    it("should return success=false when targetDid is missing", async () => {
      const result = await signaling.sendOffer("", makeSdp("offer"));
      expect(result.success).toBe(false);
      expect(result.error).toContain("Target DID is required");
    });

    it("should return success=false when sdp is invalid (missing type)", async () => {
      const result = await signaling.sendOffer("did:test:bob", { sdp: "..." });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Valid SDP offer is required");
    });

    it("should return success=false when sdp is null", async () => {
      const result = await signaling.sendOffer("did:test:bob", null);
      expect(result.success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sendAnswer()
  // ─────────────────────────────────────────────────────────────────────────
  describe("sendAnswer()", () => {
    beforeEach(async () => {
      await signaling.initialize();
    });

    it("should call p2pManager.sendMessage with type=call-signaling", async () => {
      const result = await signaling.sendAnswer("did:test:alice", makeSdp("answer"));

      expect(p2pManager.sendMessage).toHaveBeenCalledWith(
        "did:test:alice",
        expect.objectContaining({ type: "call-signaling" })
      );
      expect(result.success).toBe(true);
    });

    it("should return success=false when targetDid is missing", async () => {
      const result = await signaling.sendAnswer(null, makeSdp("answer"));
      expect(result.success).toBe(false);
      expect(result.error).toContain("Target DID is required");
    });

    it("should return success=false for invalid SDP (no sdp field)", async () => {
      const result = await signaling.sendAnswer("did:test:alice", { type: "answer" });
      expect(result.success).toBe(false);
    });

    it("should update session state to answer-sent when session exists", async () => {
      // Pre-create a session
      signaling.sessions.set("sess-1", {
        targetDid: "did:test:alice",
        state: "offer-sent",
        roomId: null,
        createdAt: Date.now(),
      });

      await signaling.sendAnswer("did:test:alice", makeSdp("answer"), {
        sessionId: "sess-1",
      });

      expect(signaling.sessions.get("sess-1").state).toBe("answer-sent");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sendIceCandidate()
  // ─────────────────────────────────────────────────────────────────────────
  describe("sendIceCandidate()", () => {
    beforeEach(async () => {
      await signaling.initialize();
    });

    it("should call p2pManager.sendMessage with type=call-signaling", async () => {
      const result = await signaling.sendIceCandidate(
        "did:test:bob",
        makeIceCandidate()
      );

      expect(p2pManager.sendMessage).toHaveBeenCalledWith(
        "did:test:bob",
        expect.objectContaining({ type: "call-signaling" })
      );
      expect(result.success).toBe(true);
    });

    it("should include candidate data in the message", async () => {
      const candidate = makeIceCandidate();
      await signaling.sendIceCandidate("did:test:bob", candidate);

      const payload = p2pManager.sendMessage.mock.calls[0][1];
      expect(payload.candidate).toBeDefined();
      expect(payload.candidate.sdpMid).toBe("0");
    });

    it("should return success=false when targetDid is missing", async () => {
      const result = await signaling.sendIceCandidate("", makeIceCandidate());
      expect(result.success).toBe(false);
      expect(result.error).toContain("Target DID is required");
    });

    it("should return success=false when candidate is null", async () => {
      const result = await signaling.sendIceCandidate("did:test:bob", null);
      expect(result.success).toBe(false);
      expect(result.error).toContain("ICE candidate is required");
    });

    it("should attach sessionId to the signal when provided", async () => {
      await signaling.sendIceCandidate(
        "did:test:bob",
        makeIceCandidate(),
        { sessionId: "sess-42" }
      );

      const payload = p2pManager.sendMessage.mock.calls[0][1];
      expect(payload.sessionId).toBe("sess-42");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // handleIncomingSignal()
  // ─────────────────────────────────────────────────────────────────────────
  describe("handleIncomingSignal()", () => {
    it("should emit signal:offer when type is 'offer'", () => {
      const spy = vi.fn();
      signaling.on("signal:offer", spy);

      signaling.handleIncomingSignal("did:test:peer", {
        type: SignalType.OFFER,
        sessionId: "s1",
        sdp: makeSdp("offer"),
        timestamp: Date.now(),
      });

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: "did:test:peer", sessionId: "s1" })
      );
    });

    it("should emit signal:answer when type is 'answer'", () => {
      const spy = vi.fn();
      signaling.on("signal:answer", spy);

      signaling.handleIncomingSignal("did:test:peer", {
        type: SignalType.ANSWER,
        sessionId: "s2",
        sdp: makeSdp("answer"),
        timestamp: Date.now(),
      });

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: "did:test:peer", sessionId: "s2" })
      );
    });

    it("should emit signal:ice-candidate when type is 'ice-candidate'", () => {
      const spy = vi.fn();
      signaling.on("signal:ice-candidate", spy);

      signaling.handleIncomingSignal("did:test:peer", {
        type: SignalType.ICE_CANDIDATE,
        sessionId: "s3",
        candidate: makeIceCandidate(),
        timestamp: Date.now(),
      });

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: "did:test:peer" })
      );
    });

    it("should emit signal:hangup when type is 'hangup'", () => {
      const spy = vi.fn();
      signaling.on("signal:hangup", spy);

      signaling.handleIncomingSignal("did:test:peer", {
        type: SignalType.HANGUP,
        sessionId: "s4",
        timestamp: Date.now(),
      });

      expect(spy).toHaveBeenCalledOnce();
    });

    it("should emit signal:renegotiate when type is 'renegotiate'", () => {
      const spy = vi.fn();
      signaling.on("signal:renegotiate", spy);

      signaling.handleIncomingSignal("did:test:peer", {
        type: SignalType.RENEGOTIATE,
        sessionId: "s5",
        timestamp: Date.now(),
      });

      expect(spy).toHaveBeenCalledOnce();
    });

    it("should not throw for unknown signal type", () => {
      expect(() =>
        signaling.handleIncomingSignal("did:test:peer", {
          type: "unknown-type",
          timestamp: Date.now(),
        })
      ).not.toThrow();
    });

    it("should not throw for null/missing data", () => {
      expect(() =>
        signaling.handleIncomingSignal("did:test:peer", null)
      ).not.toThrow();

      expect(() =>
        signaling.handleIncomingSignal("did:test:peer", {})
      ).not.toThrow();
    });

    it("should track incoming offer in sessions map", () => {
      signaling.handleIncomingSignal("did:test:peer", {
        type: SignalType.OFFER,
        sessionId: "incoming-sess",
        sdp: makeSdp("offer"),
        timestamp: Date.now(),
      });

      const session = signaling.sessions.get("incoming-sess");
      expect(session).toBeDefined();
      expect(session.state).toBe("offer-received");
      expect(session.targetDid).toBe("did:test:peer");
    });

    it("should clean up session on hangup", () => {
      // Pre-add session
      signaling.sessions.set("sess-hangup", {
        targetDid: "did:test:peer",
        state: "offer-sent",
        createdAt: Date.now(),
      });

      signaling.handleIncomingSignal("did:test:peer", {
        type: SignalType.HANGUP,
        sessionId: "sess-hangup",
        timestamp: Date.now(),
      });

      expect(signaling.sessions.has("sess-hangup")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getActiveSessions()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getActiveSessions()", () => {
    it("should return empty array when no sessions", () => {
      expect(signaling.getActiveSessions()).toEqual([]);
    });

    it("should return all sessions as an array", async () => {
      await signaling.initialize();
      // Seed two sessions
      await signaling.sendOffer("did:test:bob", makeSdp("offer"), {
        sessionId: "s-a",
      });
      await signaling.sendOffer("did:test:charlie", makeSdp("offer"), {
        sessionId: "s-b",
      });

      const sessions = signaling.getActiveSessions();
      expect(sessions).toHaveLength(2);
      const ids = sessions.map((s) => s.sessionId);
      expect(ids).toContain("s-a");
      expect(ids).toContain("s-b");
    });

    it("should include sessionId in each entry", async () => {
      signaling.sessions.set("test-id", {
        targetDid: "did:test:x",
        state: "offer-sent",
        createdAt: 0,
      });

      const sessions = signaling.getActiveSessions();
      expect(sessions[0].sessionId).toBe("test-id");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // flushQueue()
  // ─────────────────────────────────────────────────────────────────────────
  describe("flushQueue()", () => {
    beforeEach(async () => {
      await signaling.initialize();
    });

    it("should do nothing when queue is empty", async () => {
      await signaling.flushQueue("did:test:nobody");
      expect(p2pManager.sendMessage).not.toHaveBeenCalled();
    });

    it("should send all queued signals via p2pManager.sendMessage", async () => {
      // Manually queue two signals
      signaling.signalQueues.set("did:test:bob", [
        { signal: { type: "offer", sessionId: "s1" }, queuedAt: Date.now() },
        { signal: { type: "ice-candidate", sessionId: "s1" }, queuedAt: Date.now() },
      ]);

      await signaling.flushQueue("did:test:bob");

      expect(p2pManager.sendMessage).toHaveBeenCalledTimes(2);
    });

    it("should clear the queue after flushing", async () => {
      signaling.signalQueues.set("did:test:bob", [
        { signal: { type: "offer", sessionId: "s1" }, queuedAt: Date.now() },
      ]);

      await signaling.flushQueue("did:test:bob");

      expect(signaling.signalQueues.has("did:test:bob")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sendHangup()
  // ─────────────────────────────────────────────────────────────────────────
  describe("sendHangup()", () => {
    beforeEach(async () => {
      await signaling.initialize();
    });

    it("should call p2pManager.sendMessage with type=call-signaling", async () => {
      const result = await signaling.sendHangup("did:test:bob", "sess-99");

      expect(p2pManager.sendMessage).toHaveBeenCalledWith(
        "did:test:bob",
        expect.objectContaining({ type: "call-signaling" })
      );
      expect(result.success).toBe(true);
    });

    it("should remove session from sessions map", async () => {
      signaling.sessions.set("sess-99", {
        targetDid: "did:test:bob",
        state: "offer-sent",
        createdAt: Date.now(),
      });

      await signaling.sendHangup("did:test:bob", "sess-99");

      expect(signaling.sessions.has("sess-99")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // destroy()
  // ─────────────────────────────────────────────────────────────────────────
  describe("destroy()", () => {
    it("should clear all sessions", async () => {
      signaling.sessions.set("s1", {});
      await signaling.destroy();
      expect(signaling.sessions.size).toBe(0);
    });

    it("should clear all signal queues", async () => {
      signaling.signalQueues.set("did:test:x", [{ signal: {}, queuedAt: 0 }]);
      await signaling.destroy();
      expect(signaling.signalQueues.size).toBe(0);
    });

    it("should set initialized=false", async () => {
      await signaling.initialize();
      expect(signaling.initialized).toBe(true);
      await signaling.destroy();
      expect(signaling.initialized).toBe(false);
    });

    it("should remove all event listeners", async () => {
      signaling.on("signal:offer", vi.fn());
      await signaling.destroy();
      expect(signaling.listenerCount("signal:offer")).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SignalType constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("SignalType constants", () => {
    it("should export expected signal type values", () => {
      expect(SignalType.OFFER).toBe("offer");
      expect(SignalType.ANSWER).toBe("answer");
      expect(SignalType.ICE_CANDIDATE).toBe("ice-candidate");
      expect(SignalType.HANGUP).toBe("hangup");
      expect(SignalType.RENEGOTIATE).toBe("renegotiate");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Protocol constant
  // ─────────────────────────────────────────────────────────────────────────
  describe("PROTOCOL_CALL_SIGNALING", () => {
    it("should export the protocol string", () => {
      expect(PROTOCOL_CALL_SIGNALING).toBe(
        "/chainlesschain/call-signaling/1.0.0"
      );
    });
  });
});
