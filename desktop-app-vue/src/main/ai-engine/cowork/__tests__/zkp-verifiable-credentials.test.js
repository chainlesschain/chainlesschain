/**
 * ZKPVerifiableCredentials unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  ZKPVerifiableCredentials,
  CREDENTIAL_STATUS,
  CREDENTIAL_TYPE,
  DISCLOSURE_TYPE,
} = require("../zkp-verifiable-credentials");

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

function issueTestCredential(engine) {
  return engine.issueCredential({
    type: "identity",
    issuerDid: "did:chainless:issuer-1",
    subjectDid: "did:chainless:subject-1",
    claims: { name: "Alice", age: 30, role: "admin" },
  });
}

describe("ZKPVerifiableCredentials", () => {
  let engine;
  let db;

  beforeEach(() => {
    engine = new ZKPVerifiableCredentials();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (engine._cleanupTimer) {
      clearInterval(engine._cleanupTimer);
    }
  });

  // ============================================================
  // initialize()
  // ============================================================

  describe("initialize()", () => {
    it("should set initialized=true", async () => {
      await engine.initialize(db);
      expect(engine.initialized).toBe(true);
    });

    it("should call db.exec for table creation", async () => {
      await engine.initialize(db);
      expect(db.exec).toHaveBeenCalled();
    });

    it("should be idempotent — second call does nothing", async () => {
      await engine.initialize(db);
      const execCount = db.exec.mock.calls.length;
      await engine.initialize(db);
      expect(db.exec.mock.calls.length).toBe(execCount);
    });
  });

  // ============================================================
  // issueCredential()
  // ============================================================

  describe("issueCredential()", () => {
    beforeEach(async () => {
      await engine.initialize(db);
    });

    it("should return a credential with correct structure", () => {
      const cred = issueTestCredential(engine);
      expect(cred.id).toBeDefined();
      expect(cred.type).toBe("identity");
      expect(cred.issuerDid).toBe("did:chainless:issuer-1");
      expect(cred.subjectDid).toBe("did:chainless:subject-1");
      expect(cred.status).toBe(CREDENTIAL_STATUS.ACTIVE);
    });

    it("should have a BBS+ proof", () => {
      const cred = issueTestCredential(engine);
      expect(cred.proof).toBeDefined();
      expect(cred.proof.scheme).toBe("bbs_plus");
      expect(cred.proof.signature).toBeDefined();
      expect(cred.proof.nonce).toBeDefined();
      expect(cred.proof.issuerPublicKey).toBeDefined();
    });

    it("should persist to db", () => {
      issueTestCredential(engine);
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should emit 'credential:issued' event", () => {
      const handler = vi.fn();
      engine.on("credential:issued", handler);
      issueTestCredential(engine);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "identity",
          issuerDid: "did:chainless:issuer-1",
          subjectDid: "did:chainless:subject-1",
        }),
      );
    });

    it("should include correct claims", () => {
      const cred = issueTestCredential(engine);
      expect(cred.claims).toEqual({ name: "Alice", age: 30, role: "admin" });
    });
  });

  // ============================================================
  // createPresentation()
  // ============================================================

  describe("createPresentation()", () => {
    let cred;

    beforeEach(async () => {
      await engine.initialize(db);
      cred = issueTestCredential(engine);
    });

    it("should create a presentation from a credential", () => {
      const pres = engine.createPresentation(cred.id);
      expect(pres.id).toBeDefined();
      expect(pres.credentialId).toBe(cred.id);
      expect(pres.proof).toBeDefined();
    });

    it("should include disclosed claims", () => {
      const pres = engine.createPresentation(cred.id);
      expect(pres.disclosedClaims).toEqual({
        name: "Alice",
        age: 30,
        role: "admin",
      });
    });

    it("should support selective disclosure — only requested keys", () => {
      const pres = engine.createPresentation(cred.id, ["name", "role"]);
      expect(Object.keys(pres.disclosedClaims)).toEqual(["name", "role"]);
      expect(pres.disclosedClaims.age).toBeUndefined();
    });

    it("should emit 'presentation:created' event", () => {
      const handler = vi.fn();
      engine.on("presentation:created", handler);
      engine.createPresentation(cred.id);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialId: cred.id,
        }),
      );
    });

    it("should throw for non-existent credential", () => {
      expect(() => engine.createPresentation("non-existent-id")).toThrow(
        "Credential not found",
      );
    });
  });

  // ============================================================
  // verifyPresentation()
  // ============================================================

  describe("verifyPresentation()", () => {
    let cred;

    beforeEach(async () => {
      await engine.initialize(db);
      cred = issueTestCredential(engine);
    });

    it("should verify a valid presentation", () => {
      const pres = engine.createPresentation(cred.id);
      const result = engine.verifyPresentation(pres);
      expect(result.valid).toBe(true);
      expect(result.credential).toBeDefined();
    });

    it("should return invalid for a revoked credential", () => {
      engine.revokeCredential(cred.id, "did:chainless:admin", "compromised");
      // Build a presentation-like object manually since createPresentation throws for revoked
      const result = engine.verifyPresentation({
        id: "pres-fake",
        credentialId: cred.id,
        disclosedClaims: cred.claims,
        proof: { derivedSignature: "fake", nonce: "fake" },
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("revoked");
    });

    it("should return invalid for an expired credential", () => {
      // Set expiry to the past
      const credObj = engine._credentials.get(cred.id);
      credObj.expiresAt = new Date(Date.now() - 10000).toISOString();
      credObj.status = CREDENTIAL_STATUS.ACTIVE;
      const result = engine.verifyPresentation({
        id: "pres-exp",
        credentialId: cred.id,
        disclosedClaims: cred.claims,
        proof: { derivedSignature: "fake", nonce: "fake" },
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("expired");
    });

    it("should return invalid for an unknown credential", () => {
      const result = engine.verifyPresentation({
        id: "pres-unk",
        credentialId: "unknown-cred-id",
        disclosedClaims: {},
        proof: { derivedSignature: "x", nonce: "x" },
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not found");
    });

    it("should emit 'presentation:verified' event for valid presentation", () => {
      const handler = vi.fn();
      engine.on("presentation:verified", handler);
      const pres = engine.createPresentation(cred.id);
      engine.verifyPresentation(pres);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialId: cred.id,
          valid: true,
        }),
      );
    });
  });

  // ============================================================
  // revokeCredential()
  // ============================================================

  describe("revokeCredential()", () => {
    let cred;

    beforeEach(async () => {
      await engine.initialize(db);
      cred = issueTestCredential(engine);
    });

    it("should revoke a credential", () => {
      engine.revokeCredential(cred.id, "did:chainless:admin", "compromised");
      const credObj = engine._credentials.get(cred.id);
      expect(credObj.status).toBe(CREDENTIAL_STATUS.REVOKED);
    });

    it("should add to revocation registry", () => {
      engine.revokeCredential(cred.id, "did:chainless:admin", "compromised");
      expect(engine._revocationSet.has(cred.id)).toBe(true);
    });

    it("should emit 'credential:revoked' event", () => {
      const handler = vi.fn();
      engine.on("credential:revoked", handler);
      engine.revokeCredential(cred.id, "did:chainless:admin", "compromised");
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialId: cred.id,
          revokedBy: "did:chainless:admin",
          reason: "compromised",
        }),
      );
    });

    it("should throw for non-existent credential", () => {
      expect(() =>
        engine.revokeCredential("non-existent", "did:admin"),
      ).toThrow("Credential not found");
    });
  });

  // ============================================================
  // listCredentials()
  // ============================================================

  describe("listCredentials()", () => {
    beforeEach(async () => {
      await engine.initialize(db);
    });

    it("should list all credentials", () => {
      issueTestCredential(engine);
      engine.issueCredential({
        type: "access",
        issuerDid: "did:chainless:issuer-2",
        subjectDid: "did:chainless:subject-2",
        claims: { level: "gold" },
      });
      const all = engine.listCredentials();
      expect(all.length).toBe(2);
    });

    it("should filter by type", () => {
      issueTestCredential(engine);
      engine.issueCredential({
        type: "access",
        issuerDid: "did:chainless:issuer-2",
        subjectDid: "did:chainless:subject-2",
        claims: { level: "gold" },
      });
      const access = engine.listCredentials({ type: "access" });
      expect(access.length).toBe(1);
      expect(access[0].type).toBe("access");
    });

    it("should filter by issuerDid", () => {
      issueTestCredential(engine);
      engine.issueCredential({
        type: "access",
        issuerDid: "did:chainless:issuer-2",
        subjectDid: "did:chainless:subject-2",
        claims: { level: "gold" },
      });
      const filtered = engine.listCredentials({
        issuerDid: "did:chainless:issuer-1",
      });
      expect(filtered.length).toBe(1);
      expect(filtered[0].issuerDid).toBe("did:chainless:issuer-1");
    });
  });

  // ============================================================
  // getStats()
  // ============================================================

  describe("getStats()", () => {
    beforeEach(async () => {
      await engine.initialize(db);
    });

    it("should return correct counts", () => {
      issueTestCredential(engine);
      engine.issueCredential({
        type: "access",
        issuerDid: "did:chainless:issuer-2",
        subjectDid: "did:chainless:subject-2",
        claims: { level: "gold" },
      });
      const stats = engine.getStats();
      expect(stats.totalCredentials).toBe(2);
      expect(stats.activeCredentials).toBe(2);
    });

    it("should count by type", () => {
      issueTestCredential(engine);
      issueTestCredential(engine);
      engine.issueCredential({
        type: "access",
        issuerDid: "did:chainless:issuer-2",
        subjectDid: "did:chainless:subject-2",
        claims: { level: "gold" },
      });
      const stats = engine.getStats();
      expect(stats.byType.identity).toBe(2);
      expect(stats.byType.access).toBe(1);
    });
  });

  // ============================================================
  // selectiveDisclose()
  // ============================================================

  describe("selectiveDisclose()", () => {
    let cred;

    beforeEach(async () => {
      await engine.initialize(db);
      cred = issueTestCredential(engine);
    });

    it("should return only specified claims", () => {
      const disclosed = engine.selectiveDisclose(cred.id, ["name"]);
      expect(disclosed.claims).toEqual({ name: "Alice" });
      expect(disclosed.claims.age).toBeUndefined();
      expect(disclosed.claims.role).toBeUndefined();
    });

    it("should preserve proof information", () => {
      const disclosed = engine.selectiveDisclose(cred.id, ["name"]);
      expect(disclosed.proof).toBeDefined();
      expect(disclosed.proof.scheme).toBe("bbs_plus");
      expect(disclosed.proof.derivedSignature).toBeDefined();
    });
  });

  // ============================================================
  // destroy()
  // ============================================================

  describe("destroy()", () => {
    it("should clear timer and set initialized=false", async () => {
      await engine.initialize(db);
      expect(engine.initialized).toBe(true);
      engine.destroy();
      expect(engine.initialized).toBe(false);
      expect(engine._cleanupTimer).toBeNull();
    });
  });
});
