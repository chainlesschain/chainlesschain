/**
 * AgentAuthenticator unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { AgentAuthenticator, AUTH_STATUS } = require("../agent-authenticator");

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue({ count: 0 }),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

describe("AgentAuthenticator", () => {
  let auth;
  let db;

  beforeEach(() => {
    auth = new AgentAuthenticator();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (auth._cleanupTimer) {
      clearInterval(auth._cleanupTimer);
    }
  });

  // ============================================================
  // initialize()
  // ============================================================

  describe("initialize()", () => {
    it("should set initialized=true and call db.exec for table creation", async () => {
      await auth.initialize(db);
      expect(auth.initialized).toBe(true);
      expect(db.exec).toHaveBeenCalled();
    });

    it("should call db.prepare to load active sessions", async () => {
      await auth.initialize(db);
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should be idempotent — second call does nothing", async () => {
      await auth.initialize(db);
      const execCount = db.exec.mock.calls.length;
      await auth.initialize(db);
      expect(db.exec.mock.calls.length).toBe(execCount);
    });

    it("should start the cleanup timer", async () => {
      await auth.initialize(db);
      expect(auth._cleanupTimer).not.toBeNull();
    });
  });

  // ============================================================
  // authenticate()
  // ============================================================

  describe("authenticate()", () => {
    beforeEach(async () => {
      await auth.initialize(db);
    });

    it("should return an object with sessionId and challenge", async () => {
      const session = await auth.authenticate(
        "did:chainless:local-001",
        "did:chainless:remote-001",
      );
      expect(session).toHaveProperty("id");
      expect(session).toHaveProperty("challenge");
      expect(typeof session.id).toBe("string");
      expect(session.id.length).toBeGreaterThan(0);
      expect(typeof session.challenge).toBe("string");
    });

    it("should return status PENDING", async () => {
      const session = await auth.authenticate(
        "did:chainless:local-002",
        "did:chainless:remote-002",
      );
      expect(session.status).toBe(AUTH_STATUS.PENDING);
    });

    it("should include localDID and remoteDID on the session", async () => {
      const session = await auth.authenticate(
        "did:chainless:local-003",
        "did:chainless:remote-003",
      );
      expect(session.localDID).toBe("did:chainless:local-003");
      expect(session.remoteDID).toBe("did:chainless:remote-003");
    });

    it("should emit auth:challenge-created event", async () => {
      const listener = vi.fn();
      auth.on("auth:challenge-created", listener);
      await auth.authenticate(
        "did:chainless:local-004",
        "did:chainless:remote-004",
      );
      expect(listener).toHaveBeenCalledTimes(1);
      const payload = listener.mock.calls[0][0];
      expect(payload).toHaveProperty("sessionId");
      expect(payload).toHaveProperty("challenge");
    });

    it("should throw if localDID is missing", async () => {
      await expect(
        auth.authenticate("", "did:chainless:remote-005"),
      ).rejects.toThrow();
    });

    it("should throw if remoteDID is missing", async () => {
      await expect(
        auth.authenticate("did:chainless:local-005", ""),
      ).rejects.toThrow();
    });

    it("should throw if localDID equals remoteDID (self-auth)", async () => {
      await expect(
        auth.authenticate("did:chainless:same", "did:chainless:same"),
      ).rejects.toThrow("Cannot authenticate with self");
    });
  });

  // ============================================================
  // respondToChallenge()
  // ============================================================

  describe("respondToChallenge()", () => {
    beforeEach(async () => {
      await auth.initialize(db);
    });

    it("should return verified:false for a non-existent challengeId", async () => {
      const result = await auth.respondToChallenge(
        "non-existent-challenge-id",
        { signature: "bad-sig" },
      );
      expect(result).toHaveProperty("verified", false);
      expect(result).toHaveProperty("error");
    });

    it("should return status FAILED for wrong response", async () => {
      const session = await auth.authenticate(
        "did:chainless:local-006",
        "did:chainless:remote-006",
      );
      // Respond with an invalid signature — no public key, no valid HMAC
      const result = await auth.respondToChallenge(session.id, {
        signature:
          "0000000000000000000000000000000000000000000000000000000000000000",
        publicKey: "hex-key-placeholder",
      });
      expect(result.verified).toBe(false);
      expect(result.status).toBe(AUTH_STATUS.FAILED);
    });

    it("should throw if challengeId is missing", async () => {
      await expect(
        auth.respondToChallenge(null, { signature: "s" }),
      ).rejects.toThrow();
    });

    it("should throw if response is missing", async () => {
      await expect(auth.respondToChallenge("some-id", null)).rejects.toThrow();
    });
  });

  // ============================================================
  // verifyAuthentication()
  // ============================================================

  describe("verifyAuthentication()", () => {
    beforeEach(async () => {
      await auth.initialize(db);
    });

    it("should return { valid: false } for an unknown sessionId", () => {
      const result = auth.verifyAuthentication("unknown-session-id");
      expect(result).toHaveProperty("valid", false);
    });

    it("should return { valid, session } shape for a pending session", async () => {
      // A session created by authenticate() is PENDING, not AUTHENTICATED
      const session = await auth.authenticate(
        "did:chainless:local-007",
        "did:chainless:remote-007",
      );
      const result = auth.verifyAuthentication(session.id);
      // Pending sessions are not considered valid authenticated sessions
      expect(result).toHaveProperty("valid");
      expect(result.valid).toBe(false);
    });

    it("should fall through to DB when session not in memory", () => {
      // With mock DB returning null, should return { valid: false }
      const result = auth.verifyAuthentication("db-only-session-id");
      expect(result).toHaveProperty("valid", false);
      expect(result).toHaveProperty("error");
    });
  });

  // ============================================================
  // getActiveSessions()
  // ============================================================

  describe("getActiveSessions()", () => {
    beforeEach(async () => {
      await auth.initialize(db);
    });

    it("should return an Array", () => {
      const sessions = auth.getActiveSessions();
      expect(Array.isArray(sessions)).toBe(true);
    });

    it("should be empty when no authenticated sessions exist", async () => {
      // Creating a pending session should not appear in active sessions
      await auth.authenticate(
        "did:chainless:local-008",
        "did:chainless:remote-008",
      );
      const sessions = auth.getActiveSessions();
      // Pending sessions do NOT count as active (only AUTHENTICATED ones do)
      expect(sessions.length).toBe(0);
    });
  });

  // ============================================================
  // revokeSession()
  // ============================================================

  describe("revokeSession()", () => {
    beforeEach(async () => {
      await auth.initialize(db);
    });

    it("should return false for an unknown sessionId", () => {
      const result = auth.revokeSession("nonexistent-session");
      expect(result).toBe(false);
    });

    it("should return true after revoking a known pending session", async () => {
      const session = await auth.authenticate(
        "did:chainless:local-009",
        "did:chainless:remote-009",
      );
      const result = auth.revokeSession(session.id);
      expect(result).toBe(true);
    });

    it("should remove session from active map after revocation", async () => {
      const session = await auth.authenticate(
        "did:chainless:local-010",
        "did:chainless:remote-010",
      );
      auth.revokeSession(session.id);
      // The session is gone from in-memory map
      expect(auth._sessions.has(session.id)).toBe(false);
    });

    it("should emit auth:revoked event", async () => {
      const session = await auth.authenticate(
        "did:chainless:local-011",
        "did:chainless:remote-011",
      );
      const listener = vi.fn();
      auth.on("auth:revoked", listener);
      auth.revokeSession(session.id);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // getStats()
  // ============================================================

  describe("getStats()", () => {
    beforeEach(async () => {
      await auth.initialize(db);
    });

    it("should return an object with totalSessions", () => {
      const stats = auth.getStats();
      expect(stats).toHaveProperty("totalSessions");
    });

    it("should return activeSessions count", () => {
      const stats = auth.getStats();
      expect(stats).toHaveProperty("activeSessions");
      expect(typeof stats.activeSessions).toBe("number");
    });

    it("should return pendingChallenges count", () => {
      const stats = auth.getStats();
      expect(stats).toHaveProperty("pendingChallenges");
      expect(typeof stats.pendingChallenges).toBe("number");
    });

    it("should reflect pending challenge count after authenticate()", async () => {
      await auth.authenticate(
        "did:chainless:local-012",
        "did:chainless:remote-012",
      );
      const stats = auth.getStats();
      // Each authenticate() call creates one pending challenge
      expect(stats.pendingChallenges).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // getConfig() / configure()
  // ============================================================

  describe("getConfig() / configure()", () => {
    beforeEach(async () => {
      await auth.initialize(db);
    });

    it("getConfig() should return a config object with sessionTTLMs", () => {
      const config = auth.getConfig();
      expect(config).toHaveProperty("sessionTTLMs");
      expect(typeof config.sessionTTLMs).toBe("number");
    });

    it("getConfig() should return a copy — mutations do not affect internal config", () => {
      const config = auth.getConfig();
      config.sessionTTLMs = 0;
      expect(auth.getConfig().sessionTTLMs).not.toBe(0);
    });

    it("configure() should update a valid config key", () => {
      auth.configure({ maxActiveSessions: 200 });
      expect(auth.getConfig().maxActiveSessions).toBe(200);
    });

    it("configure() should ignore unknown keys", () => {
      const before = auth.getConfig();
      auth.configure({ unknownKey: "should-be-ignored" });
      const after = auth.getConfig();
      expect(after).not.toHaveProperty("unknownKey");
      expect(after.sessionTTLMs).toBe(before.sessionTTLMs);
    });
  });

  // ============================================================
  // destroy()
  // ============================================================

  describe("destroy()", () => {
    it("should clear the cleanup timer and reset initialized", async () => {
      await auth.initialize(db);
      auth.destroy();
      expect(auth._cleanupTimer).toBeNull();
      expect(auth.initialized).toBe(false);
    });
  });

  // ============================================================
  // Constants
  // ============================================================

  describe("Constants", () => {
    it("AUTH_STATUS.PENDING should equal 'pending'", () => {
      expect(AUTH_STATUS.PENDING).toBe("pending");
    });

    it("AUTH_STATUS.AUTHENTICATED should equal 'authenticated'", () => {
      expect(AUTH_STATUS.AUTHENTICATED).toBe("authenticated");
    });

    it("AUTH_STATUS.FAILED should equal 'failed'", () => {
      expect(AUTH_STATUS.FAILED).toBe("failed");
    });

    it("AUTH_STATUS.EXPIRED should equal 'expired'", () => {
      expect(AUTH_STATUS.EXPIRED).toBe("expired");
    });

    it("AUTH_STATUS should have exactly 4 values", () => {
      expect(Object.keys(AUTH_STATUS).length).toBe(4);
    });
  });
});
