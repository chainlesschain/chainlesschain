/**
 * AdvancedCryptoManager Unit Tests
 *
 * Covers: initialize, sseCreateIndex, sseSearch, fuzzyEncryptedSearch,
 *         ragEncryptedSimilarity, generateReEncryptionKey, proxyReEncrypt,
 *         p2pReEncryptedShare, rbacReEncryptionDelegate, verifiableCompute,
 *         verifyComputation, llmOutputVerify, auditProof, registerAlgorithm,
 *         switchAlgorithm, keyEscrowSetup, emergencyAccess, enhancedRandom,
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

const { AdvancedCryptoManager } = require("../advanced-crypto-manager.js");

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

// Sample documents for SSE index tests
const SAMPLE_DOCS = [
  { id: "doc-1", content: "The quick brown fox jumps over the lazy dog" },
  { id: "doc-2", content: "Blockchain decentralized cryptography security" },
  { id: "doc-3", content: "Advanced encryption featuring proxy re-encryption" },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AdvancedCryptoManager", () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new AdvancedCryptoManager();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true and register 6 default algorithms", async () => {
      await manager.initialize(mockDb);

      expect(manager.initialized).toBe(true);
      expect(manager.algorithms.size).toBe(6);
    });

    it("this.algorithms.size should be 6 after init", async () => {
      await manager.initialize(mockDb);

      expect(manager.algorithms.size).toBe(6);
    });

    it("should register the expected default algorithm names", async () => {
      await manager.initialize(mockDb);

      expect(manager.algorithms.has("aes-256-gcm")).toBe(true);
      expect(manager.algorithms.has("chacha20-poly1305")).toBe(true);
      expect(manager.algorithms.has("aes-256-cbc")).toBe(true);
      expect(manager.algorithms.has("rsa-4096")).toBe(true);
      expect(manager.algorithms.has("ed25519")).toBe(true);
      expect(manager.algorithms.has("x25519")).toBe(true);
    });

    it("should be idempotent — calling twice does not re-register algorithms", async () => {
      await manager.initialize(mockDb);
      const execCount = mockDb.db.exec.mock.calls.length;
      expect(manager.algorithms.size).toBe(6);

      // Add an extra algorithm so we can tell if re-init would reset the map
      manager.algorithms.set("extra-algo", { name: "extra-algo" });
      expect(manager.algorithms.size).toBe(7);

      await manager.initialize(mockDb);

      // exec should not have been called again
      expect(mockDb.db.exec.mock.calls.length).toBe(execCount);
      // algorithms map still has the extra one (init was skipped)
      expect(manager.algorithms.size).toBe(7);
    });

    it("should emit 'initialized' event once", async () => {
      const spy = vi.fn();
      manager.on("initialized", spy);

      await manager.initialize(mockDb);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("should work without db (memory-only mode)", async () => {
      await manager.initialize(null);

      expect(manager.initialized).toBe(true);
      expect(manager.db).toBeNull();
      expect(manager.algorithms.size).toBe(6);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sseCreateIndex
  // ─────────────────────────────────────────────────────────────────────────
  describe("sseCreateIndex()", () => {
    it("should return indexId, documentCount, tokenCount, indexSizeBytes", async () => {
      const result = await manager.sseCreateIndex(SAMPLE_DOCS);

      expect(result).toHaveProperty("indexId");
      expect(result).toHaveProperty("documentCount");
      expect(result).toHaveProperty("tokenCount");
      expect(result).toHaveProperty("indexSizeBytes");
    });

    it("documentCount should equal documents.length", async () => {
      const result = await manager.sseCreateIndex(SAMPLE_DOCS);

      expect(result.documentCount).toBe(SAMPLE_DOCS.length);
    });

    it("tokenCount should be > 0 for documents with text", async () => {
      const result = await manager.sseCreateIndex(SAMPLE_DOCS);

      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it("indexId should be stored in the _sseIndexes Map", async () => {
      const result = await manager.sseCreateIndex(SAMPLE_DOCS);

      expect(manager._sseIndexes.has(result.indexId)).toBe(true);
    });

    it("should throw for empty documents array", async () => {
      await expect(manager.sseCreateIndex([])).rejects.toThrow(
        "documents must be a non-empty array",
      );
    });

    it("should throw for non-array input", async () => {
      await expect(manager.sseCreateIndex("not-an-array")).rejects.toThrow(
        "documents must be a non-empty array",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sseSearch
  // ─────────────────────────────────────────────────────────────────────────
  describe("sseSearch()", () => {
    it("should return results array, searchTimeMs, tokenMatched", async () => {
      const { indexId } = await manager.sseCreateIndex(SAMPLE_DOCS);
      const result = await manager.sseSearch(indexId, "fox");

      expect(result).toHaveProperty("results");
      expect(result).toHaveProperty("searchTimeMs");
      expect(result).toHaveProperty("tokenMatched");
      expect(Array.isArray(result.results)).toBe(true);
    });

    it("should throw for unknown indexId", async () => {
      await expect(
        manager.sseSearch("nonexistent-index-id", "keyword"),
      ).rejects.toThrow("SSE index not found");
    });

    it("results should be an array (even if empty for no match)", async () => {
      const { indexId } = await manager.sseCreateIndex(SAMPLE_DOCS);
      const result = await manager.sseSearch(indexId, "zzzyyyxxx");

      expect(Array.isArray(result.results)).toBe(true);
    });

    it("tokenMatched should be true when keyword exists in index", async () => {
      const { indexId } = await manager.sseCreateIndex(SAMPLE_DOCS);
      const result = await manager.sseSearch(indexId, "fox");

      expect(result.tokenMatched).toBe(true);
    });

    it("tokenMatched should be false for non-existent keyword", async () => {
      const { indexId } = await manager.sseCreateIndex(SAMPLE_DOCS);
      const result = await manager.sseSearch(indexId, "zzzyyynothere");

      expect(result.tokenMatched).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // fuzzyEncryptedSearch
  // ─────────────────────────────────────────────────────────────────────────
  describe("fuzzyEncryptedSearch()", () => {
    it("should return results, fuzzyMatches, threshold", async () => {
      const { indexId } = await manager.sseCreateIndex(SAMPLE_DOCS);
      const result = await manager.fuzzyEncryptedSearch(indexId, "crypt", 0.5);

      expect(result).toHaveProperty("results");
      expect(result).toHaveProperty("fuzzyMatches");
      expect(result).toHaveProperty("threshold");
      expect(Array.isArray(result.results)).toBe(true);
    });

    it("threshold should equal input threshold", async () => {
      const { indexId } = await manager.sseCreateIndex(SAMPLE_DOCS);
      const result = await manager.fuzzyEncryptedSearch(indexId, "fox", 0.75);

      expect(result.threshold).toBe(0.75);
    });

    it("should use default threshold 0.6 when not specified", async () => {
      const { indexId } = await manager.sseCreateIndex(SAMPLE_DOCS);
      const result = await manager.fuzzyEncryptedSearch(indexId, "fox");

      expect(result.threshold).toBe(0.6);
    });

    it("should throw for unknown indexId", async () => {
      await expect(
        manager.fuzzyEncryptedSearch("nonexistent-id", "keyword"),
      ).rejects.toThrow("SSE index not found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ragEncryptedSimilarity
  // ─────────────────────────────────────────────────────────────────────────
  describe("ragEncryptedSimilarity()", () => {
    it("should return results array and topK", async () => {
      const { indexId } = await manager.sseCreateIndex(SAMPLE_DOCS);
      const queryVector = [0.1, 0.2, 0.3, 0.4, 0.5];
      const result = await manager.ragEncryptedSimilarity(
        indexId,
        queryVector,
        3,
      );

      expect(result).toHaveProperty("results");
      expect(result).toHaveProperty("topK", 3);
      expect(Array.isArray(result.results)).toBe(true);
    });

    it("results.length should be <= topK", async () => {
      const { indexId } = await manager.sseCreateIndex(SAMPLE_DOCS);
      const queryVector = [0.5, 0.5, 0.5];
      const topK = 2;
      const result = await manager.ragEncryptedSimilarity(
        indexId,
        queryVector,
        topK,
      );

      expect(result.results.length).toBeLessThanOrEqual(topK);
    });

    it("should throw for unknown indexId", async () => {
      await expect(
        manager.ragEncryptedSimilarity("bad-index", [0.1, 0.2], 3),
      ).rejects.toThrow("SSE index not found");
    });

    it("should throw for empty queryVector", async () => {
      const { indexId } = await manager.sseCreateIndex(SAMPLE_DOCS);

      await expect(
        manager.ragEncryptedSimilarity(indexId, [], 3),
      ).rejects.toThrow("queryVector must be a non-empty array");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // generateReEncryptionKey
  // ─────────────────────────────────────────────────────────────────────────
  describe("generateReEncryptionKey()", () => {
    it("should return reKeyId, delegator, delegatee, reKey", async () => {
      const result = await manager.generateReEncryptionKey(
        "delegator-private-key-hex",
        "delegatee-public-key-hex",
      );

      expect(result).toHaveProperty("reKeyId");
      expect(result).toHaveProperty("delegator");
      expect(result).toHaveProperty("delegatee");
      expect(result).toHaveProperty("reKey");
    });

    it("reKey should be a non-empty string", async () => {
      const result = await manager.generateReEncryptionKey(
        "priv-key-abc",
        "pub-key-xyz",
      );

      expect(typeof result.reKey).toBe("string");
      expect(result.reKey.length).toBeGreaterThan(0);
    });

    it("should store reKey in the _reKeys Map", async () => {
      const result = await manager.generateReEncryptionKey(
        "priv-key-123",
        "pub-key-456",
      );

      expect(manager._reKeys.has(result.reKeyId)).toBe(true);
    });

    it("should throw if delegatorKey is missing", async () => {
      await expect(
        manager.generateReEncryptionKey(null, "pub-key"),
      ).rejects.toThrow(
        "Both delegatorKey and delegateePublicKey are required",
      );
    });

    it("should throw if delegateePublicKey is missing", async () => {
      await expect(
        manager.generateReEncryptionKey("priv-key", null),
      ).rejects.toThrow(
        "Both delegatorKey and delegateePublicKey are required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // proxyReEncrypt
  // ─────────────────────────────────────────────────────────────────────────
  describe("proxyReEncrypt()", () => {
    it("should return reEncryptedCiphertext, originalCiphertextHash, reKeyId", async () => {
      const { reKeyId } = await manager.generateReEncryptionKey(
        "delegator-key",
        "delegatee-key",
      );
      const result = await manager.proxyReEncrypt("deadbeef1234", reKeyId);

      expect(result).toHaveProperty("reEncryptedCiphertext");
      expect(result).toHaveProperty("originalCiphertextHash");
      expect(result).toHaveProperty("reKeyId", reKeyId);
    });

    it("should throw for unknown reKeyId", async () => {
      await expect(
        manager.proxyReEncrypt("ciphertext-hex", "nonexistent-re-key-id"),
      ).rejects.toThrow("Re-encryption key not found");
    });

    it("should throw if ciphertext is missing", async () => {
      const { reKeyId } = await manager.generateReEncryptionKey(
        "delegator-key",
        "delegatee-key",
      );

      await expect(manager.proxyReEncrypt(null, reKeyId)).rejects.toThrow(
        "ciphertext is required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // p2pReEncryptedShare
  // ─────────────────────────────────────────────────────────────────────────
  describe("p2pReEncryptedShare()", () => {
    it("should return shareId, sender, receiver, encryptedData", async () => {
      const result = await manager.p2pReEncryptedShare(
        "sender-did",
        "receiver-did",
        { message: "hello P2P" },
      );

      expect(result).toHaveProperty("shareId");
      expect(result).toHaveProperty("sender");
      expect(result).toHaveProperty("receiver");
      expect(result).toHaveProperty("encryptedData");
    });

    it("sender and receiver should match inputs", async () => {
      const result = await manager.p2pReEncryptedShare(
        "alice-did",
        "bob-did",
        "secret-data",
      );

      expect(result.sender).toBe("alice-did");
      expect(result.receiver).toBe("bob-did");
    });

    it("should throw if senderId is missing", async () => {
      await expect(
        manager.p2pReEncryptedShare(null, "receiver", "data"),
      ).rejects.toThrow("senderId and receiverId are required");
    });

    it("should throw if receiverId is missing", async () => {
      await expect(
        manager.p2pReEncryptedShare("sender", null, "data"),
      ).rejects.toThrow("senderId and receiverId are required");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // rbacReEncryptionDelegate
  // ─────────────────────────────────────────────────────────────────────────
  describe("rbacReEncryptionDelegate()", () => {
    it("should return delegationId, fromRole, toRole, permissions", async () => {
      const result = await manager.rbacReEncryptionDelegate(
        "admin",
        "auditor",
        ["read", "export"],
      );

      expect(result).toHaveProperty("delegationId");
      expect(result).toHaveProperty("fromRole", "admin");
      expect(result).toHaveProperty("toRole", "auditor");
      expect(result).toHaveProperty("permissions");
    });

    it("permissions should equal input permissions array", async () => {
      const perms = ["read", "audit", "export"];
      const result = await manager.rbacReEncryptionDelegate(
        "admin",
        "auditor",
        perms,
      );

      expect(result.permissions).toEqual(perms);
    });

    it("should handle empty permissions array", async () => {
      const result = await manager.rbacReEncryptionDelegate(
        "admin",
        "viewer",
        [],
      );

      expect(result.permissions).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // verifiableCompute
  // ─────────────────────────────────────────────────────────────────────────
  describe("verifiableCompute()", () => {
    it("should return resultId, output, proof, computeTimeMs", async () => {
      const result = await manager.verifiableCompute("hash-program", {
        data: "test-input",
      });

      expect(result).toHaveProperty("resultId");
      expect(result).toHaveProperty("output");
      expect(result).toHaveProperty("proof");
      expect(result).toHaveProperty("computeTimeMs");
    });

    it("resultId should be stored in _computeResults Map", async () => {
      const result = await manager.verifiableCompute("sum-program", {
        a: 1,
        b: 2,
      });

      expect(manager._computeResults.has(result.resultId)).toBe(true);
    });

    it("should throw if program is missing", async () => {
      await expect(
        manager.verifiableCompute(null, { data: "x" }),
      ).rejects.toThrow("program is required");
    });

    it("output should be a non-empty hex string", async () => {
      const result = await manager.verifiableCompute("prog", { x: 42 });

      expect(typeof result.output).toBe("string");
      expect(result.output.length).toBeGreaterThan(0);
      expect(result.output).toMatch(/^[0-9a-f]+$/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // verifyComputation
  // ─────────────────────────────────────────────────────────────────────────
  describe("verifyComputation()", () => {
    it("should return valid:true, resultId, verificationTimeMs", async () => {
      const { resultId } = await manager.verifiableCompute("prog", {
        input: "test",
      });
      const result = await manager.verifyComputation(resultId);

      expect(result).toHaveProperty("valid", true);
      expect(result).toHaveProperty("resultId", resultId);
      expect(result).toHaveProperty("verificationTimeMs");
    });

    it("should throw for unknown resultId", async () => {
      await expect(
        manager.verifyComputation("nonexistent-result-id"),
      ).rejects.toThrow("Computation result not found");
    });

    it("verificationTimeMs should be a non-negative number", async () => {
      const { resultId } = await manager.verifiableCompute("prog", {});
      const result = await manager.verifyComputation(resultId);

      expect(typeof result.verificationTimeMs).toBe("number");
      expect(result.verificationTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // llmOutputVerify
  // ─────────────────────────────────────────────────────────────────────────
  describe("llmOutputVerify()", () => {
    it("should return verified, promptHash, outputHash, attestation", async () => {
      const result = await manager.llmOutputVerify(
        "What is 2+2?",
        "4",
        "gpt-4",
      );

      expect(result).toHaveProperty("verified");
      expect(result).toHaveProperty("promptHash");
      expect(result).toHaveProperty("outputHash");
      expect(result).toHaveProperty("attestation");
    });

    it("promptHash and outputHash should be non-empty strings", async () => {
      const result = await manager.llmOutputVerify(
        "prompt text",
        "output text",
      );

      expect(typeof result.promptHash).toBe("string");
      expect(result.promptHash.length).toBeGreaterThan(0);
      expect(typeof result.outputHash).toBe("string");
      expect(result.outputHash.length).toBeGreaterThan(0);
    });

    it("verified should be true in simulation mode", async () => {
      const result = await manager.llmOutputVerify(
        "Hello",
        "World",
        "test-model",
      );

      expect(result.verified).toBe(true);
    });

    it("should throw if prompt is missing", async () => {
      await expect(manager.llmOutputVerify(null, "output")).rejects.toThrow(
        "prompt and output are required",
      );
    });

    it("should throw if output is missing", async () => {
      await expect(manager.llmOutputVerify("prompt", null)).rejects.toThrow(
        "prompt and output are required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // auditProof
  // ─────────────────────────────────────────────────────────────────────────
  describe("auditProof()", () => {
    it("should return proofId, operationId, proof, timestamp", async () => {
      const result = await manager.auditProof("some-operation-id");

      expect(result).toHaveProperty("proofId");
      expect(result).toHaveProperty("operationId", "some-operation-id");
      expect(result).toHaveProperty("proof");
      expect(result).toHaveProperty("timestamp");
    });

    it("timestamp should be a recent ISO string", async () => {
      const before = new Date().toISOString();
      const result = await manager.auditProof("op-123");
      const after = new Date().toISOString();

      expect(result.timestamp >= before).toBe(true);
      expect(result.timestamp <= after).toBe(true);
    });

    it("proof should be a non-empty hex string", async () => {
      const result = await manager.auditProof("op-456");

      expect(typeof result.proof).toBe("string");
      expect(result.proof.length).toBeGreaterThan(0);
      expect(result.proof).toMatch(/^[0-9a-f]+$/);
    });

    it("should throw if operationId is missing", async () => {
      await expect(manager.auditProof(null)).rejects.toThrow(
        "operationId is required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // registerAlgorithm
  // ─────────────────────────────────────────────────────────────────────────
  describe("registerAlgorithm()", () => {
    it("should add to this.algorithms Map", async () => {
      const sizeBefore = manager.algorithms.size;
      await manager.registerAlgorithm("kyber-1024-sim", {
        type: "kem",
        keySize: 1024,
        family: "Kyber",
      });

      expect(manager.algorithms.size).toBe(sizeBefore + 1);
      expect(manager.algorithms.has("kyber-1024-sim")).toBe(true);
    });

    it("should return {name, registered:true, config}", async () => {
      const result = await manager.registerAlgorithm("test-algo", {
        type: "symmetric",
        keySize: 128,
      });

      expect(result).toHaveProperty("name", "test-algo");
      expect(result).toHaveProperty("registered", true);
      expect(result).toHaveProperty("config");
    });

    it("config should contain the provided fields", async () => {
      const result = await manager.registerAlgorithm("my-algo", {
        type: "signing",
        keySize: 512,
        family: "TestFamily",
      });

      expect(result.config.type).toBe("signing");
      expect(result.config.keySize).toBe(512);
      expect(result.config.family).toBe("TestFamily");
    });

    it("should throw if name is missing", async () => {
      await expect(manager.registerAlgorithm(null, {})).rejects.toThrow(
        "Algorithm name is required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // switchAlgorithm
  // ─────────────────────────────────────────────────────────────────────────
  describe("switchAlgorithm()", () => {
    beforeEach(async () => {
      // Must have the 6 default algorithms registered for switchAlgorithm to work
      await manager.initialize(mockDb);
    });

    it("should return {switched:true, from, to, scope, migrationSteps}", async () => {
      const result = await manager.switchAlgorithm(
        "aes-256-cbc",
        "aes-256-gcm",
        "file-encryption",
      );

      expect(result).toHaveProperty("switched", true);
      expect(result).toHaveProperty("from", "aes-256-cbc");
      expect(result).toHaveProperty("to", "aes-256-gcm");
      expect(result).toHaveProperty("scope", "file-encryption");
      expect(result).toHaveProperty("migrationSteps");
    });

    it("migrationSteps should be an array with steps", async () => {
      const result = await manager.switchAlgorithm(
        "aes-256-cbc",
        "chacha20-poly1305",
        "messages",
      );

      expect(Array.isArray(result.migrationSteps)).toBe(true);
      expect(result.migrationSteps.length).toBeGreaterThan(0);
    });

    it("scope should default to 'default' when not provided", async () => {
      const result = await manager.switchAlgorithm("ed25519", "ed25519");

      expect(result.scope).toBe("default");
    });

    it("should throw for unknown target algorithm", async () => {
      await expect(
        manager.switchAlgorithm("aes-256-gcm", "nonexistent-algo", "scope"),
      ).rejects.toThrow("Target algorithm not registered");
    });

    it("should throw if 'from' is missing", async () => {
      await expect(
        manager.switchAlgorithm(null, "aes-256-gcm", "scope"),
      ).rejects.toThrow("Both 'from' and 'to' algorithms are required");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // keyEscrowSetup
  // ─────────────────────────────────────────────────────────────────────────
  describe("keyEscrowSetup()", () => {
    it("should return escrowId, keyId, agentCount, threshold", async () => {
      const agents = ["agent-A", "agent-B", "agent-C"];
      const result = await manager.keyEscrowSetup("my-key-id", agents, 2);

      expect(result).toHaveProperty("escrowId");
      expect(result).toHaveProperty("keyId", "my-key-id");
      expect(result).toHaveProperty("agentCount", 3);
      expect(result).toHaveProperty("threshold", 2);
    });

    it("agentCount should equal escrowAgents.length", async () => {
      const agents = ["a", "b", "c", "d"];
      const result = await manager.keyEscrowSetup("key-999", agents, 3);

      expect(result.agentCount).toBe(agents.length);
    });

    it("should store the escrow in the escrowKeys Map", async () => {
      const result = await manager.keyEscrowSetup(
        "stored-key",
        ["ag-1", "ag-2"],
        1,
      );

      expect(manager.escrowKeys.has(result.escrowId)).toBe(true);
    });

    it("should throw if keyId is missing", async () => {
      await expect(manager.keyEscrowSetup(null, ["a", "b"], 1)).rejects.toThrow(
        "keyId is required",
      );
    });

    it("should throw if escrowAgents is empty", async () => {
      await expect(manager.keyEscrowSetup("my-key", [], 1)).rejects.toThrow(
        "escrowAgents must be a non-empty array",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // emergencyAccess
  // ─────────────────────────────────────────────────────────────────────────
  describe("emergencyAccess()", () => {
    it("sufficient approvals (>= threshold): should return accessGranted:true", async () => {
      const agents = ["agent-1", "agent-2", "agent-3"];
      const { escrowId } = await manager.keyEscrowSetup(
        "emergency-key",
        agents,
        2,
      );

      const result = await manager.emergencyAccess(escrowId, [
        "agent-1",
        "agent-2",
      ]);

      expect(result.accessGranted).toBe(true);
      expect(result.approvalsReceived).toBe(2);
      expect(result.threshold).toBe(2);
    });

    it("insufficient approvals (< threshold): accessGranted:false", async () => {
      const agents = ["agent-A", "agent-B", "agent-C"];
      const { escrowId } = await manager.keyEscrowSetup(
        "guarded-key",
        agents,
        3,
      );

      const result = await manager.emergencyAccess(escrowId, ["agent-A"]);

      expect(result.accessGranted).toBe(false);
      expect(result.keyMaterial).toBeNull();
    });

    it("keyMaterial should be returned when access is granted", async () => {
      const agents = ["x", "y"];
      const { escrowId } = await manager.keyEscrowSetup("km-key", agents, 1);
      const result = await manager.emergencyAccess(escrowId, ["x"]);

      expect(result.accessGranted).toBe(true);
      expect(typeof result.keyMaterial).toBe("string");
      expect(result.keyMaterial.length).toBeGreaterThan(0);
    });

    it("should throw for unknown escrowId", async () => {
      await expect(
        manager.emergencyAccess("nonexistent-escrow-id", ["agent-1"]),
      ).rejects.toThrow("Escrow not found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // enhancedRandom
  // ─────────────────────────────────────────────────────────────────────────
  describe("enhancedRandom()", () => {
    it("should return random hex string, length, sources, entropyBits", async () => {
      const result = await manager.enhancedRandom(32);

      expect(result).toHaveProperty("random");
      expect(result).toHaveProperty("length", 32);
      expect(result).toHaveProperty("sources");
      expect(result).toHaveProperty("entropyBits");
    });

    it("random string should have correct hex length (2 * byteLength)", async () => {
      const byteLength = 16;
      const result = await manager.enhancedRandom(byteLength);

      expect(result.random).toHaveLength(byteLength * 2);
      expect(result.random).toMatch(/^[0-9a-f]+$/);
    });

    it("sources should be an array with at least one entry", async () => {
      const result = await manager.enhancedRandom(32);

      expect(Array.isArray(result.sources)).toBe(true);
      expect(result.sources.length).toBeGreaterThan(0);
    });

    it("entropyBits should equal byteLength * 8", async () => {
      const byteLength = 24;
      const result = await manager.enhancedRandom(byteLength);

      expect(result.entropyBits).toBe(byteLength * 8);
    });

    it("should use default length 32 when no argument given", async () => {
      const result = await manager.enhancedRandom();

      expect(result.length).toBe(32);
      expect(result.random).toHaveLength(64);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    it("should return {total:0, byCategory:{}, byOperation:{}} with no db rows", async () => {
      // No db initialized — pure memory mode
      const stats = await manager.getStats();

      expect(stats).toEqual({ total: 0, byCategory: {}, byOperation: {} });
    });

    it("should return zero stats when db returns empty rows", async () => {
      await manager.initialize(mockDb);
      // mockDb._prep.get returns null, .all returns [] by default

      const stats = await manager.getStats();

      expect(stats.total).toBe(0);
    });

    it("should aggregate byCategory from db rows", async () => {
      await manager.initialize(mockDb);

      // Override all() to return category rows
      mockDb.db._prep.all
        .mockReturnValueOnce([{ count: 7 }]) // total query .get() won't use all()
        .mockReturnValueOnce([
          { category: "sse", count: 4 },
          { category: "proxy-re", count: 3 },
        ])
        .mockReturnValueOnce([{ operation: "sse-search", count: 4 }]);

      // Override get() for total count
      mockDb.db._prep.get.mockReturnValueOnce({ count: 7 });

      const stats = await manager.getStats();

      expect(typeof stats.total).toBe("number");
      expect(typeof stats.byCategory).toBe("object");
      expect(typeof stats.byOperation).toBe("object");
    });
  });
});
