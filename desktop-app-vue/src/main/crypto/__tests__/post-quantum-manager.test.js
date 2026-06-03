/**
 * PostQuantumManager Unit Tests
 *
 * Covers: initialize, generateKyberKeyPair, encapsulate, decapsulate,
 *         generateDilithiumKeyPair, dilithiumSign, dilithiumVerify,
 *         generateSphincsPlusKeyPair, hybridKeyExchange, auditScan,
 *         hybridFallback, migrationWizard, getStats
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
  v4: vi.fn(() => "test-uuid-pqc-1234"),
}));

const { PostQuantumManager } = require("../post-quantum-manager.js");

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

describe("PostQuantumManager", () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new PostQuantumManager();
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
  // generateKyberKeyPair
  // ─────────────────────────────────────────────────────────────────────────
  describe("generateKyberKeyPair()", () => {
    it("should return id, publicKey, algorithm, securityLevel for level 768", async () => {
      const result = await manager.generateKyberKeyPair(768);

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("publicKey");
      expect(result).toHaveProperty("algorithm", "kyber-768");
      expect(result).toHaveProperty("securityLevel", 768);
    });

    it("should support level 512", async () => {
      const result = await manager.generateKyberKeyPair(512);

      expect(result.algorithm).toBe("kyber-512");
      expect(result.securityLevel).toBe(512);
    });

    it("should support level 1024", async () => {
      const result = await manager.generateKyberKeyPair(1024);

      expect(result.algorithm).toBe("kyber-1024");
      expect(result.securityLevel).toBe(1024);
    });

    it("should throw for invalid level (e.g. 999)", async () => {
      await expect(manager.generateKyberKeyPair(999)).rejects.toThrow(
        "Invalid Kyber security level: 999",
      );
    });

    it("publicKey should be a hex string", async () => {
      const result = await manager.generateKyberKeyPair(768);

      expect(typeof result.publicKey).toBe("string");
      expect(result.publicKey).toMatch(/^[0-9a-f]+$/);
    });

    it("should emit keypair:generated event", async () => {
      const spy = vi.fn();
      manager.on("keypair:generated", spy);

      await manager.generateKyberKeyPair(768);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ algorithm: "kyber-768" }),
      );
    });

    it("should call db.prepare().run() when db is available", async () => {
      await manager.initialize(mockDb);
      vi.clearAllMocks();

      await manager.generateKyberKeyPair(768);

      expect(mockDb.db.prepare).toHaveBeenCalled();
      expect(mockDb.db._prep.run).toHaveBeenCalled();
    });

    it("should use default level 768 when no argument given", async () => {
      const result = await manager.generateKyberKeyPair();

      expect(result.algorithm).toBe("kyber-768");
      expect(result.securityLevel).toBe(768);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // encapsulate
  // ─────────────────────────────────────────────────────────────────────────
  describe("encapsulate()", () => {
    it("should return ciphertext and sharedSecret hex strings", async () => {
      const { publicKey } = await manager.generateKyberKeyPair(768);
      const result = await manager.encapsulate(publicKey);

      expect(result).toHaveProperty("ciphertext");
      expect(result).toHaveProperty("sharedSecret");
      expect(typeof result.ciphertext).toBe("string");
      expect(typeof result.sharedSecret).toBe("string");
    });

    it("should throw if publicKeyHex is missing", async () => {
      await expect(manager.encapsulate()).rejects.toThrow(
        "publicKeyHex is required",
      );
    });

    it("sharedSecret should be 64 chars (32 bytes hex)", async () => {
      const { publicKey } = await manager.generateKyberKeyPair(768);
      const { sharedSecret } = await manager.encapsulate(publicKey);

      expect(sharedSecret).toHaveLength(64);
      expect(sharedSecret).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should throw if publicKeyHex is not a string", async () => {
      await expect(manager.encapsulate(12345)).rejects.toThrow(
        "publicKeyHex is required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // decapsulate
  // ─────────────────────────────────────────────────────────────────────────
  describe("decapsulate()", () => {
    it("should return sharedSecret hex string", async () => {
      const { publicKey, id } = await manager.generateKyberKeyPair(768);
      const { ciphertext } = await manager.encapsulate(publicKey);
      // Use a fake private key of correct hex length (2400 bytes = 4800 hex chars)
      const fakePrivateKey = "ab".repeat(2400);
      const result = await manager.decapsulate(ciphertext, fakePrivateKey);

      expect(result).toHaveProperty("sharedSecret");
      expect(typeof result.sharedSecret).toBe("string");
      expect(result.sharedSecret).toHaveLength(64);
    });

    it("should throw if ciphertextHex is missing", async () => {
      await expect(manager.decapsulate(null, "deadbeef")).rejects.toThrow(
        "ciphertextHex and privateKeyHex are required",
      );
    });

    it("should throw if privateKeyHex is missing", async () => {
      await expect(manager.decapsulate("deadbeef", null)).rejects.toThrow(
        "ciphertextHex and privateKeyHex are required",
      );
    });

    it("should throw if both arguments are missing", async () => {
      await expect(manager.decapsulate()).rejects.toThrow(
        "ciphertextHex and privateKeyHex are required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // generateDilithiumKeyPair
  // ─────────────────────────────────────────────────────────────────────────
  describe("generateDilithiumKeyPair()", () => {
    it("should support level 2", async () => {
      const result = await manager.generateDilithiumKeyPair(2);

      expect(result.algorithm).toBe("dilithium-2");
      expect(result.securityLevel).toBe(2);
    });

    it("should support level 3", async () => {
      const result = await manager.generateDilithiumKeyPair(3);

      expect(result.algorithm).toBe("dilithium-3");
      expect(result.securityLevel).toBe(3);
    });

    it("should support level 5", async () => {
      const result = await manager.generateDilithiumKeyPair(5);

      expect(result.algorithm).toBe("dilithium-5");
      expect(result.securityLevel).toBe(5);
    });

    it("should throw for invalid level (e.g. 4)", async () => {
      await expect(manager.generateDilithiumKeyPair(4)).rejects.toThrow(
        "Invalid Dilithium security level: 4",
      );
    });

    it("algorithm should be dilithium-3 for default", async () => {
      const result = await manager.generateDilithiumKeyPair();

      expect(result.algorithm).toBe("dilithium-3");
    });

    it("should return id and publicKey", async () => {
      const result = await manager.generateDilithiumKeyPair(3);

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("publicKey");
      expect(typeof result.publicKey).toBe("string");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // dilithiumSign
  // ─────────────────────────────────────────────────────────────────────────
  describe("dilithiumSign()", () => {
    it("should return signature string and algorithm", async () => {
      const fakePrivKey = "ab".repeat(2000);
      const result = await manager.dilithiumSign("hello world", fakePrivKey);

      expect(result).toHaveProperty("signature");
      expect(result).toHaveProperty("algorithm", "dilithium");
      expect(typeof result.signature).toBe("string");
    });

    it("should throw if message is missing", async () => {
      await expect(manager.dilithiumSign(null, "deadbeef")).rejects.toThrow(
        "message and privateKeyHex are required",
      );
    });

    it("should throw if privateKeyHex is missing", async () => {
      await expect(manager.dilithiumSign("hello", null)).rejects.toThrow(
        "message and privateKeyHex are required",
      );
    });

    it("should accept Buffer as message", async () => {
      const fakePrivKey = "ab".repeat(2000);
      const msgBuf = Buffer.from("hello world", "utf8");
      const result = await manager.dilithiumSign(msgBuf, fakePrivKey);

      expect(result).toHaveProperty("signature");
      expect(result.algorithm).toBe("dilithium");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // dilithiumVerify
  // ─────────────────────────────────────────────────────────────────────────
  describe("dilithiumVerify()", () => {
    it("should return valid:true", async () => {
      const fakePrivKey = "ab".repeat(2000);
      const fakePubKey = "cd".repeat(976);
      const { signature } = await manager.dilithiumSign("hello", fakePrivKey);
      const result = await manager.dilithiumVerify(
        "hello",
        signature,
        fakePubKey,
      );

      expect(result.valid).toBe(true);
      expect(result.algorithm).toBe("dilithium");
    });

    it("should throw if message is missing", async () => {
      await expect(
        manager.dilithiumVerify(null, "sig", "pubkey"),
      ).rejects.toThrow("message, signature, and publicKeyHex are required");
    });

    it("should throw if signature is missing", async () => {
      await expect(
        manager.dilithiumVerify("hello", null, "pubkey"),
      ).rejects.toThrow("message, signature, and publicKeyHex are required");
    });

    it("should throw if publicKeyHex is missing", async () => {
      await expect(
        manager.dilithiumVerify("hello", "sig", null),
      ).rejects.toThrow("message, signature, and publicKeyHex are required");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // generateSphincsPlusKeyPair
  // ─────────────────────────────────────────────────────────────────────────
  describe("generateSphincsPlusKeyPair()", () => {
    it("default variant should be shake-256f", async () => {
      const result = await manager.generateSphincsPlusKeyPair();

      expect(result.variant).toBe("shake-256f");
      expect(result.algorithm).toBe("sphincs-plus-shake-256f");
    });

    it("should support shake-128f variant", async () => {
      const result = await manager.generateSphincsPlusKeyPair("shake-128f");

      expect(result.variant).toBe("shake-128f");
      expect(result.algorithm).toBe("sphincs-plus-shake-128f");
    });

    it("should support sha2-256s variant", async () => {
      const result = await manager.generateSphincsPlusKeyPair("sha2-256s");

      expect(result.variant).toBe("sha2-256s");
      expect(result.algorithm).toBe("sphincs-plus-sha2-256s");
    });

    it("should throw for invalid variant", async () => {
      await expect(
        manager.generateSphincsPlusKeyPair("invalid-variant"),
      ).rejects.toThrow("Invalid SPHINCS+ variant: invalid-variant");
    });

    it("should return id and publicKey", async () => {
      const result = await manager.generateSphincsPlusKeyPair();

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("publicKey");
      expect(typeof result.publicKey).toBe("string");
    });

    it("should emit keypair:generated event", async () => {
      const spy = vi.fn();
      manager.on("keypair:generated", spy);

      await manager.generateSphincsPlusKeyPair("shake-256f");

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // hybridKeyExchange
  // ─────────────────────────────────────────────────────────────────────────
  describe("hybridKeyExchange()", () => {
    const localPriv = "aa".repeat(32);
    const remotePub = "bb".repeat(32);

    it("should return sharedSecret, classical, pqc", async () => {
      const result = await manager.hybridKeyExchange(localPriv, remotePub);

      expect(result).toHaveProperty("sharedSecret");
      expect(result).toHaveProperty("classical");
      expect(result).toHaveProperty("pqc");
      expect(typeof result.sharedSecret).toBe("string");
    });

    it("sharedSecret should be deterministic for same inputs", async () => {
      const r1 = await manager.hybridKeyExchange(localPriv, remotePub);
      const r2 = await manager.hybridKeyExchange(localPriv, remotePub);

      expect(r1.sharedSecret).toBe(r2.sharedSecret);
      expect(r1.classical).toBe(r2.classical);
      expect(r1.pqc).toBe(r2.pqc);
    });

    it("should throw if localPrivateHex is missing", async () => {
      await expect(manager.hybridKeyExchange(null, remotePub)).rejects.toThrow(
        "localPrivateHex and remotePublicHex are required",
      );
    });

    it("should throw if remotePublicHex is missing", async () => {
      await expect(manager.hybridKeyExchange(localPriv, null)).rejects.toThrow(
        "localPrivateHex and remotePublicHex are required",
      );
    });

    it("sharedSecret should be 64 hex chars (32 bytes)", async () => {
      const { sharedSecret } = await manager.hybridKeyExchange(
        localPriv,
        remotePub,
      );

      expect(sharedSecret).toHaveLength(64);
      expect(sharedSecret).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should emit hybrid:exchanged event", async () => {
      const spy = vi.fn();
      manager.on("hybrid:exchanged", spy);

      await manager.hybridKeyExchange(localPriv, remotePub);

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // auditScan
  // ─────────────────────────────────────────────────────────────────────────
  describe("auditScan()", () => {
    it("should return counts and recommendations when no db", async () => {
      const result = await manager.auditScan();

      expect(result).toHaveProperty("totalKeys", 0);
      expect(result).toHaveProperty("classicalKeys", 0);
      expect(result).toHaveProperty("pqcKeys", 0);
      expect(result).toHaveProperty("hybridKeys", 0);
      expect(Array.isArray(result.recommendations)).toBe(true);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it("should include 'No database connected' recommendation when no db", async () => {
      const result = await manager.auditScan();

      expect(result.recommendations[0]).toContain("No database connected");
    });

    it("with db returning pqc rows, should count correctly", async () => {
      await manager.initialize(mockDb);

      mockDb.db._prep.all.mockReturnValue([
        { key_type: "pqc", cnt: 5 },
        { key_type: "hybrid", cnt: 2 },
        { key_type: "classical", cnt: 1 },
      ]);

      const result = await manager.auditScan();

      expect(result.pqcKeys).toBe(5);
      expect(result.hybridKeys).toBe(2);
      expect(result.classicalKeys).toBe(1);
      expect(result.totalKeys).toBe(8);
    });

    it("should recommend migrating when classical keys exist", async () => {
      await manager.initialize(mockDb);

      mockDb.db._prep.all.mockReturnValue([{ key_type: "classical", cnt: 3 }]);

      const result = await manager.auditScan();

      expect(result.recommendations.some((r) => r.includes("classical"))).toBe(
        true,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // hybridFallback
  // ─────────────────────────────────────────────────────────────────────────
  describe("hybridFallback()", () => {
    it("default mode 'hybrid': pqc.enabled=true, classical.enabled=true", async () => {
      const result = await manager.hybridFallback();

      expect(result.mode).toBe("hybrid");
      expect(result.pqc.enabled).toBe(true);
      expect(result.classical.enabled).toBe(true);
    });

    it("mode 'pqc-only': classical.enabled=false", async () => {
      const result = await manager.hybridFallback({ mode: "pqc-only" });

      expect(result.mode).toBe("pqc-only");
      expect(result.pqc.enabled).toBe(true);
      expect(result.classical.enabled).toBe(false);
    });

    it("mode 'classical-fallback': pqc.enabled=false", async () => {
      const result = await manager.hybridFallback({
        mode: "classical-fallback",
      });

      expect(result.mode).toBe("classical-fallback");
      expect(result.classical.enabled).toBe(true);
      expect(result.pqc.enabled).toBe(false);
    });

    it("should throw for invalid mode", async () => {
      await expect(
        manager.hybridFallback({ mode: "nonsense-mode" }),
      ).rejects.toThrow("Invalid mode: nonsense-mode");
    });

    it("should allow overriding classicalAlgorithm and pqcAlgorithm", async () => {
      const result = await manager.hybridFallback({
        mode: "hybrid",
        classicalAlgorithm: "ecdh-p256",
        pqcAlgorithm: "kyber-1024",
      });

      expect(result.classical.algorithm).toBe("ecdh-p256");
      expect(result.pqc.algorithm).toBe("kyber-1024");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // migrationWizard
  // ─────────────────────────────────────────────────────────────────────────
  describe("migrationWizard()", () => {
    it("should return steps array and estimatedTime", async () => {
      const result = await manager.migrationWizard();

      expect(Array.isArray(result.steps)).toBe(true);
      expect(result.steps.length).toBeGreaterThan(0);
      expect(typeof result.estimatedTime).toBe("string");
    });

    it("should include affectedKeys count", async () => {
      const result = await manager.migrationWizard();

      expect(result).toHaveProperty("affectedKeys");
      expect(typeof result.affectedKeys).toBe("number");
    });

    it("first step should be audit", async () => {
      const result = await manager.migrationWizard();

      expect(result.steps[0].action).toBe("audit");
      expect(result.steps[0].status).toBe("completed");
    });

    it("last step should be verify", async () => {
      const result = await manager.migrationWizard();
      const lastStep = result.steps[result.steps.length - 1];

      expect(lastStep.action).toBe("verify");
    });

    it("should respect custom targetAlgorithm option", async () => {
      const result = await manager.migrationWizard({
        targetAlgorithm: "kyber-1024",
      });

      expect(
        result.steps.some((s) => s.description?.includes("kyber-1024")),
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    it("should return {total:0, byAlgorithm:{}, byType:{}} with no db rows", async () => {
      const stats = await manager.getStats();

      expect(stats).toEqual({
        total: 0,
        byAlgorithm: {},
        byType: {},
      });
    });

    it("should return zero stats when no db initialized", async () => {
      // manager has no db (no initialize called)
      const stats = await manager.getStats();

      expect(stats.total).toBe(0);
    });

    it("should aggregate byAlgorithm from db rows", async () => {
      await manager.initialize(mockDb);

      // First prepare().all() call returns algorithm rows
      mockDb.db._prep.all
        .mockReturnValueOnce([
          { algorithm: "kyber-768", cnt: 3 },
          { algorithm: "dilithium-3", cnt: 2 },
        ])
        .mockReturnValueOnce([{ key_type: "pqc", cnt: 5 }]);

      const stats = await manager.getStats();

      expect(stats.byAlgorithm["kyber-768"]).toBe(3);
      expect(stats.byAlgorithm["dilithium-3"]).toBe(2);
      expect(stats.total).toBe(5);
    });

    it("should aggregate byType from db rows", async () => {
      await manager.initialize(mockDb);

      mockDb.db._prep.all
        .mockReturnValueOnce([{ algorithm: "kyber-768", cnt: 4 }])
        .mockReturnValueOnce([
          { key_type: "pqc", cnt: 3 },
          { key_type: "hybrid", cnt: 1 },
        ]);

      const stats = await manager.getStats();

      expect(stats.byType["pqc"]).toBe(3);
      expect(stats.byType["hybrid"]).toBe(1);
    });
  });
});
