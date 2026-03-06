/**
 * BiometricBinding Unit Tests
 * Target: src/main/ukey/biometric-binding.js
 * Coverage: Constants, constructor, initialize, _ensureTables, bindBiometric,
 *           verifyBiometric, unbindBiometric, listBindings, _hashTemplate, singleton
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("BiometricBinding", () => {
  let BiometricBinding, getBiometricBinding, BIOMETRIC_TYPES, BINDING_STATUS;
  let binding;
  let mockDb;
  let mockRunStmt;
  let mockGetStmt;
  let mockAllStmt;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockRunStmt = { run: vi.fn() };
    mockGetStmt = { get: vi.fn(() => null) };
    mockAllStmt = { all: vi.fn(() => []) };

    mockDb = {
      exec: vi.fn(),
      prepare: vi.fn((sql) => {
        if (sql.includes("INSERT")) {
          return mockRunStmt;
        }
        if (sql.includes("DELETE")) {
          return mockRunStmt;
        }
        if (sql.includes("UPDATE")) {
          return mockRunStmt;
        }
        if (
          sql.includes("SELECT") &&
          (sql.includes("id = ?") || sql.includes("key_id = ?"))
        ) {
          return mockGetStmt;
        }
        if (sql.includes("SELECT")) {
          return mockAllStmt;
        }
        return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
      }),
      saveToFile: vi.fn(),
    };

    const mod = await import("../../../src/main/ukey/biometric-binding.js");
    BiometricBinding = mod.BiometricBinding;
    getBiometricBinding = mod.getBiometricBinding;
    BIOMETRIC_TYPES = mod.BIOMETRIC_TYPES;
    BINDING_STATUS = mod.BINDING_STATUS;

    binding = new BiometricBinding(mockDb);
  });

  // ============================================================
  // Constants
  // ============================================================

  describe("constants", () => {
    it("BIOMETRIC_TYPES should have fingerprint, face, iris, voice", () => {
      expect(BIOMETRIC_TYPES.FINGERPRINT).toBe("fingerprint");
      expect(BIOMETRIC_TYPES.FACE).toBe("face");
      expect(BIOMETRIC_TYPES.IRIS).toBe("iris");
      expect(BIOMETRIC_TYPES.VOICE).toBe("voice");
    });

    it("BINDING_STATUS should have active, revoked, expired", () => {
      expect(BINDING_STATUS.ACTIVE).toBe("active");
      expect(BINDING_STATUS.REVOKED).toBe("revoked");
      expect(BINDING_STATUS.EXPIRED).toBe("expired");
    });
  });

  // ============================================================
  // Constructor
  // ============================================================

  describe("constructor", () => {
    it("should store database reference", () => {
      expect(binding.database).toBe(mockDb);
    });

    it("should set initialized to false", () => {
      expect(binding.initialized).toBe(false);
    });

    it("should create empty bindings map", () => {
      expect(binding._bindings).toBeInstanceOf(Map);
      expect(binding._bindings.size).toBe(0);
    });
  });

  // ============================================================
  // initialize()
  // ============================================================

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await binding.initialize();
      expect(binding.initialized).toBe(true);
    });

    it("should call _ensureTables via db.exec", async () => {
      await binding.initialize();
      expect(mockDb.exec).toHaveBeenCalled();
    });

    it("should be idempotent (skip if already initialized)", async () => {
      await binding.initialize();
      await binding.initialize();
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // _ensureTables()
  // ============================================================

  describe("_ensureTables()", () => {
    it("should call db.exec with CREATE TABLE biometric_bindings", () => {
      binding._ensureTables();
      const execCall = mockDb.exec.mock.calls[0][0];
      expect(execCall).toContain(
        "CREATE TABLE IF NOT EXISTS biometric_bindings",
      );
      expect(execCall).toContain("idx_biometric_key");
      expect(execCall).toContain("idx_biometric_status");
    });

    it("should not throw when database is null", () => {
      const b = new BiometricBinding(null);
      expect(() => b._ensureTables()).not.toThrow();
    });
  });

  // ============================================================
  // bindBiometric()
  // ============================================================

  describe("bindBiometric()", () => {
    beforeEach(async () => {
      await binding.initialize();
    });

    it("should throw if not initialized", async () => {
      const b = new BiometricBinding(mockDb);
      await expect(
        b.bindBiometric({
          keyId: "k1",
          biometricType: "fingerprint",
          templateData: "data",
        }),
      ).rejects.toThrow("BiometricBinding not initialized");
    });

    it("should throw if missing required params", async () => {
      await expect(binding.bindBiometric({ keyId: "k1" })).rejects.toThrow(
        "keyId, biometricType, and templateData are required",
      );
    });

    it("should throw if keyId is missing", async () => {
      await expect(
        binding.bindBiometric({
          biometricType: "fingerprint",
          templateData: "data",
        }),
      ).rejects.toThrow("keyId, biometricType, and templateData are required");
    });

    it("should throw for invalid biometric type", async () => {
      await expect(
        binding.bindBiometric({
          keyId: "k1",
          biometricType: "retina",
          templateData: "data",
        }),
      ).rejects.toThrow("Invalid biometric type: retina");
    });

    it("should return success with bindingId, keyId, biometricType", async () => {
      const result = await binding.bindBiometric({
        keyId: "k1",
        biometricType: "fingerprint",
        templateData: "template-data-buffer",
      });

      expect(result.success).toBe(true);
      expect(result.bindingId).toBeDefined();
      expect(result.keyId).toBe("k1");
      expect(result.biometricType).toBe("fingerprint");
    });

    it("should call DB prepare with INSERT", async () => {
      await binding.bindBiometric({
        keyId: "k1",
        biometricType: "face",
        templateData: "face-template",
      });

      const insertCall = mockDb.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT"),
      );
      expect(insertCall).toBeDefined();
      expect(mockRunStmt.run).toHaveBeenCalled();
    });

    it("should emit biometric-bound event", async () => {
      const spy = vi.fn();
      binding.on("biometric-bound", spy);

      await binding.bindBiometric({
        keyId: "k1",
        biometricType: "fingerprint",
        templateData: "data",
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          keyId: "k1",
          biometricType: "fingerprint",
          bindingId: expect.any(String),
        }),
      );
    });

    it("should store binding in internal map", async () => {
      await binding.bindBiometric({
        keyId: "k1",
        biometricType: "iris",
        templateData: "iris-data",
      });

      expect(binding._bindings.has("k1:iris")).toBe(true);
      const stored = binding._bindings.get("k1:iris");
      expect(stored.status).toBe(BINDING_STATUS.ACTIVE);
    });

    it("should set expiresAt when expiresInDays is provided", async () => {
      const result = await binding.bindBiometric({
        keyId: "k1",
        biometricType: "voice",
        templateData: "voice-data",
        expiresInDays: 30,
      });

      expect(result.expiresAt).toBeGreaterThan(0);
    });

    it("should set expiresAt to null when expiresInDays is not provided", async () => {
      const result = await binding.bindBiometric({
        keyId: "k1",
        biometricType: "fingerprint",
        templateData: "data",
      });

      expect(result.expiresAt).toBeNull();
    });
  });

  // ============================================================
  // verifyBiometric()
  // ============================================================

  describe("verifyBiometric()", () => {
    beforeEach(async () => {
      await binding.initialize();
    });

    it("should throw if not initialized", async () => {
      const b = new BiometricBinding(mockDb);
      await expect(
        b.verifyBiometric({
          keyId: "k1",
          biometricType: "fingerprint",
          templateData: "data",
        }),
      ).rejects.toThrow("BiometricBinding not initialized");
    });

    it("should return verified=false if no binding found", async () => {
      // mockGetStmt.get returns null by default
      const result = await binding.verifyBiometric({
        keyId: "k1",
        biometricType: "fingerprint",
        templateData: "data",
      });

      expect(result.success).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.error).toBe("No active binding found");
    });

    it("should throw if missing required params", async () => {
      await expect(binding.verifyBiometric({ keyId: "k1" })).rejects.toThrow(
        "keyId, biometricType, and templateData are required",
      );
    });
  });

  // ============================================================
  // unbindBiometric()
  // ============================================================

  describe("unbindBiometric()", () => {
    it("should throw if missing params", async () => {
      await expect(binding.unbindBiometric({ keyId: "k1" })).rejects.toThrow(
        "keyId and biometricType are required",
      );
    });

    it("should throw if keyId is missing", async () => {
      await expect(
        binding.unbindBiometric({ biometricType: "fingerprint" }),
      ).rejects.toThrow("keyId and biometricType are required");
    });

    it("should update status to REVOKED in DB", async () => {
      await binding.unbindBiometric({
        keyId: "k1",
        biometricType: "fingerprint",
      });

      const updateCall = mockDb.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE"),
      );
      expect(updateCall).toBeDefined();
      expect(mockRunStmt.run).toHaveBeenCalledWith(
        BINDING_STATUS.REVOKED,
        "k1",
        "fingerprint",
      );
    });

    it("should emit biometric-unbound event", async () => {
      const spy = vi.fn();
      binding.on("biometric-unbound", spy);

      await binding.unbindBiometric({
        keyId: "k1",
        biometricType: "face",
      });

      expect(spy).toHaveBeenCalledWith({ keyId: "k1", biometricType: "face" });
    });

    it("should remove from internal bindings map", async () => {
      // Pre-populate the map
      binding._bindings.set("k1:fingerprint", { id: "b1", status: "active" });

      await binding.unbindBiometric({
        keyId: "k1",
        biometricType: "fingerprint",
      });

      expect(binding._bindings.has("k1:fingerprint")).toBe(false);
    });

    it("should return success", async () => {
      const result = await binding.unbindBiometric({
        keyId: "k1",
        biometricType: "fingerprint",
      });

      expect(result.success).toBe(true);
      expect(result.keyId).toBe("k1");
      expect(result.biometricType).toBe("fingerprint");
    });
  });

  // ============================================================
  // listBindings()
  // ============================================================

  describe("listBindings()", () => {
    it("should return empty array when no database", async () => {
      const b = new BiometricBinding(null);
      const result = await b.listBindings();
      expect(result).toEqual([]);
    });

    it("should query without keyId filter when no keyId", async () => {
      await binding.listBindings();
      const call = mockDb.prepare.mock.calls[0];
      expect(call[0]).not.toContain("WHERE key_id");
    });

    it("should query with keyId filter when keyId provided", async () => {
      // Need separate stmts for the two SQL variants
      const allStmtWithKey = { all: vi.fn(() => []) };
      const allStmtNoKey = { all: vi.fn(() => []) };
      mockDb.prepare = vi.fn((sql) => {
        if (sql.includes("WHERE key_id")) {
          return allStmtWithKey;
        }
        return allStmtNoKey;
      });

      await binding.listBindings("k1");
      expect(allStmtWithKey.all).toHaveBeenCalledWith("k1");
    });

    it("should return rows from DB", async () => {
      const mockRows = [
        {
          id: "b1",
          key_id: "k1",
          biometric_type: "fingerprint",
          status: "active",
        },
      ];
      mockAllStmt.all.mockReturnValue(mockRows);

      const result = await binding.listBindings();
      expect(result).toEqual(mockRows);
    });
  });

  // ============================================================
  // _hashTemplate()
  // ============================================================

  describe("_hashTemplate()", () => {
    it("should produce consistent hash for same input and salt", () => {
      const hash1 = binding._hashTemplate("my-template", "salt123");
      const hash2 = binding._hashTemplate("my-template", "salt123");
      expect(hash1).toBe(hash2);
    });

    it("should produce different hash for different input", () => {
      const hash1 = binding._hashTemplate("template-A", "salt123");
      const hash2 = binding._hashTemplate("template-B", "salt123");
      expect(hash1).not.toBe(hash2);
    });

    it("should produce different hash for different salt", () => {
      const hash1 = binding._hashTemplate("my-template", "salt-1");
      const hash2 = binding._hashTemplate("my-template", "salt-2");
      expect(hash1).not.toBe(hash2);
    });

    it("should accept Buffer input", () => {
      const buf = Buffer.from("template-data", "utf-8");
      const hash = binding._hashTemplate(buf, "salt");
      expect(typeof hash).toBe("string");
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // Singleton
  // ============================================================

  describe("singleton", () => {
    it("getBiometricBinding returns same instance", () => {
      const a = getBiometricBinding();
      const b = getBiometricBinding();
      expect(a).toBe(b);
    });
  });
});
