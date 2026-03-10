/**
 * ZKPProofEngine unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  ZKPProofEngine,
  PROOF_TYPE,
  PROOF_SCHEME,
  PROOF_STATUS,
} = require("../zkp-proof-engine");

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

describe("ZKPProofEngine", () => {
  let engine;
  let db;

  beforeEach(() => {
    engine = new ZKPProofEngine();
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
  // generateIdentityProof()
  // ============================================================

  describe("generateIdentityProof()", () => {
    beforeEach(async () => {
      await engine.initialize(db);
    });

    it("should return a proof with correct type", async () => {
      const proof = await engine.generateIdentityProof("did:chainless:alice", {
        name: "Alice",
      });
      expect(proof.proofType).toBe(PROOF_TYPE.IDENTITY);
      expect(proof.id).toBeDefined();
      expect(proof.proverDid).toBe("did:chainless:alice");
    });

    it("should have commitment/challenge/response in proofData", async () => {
      const proof = await engine.generateIdentityProof("did:chainless:alice", {
        name: "Alice",
      });
      expect(proof.proofData.commitment).toBeDefined();
      expect(proof.proofData.challenge).toBeDefined();
      expect(proof.proofData.response).toBeDefined();
    });

    it("should persist the proof to db", async () => {
      await engine.generateIdentityProof("did:chainless:alice", {
        name: "Alice",
      });
      expect(db.run).toHaveBeenCalled();
    });

    it("should emit 'proof:generated' event", async () => {
      const handler = vi.fn();
      engine.on("proof:generated", handler);
      await engine.generateIdentityProof("did:chainless:alice", {
        name: "Alice",
      });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          proofType: PROOF_TYPE.IDENTITY,
          proverDid: "did:chainless:alice",
        }),
      );
    });

    it("should throw if proverDid is missing", async () => {
      await expect(engine.generateIdentityProof(null, {})).rejects.toThrow(
        "proverDid is required",
      );
    });
  });

  // ============================================================
  // generateRangeProof()
  // ============================================================

  describe("generateRangeProof()", () => {
    beforeEach(async () => {
      await engine.initialize(db);
    });

    it("should return a range proof", async () => {
      const proof = await engine.generateRangeProof(
        "did:chainless:bob",
        25,
        18,
        65,
      );
      expect(proof.proofType).toBe(PROOF_TYPE.RANGE);
      expect(proof.id).toBeDefined();
    });

    it("should have commitment and rangeCommitment in proofData", async () => {
      const proof = await engine.generateRangeProof(
        "did:chainless:bob",
        25,
        18,
        65,
      );
      expect(proof.proofData.commitment).toBeDefined();
      expect(proof.proofData.rangeCommitment).toBeDefined();
    });

    it("should throw if value is out of range", async () => {
      await expect(
        engine.generateRangeProof("did:chainless:bob", 10, 18, 65),
      ).rejects.toThrow("value is out of range");
    });

    it("should have min/max in publicInputs", async () => {
      const proof = await engine.generateRangeProof(
        "did:chainless:bob",
        25,
        18,
        65,
      );
      expect(proof.publicInputs.min).toBe(18);
      expect(proof.publicInputs.max).toBe(65);
    });

    it("should emit 'proof:generated' event", async () => {
      const handler = vi.fn();
      engine.on("proof:generated", handler);
      await engine.generateRangeProof("did:chainless:bob", 25, 18, 65);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          proofType: PROOF_TYPE.RANGE,
          proverDid: "did:chainless:bob",
        }),
      );
    });
  });

  // ============================================================
  // generateMembershipProof()
  // ============================================================

  describe("generateMembershipProof()", () => {
    beforeEach(async () => {
      await engine.initialize(db);
    });

    it("should return a membership proof", async () => {
      const proof = await engine.generateMembershipProof(
        "did:chainless:carol",
        "admin",
        ["admin", "user", "moderator"],
      );
      expect(proof.proofType).toBe(PROOF_TYPE.MEMBERSHIP);
      expect(proof.id).toBeDefined();
    });

    it("should have setCommitment and membershipWitness in proofData", async () => {
      const proof = await engine.generateMembershipProof(
        "did:chainless:carol",
        "admin",
        ["admin", "user", "moderator"],
      );
      expect(proof.proofData.setCommitment).toBeDefined();
      expect(proof.proofData.membershipWitness).toBeDefined();
    });

    it("should have setSize in publicInputs", async () => {
      const proof = await engine.generateMembershipProof(
        "did:chainless:carol",
        "admin",
        ["admin", "user", "moderator"],
      );
      expect(proof.publicInputs.setSize).toBe(3);
    });

    it("should emit 'proof:generated' event", async () => {
      const handler = vi.fn();
      engine.on("proof:generated", handler);
      await engine.generateMembershipProof("did:chainless:carol", "admin", [
        "admin",
        "user",
        "moderator",
      ]);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          proofType: PROOF_TYPE.MEMBERSHIP,
          proverDid: "did:chainless:carol",
        }),
      );
    });
  });

  // ============================================================
  // verifyProof()
  // ============================================================

  describe("verifyProof()", () => {
    beforeEach(async () => {
      await engine.initialize(db);
    });

    it("should verify a valid identity proof and return { valid: true }", async () => {
      const proof = await engine.generateIdentityProof("did:chainless:alice", {
        name: "Alice",
      });
      const result = engine.verifyProof(proof.id);
      expect(result.valid).toBe(true);
      expect(result.proof).toBeDefined();
    });

    it("should verify a valid range proof", async () => {
      const proof = await engine.generateRangeProof(
        "did:chainless:bob",
        25,
        18,
        65,
      );
      const result = engine.verifyProof(proof.id);
      expect(result.valid).toBe(true);
    });

    it("should verify a valid membership proof", async () => {
      const proof = await engine.generateMembershipProof(
        "did:chainless:carol",
        "admin",
        ["admin", "user"],
      );
      const result = engine.verifyProof(proof.id);
      expect(result.valid).toBe(true);
    });

    it("should return { valid: false } for an expired proof", async () => {
      engine.configure({ proofExpiryMs: 1 });
      const proof = await engine.generateIdentityProof("did:chainless:alice", {
        name: "Alice",
      });
      // Wait a tiny bit to ensure expiry
      await new Promise((resolve) => setTimeout(resolve, 10));
      const result = engine.verifyProof(proof.id);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("expired");
    });

    it("should return { valid: false } for a non-existent proof", () => {
      const result = engine.verifyProof("non-existent-id");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not found");
    });
  });

  // ============================================================
  // listProofs()
  // ============================================================

  describe("listProofs()", () => {
    beforeEach(async () => {
      await engine.initialize(db);
    });

    it("should list all proofs", async () => {
      await engine.generateIdentityProof("did:chainless:alice", {
        name: "Alice",
      });
      await engine.generateRangeProof("did:chainless:bob", 25, 18, 65);
      const all = engine.listProofs();
      expect(all.length).toBe(2);
    });

    it("should filter by proofType", async () => {
      await engine.generateIdentityProof("did:chainless:alice", {
        name: "Alice",
      });
      await engine.generateRangeProof("did:chainless:bob", 25, 18, 65);
      const range = engine.listProofs({ proofType: PROOF_TYPE.RANGE });
      expect(range.length).toBe(1);
      expect(range[0].proofType).toBe(PROOF_TYPE.RANGE);
    });

    it("should filter by proverDid", async () => {
      await engine.generateIdentityProof("did:chainless:alice", {
        name: "Alice",
      });
      await engine.generateIdentityProof("did:chainless:bob", { name: "Bob" });
      const alice = engine.listProofs({ proverDid: "did:chainless:alice" });
      expect(alice.length).toBe(1);
      expect(alice[0].proverDid).toBe("did:chainless:alice");
    });
  });

  // ============================================================
  // getStats()
  // ============================================================

  describe("getStats()", () => {
    beforeEach(async () => {
      await engine.initialize(db);
    });

    it("should return correct total count", async () => {
      await engine.generateIdentityProof("did:chainless:alice", {
        name: "Alice",
      });
      await engine.generateRangeProof("did:chainless:bob", 25, 18, 65);
      const stats = engine.getStats();
      expect(stats.totalProofs).toBe(2);
      expect(stats.validProofs).toBe(2);
    });

    it("should count by type", async () => {
      await engine.generateIdentityProof("did:chainless:alice", {
        name: "Alice",
      });
      await engine.generateRangeProof("did:chainless:bob", 25, 18, 65);
      await engine.generateMembershipProof("did:chainless:carol", "admin", [
        "admin",
        "user",
      ]);
      const stats = engine.getStats();
      expect(stats.byType.identity).toBe(1);
      expect(stats.byType.range).toBe(1);
      expect(stats.byType.membership).toBe(1);
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

  // ============================================================
  // constants
  // ============================================================

  describe("constants", () => {
    it("PROOF_TYPE should have correct values", () => {
      expect(PROOF_TYPE.IDENTITY).toBe("identity");
      expect(PROOF_TYPE.RANGE).toBe("range");
      expect(PROOF_TYPE.MEMBERSHIP).toBe("membership");
      expect(PROOF_TYPE.KNOWLEDGE).toBe("knowledge");
    });

    it("PROOF_SCHEME should have correct values", () => {
      expect(PROOF_SCHEME.SCHNORR).toBe("schnorr");
      expect(PROOF_SCHEME.BBS_PLUS).toBe("bbs_plus");
      expect(PROOF_SCHEME.GROTH16).toBe("groth16");
      expect(PROOF_SCHEME.BULLETPROOFS).toBe("bulletproofs");
    });
  });
});
