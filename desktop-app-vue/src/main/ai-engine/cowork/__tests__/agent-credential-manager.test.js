/**
 * AgentCredentialManager unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  AgentCredentialManager,
  CREDENTIAL_STATUS,
  CREDENTIAL_TYPES,
} = require("../agent-credential-manager");

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

describe("AgentCredentialManager", () => {
  let mgr;
  let db;

  beforeEach(() => {
    mgr = new AgentCredentialManager();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (mgr._cleanupInterval) {
      clearInterval(mgr._cleanupInterval);
    }
  });

  // ============================================================
  // initialize()
  // ============================================================

  describe("initialize()", () => {
    it("should set initialized=true", async () => {
      await mgr.initialize(db);
      expect(mgr.initialized).toBe(true);
    });

    it("should call db.exec for table creation", async () => {
      await mgr.initialize(db);
      expect(db.exec).toHaveBeenCalled();
    });

    it("should call db.prepare to load credentials from DB", async () => {
      await mgr.initialize(db);
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should start the expiration cleanup interval", async () => {
      await mgr.initialize(db);
      expect(mgr._cleanupInterval).not.toBeNull();
    });

    it("should be idempotent — second call does nothing", async () => {
      await mgr.initialize(db);
      const execCount = db.exec.mock.calls.length;
      await mgr.initialize(db);
      expect(db.exec.mock.calls.length).toBe(execCount);
    });

    it("should accept optional deps", async () => {
      const mockDeps = { agentDID: { initialized: true } };
      await mgr.initialize(db, mockDeps);
      expect(mgr.initialized).toBe(true);
    });
  });

  // ============================================================
  // issueCredential()
  // ============================================================

  describe("issueCredential()", () => {
    beforeEach(async () => {
      await mgr.initialize(db);
    });

    it("should return a credential with VALID status", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-001",
        subjectDID: "did:chainless:subject-001",
        type: CREDENTIAL_TYPES.CAPABILITY,
        claims: { capabilities: ["agent:code-review"] },
      });
      expect(cred).toHaveProperty("status", CREDENTIAL_STATUS.VALID);
    });

    it("should assign a unique id to each credential", () => {
      const c1 = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-002",
        subjectDID: "did:chainless:subject-002",
      });
      const c2 = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-002",
        subjectDID: "did:chainless:subject-003",
      });
      expect(c1.id).not.toBe(c2.id);
    });

    it("should populate issuerDID and subjectDID on the credential", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-003",
        subjectDID: "did:chainless:subject-004",
      });
      expect(cred.issuerDID).toBe("did:chainless:issuer-003");
      expect(cred.subjectDID).toBe("did:chainless:subject-004");
    });

    it("should include issuedAt and expiresAt timestamps", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-004",
        subjectDID: "did:chainless:subject-005",
      });
      expect(cred).toHaveProperty("issuedAt");
      expect(cred).toHaveProperty("expiresAt");
      expect(new Date(cred.issuedAt).getTime()).toBeLessThanOrEqual(Date.now());
      expect(new Date(cred.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("should default to CAPABILITY type when none is specified", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-005",
        subjectDID: "did:chainless:subject-006",
      });
      expect(cred.credentialType).toBe(CREDENTIAL_TYPES.CAPABILITY);
    });

    it("should throw if issuerDID is missing", () => {
      expect(() =>
        mgr.issueCredential({ subjectDID: "did:chainless:subject-007" }),
      ).toThrow("issuerDID is required");
    });

    it("should throw if subjectDID is missing", () => {
      expect(() =>
        mgr.issueCredential({ issuerDID: "did:chainless:issuer-006" }),
      ).toThrow("subjectDID is required");
    });

    it("should throw for an invalid credential type", () => {
      expect(() =>
        mgr.issueCredential({
          issuerDID: "did:chainless:issuer-007",
          subjectDID: "did:chainless:subject-008",
          type: "invalid-type",
        }),
      ).toThrow("Invalid credential type");
    });

    it("should increment stats.totalIssued", () => {
      const before = mgr.stats.totalIssued;
      mgr.issueCredential({
        issuerDID: "did:chainless:issuer-008",
        subjectDID: "did:chainless:subject-009",
      });
      expect(mgr.stats.totalIssued).toBe(before + 1);
    });
  });

  // ============================================================
  // issueCredential() — event emission
  // ============================================================

  describe("issueCredential() — event emission", () => {
    beforeEach(async () => {
      await mgr.initialize(db);
    });

    it("should emit credential:issued event", () => {
      const listener = vi.fn();
      mgr.on("credential:issued", listener);
      mgr.issueCredential({
        issuerDID: "did:chainless:issuer-evt",
        subjectDID: "did:chainless:subject-evt",
        type: CREDENTIAL_TYPES.DELEGATION,
      });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should include id, type, issuerDID, subjectDID in the event payload", () => {
      const listener = vi.fn();
      mgr.on("credential:issued", listener);
      mgr.issueCredential({
        issuerDID: "did:chainless:issuer-evtb",
        subjectDID: "did:chainless:subject-evtb",
        type: CREDENTIAL_TYPES.MEMBERSHIP,
      });
      const payload = listener.mock.calls[0][0];
      expect(payload).toHaveProperty("id");
      expect(payload).toHaveProperty("type", CREDENTIAL_TYPES.MEMBERSHIP);
      expect(payload).toHaveProperty("issuerDID", "did:chainless:issuer-evtb");
      expect(payload).toHaveProperty(
        "subjectDID",
        "did:chainless:subject-evtb",
      );
    });
  });

  // ============================================================
  // verifyCredential()
  // ============================================================

  describe("verifyCredential()", () => {
    beforeEach(async () => {
      await mgr.initialize(db);
    });

    it("should return { valid: true } for a just-issued credential", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-v1",
        subjectDID: "did:chainless:subject-v1",
        claims: { capabilities: ["agent:deploy"] },
      });
      const result = mgr.verifyCredential(cred.id);
      expect(result).toHaveProperty("valid", true);
      expect(result).toHaveProperty("credential");
      expect(result.credential.id).toBe(cred.id);
    });

    it("should return { valid: false } for an unknown credential id", () => {
      const result = mgr.verifyCredential("does-not-exist");
      expect(result).toHaveProperty("valid", false);
      expect(result).toHaveProperty("reason");
    });

    it("should return { valid: false } after revoking the credential", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-v2",
        subjectDID: "did:chainless:subject-v2",
      });
      mgr.revokeCredential(cred.id, "test revocation");
      const result = mgr.verifyCredential(cred.id);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/revoked/i);
    });

    it("should increment totalVerifications on each call", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-v3",
        subjectDID: "did:chainless:subject-v3",
      });
      const before = mgr.stats.totalVerifications;
      mgr.verifyCredential(cred.id);
      mgr.verifyCredential("unknown-id");
      expect(mgr.stats.totalVerifications).toBe(before + 2);
    });
  });

  // ============================================================
  // verifyCapability()
  // ============================================================

  describe("verifyCapability()", () => {
    beforeEach(async () => {
      await mgr.initialize(db);
    });

    it("should return { hasCapability: false } for an unknown DID", () => {
      const result = mgr.verifyCapability(
        "did:chainless:unknown-agent",
        "agent:code-review",
      );
      expect(result).toHaveProperty("hasCapability", false);
      expect(result).toHaveProperty("credentialId", null);
    });

    it("should return { hasCapability: true } when DID has the capability", () => {
      const agentDID = "did:chainless:capable-agent";
      mgr.issueCredential({
        issuerDID: "did:chainless:org-001",
        subjectDID: agentDID,
        type: CREDENTIAL_TYPES.CAPABILITY,
        claims: { capabilities: ["agent:deploy", "agent:code-review"] },
      });
      const result = mgr.verifyCapability(agentDID, "agent:deploy");
      expect(result.hasCapability).toBe(true);
      expect(result.credentialId).toBeTruthy();
    });

    it("should return { hasCapability: false } for a capability not in claims", () => {
      const agentDID = "did:chainless:partial-agent";
      mgr.issueCredential({
        issuerDID: "did:chainless:org-002",
        subjectDID: agentDID,
        type: CREDENTIAL_TYPES.CAPABILITY,
        claims: { capabilities: ["agent:read"] },
      });
      const result = mgr.verifyCapability(agentDID, "agent:write");
      expect(result.hasCapability).toBe(false);
    });

    it("should always return an object with hasCapability field", () => {
      const result = mgr.verifyCapability(
        "did:chainless:any-agent",
        "any:capability",
      );
      expect(result).toHaveProperty("hasCapability");
      expect(typeof result.hasCapability).toBe("boolean");
    });
  });

  // ============================================================
  // revokeCredential()
  // ============================================================

  describe("revokeCredential()", () => {
    beforeEach(async () => {
      await mgr.initialize(db);
    });

    it("should set credential status to REVOKED", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-r1",
        subjectDID: "did:chainless:subject-r1",
      });
      const revoked = mgr.revokeCredential(cred.id, "security breach");
      expect(revoked.status).toBe(CREDENTIAL_STATUS.REVOKED);
    });

    it("should set revokedAt timestamp", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-r2",
        subjectDID: "did:chainless:subject-r2",
      });
      const revoked = mgr.revokeCredential(cred.id, "test");
      expect(revoked).toHaveProperty("revokedAt");
      expect(revoked.revokedAt).not.toBeNull();
    });

    it("should record the revocation reason", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-r3",
        subjectDID: "did:chainless:subject-r3",
      });
      const revoked = mgr.revokeCredential(cred.id, "policy violation");
      expect(revoked.revocationReason).toBe("policy violation");
    });

    it("should throw if credential is not found", () => {
      expect(() => mgr.revokeCredential("nonexistent-id", "reason")).toThrow();
    });

    it("should throw if credential is already revoked", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-r4",
        subjectDID: "did:chainless:subject-r4",
      });
      mgr.revokeCredential(cred.id, "first");
      expect(() => mgr.revokeCredential(cred.id, "second")).toThrow();
    });

    it("should emit credential:revoked event", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-r5",
        subjectDID: "did:chainless:subject-r5",
      });
      const listener = vi.fn();
      mgr.on("credential:revoked", listener);
      mgr.revokeCredential(cred.id, "event-test");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should add the id to the revocation set", () => {
      const cred = mgr.issueCredential({
        issuerDID: "did:chainless:issuer-r6",
        subjectDID: "did:chainless:subject-r6",
      });
      mgr.revokeCredential(cred.id, "revocation-set-test");
      expect(mgr._revocationSet.has(cred.id)).toBe(true);
    });
  });

  // ============================================================
  // revokeAllForAgent()
  // ============================================================

  describe("revokeAllForAgent()", () => {
    beforeEach(async () => {
      await mgr.initialize(db);
    });

    it("should return 0 when agent has no credentials", () => {
      const count = mgr.revokeAllForAgent(
        "did:chainless:no-creds-agent",
        "bulk",
      );
      expect(count).toBe(0);
    });

    it("should return the number of credentials revoked", () => {
      const agentDID = "did:chainless:bulk-agent";
      mgr.issueCredential({
        issuerDID: "did:chainless:org-b1",
        subjectDID: agentDID,
        type: CREDENTIAL_TYPES.CAPABILITY,
      });
      mgr.issueCredential({
        issuerDID: "did:chainless:org-b1",
        subjectDID: agentDID,
        type: CREDENTIAL_TYPES.MEMBERSHIP,
      });
      const count = mgr.revokeAllForAgent(agentDID, "bulk-revocation");
      expect(count).toBe(2);
    });

    it("should return a number (not throw) in all cases", () => {
      expect(typeof mgr.revokeAllForAgent("any-did", "reason")).toBe("number");
    });
  });

  // ============================================================
  // getCredentials()
  // ============================================================

  describe("getCredentials()", () => {
    beforeEach(async () => {
      await mgr.initialize(db);
    });

    it("should return an empty array for an agent with no credentials", () => {
      const creds = mgr.getCredentials("did:chainless:no-creds-agent-2");
      expect(Array.isArray(creds)).toBe(true);
      expect(creds.length).toBe(0);
    });

    it("should return all credentials for an agent", () => {
      const agentDID = "did:chainless:multi-cred-agent";
      mgr.issueCredential({
        issuerDID: "did:chainless:org-gc1",
        subjectDID: agentDID,
        type: CREDENTIAL_TYPES.CAPABILITY,
      });
      mgr.issueCredential({
        issuerDID: "did:chainless:org-gc1",
        subjectDID: agentDID,
        type: CREDENTIAL_TYPES.MEMBERSHIP,
      });
      const creds = mgr.getCredentials(agentDID);
      expect(Array.isArray(creds)).toBe(true);
      expect(creds.length).toBe(2);
    });

    it("should filter by type when filter.type is provided", () => {
      const agentDID = "did:chainless:filtered-agent";
      mgr.issueCredential({
        issuerDID: "did:chainless:org-f1",
        subjectDID: agentDID,
        type: CREDENTIAL_TYPES.CAPABILITY,
      });
      mgr.issueCredential({
        issuerDID: "did:chainless:org-f1",
        subjectDID: agentDID,
        type: CREDENTIAL_TYPES.DELEGATION,
      });
      const creds = mgr.getCredentials(agentDID, {
        type: CREDENTIAL_TYPES.CAPABILITY,
      });
      creds.forEach((c) =>
        expect(c.credentialType).toBe(CREDENTIAL_TYPES.CAPABILITY),
      );
    });
  });

  // ============================================================
  // getStats()
  // ============================================================

  describe("getStats()", () => {
    beforeEach(async () => {
      await mgr.initialize(db);
    });

    it("should return an object with totalIssued", () => {
      const stats = mgr.getStats();
      expect(stats).toHaveProperty("totalIssued");
    });

    it("should reflect issued credentials in totalIssued", () => {
      mgr.issueCredential({
        issuerDID: "did:chainless:stat-issuer",
        subjectDID: "did:chainless:stat-subject",
      });
      const stats = mgr.getStats();
      expect(stats.totalIssued).toBeGreaterThanOrEqual(1);
    });

    it("should have totalRevoked field", () => {
      const stats = mgr.getStats();
      expect(stats).toHaveProperty("totalRevoked");
    });

    it("should have totalVerifications field", () => {
      const stats = mgr.getStats();
      expect(stats).toHaveProperty("totalVerifications");
    });

    it("should have totalCredentials equal to number of in-memory credentials", () => {
      const before = mgr.getStats().totalCredentials;
      mgr.issueCredential({
        issuerDID: "did:chainless:count-issuer",
        subjectDID: "did:chainless:count-subject",
      });
      const after = mgr.getStats().totalCredentials;
      expect(after).toBe(before + 1);
    });
  });

  // ============================================================
  // getConfig() / configure()
  // ============================================================

  describe("getConfig() / configure()", () => {
    beforeEach(async () => {
      await mgr.initialize(db);
    });

    it("getConfig() should return config with defaultExpiryMs", () => {
      const config = mgr.getConfig();
      expect(config).toHaveProperty("defaultExpiryMs");
      expect(typeof config.defaultExpiryMs).toBe("number");
    });

    it("configure() should update a valid config key and return updated config", () => {
      const updated = mgr.configure({ maxCredentialsPerAgent: 50 });
      expect(updated.maxCredentialsPerAgent).toBe(50);
      expect(mgr.getConfig().maxCredentialsPerAgent).toBe(50);
    });
  });

  // ============================================================
  // destroy()
  // ============================================================

  describe("destroy()", () => {
    it("should clear the cleanup interval and reset initialized", async () => {
      await mgr.initialize(db);
      mgr.destroy();
      expect(mgr._cleanupInterval).toBeNull();
      expect(mgr.initialized).toBe(false);
    });

    it("should clear all in-memory caches", async () => {
      await mgr.initialize(db);
      mgr.issueCredential({
        issuerDID: "did:chainless:destroy-issuer",
        subjectDID: "did:chainless:destroy-subject",
      });
      mgr.destroy();
      expect(mgr._credentials.size).toBe(0);
      expect(mgr._revocationSet.size).toBe(0);
    });
  });

  // ============================================================
  // Constants
  // ============================================================

  describe("Constants", () => {
    it("CREDENTIAL_STATUS.VALID should equal 'valid'", () => {
      expect(CREDENTIAL_STATUS.VALID).toBe("valid");
    });

    it("CREDENTIAL_STATUS.REVOKED should equal 'revoked'", () => {
      expect(CREDENTIAL_STATUS.REVOKED).toBe("revoked");
    });

    it("CREDENTIAL_STATUS.EXPIRED should equal 'expired'", () => {
      expect(CREDENTIAL_STATUS.EXPIRED).toBe("expired");
    });

    it("CREDENTIAL_TYPES.CAPABILITY should equal 'capability'", () => {
      expect(CREDENTIAL_TYPES.CAPABILITY).toBe("capability");
    });

    it("CREDENTIAL_TYPES.DELEGATION should equal 'delegation'", () => {
      expect(CREDENTIAL_TYPES.DELEGATION).toBe("delegation");
    });

    it("CREDENTIAL_TYPES.MEMBERSHIP should equal 'membership'", () => {
      expect(CREDENTIAL_TYPES.MEMBERSHIP).toBe("membership");
    });

    it("CREDENTIAL_STATUS should have exactly 3 values", () => {
      expect(Object.keys(CREDENTIAL_STATUS).length).toBe(3);
    });

    it("CREDENTIAL_TYPES should have exactly 3 values", () => {
      expect(Object.keys(CREDENTIAL_TYPES).length).toBe(3);
    });
  });
});
