/**
 * AgentDID 单元测试
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { AgentDID, DID_STATUS } = require("../agent-did");

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
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

describe("AgentDID", () => {
  let agentDID;
  let db;

  beforeEach(() => {
    agentDID = new AgentDID();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Stop challenge cleanup interval if running
    if (agentDID._challengeCleanupInterval) {
      clearInterval(agentDID._challengeCleanupInterval);
    }
  });

  describe("initialize()", () => {
    it("should set initialized=true and call db.prepare", async () => {
      await agentDID.initialize(db);
      expect(agentDID.initialized).toBe(true);
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should be idempotent", async () => {
      await agentDID.initialize(db);
      const count = db.prepare.mock.calls.length;
      await agentDID.initialize(db);
      expect(db.prepare.mock.calls.length).toBe(count);
    });
  });

  describe("createDID()", () => {
    beforeEach(async () => {
      await agentDID.initialize(db);
    });

    it("should create a DID with did:chainless prefix", () => {
      const record = agentDID.createDID({ displayName: "TestAgent" });
      expect(record.did).toMatch(/^did:chainless:/);
      expect(record.displayName).toBe("TestAgent");
      expect(record.status).toBe(DID_STATUS.ACTIVE);
    });

    it("should include default capabilities", () => {
      const record = agentDID.createDID({});
      expect(Array.isArray(record.capabilities)).toBe(true);
      expect(record.capabilities.length).toBeGreaterThan(0);
    });

    it("should merge custom capabilities with defaults", () => {
      const record = agentDID.createDID({ capabilities: ["agent:code-review"] });
      expect(record.capabilities).toContain("agent:code-review");
    });

    it("should emit did:created event", () => {
      const listener = vi.fn();
      agentDID.on("did:created", listener);
      agentDID.createDID({ displayName: "EventAgent" });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should generate a public key", () => {
      const record = agentDID.createDID({});
      expect(record.publicKey).toBeTruthy();
    });
  });

  describe("resolveDID()", () => {
    beforeEach(async () => {
      await agentDID.initialize(db);
    });

    it("should resolve a just-created DID from cache", () => {
      const record = agentDID.createDID({ displayName: "Resolvable" });
      const doc = agentDID.resolveDID(record.did);
      expect(doc).not.toBeNull();
      expect(doc.id).toBe(record.did);
    });

    it("should return null for unknown DID", () => {
      expect(agentDID.resolveDID("did:chainless:nonexistent")).toBeNull();
    });

    it("should return null for null/undefined input", () => {
      expect(agentDID.resolveDID(null)).toBeNull();
      expect(agentDID.resolveDID(undefined)).toBeNull();
    });
  });

  describe("getAllDIDs()", () => {
    beforeEach(async () => {
      await agentDID.initialize(db);
    });

    it("should return all DIDs", () => {
      agentDID.createDID({ displayName: "Agent A" });
      agentDID.createDID({ displayName: "Agent B" });
      const all = agentDID.getAllDIDs();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter by organization", () => {
      agentDID.createDID({ organization: "org-a" });
      agentDID.createDID({ organization: "org-b" });
      const orgA = agentDID.getAllDIDs({ organization: "org-a" });
      orgA.forEach((d) => expect(d.organization).toBe("org-a"));
    });
  });

  describe("revokeDID()", () => {
    beforeEach(async () => {
      await agentDID.initialize(db);
    });

    it("should set status to REVOKED", () => {
      const record = agentDID.createDID({});
      const revoked = agentDID.revokeDID(record.did, "security breach");
      expect(revoked.status).toBe(DID_STATUS.REVOKED);
    });

    it("should emit did:revoked event", () => {
      const listener = vi.fn();
      agentDID.on("did:revoked", listener);
      const record = agentDID.createDID({});
      agentDID.revokeDID(record.did, "test");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should throw for unknown DID", () => {
      expect(() => agentDID.revokeDID("did:chainless:nonexistent")).toThrow();
    });
  });

  describe("hasCapability()", () => {
    beforeEach(async () => {
      await agentDID.initialize(db);
    });

    it("should return true for a capability the DID has", () => {
      const record = agentDID.createDID({ capabilities: ["agent:deploy"] });
      expect(agentDID.hasCapability(record.did, "agent:deploy")).toBe(true);
    });

    it("should return false for a capability the DID lacks", () => {
      const record = agentDID.createDID({});
      expect(agentDID.hasCapability(record.did, "agent:super-secret-power")).toBe(false);
    });
  });

  describe("signChallenge() / verifySignature()", () => {
    beforeEach(async () => {
      await agentDID.initialize(db);
    });

    it("should sign a challenge and verify it successfully", () => {
      const record = agentDID.createDID({});
      const challenge = "test-challenge-12345";
      const sig = agentDID.signChallenge(record.did, challenge);

      expect(sig.signature).toBeTruthy();
      expect(sig.publicKey).toBeTruthy();

      const verified = agentDID.verifySignature(record.did, challenge, sig.signature);
      expect(verified.valid).toBe(true);
    });

    it("should fail verification with wrong challenge", () => {
      const record = agentDID.createDID({});
      const sig = agentDID.signChallenge(record.did, "original-challenge");
      const verified = agentDID.verifySignature(record.did, "wrong-challenge", sig.signature);
      expect(verified.valid).toBe(false);
    });
  });

  describe("getStats()", () => {
    beforeEach(async () => {
      await agentDID.initialize(db);
    });

    it("should return stats with totalDIDs", () => {
      agentDID.createDID({});
      agentDID.createDID({});
      const stats = agentDID.getStats();
      expect(stats).toHaveProperty("totalDIDs");
      expect(stats.totalDIDs).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Constants", () => {
    it("DID_STATUS should have ACTIVE, REVOKED", () => {
      expect(DID_STATUS.ACTIVE).toBeTruthy();
      expect(DID_STATUS.REVOKED).toBeTruthy();
    });
  });
});
