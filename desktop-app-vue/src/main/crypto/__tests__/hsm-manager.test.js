/**
 * HSMManager Unit Tests
 *
 * Covers: initialize, registerBackend, selectBackend, generateKey, sign,
 *         verify, encrypt, decrypt, rotateKey, destroyKey, backupKey,
 *         configureCluster, getClusterStatus, batchEncrypt,
 *         getComplianceStatus, getStats
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

const { HSMManager } = require("../hsm-manager.js");

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

describe("HSMManager", () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    manager = new HSMManager();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should register 4 backends (luna, cloudhsm, azure-hsm, guomi)", async () => {
      await manager.initialize(mockDb);

      expect(manager.backends.has("luna")).toBe(true);
      expect(manager.backends.has("cloudhsm")).toBe(true);
      expect(manager.backends.has("azure-hsm")).toBe(true);
      expect(manager.backends.has("guomi")).toBe(true);
      expect(manager.backends.size).toBe(4);
    });

    it("should set activeBackend to 'luna'", async () => {
      await manager.initialize(mockDb);

      expect(manager.activeBackend).toBe("luna");
    });

    it("should set initialized=true", async () => {
      await manager.initialize(mockDb);

      expect(manager.initialized).toBe(true);
    });

    it("should be idempotent — calling twice only registers backends once", async () => {
      await manager.initialize(mockDb);
      const backendCount = manager.backends.size;

      await manager.initialize(mockDb);

      expect(manager.backends.size).toBe(backendCount);
      expect(manager.initialized).toBe(true);
    });

    it("should work in memory-only mode when db is null", async () => {
      await manager.initialize(null);

      expect(manager.initialized).toBe(true);
      expect(manager.activeBackend).toBe("luna");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // registerBackend
  // ─────────────────────────────────────────────────────────────────────────
  describe("registerBackend()", () => {
    it("should add backend to this.backends Map", () => {
      manager.registerBackend("my-custom-hsm", {
        vendor: "Acme",
        capabilities: ["sign", "verify"],
      });

      expect(manager.backends.has("my-custom-hsm")).toBe(true);
    });

    it("should return {name, registered:true, capabilities}", () => {
      const result = manager.registerBackend("test-hsm", {
        vendor: "Test",
        capabilities: ["encrypt", "decrypt"],
      });

      expect(result.name).toBe("test-hsm");
      expect(result.registered).toBe(true);
      expect(Array.isArray(result.capabilities)).toBe(true);
    });

    it("should provide default capabilities if not specified", () => {
      const result = manager.registerBackend("min-hsm", { vendor: "Min" });

      expect(result.capabilities).toContain("sign");
      expect(result.capabilities).toContain("verify");
    });

    it("should throw if name is missing", () => {
      expect(() => manager.registerBackend(null, { vendor: "X" })).toThrow(
        "name and config are required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // selectBackend
  // ─────────────────────────────────────────────────────────────────────────
  describe("selectBackend()", () => {
    it("should set activeBackend", async () => {
      await manager.initialize(mockDb);

      manager.selectBackend("cloudhsm");

      expect(manager.activeBackend).toBe("cloudhsm");
    });

    it("should return {selected:name, status:'ready'}", async () => {
      await manager.initialize(mockDb);

      const result = manager.selectBackend("azure-hsm");

      expect(result.selected).toBe("azure-hsm");
      expect(result.status).toBe("ready");
    });

    it("should throw for unregistered backend name", async () => {
      await manager.initialize(mockDb);

      expect(() => manager.selectBackend("nonexistent-backend")).toThrow(
        "Backend not found",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // generateKey
  // ─────────────────────────────────────────────────────────────────────────
  describe("generateKey()", () => {
    it("should return keyId, alias, algorithm, backend", async () => {
      await manager.initialize(mockDb);

      const result = await manager.generateKey("my-aes-key", "aes-256-gcm");

      expect(result).toHaveProperty("keyId");
      expect(result.alias).toBe("my-aes-key");
      expect(result.algorithm).toBe("aes-256-gcm");
      expect(result.backend).toBe("luna");
    });

    it("should store key in this.keyStore", async () => {
      await manager.initialize(null);

      await manager.generateKey("stored-key", "aes-256-gcm");

      expect(manager.keyStore.has("stored-key")).toBe(true);
    });

    it("'aes-256-gcm' algorithm should store a symmetric key", async () => {
      await manager.initialize(null);

      await manager.generateKey("sym-key", "aes-256-gcm");

      const entry = manager.keyStore.get("sym-key");
      expect(entry.keyType).toBe("symmetric");
      expect(entry.material).toHaveProperty("secret");
    });

    it("'rsa-2048' should store an asymmetric key", async () => {
      await manager.initialize(null);

      await manager.generateKey("rsa-key", "rsa-2048");

      const entry = manager.keyStore.get("rsa-key");
      expect(entry.keyType).toBe("asymmetric");
      expect(entry.material).toHaveProperty("publicKey");
      expect(entry.material).toHaveProperty("privateKey");
    });

    it("'hmac-sha256' should store an hmac key", async () => {
      await manager.initialize(null);

      await manager.generateKey("hmac-key", "hmac-sha256");

      const entry = manager.keyStore.get("hmac-key");
      expect(entry.keyType).toBe("hmac");
    });

    it("should throw if no active backend is set", async () => {
      // Bypass initialize to leave activeBackend null
      await expect(manager.generateKey("k", "aes-256-gcm")).rejects.toThrow(
        "No active backend selected",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // sign
  // ─────────────────────────────────────────────────────────────────────────
  describe("sign()", () => {
    it("should return signature, algorithm, backend", async () => {
      await manager.initialize(null);
      await manager.generateKey("sign-key", "aes-256-gcm");

      const result = await manager.sign("sign-key", "data to sign");

      expect(result).toHaveProperty("signature");
      expect(result).toHaveProperty("algorithm");
      expect(result).toHaveProperty("backend");
    });

    it("should throw for unknown key alias", async () => {
      await manager.initialize(null);

      await expect(manager.sign("ghost-key", "data")).rejects.toThrow(
        "Key not found",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // verify
  // ─────────────────────────────────────────────────────────────────────────
  describe("verify()", () => {
    it("should return valid:true for a matching symmetric signature", async () => {
      await manager.initialize(null);
      await manager.generateKey("verify-key", "aes-256-gcm");
      const data = "message to verify";
      const { signature } = await manager.sign("verify-key", data);

      const result = await manager.verify("verify-key", data, signature);

      expect(result.valid).toBe(true);
      expect(result).toHaveProperty("algorithm");
    });

    it("should return valid:true for a matching asymmetric RSA signature", async () => {
      await manager.initialize(null);
      await manager.generateKey("rsa-sign-key", "rsa-2048");
      const data = "rsa message";
      const { signature } = await manager.sign("rsa-sign-key", data);

      const result = await manager.verify("rsa-sign-key", data, signature);

      expect(result.valid).toBe(true);
    });

    it("should throw for unknown key alias", async () => {
      await manager.initialize(null);

      await expect(manager.verify("ghost-key", "data", "sig")).rejects.toThrow(
        "Key not found",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // encrypt
  // ─────────────────────────────────────────────────────────────────────────
  describe("encrypt()", () => {
    it("should return ciphertext, iv, algorithm", async () => {
      await manager.initialize(null);
      await manager.generateKey("enc-key", "aes-256-gcm");

      const result = await manager.encrypt("enc-key", "hello world");

      expect(result).toHaveProperty("ciphertext");
      expect(result).toHaveProperty("iv");
      expect(result).toHaveProperty("algorithm");
    });

    it("ciphertext should be a non-empty string", async () => {
      await manager.initialize(null);
      await manager.generateKey("enc-key2", "aes-256-gcm");

      const result = await manager.encrypt("enc-key2", "plaintext data");

      expect(typeof result.ciphertext).toBe("string");
      expect(result.ciphertext.length).toBeGreaterThan(0);
    });

    it("should throw for unknown key alias", async () => {
      await manager.initialize(null);

      await expect(manager.encrypt("no-such-key", "data")).rejects.toThrow(
        "Key not found",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // decrypt
  // ─────────────────────────────────────────────────────────────────────────
  describe("decrypt()", () => {
    it("should return plaintext matching original and algorithm", async () => {
      await manager.initialize(null);
      await manager.generateKey("dec-key", "aes-256-gcm");
      const original = "secret payload";
      const { ciphertext, iv } = await manager.encrypt("dec-key", original);

      const result = await manager.decrypt("dec-key", ciphertext, iv);

      expect(result.plaintext).toBe(original);
      expect(result).toHaveProperty("algorithm");
    });

    it("should throw for unknown key alias", async () => {
      await manager.initialize(null);

      await expect(
        manager.decrypt("ghost-key", "ciphertext", "iv"),
      ).rejects.toThrow("Key not found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // rotateKey
  // ─────────────────────────────────────────────────────────────────────────
  describe("rotateKey()", () => {
    it("should return keyId, alias, version, previousVersion", async () => {
      await manager.initialize(null);
      await manager.generateKey("rot-key", "aes-256-gcm");

      const result = await manager.rotateKey("rot-key");

      expect(result).toHaveProperty("keyId");
      expect(result.alias).toBe("rot-key");
      expect(result).toHaveProperty("version");
      expect(result).toHaveProperty("previousVersion");
    });

    it("version should be previousVersion + 1", async () => {
      await manager.initialize(null);
      await manager.generateKey("rot-key2", "aes-256-gcm");

      const result = await manager.rotateKey("rot-key2");

      expect(result.version).toBe(result.previousVersion + 1);
    });

    it("should update key in keyStore with new version", async () => {
      await manager.initialize(null);
      await manager.generateKey("rot-key3", "aes-256-gcm");

      await manager.rotateKey("rot-key3");

      const entry = manager.keyStore.get("rot-key3");
      expect(entry.version).toBe(2);
    });

    it("should throw for unknown key alias", async () => {
      await manager.initialize(null);

      await expect(manager.rotateKey("nonexistent-key")).rejects.toThrow(
        "Key not found",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // destroyKey
  // ─────────────────────────────────────────────────────────────────────────
  describe("destroyKey()", () => {
    it("should return {alias, destroyed:true}", async () => {
      await manager.initialize(null);
      await manager.generateKey("destroy-key", "aes-256-gcm");

      const result = await manager.destroyKey("destroy-key");

      expect(result.alias).toBe("destroy-key");
      expect(result.destroyed).toBe(true);
    });

    it("should remove key from keyStore", async () => {
      await manager.initialize(null);
      await manager.generateKey("gone-key", "aes-256-gcm");

      await manager.destroyKey("gone-key");

      expect(manager.keyStore.has("gone-key")).toBe(false);
    });

    it("should throw for unknown key alias", async () => {
      await manager.initialize(null);

      await expect(manager.destroyKey("phantom-key")).rejects.toThrow(
        "Key not found",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // backupKey
  // ─────────────────────────────────────────────────────────────────────────
  describe("backupKey()", () => {
    it("should return backupId, alias, backupData, encryptedSize", async () => {
      await manager.initialize(null);
      await manager.generateKey("backup-key", "aes-256-gcm");

      const result = await manager.backupKey("backup-key");

      expect(result).toHaveProperty("backupId");
      expect(result.alias).toBe("backup-key");
      expect(result).toHaveProperty("backupData");
      expect(result).toHaveProperty("encryptedSize");
    });

    it("encryptedSize should be > 0", async () => {
      await manager.initialize(null);
      await manager.generateKey("backup-key2", "aes-256-gcm");

      const result = await manager.backupKey("backup-key2");

      expect(result.encryptedSize).toBeGreaterThan(0);
    });

    it("should throw for unknown key alias", async () => {
      await manager.initialize(null);

      await expect(manager.backupKey("no-such-key")).rejects.toThrow(
        "Key not found",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // configureCluster
  // ─────────────────────────────────────────────────────────────────────────
  describe("configureCluster()", () => {
    it("should return clusterId, nodeCount, status:'configured', replicationFactor", () => {
      const nodes = [
        { id: "node-1", host: "10.0.0.1", port: 9223 },
        { id: "node-2", host: "10.0.0.2", port: 9223 },
        { id: "node-3", host: "10.0.0.3", port: 9223 },
      ];

      const result = manager.configureCluster(nodes);

      expect(result).toHaveProperty("clusterId");
      expect(result.nodeCount).toBe(nodes.length);
      expect(result.status).toBe("configured");
      expect(result).toHaveProperty("replicationFactor");
    });

    it("nodeCount should equal nodes.length", () => {
      const nodes = [
        { id: "n1", host: "h1" },
        { id: "n2", host: "h2" },
      ];

      const result = manager.configureCluster(nodes);

      expect(result.nodeCount).toBe(nodes.length);
    });

    it("replicationFactor should not exceed 3", () => {
      const manyNodes = Array.from({ length: 10 }, (_, i) => ({
        id: `node-${i}`,
        host: `10.0.0.${i}`,
      }));

      const result = manager.configureCluster(manyNodes);

      expect(result.replicationFactor).toBeLessThanOrEqual(3);
    });

    it("should throw if nodes array is empty", () => {
      expect(() => manager.configureCluster([])).toThrow(
        "nodes must be a non-empty array",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getClusterStatus
  // ─────────────────────────────────────────────────────────────────────────
  describe("getClusterStatus()", () => {
    it("should return empty/false values if cluster not configured", () => {
      const result = manager.getClusterStatus();

      expect(result.nodes).toEqual([]);
      expect(result.healthy).toBe(false);
      expect(result.quorum).toBe(false);
    });

    it("after configureCluster, should return nodes, healthy, quorum", () => {
      manager.configureCluster([
        { id: "n1", host: "h1" },
        { id: "n2", host: "h2" },
        { id: "n3", host: "h3" },
      ]);

      const result = manager.getClusterStatus();

      expect(Array.isArray(result.nodes)).toBe(true);
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result).toHaveProperty("healthy");
      expect(result).toHaveProperty("quorum");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // batchEncrypt
  // ─────────────────────────────────────────────────────────────────────────
  describe("batchEncrypt()", () => {
    it("should return results array, totalItems, successCount", async () => {
      await manager.initialize(null);
      await manager.generateKey("batch-key", "aes-256-gcm");

      const items = [
        { id: "item-1", data: "hello" },
        { id: "item-2", data: "world" },
      ];

      const result = await manager.batchEncrypt("batch-key", items);

      expect(Array.isArray(result.results)).toBe(true);
      expect(result).toHaveProperty("totalItems");
      expect(result).toHaveProperty("successCount");
    });

    it("results.length should equal items.length", async () => {
      await manager.initialize(null);
      await manager.generateKey("batch-key2", "aes-256-gcm");

      const items = [
        { id: "i1", data: "a" },
        { id: "i2", data: "b" },
        { id: "i3", data: "c" },
      ];

      const result = await manager.batchEncrypt("batch-key2", items);

      expect(result.results).toHaveLength(items.length);
      expect(result.totalItems).toBe(items.length);
    });

    it("each result should have id and ciphertext", async () => {
      await manager.initialize(null);
      await manager.generateKey("batch-key3", "aes-256-gcm");

      const items = [{ id: "doc-a", data: "content-a" }];

      const result = await manager.batchEncrypt("batch-key3", items);

      expect(result.results[0]).toHaveProperty("id");
      expect(result.results[0]).toHaveProperty("ciphertext");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getComplianceStatus
  // ─────────────────────────────────────────────────────────────────────────
  describe("getComplianceStatus()", () => {
    it("should return standards array and overallCompliant", () => {
      const result = manager.getComplianceStatus();

      expect(Array.isArray(result.standards)).toBe(true);
      expect(result).toHaveProperty("overallCompliant");
    });

    it("standards should include FIPS 140-3, CC EAL4+, GM/T 0028, PCI HSM", () => {
      const result = manager.getComplianceStatus();
      const names = result.standards.map((s) => s.name);

      expect(names).toContain("FIPS 140-3");
      expect(names).toContain("CC EAL4+");
      expect(names).toContain("GM/T 0028");
      expect(names).toContain("PCI HSM");
    });

    it("overallCompliant should be true when all standards are compliant", () => {
      const result = manager.getComplianceStatus();

      const allCompliant = result.standards.every(
        (s) => s.status === "compliant",
      );
      expect(result.overallCompliant).toBe(allCompliant);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    it("should return key counts from DB (zeroed with mock db)", async () => {
      await manager.initialize(mockDb);

      const stats = await manager.getStats();

      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("active");
      expect(stats).toHaveProperty("rotated");
      expect(stats).toHaveProperty("destroyed");
      expect(stats).toHaveProperty("backedUp");
      expect(stats).toHaveProperty("restored");
      expect(stats).toHaveProperty("byBackend");
      expect(stats).toHaveProperty("byAlgorithm");
      expect(stats.total).toBe(0);
    });

    it("should return zeroed stats when no db is set", async () => {
      await manager.initialize(null);

      const stats = await manager.getStats();

      expect(stats.total).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.byBackend).toEqual({});
    });
  });
});
