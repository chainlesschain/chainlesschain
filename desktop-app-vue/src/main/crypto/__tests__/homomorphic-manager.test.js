/**
 * HomomorphicManager Unit Tests
 *
 * Covers: initialize, paillierKeyGen, paillierEncrypt, paillierDecrypt,
 *         paillierAdd, paillierScalarMultiply, tfheInit, tfheEvalGate,
 *         encryptedSQLQuery, aiPrivacyInference, encryptedSearch,
 *         encryptedDataAnalysis, multiAgentSecureCompute,
 *         encryptedBackupVerify, setGPUAcceleration, setTieringStrategy,
 *         getStats
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

const { HomomorphicManager } = require("../homomorphic-manager.js");

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

describe("HomomorphicManager", () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new HomomorphicManager();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true", async () => {
      await manager.initialize(mockDb);

      expect(manager.initialized).toBe(true);
    });

    it("should be idempotent — calling twice only execs once", async () => {
      await manager.initialize(mockDb);
      const execCalls = mockDb.db.exec.mock.calls.length;

      await manager.initialize(mockDb);

      expect(mockDb.db.exec.mock.calls.length).toBe(execCalls);
      expect(manager.initialized).toBe(true);
    });

    it("should work without db (memory-only mode)", async () => {
      await manager.initialize(null);

      expect(manager.initialized).toBe(true);
      expect(manager.db).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // paillierKeyGen
  // ─────────────────────────────────────────────────────────────────────────
  describe("paillierKeyGen()", () => {
    it("should return publicKey, privateKey, and bitLength", async () => {
      await manager.initialize(null);

      const result = await manager.paillierKeyGen();

      expect(result).toHaveProperty("publicKey");
      expect(result).toHaveProperty("privateKey");
      expect(result).toHaveProperty("bitLength");
    });

    it("publicKey should have n and g fields", async () => {
      await manager.initialize(null);

      const { publicKey } = await manager.paillierKeyGen();

      expect(publicKey).toHaveProperty("n");
      expect(publicKey).toHaveProperty("g");
      expect(typeof publicKey.n).toBe("string");
      expect(typeof publicKey.g).toBe("string");
    });

    it("privateKey should have lambda and mu fields", async () => {
      await manager.initialize(null);

      const { privateKey } = await manager.paillierKeyGen();

      expect(privateKey).toHaveProperty("lambda");
      expect(privateKey).toHaveProperty("mu");
      expect(typeof privateKey.lambda).toBe("string");
      expect(typeof privateKey.mu).toBe("string");
    });

    it("should use default bitLength of 2048", async () => {
      await manager.initialize(null);

      const result = await manager.paillierKeyGen();

      expect(result.bitLength).toBe(2048);
    });

    it("should support 4096 bit length", async () => {
      await manager.initialize(null);

      const result = await manager.paillierKeyGen(4096);

      expect(result.bitLength).toBe(4096);
    });

    it("should store computation in DB when db is available", async () => {
      await manager.initialize(mockDb);

      await manager.paillierKeyGen();

      expect(mockDb.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO he_computations"),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // paillierEncrypt
  // ─────────────────────────────────────────────────────────────────────────
  describe("paillierEncrypt()", () => {
    it("should return ciphertext and scheme:'paillier'", async () => {
      await manager.initialize(null);
      const { publicKey } = await manager.paillierKeyGen();

      const result = await manager.paillierEncrypt(42, publicKey);

      expect(result).toHaveProperty("ciphertext");
      expect(result.scheme).toBe("paillier");
      expect(typeof result.ciphertext).toBe("string");
    });

    it("should throw if plaintext is missing (null)", async () => {
      await manager.initialize(null);
      const { publicKey } = await manager.paillierKeyGen();

      await expect(manager.paillierEncrypt(null, publicKey)).rejects.toThrow(
        "plaintext and publicKey are required",
      );
    });

    it("should throw if publicKey is missing", async () => {
      await manager.initialize(null);

      await expect(manager.paillierEncrypt(42, null)).rejects.toThrow(
        "plaintext and publicKey are required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // paillierDecrypt
  // ─────────────────────────────────────────────────────────────────────────
  describe("paillierDecrypt()", () => {
    it("should return plaintext and scheme:'paillier'", async () => {
      await manager.initialize(null);
      const { publicKey, privateKey } = await manager.paillierKeyGen();
      const { ciphertext } = await manager.paillierEncrypt(100, publicKey);

      const result = await manager.paillierDecrypt(ciphertext, privateKey);

      expect(result).toHaveProperty("plaintext");
      expect(result.scheme).toBe("paillier");
      expect(typeof result.plaintext).toBe("string");
    });

    it("should throw if ciphertext is missing", async () => {
      await manager.initialize(null);
      const { privateKey } = await manager.paillierKeyGen();

      await expect(manager.paillierDecrypt(null, privateKey)).rejects.toThrow(
        "ciphertext and privateKey are required",
      );
    });

    it("should throw if privateKey is missing", async () => {
      await manager.initialize(null);
      const { publicKey } = await manager.paillierKeyGen();
      const { ciphertext } = await manager.paillierEncrypt(100, publicKey);

      await expect(manager.paillierDecrypt(ciphertext, null)).rejects.toThrow(
        "ciphertext and privateKey are required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // paillierAdd
  // ─────────────────────────────────────────────────────────────────────────
  describe("paillierAdd()", () => {
    it("should return result and operation:'add'", async () => {
      await manager.initialize(null);
      const { publicKey } = await manager.paillierKeyGen();
      const { ciphertext: c1 } = await manager.paillierEncrypt(10, publicKey);
      const { ciphertext: c2 } = await manager.paillierEncrypt(20, publicKey);

      const result = await manager.paillierAdd(c1, c2, publicKey);

      expect(result).toHaveProperty("result");
      expect(result.operation).toBe("add");
      expect(typeof result.result).toBe("string");
    });

    it("should store computation in DB when db is available", async () => {
      await manager.initialize(mockDb);
      const { publicKey } = await manager.paillierKeyGen();
      const { ciphertext: c1 } = await manager.paillierEncrypt(10, publicKey);
      const { ciphertext: c2 } = await manager.paillierEncrypt(20, publicKey);

      await manager.paillierAdd(c1, c2, publicKey);

      // prepare is called multiple times; at least once for INSERT
      expect(mockDb.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO he_computations"),
      );
    });

    it("should throw if any argument is missing", async () => {
      await manager.initialize(null);
      const { publicKey } = await manager.paillierKeyGen();

      await expect(
        manager.paillierAdd(null, "some-ct", publicKey),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // paillierScalarMultiply
  // ─────────────────────────────────────────────────────────────────────────
  describe("paillierScalarMultiply()", () => {
    it("should return result and operation:'scalar_multiply'", async () => {
      await manager.initialize(null);
      const { publicKey } = await manager.paillierKeyGen();
      const { ciphertext } = await manager.paillierEncrypt(7, publicKey);

      const result = await manager.paillierScalarMultiply(
        ciphertext,
        3,
        publicKey,
      );

      expect(result).toHaveProperty("result");
      expect(result.operation).toBe("scalar_multiply");
      expect(typeof result.result).toBe("string");
    });

    it("should throw if ciphertext is missing", async () => {
      await manager.initialize(null);
      const { publicKey } = await manager.paillierKeyGen();

      await expect(
        manager.paillierScalarMultiply(null, 3, publicKey),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // tfheInit
  // ─────────────────────────────────────────────────────────────────────────
  describe("tfheInit()", () => {
    it("should return contextId, securityParam, bootstrapKeySize", async () => {
      await manager.initialize(null);

      const result = await manager.tfheInit();

      expect(result).toHaveProperty("contextId");
      expect(result).toHaveProperty("securityParam");
      expect(result).toHaveProperty("bootstrapKeySize");
    });

    it("should store context in this.tfheContexts Map", async () => {
      await manager.initialize(null);

      const { contextId } = await manager.tfheInit(128);

      expect(manager.tfheContexts.has(contextId)).toBe(true);
    });

    it("bootstrapKeySize should scale with securityParam", async () => {
      await manager.initialize(null);

      const { bootstrapKeySize, securityParam } = await manager.tfheInit(128);

      // bootstrapKeySize = securityParam * securityParam * 8
      expect(bootstrapKeySize).toBe(securityParam * securityParam * 8);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // tfheEvalGate
  // ─────────────────────────────────────────────────────────────────────────
  describe("tfheEvalGate()", () => {
    let contextId;

    beforeEach(async () => {
      await manager.initialize(null);
      const ctx = await manager.tfheInit();
      contextId = ctx.contextId;
    });

    it.each(["AND", "OR", "XOR", "NAND"])(
      "should support %s gate and return result, gate, evaluationTimeMs",
      async (gate) => {
        const result = await manager.tfheEvalGate(
          gate,
          "input1",
          "input2",
          contextId,
        );

        expect(result).toHaveProperty("result");
        expect(result.gate).toBe(gate);
        expect(result).toHaveProperty("evaluationTimeMs");
        expect(typeof result.evaluationTimeMs).toBe("number");
      },
    );

    it("should support NOT gate (no input2 needed)", async () => {
      const result = await manager.tfheEvalGate(
        "NOT",
        "input1",
        null,
        contextId,
      );

      expect(result.gate).toBe("NOT");
      expect(result).toHaveProperty("result");
    });

    it("should throw for invalid contextId (not found)", async () => {
      await expect(
        manager.tfheEvalGate("AND", "i1", "i2", "nonexistent-ctx-id"),
      ).rejects.toThrow("TFHE context not found");
    });

    it("should throw for unsupported gate type", async () => {
      await expect(
        manager.tfheEvalGate("INVALID_GATE", "i1", "i2", contextId),
      ).rejects.toThrow("Unsupported gate");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // encryptedSQLQuery
  // ─────────────────────────────────────────────────────────────────────────
  describe("encryptedSQLQuery()", () => {
    it("should return resultCount, queryTimeMs, scheme:'bfv'", async () => {
      await manager.initialize(null);

      const result = await manager.encryptedSQLQuery(
        "SELECT * FROM users WHERE age > 18",
        [{ record: "encrypted-data-1" }, { record: "encrypted-data-2" }],
      );

      expect(result).toHaveProperty("resultCount");
      expect(result).toHaveProperty("queryTimeMs");
      expect(result.scheme).toBe("bfv");
      expect(typeof result.resultCount).toBe("number");
      expect(result.resultCount).toBeGreaterThanOrEqual(0);
    });

    it("should throw if query is missing", async () => {
      await manager.initialize(null);

      await expect(
        manager.encryptedSQLQuery(null, [{ record: "x" }]),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // aiPrivacyInference
  // ─────────────────────────────────────────────────────────────────────────
  describe("aiPrivacyInference()", () => {
    it("should return encryptedOutput, inferenceTimeMs, modelId", async () => {
      await manager.initialize(null);

      const result = await manager.aiPrivacyInference("gpt-private-v1", {
        features: [0.1, 0.5, 0.9],
      });

      expect(result).toHaveProperty("encryptedOutput");
      expect(result).toHaveProperty("inferenceTimeMs");
      expect(result.modelId).toBe("gpt-private-v1");
    });

    it("should throw if modelId is missing", async () => {
      await manager.initialize(null);

      await expect(
        manager.aiPrivacyInference(null, { features: [] }),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // encryptedSearch
  // ─────────────────────────────────────────────────────────────────────────
  describe("encryptedSearch()", () => {
    it("should return matchCount and searchTimeMs", async () => {
      await manager.initialize(null);

      const result = await manager.encryptedSearch("alice", [
        { idx: "enc-token-a" },
        { idx: "enc-token-b" },
        { idx: "enc-token-c" },
      ]);

      expect(result).toHaveProperty("matchCount");
      expect(result).toHaveProperty("searchTimeMs");
    });

    it("matchCount should be a non-negative number", async () => {
      await manager.initialize(null);

      const result = await manager.encryptedSearch("search-term", [
        { idx: "e1" },
      ]);

      expect(typeof result.matchCount).toBe("number");
      expect(result.matchCount).toBeGreaterThanOrEqual(0);
    });

    it("should throw if searchTerm is missing", async () => {
      await manager.initialize(null);

      await expect(
        manager.encryptedSearch(null, [{ idx: "x" }]),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // encryptedDataAnalysis
  // ─────────────────────────────────────────────────────────────────────────
  describe("encryptedDataAnalysis()", () => {
    const dataset = [{ val: "enc-10" }, { val: "enc-20" }, { val: "enc-30" }];

    it.each(["sum", "avg", "count", "min", "max"])(
      "should support '%s' operation and return result, operation, recordCount",
      async (op) => {
        await manager.initialize(null);

        const result = await manager.encryptedDataAnalysis(dataset, op);

        expect(result).toHaveProperty("result");
        expect(result.operation).toBe(op);
        expect(result).toHaveProperty("recordCount");
      },
    );

    it("recordCount should equal dataset.length", async () => {
      await manager.initialize(null);

      const result = await manager.encryptedDataAnalysis(dataset, "count");

      expect(result.recordCount).toBe(dataset.length);
    });

    it("should throw for unsupported operation", async () => {
      await manager.initialize(null);

      await expect(
        manager.encryptedDataAnalysis(dataset, "median"),
      ).rejects.toThrow("Unsupported operation");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // multiAgentSecureCompute
  // ─────────────────────────────────────────────────────────────────────────
  describe("multiAgentSecureCompute()", () => {
    it("should return result, participantCount, roundTrips", async () => {
      await manager.initialize(null);
      const agents = [
        { id: "agent-1", encryptedInput: "ct-1" },
        { id: "agent-2", encryptedInput: "ct-2" },
        { id: "agent-3", encryptedInput: "ct-3" },
      ];

      const result = await manager.multiAgentSecureCompute(agents, {
        type: "aggregate",
      });

      expect(result).toHaveProperty("result");
      expect(result).toHaveProperty("participantCount");
      expect(result).toHaveProperty("roundTrips");
    });

    it("participantCount should equal agents.length", async () => {
      await manager.initialize(null);
      const agents = [
        { id: "a1", encryptedInput: "ct1" },
        { id: "a2", encryptedInput: "ct2" },
      ];

      const result = await manager.multiAgentSecureCompute(agents, {
        type: "sum",
      });

      expect(result.participantCount).toBe(agents.length);
    });

    it("should throw if agents array is empty", async () => {
      await manager.initialize(null);

      await expect(
        manager.multiAgentSecureCompute([], { type: "aggregate" }),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // encryptedBackupVerify
  // ─────────────────────────────────────────────────────────────────────────
  describe("encryptedBackupVerify()", () => {
    it("should return verified, backupId, integrityScore", async () => {
      await manager.initialize(null);

      const result = await manager.encryptedBackupVerify(
        "backup-uuid-001",
        "aabbccddeeff001122334455",
      );

      expect(result).toHaveProperty("verified");
      expect(result).toHaveProperty("backupId");
      expect(result).toHaveProperty("integrityScore");
    });

    it("backupId should be returned in the result unchanged", async () => {
      await manager.initialize(null);
      const id = "my-backup-id-xyz";

      const result = await manager.encryptedBackupVerify(id, "somehashvalue");

      expect(result.backupId).toBe(id);
    });

    it("verified should be true only if hashes match exactly", async () => {
      const crypto = require("crypto");
      await manager.initialize(null);
      const backupId = "exact-match-id";
      const correctHash = crypto
        .createHash("sha256")
        .update(backupId)
        .digest("hex");

      const result = await manager.encryptedBackupVerify(backupId, correctHash);

      expect(result.verified).toBe(true);
    });

    it("should throw if backupId is missing", async () => {
      await manager.initialize(null);

      await expect(
        manager.encryptedBackupVerify(null, "somehash"),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // setGPUAcceleration
  // ─────────────────────────────────────────────────────────────────────────
  describe("setGPUAcceleration()", () => {
    it("enabled=true should return estimatedSpeedup > 1", () => {
      const result = manager.setGPUAcceleration(true);

      expect(result.enabled).toBe(true);
      expect(result.estimatedSpeedup).toBeGreaterThan(1);
    });

    it("enabled=false should return estimatedSpeedup of 1", () => {
      const result = manager.setGPUAcceleration(false);

      expect(result.enabled).toBe(false);
      expect(result.estimatedSpeedup).toBe(1.0);
    });

    it("should set this.gpuAcceleration flag on the instance", () => {
      manager.setGPUAcceleration(true);
      expect(manager.gpuAcceleration).toBe(true);

      manager.setGPUAcceleration(false);
      expect(manager.gpuAcceleration).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // setTieringStrategy
  // ─────────────────────────────────────────────────────────────────────────
  describe("setTieringStrategy()", () => {
    it.each(["auto", "phe-first", "fhe-always"])(
      "should accept '%s' and return strategy and description",
      (strategy) => {
        const result = manager.setTieringStrategy(strategy);

        expect(result.strategy).toBe(strategy);
        expect(typeof result.description).toBe("string");
        expect(result.description.length).toBeGreaterThan(0);
      },
    );

    it("should throw for an invalid strategy string", () => {
      expect(() => manager.setTieringStrategy("invalid-mode")).toThrow(
        "Unsupported tiering strategy",
      );
    });

    it("should set this.tieringStrategy on the instance", () => {
      manager.setTieringStrategy("fhe-always");
      expect(manager.tieringStrategy).toBe("fhe-always");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    it("should return empty stats shape with no rows (mock db returns nulls)", async () => {
      await manager.initialize(mockDb);

      const stats = await manager.getStats();

      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("byScheme");
      expect(stats).toHaveProperty("byOperation");
      expect(stats).toHaveProperty("avgDurationMs");
      expect(stats.total).toBe(0);
      expect(stats.byScheme).toEqual({});
      expect(stats.byOperation).toEqual({});
    });

    it("should return zeroed stats when no db is set", async () => {
      await manager.initialize(null);

      const stats = await manager.getStats();

      expect(stats.total).toBe(0);
      expect(stats.byScheme).toEqual({});
      expect(stats.byOperation).toEqual({});
    });
  });
});
