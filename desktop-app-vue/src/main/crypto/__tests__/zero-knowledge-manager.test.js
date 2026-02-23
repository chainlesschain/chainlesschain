/**
 * ZeroKnowledgeManager Unit Tests
 *
 * Covers: initialize, generateZKProof, verifyZKProof, createAgeProof,
 *         createBalanceProof, ssoPrivacyProof, createZKRollupBatch,
 *         verifyZKRollupBatch, createAuditKey, createFileIntegrityProof,
 *         createQueryPrivacyProof, createSyncVerificationProof,
 *         benchmarkSystems, getStats
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock uuid ────────────────────────────────────────────────────────────────
vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-zk-1234"),
}));

const { ZeroKnowledgeManager } = require("../zero-knowledge-manager.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  const raw = {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    _prep: prepResult,
  };
  return { db: raw, saveToFile: vi.fn() };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ZeroKnowledgeManager", () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new ZeroKnowledgeManager();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true and call db.exec", async () => {
      await manager.initialize(mockDb);

      expect(manager.initialized).toBe(true);
      expect(mockDb.db.exec).toHaveBeenCalled();
    });

    it("should be idempotent — calling twice only execs once", async () => {
      await manager.initialize(mockDb);
      const callCount = mockDb.db.exec.mock.calls.length;

      await manager.initialize(mockDb);

      expect(mockDb.db.exec.mock.calls.length).toBe(callCount);
      expect(manager.initialized).toBe(true);
    });

    it("should work without db (memory-only mode)", async () => {
      await manager.initialize(null);

      expect(manager.initialized).toBe(true);
      expect(manager.db).toBeNull();
    });

    it("should emit initialized event", async () => {
      const spy = vi.fn();
      manager.on("initialized", spy);

      await manager.initialize(mockDb);

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // generateZKProof
  // ─────────────────────────────────────────────────────────────────────────
  describe("generateZKProof()", () => {
    it("should return proofId, proof, publicInputs, provingTimeMs, proofSize", async () => {
      const result = await manager.generateZKProof(
        "I know a secret",
        "mySecretWitness",
      );

      expect(result).toHaveProperty("proofId");
      expect(result).toHaveProperty("proof");
      expect(result).toHaveProperty("publicInputs");
      expect(result).toHaveProperty("provingTimeMs");
      expect(result).toHaveProperty("proofSize");
    });

    it("proof should be a non-empty string", async () => {
      const { proof } = await manager.generateZKProof("statement", "witness");

      expect(typeof proof).toBe("string");
      expect(proof.length).toBeGreaterThan(0);
    });

    it("should call db.prepare().run() when db is available", async () => {
      await manager.initialize(mockDb);
      vi.clearAllMocks();

      await manager.generateZKProof("s", "w");

      expect(mockDb.db.prepare).toHaveBeenCalled();
      expect(mockDb.db._prep.run).toHaveBeenCalled();
    });

    it("should throw for empty statement", async () => {
      await expect(manager.generateZKProof("", "witness")).rejects.toThrow(
        "statement and witness are required",
      );
    });

    it("should throw for missing witness", async () => {
      await expect(manager.generateZKProof("statement", null)).rejects.toThrow(
        "statement and witness are required",
      );
    });

    it("publicInputs should contain statementHash and proofSystem", async () => {
      const { publicInputs } = await manager.generateZKProof("stmt", "wit");

      expect(publicInputs).toHaveProperty("statementHash");
      expect(publicInputs).toHaveProperty("proofSystem");
    });

    it("should emit proof:generated event", async () => {
      const spy = vi.fn();
      manager.on("proof:generated", spy);

      await manager.generateZKProof("stmt", "wit");

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ proofId: expect.any(String) }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // verifyZKProof
  // ─────────────────────────────────────────────────────────────────────────
  describe("verifyZKProof()", () => {
    it("should return valid, verificationTimeMs, proofType when row exists", async () => {
      await manager.initialize(mockDb);

      // Mock the row returned by prepare().get()
      mockDb.db._prep.get.mockReturnValue({
        id: "test-uuid-zk-1234",
        proof_data: "deadbeef",
        verification_key: "cafebabe",
        proof_type: "zk-snark",
        expires_at: null,
      });

      const result = await manager.verifyZKProof("test-uuid-zk-1234");

      expect(result).toHaveProperty("valid");
      expect(result).toHaveProperty("verificationTimeMs");
      expect(result).toHaveProperty("proofType", "zk-snark");
    });

    it("should throw when proof is not found in DB", async () => {
      await manager.initialize(mockDb);

      // db.prepare().get() returns null (not found)
      mockDb.db._prep.get.mockReturnValue(null);

      await expect(manager.verifyZKProof("nonexistent-id")).rejects.toThrow(
        "Proof not found: nonexistent-id",
      );
    });

    it("should throw for empty proofId", async () => {
      await manager.initialize(mockDb);

      await expect(manager.verifyZKProof("")).rejects.toThrow(
        "proofId is required",
      );
    });

    it("should throw when no database is available", async () => {
      // manager not initialized with db
      await expect(manager.verifyZKProof("some-id")).rejects.toThrow(
        "Database not available for verification",
      );
    });

    it("should return valid=true when proof_data and verification_key are present", async () => {
      await manager.initialize(mockDb);

      mockDb.db._prep.get.mockReturnValue({
        id: "test-uuid-zk-1234",
        proof_data: "proof-content",
        verification_key: "vk-content",
        proof_type: "zk-snark",
        expires_at: null,
      });

      const { valid } = await manager.verifyZKProof("test-uuid-zk-1234");

      expect(valid).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createAgeProof
  // ─────────────────────────────────────────────────────────────────────────
  describe("createAgeProof()", () => {
    it("should return proofId, proof, claim, verified", async () => {
      const result = await manager.createAgeProof("1990-01-01", 18);

      expect(result).toHaveProperty("proofId");
      expect(result).toHaveProperty("proof");
      expect(result).toHaveProperty("claim");
      expect(result).toHaveProperty("verified");
    });

    it("claim should contain 'age' string", async () => {
      const { claim } = await manager.createAgeProof("1990-01-01", 18);

      expect(claim).toContain("age");
    });

    it("verified should be true when age >= minimumAge", async () => {
      // 1990-01-01 person is well over 18 in 2026
      const { verified } = await manager.createAgeProof("1990-01-01", 18);

      expect(verified).toBe(true);
    });

    it("verified should be false when age < minimumAge", async () => {
      // Someone born in 2020 would be ~6 years old in 2026
      const { verified } = await manager.createAgeProof("2020-01-01", 18);

      expect(verified).toBe(false);
    });

    it("should throw when birthDate is missing", async () => {
      await expect(manager.createAgeProof(null, 18)).rejects.toThrow(
        "birthDate and minimumAge are required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createBalanceProof
  // ─────────────────────────────────────────────────────────────────────────
  describe("createBalanceProof()", () => {
    it("should return proofId, proof, claim, verified", async () => {
      const result = await manager.createBalanceProof(1000, 500);

      expect(result).toHaveProperty("proofId");
      expect(result).toHaveProperty("proof");
      expect(result).toHaveProperty("claim");
      expect(result).toHaveProperty("verified");
    });

    it("claim should contain 'balance' string", async () => {
      const { claim } = await manager.createBalanceProof(1000, 500);

      expect(claim).toContain("balance");
    });

    it("verified=true when balance >= minimumBalance", async () => {
      const { verified } = await manager.createBalanceProof(1000, 500);

      expect(verified).toBe(true);
    });

    it("verified=false when balance < minimumBalance", async () => {
      const { verified } = await manager.createBalanceProof(100, 500);

      expect(verified).toBe(false);
    });

    it("verified=true when balance equals minimumBalance (boundary)", async () => {
      const { verified } = await manager.createBalanceProof(500, 500);

      expect(verified).toBe(true);
    });

    it("should throw when balance is missing", async () => {
      await expect(manager.createBalanceProof(null, 500)).rejects.toThrow(
        "balance and minimumBalance are required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ssoPrivacyProof
  // ─────────────────────────────────────────────────────────────────────────
  describe("ssoPrivacyProof()", () => {
    const attributes = {
      name: "Alice",
      email: "alice@example.com",
      age: 30,
      country: "US",
    };
    const disclosedFields = ["name", "country"];

    it("should return proofId, disclosedAttributes, hiddenCount", async () => {
      const result = await manager.ssoPrivacyProof(attributes, disclosedFields);

      expect(result).toHaveProperty("proofId");
      expect(result).toHaveProperty("disclosedAttributes");
      expect(result).toHaveProperty("hiddenCount");
    });

    it("hiddenCount should equal count of non-disclosed fields", async () => {
      const { hiddenCount } = await manager.ssoPrivacyProof(
        attributes,
        disclosedFields,
      );

      // attributes has 4 keys, 2 disclosed → 2 hidden
      expect(hiddenCount).toBe(2);
    });

    it("disclosedAttributes should contain only disclosed fields", async () => {
      const { disclosedAttributes } = await manager.ssoPrivacyProof(
        attributes,
        disclosedFields,
      );

      expect(disclosedAttributes).toHaveProperty("name", "Alice");
      expect(disclosedAttributes).toHaveProperty("country", "US");
      expect(disclosedAttributes).not.toHaveProperty("email");
      expect(disclosedAttributes).not.toHaveProperty("age");
    });

    it("hiddenCount=0 when all fields disclosed", async () => {
      const allFields = Object.keys(attributes);
      const { hiddenCount } = await manager.ssoPrivacyProof(
        attributes,
        allFields,
      );

      expect(hiddenCount).toBe(0);
    });

    it("should throw when attributes is missing", async () => {
      await expect(
        manager.ssoPrivacyProof(null, disclosedFields),
      ).rejects.toThrow("attributes and disclosedFields are required");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createZKRollupBatch
  // ─────────────────────────────────────────────────────────────────────────
  describe("createZKRollupBatch()", () => {
    // Use realistic-sized transactions so original JSON size exceeds proof size
    // (proof = 64-char HMAC hex + 64-char merkleRoot hex = 128 chars minimum)
    const txs = [
      {
        from: "0xabc123def456abc123def456abc123def456abc1",
        to: "0xbbb222ccc333ddd444eee555fff666aaa777bbb8",
        amount: 1000000,
        nonce: 1,
        gasPrice: "20000000000",
        data: "transfer",
      },
      {
        from: "0xccc333ddd444eee555fff666aaa777bbb888ccc9",
        to: "0xddd444eee555fff666aaa777bbb888ccc999ddd0",
        amount: 2500000,
        nonce: 2,
        gasPrice: "20000000000",
        data: "transfer",
      },
      {
        from: "0xeee555fff666aaa777bbb888ccc999ddd000eee1",
        to: "0xfff666aaa777bbb888ccc999ddd000eee111fff2",
        amount: 750000,
        nonce: 3,
        gasPrice: "20000000000",
        data: "transfer",
      },
      {
        from: "0xaaa777bbb888ccc999ddd000eee111fff222aaa3",
        to: "0xbbb888ccc999ddd000eee111fff222aaa333bbb4",
        amount: 3000000,
        nonce: 4,
        gasPrice: "20000000000",
        data: "transfer",
      },
    ];

    it("should return batchId, merkleRoot, txCount, compressionRatio", async () => {
      const result = await manager.createZKRollupBatch(txs);

      expect(result).toHaveProperty("batchId");
      expect(result).toHaveProperty("merkleRoot");
      expect(result).toHaveProperty("txCount");
      expect(result).toHaveProperty("compressionRatio");
    });

    it("txCount should match input transactions length", async () => {
      const { txCount } = await manager.createZKRollupBatch(txs);

      expect(txCount).toBe(txs.length);
    });

    it("compressionRatio > 1 for multiple txs", async () => {
      const { compressionRatio } = await manager.createZKRollupBatch(txs);

      expect(compressionRatio).toBeGreaterThan(1);
    });

    it("merkleRoot should be a non-empty hex string", async () => {
      const { merkleRoot } = await manager.createZKRollupBatch(txs);

      expect(typeof merkleRoot).toBe("string");
      expect(merkleRoot.length).toBeGreaterThan(0);
      expect(merkleRoot).toMatch(/^[0-9a-f]+$/);
    });

    it("should throw for empty transactions array", async () => {
      await expect(manager.createZKRollupBatch([])).rejects.toThrow(
        "transactions must be a non-empty array",
      );
    });

    it("should throw when transactions is not an array", async () => {
      await expect(manager.createZKRollupBatch("not-array")).rejects.toThrow(
        "transactions must be a non-empty array",
      );
    });

    it("should emit rollup:batched event", async () => {
      const spy = vi.fn();
      manager.on("rollup:batched", spy);

      await manager.createZKRollupBatch(txs);

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // verifyZKRollupBatch
  // ─────────────────────────────────────────────────────────────────────────
  describe("verifyZKRollupBatch()", () => {
    it("should attempt to verify and return result with valid, batchId, verificationTimeMs", async () => {
      await manager.initialize(mockDb);

      mockDb.db._prep.get.mockReturnValue({
        id: "test-uuid-zk-1234",
        proof_data: "proof-data",
        verification_key: "vk",
        proof_type: "zk-rollup",
        metadata: JSON.stringify({ merkleRoot: "abc123", txCount: 3 }),
      });

      const result = await manager.verifyZKRollupBatch("some-batch-id");

      expect(result).toHaveProperty("valid");
      expect(result).toHaveProperty("batchId", "some-batch-id");
      expect(result).toHaveProperty("verificationTimeMs");
    });

    it("should throw when batchId is missing", async () => {
      await manager.initialize(mockDb);

      await expect(manager.verifyZKRollupBatch("")).rejects.toThrow(
        "batchId is required",
      );
    });

    it("should throw when no database is available", async () => {
      await expect(
        manager.verifyZKRollupBatch("some-batch-id"),
      ).rejects.toThrow("Database not available for verification");
    });

    it("should throw when batch not found", async () => {
      await manager.initialize(mockDb);
      mockDb.db._prep.get.mockReturnValue(null);

      await expect(
        manager.verifyZKRollupBatch("nonexistent-batch"),
      ).rejects.toThrow("Rollup batch not found: nonexistent-batch");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createAuditKey
  // ─────────────────────────────────────────────────────────────────────────
  describe("createAuditKey()", () => {
    it("should return keyId, scope, permissions, publicKey", async () => {
      const result = await manager.createAuditKey("financial", [
        "verify-balance",
        "verify-identity",
      ]);

      expect(result).toHaveProperty("keyId");
      expect(result).toHaveProperty("scope", "financial");
      expect(result).toHaveProperty("permissions");
      expect(result).toHaveProperty("publicKey");
    });

    it("permissions should match input array", async () => {
      const perms = ["verify-balance", "verify-compliance"];
      const { permissions } = await manager.createAuditKey("compliance", perms);

      expect(permissions).toEqual(perms);
    });

    it("publicKey should be a non-empty string (PEM format)", async () => {
      const { publicKey } = await manager.createAuditKey("audit", ["read"]);

      expect(typeof publicKey).toBe("string");
      expect(publicKey.length).toBeGreaterThan(0);
    });

    it("should throw when scope is missing", async () => {
      await expect(manager.createAuditKey(null, ["read"])).rejects.toThrow(
        "scope and permissions array are required",
      );
    });

    it("should throw when permissions is not an array", async () => {
      await expect(manager.createAuditKey("financial", "read")).rejects.toThrow(
        "scope and permissions array are required",
      );
    });

    it("should emit audit:key-created event", async () => {
      const spy = vi.fn();
      manager.on("audit:key-created", spy);

      await manager.createAuditKey("test-scope", ["perm1"]);

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createFileIntegrityProof
  // ─────────────────────────────────────────────────────────────────────────
  describe("createFileIntegrityProof()", () => {
    it("should return proofId, proof, fileHashCommitment", async () => {
      const result = await manager.createFileIntegrityProof(
        "/path/to/file.txt",
        "abc123def456",
      );

      expect(result).toHaveProperty("proofId");
      expect(result).toHaveProperty("proof");
      expect(result).toHaveProperty("fileHashCommitment");
    });

    it("fileHashCommitment should be a non-empty hex string", async () => {
      const { fileHashCommitment } = await manager.createFileIntegrityProof(
        "/path/to/file.txt",
        "abc123def456",
      );

      expect(typeof fileHashCommitment).toBe("string");
      expect(fileHashCommitment).toMatch(/^[0-9a-f]+$/);
    });

    it("should throw when filePath is missing", async () => {
      await expect(
        manager.createFileIntegrityProof(null, "abc123"),
      ).rejects.toThrow("filePath and fileHash are required");
    });

    it("should throw when fileHash is missing", async () => {
      await expect(
        manager.createFileIntegrityProof("/some/path", null),
      ).rejects.toThrow("filePath and fileHash are required");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createQueryPrivacyProof
  // ─────────────────────────────────────────────────────────────────────────
  describe("createQueryPrivacyProof()", () => {
    it("should return proofId, proof, queryCommitment", async () => {
      const result = await manager.createQueryPrivacyProof(
        "SELECT * FROM users WHERE age > 18",
        "result-hash-abc123",
      );

      expect(result).toHaveProperty("proofId");
      expect(result).toHaveProperty("proof");
      expect(result).toHaveProperty("queryCommitment");
    });

    it("queryCommitment should be a non-empty hex string", async () => {
      const { queryCommitment } = await manager.createQueryPrivacyProof(
        "SELECT 1",
        "hash123",
      );

      expect(typeof queryCommitment).toBe("string");
      expect(queryCommitment).toMatch(/^[0-9a-f]+$/);
    });

    it("should throw when query is missing", async () => {
      await expect(
        manager.createQueryPrivacyProof(null, "hash123"),
      ).rejects.toThrow("query and resultHash are required");
    });

    it("should throw when resultHash is missing", async () => {
      await expect(
        manager.createQueryPrivacyProof("SELECT 1", null),
      ).rejects.toThrow("query and resultHash are required");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createSyncVerificationProof
  // ─────────────────────────────────────────────────────────────────────────
  describe("createSyncVerificationProof()", () => {
    it("should return proofId, proof, stateCommitment", async () => {
      const result = await manager.createSyncVerificationProof(
        "local-state-data",
        "remote-state-hash-abc",
      );

      expect(result).toHaveProperty("proofId");
      expect(result).toHaveProperty("proof");
      expect(result).toHaveProperty("stateCommitment");
    });

    it("stateCommitment should be a non-empty hex string", async () => {
      const { stateCommitment } = await manager.createSyncVerificationProof(
        "state",
        "remote-hash",
      );

      expect(typeof stateCommitment).toBe("string");
      expect(stateCommitment).toMatch(/^[0-9a-f]+$/);
    });

    it("should throw when localState is missing", async () => {
      await expect(
        manager.createSyncVerificationProof(null, "remote-hash"),
      ).rejects.toThrow("localState and remoteStateHash are required");
    });

    it("should throw when remoteStateHash is missing", async () => {
      await expect(
        manager.createSyncVerificationProof("local-state", null),
      ).rejects.toThrow("localState and remoteStateHash are required");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // benchmarkSystems
  // ─────────────────────────────────────────────────────────────────────────
  describe("benchmarkSystems()", () => {
    it("should return snark, stark, bulletproofs, plonk", async () => {
      const results = await manager.benchmarkSystems();

      expect(results).toHaveProperty("snark");
      expect(results).toHaveProperty("stark");
      expect(results).toHaveProperty("bulletproofs");
      expect(results).toHaveProperty("plonk");
    });

    it("each system should have provingTime, verifyTime, proofSize, setupRequired", async () => {
      const results = await manager.benchmarkSystems();

      for (const key of ["snark", "stark", "bulletproofs", "plonk"]) {
        const sys = results[key];
        expect(sys).toHaveProperty("provingTime");
        expect(typeof sys.provingTime).toBe("number");
        expect(sys).toHaveProperty("verifyTime");
        expect(typeof sys.verifyTime).toBe("number");
        expect(sys).toHaveProperty("proofSize");
        expect(sys).toHaveProperty("setupRequired");
      }
    });

    it("snark.setupRequired should be true", async () => {
      const { snark } = await manager.benchmarkSystems();

      expect(snark.setupRequired).toBe(true);
    });

    it("stark.setupRequired should be false", async () => {
      const { stark } = await manager.benchmarkSystems();

      expect(stark.setupRequired).toBe(false);
    });

    it("provingTime values should be positive numbers", async () => {
      const results = await manager.benchmarkSystems();

      for (const key of ["snark", "stark", "bulletproofs", "plonk"]) {
        expect(results[key].provingTime).toBeGreaterThan(0);
        expect(results[key].verifyTime).toBeGreaterThan(0);
      }
    });

    it("should emit benchmark:completed event", async () => {
      const spy = vi.fn();
      manager.on("benchmark:completed", spy);

      await manager.benchmarkSystems();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    it("should return {total:0, verified:0, unverified:0, byType:{}} with no db rows", async () => {
      const stats = await manager.getStats();

      expect(stats).toEqual({
        total: 0,
        verified: 0,
        unverified: 0,
        byType: {},
      });
    });

    it("should return zero stats when no db initialized", async () => {
      const stats = await manager.getStats();

      expect(stats.total).toBe(0);
      expect(stats.verified).toBe(0);
      expect(stats.unverified).toBe(0);
    });

    it("should aggregate total, verified, unverified from db rows", async () => {
      await manager.initialize(mockDb);

      // total row
      mockDb.db._prep.get
        .mockReturnValueOnce({ cnt: 10 }) // total
        .mockReturnValueOnce({ cnt: 7 }); // verified

      mockDb.db._prep.all.mockReturnValue([
        { proof_type: "zk-snark", cnt: 6 },
        { proof_type: "age-proof", cnt: 4 },
      ]);

      const stats = await manager.getStats();

      expect(stats.total).toBe(10);
      expect(stats.verified).toBe(7);
      expect(stats.unverified).toBe(3);
    });

    it("should aggregate byType from db type rows", async () => {
      await manager.initialize(mockDb);

      mockDb.db._prep.get
        .mockReturnValueOnce({ cnt: 5 })
        .mockReturnValueOnce({ cnt: 3 });

      mockDb.db._prep.all.mockReturnValue([
        { proof_type: "zk-snark", cnt: 3 },
        { proof_type: "bulletproof", cnt: 2 },
      ]);

      const stats = await manager.getStats();

      expect(stats.byType["zk-snark"]).toBe(3);
      expect(stats.byType["bulletproof"]).toBe(2);
    });
  });
});
