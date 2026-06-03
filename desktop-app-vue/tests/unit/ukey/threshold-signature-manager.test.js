/**
 * ThresholdSignatureManager Unit Tests
 * Target: src/main/ukey/threshold-signature-manager.js
 * Coverage: Constants, constructor, initialize, setupKeys, listKeys,
 *           getKeyShares, deleteKey, sign, _splitSecret, encrypt/decrypt roundtrip,
 *           getState, singleton
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("ThresholdSignatureManager", () => {
  let ThresholdSignatureManager,
    getThresholdSignatureManager,
    SHARE_SOURCES,
    THRESHOLD_STATE;
  let manager;
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

    const mod =
      await import("../../../src/main/ukey/threshold-signature-manager.js");
    ThresholdSignatureManager = mod.ThresholdSignatureManager;
    getThresholdSignatureManager = mod.getThresholdSignatureManager;
    SHARE_SOURCES = mod.SHARE_SOURCES;
    THRESHOLD_STATE = mod.THRESHOLD_STATE;

    manager = new ThresholdSignatureManager(mockDb);
  });

  // ============================================================
  // Constants
  // ============================================================

  describe("constants", () => {
    it("SHARE_SOURCES should have ukey, simkey, tee", () => {
      expect(SHARE_SOURCES.UKEY).toBe("ukey");
      expect(SHARE_SOURCES.SIMKEY).toBe("simkey");
      expect(SHARE_SOURCES.TEE).toBe("tee");
    });

    it("THRESHOLD_STATE should have all states", () => {
      expect(THRESHOLD_STATE.UNINITIALIZED).toBe("uninitialized");
      expect(THRESHOLD_STATE.READY).toBe("ready");
      expect(THRESHOLD_STATE.SIGNING).toBe("signing");
      expect(THRESHOLD_STATE.ERROR).toBe("error");
    });
  });

  // ============================================================
  // Constructor
  // ============================================================

  describe("constructor", () => {
    it("should set initial state to uninitialized", () => {
      expect(manager._state).toBe(THRESHOLD_STATE.UNINITIALIZED);
    });

    it("should set initialized to false", () => {
      expect(manager.initialized).toBe(false);
    });

    it("should store database reference", () => {
      expect(manager.database).toBe(mockDb);
    });

    it("should set threshold to 2 and totalShares to 3", () => {
      expect(manager._threshold).toBe(2);
      expect(manager._totalShares).toBe(3);
    });
  });

  // ============================================================
  // initialize()
  // ============================================================

  describe("initialize()", () => {
    it("should set initialized to true and state to ready", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
      expect(manager._state).toBe(THRESHOLD_STATE.READY);
    });

    it("should call _ensureTables", async () => {
      await manager.initialize();
      expect(mockDb.exec).toHaveBeenCalled();
    });

    it("should be idempotent (skip if already initialized)", async () => {
      await manager.initialize();
      await manager.initialize();
      // exec called only once
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // _ensureTables()
  // ============================================================

  describe("_ensureTables()", () => {
    it("should call db.exec with CREATE TABLE threshold_key_shares", () => {
      manager._ensureTables();
      const execCall = mockDb.exec.mock.calls[0][0];
      expect(execCall).toContain(
        "CREATE TABLE IF NOT EXISTS threshold_key_shares",
      );
      expect(execCall).toContain("idx_threshold_shares_key");
      expect(execCall).toContain("idx_threshold_shares_source");
    });

    it("should not throw when database is null", () => {
      const m = new ThresholdSignatureManager(null);
      expect(() => m._ensureTables()).not.toThrow();
    });
  });

  // ============================================================
  // setupKeys()
  // ============================================================

  describe("setupKeys()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should throw if not initialized", async () => {
      const m = new ThresholdSignatureManager(mockDb);
      await expect(m.setupKeys({ keyId: "k1" })).rejects.toThrow(
        "ThresholdSignatureManager not initialized",
      );
    });

    it("should throw if no keyId provided", async () => {
      await expect(manager.setupKeys({})).rejects.toThrow("keyId is required");
    });

    it("should throw if wrong number of sources", async () => {
      await expect(
        manager.setupKeys({
          keyId: "k1",
          sources: ["ukey", "simkey"],
        }),
      ).rejects.toThrow("Exactly 3 sources required");
    });

    it("should return success with correct structure", async () => {
      const result = await manager.setupKeys({ keyId: "test-key-1" });

      expect(result.success).toBe(true);
      expect(result.keyId).toBe("test-key-1");
      expect(result.publicKey).toBeDefined();
      expect(result.shares).toHaveLength(3);
      expect(result.threshold).toBe(2);
      expect(result.total).toBe(3);
    });

    it("should create shares with correct sources", async () => {
      const result = await manager.setupKeys({ keyId: "test-key-1" });

      expect(result.shares[0].source).toBe("ukey");
      expect(result.shares[1].source).toBe("simkey");
      expect(result.shares[2].source).toBe("tee");
      expect(result.shares[0].index).toBe(1);
      expect(result.shares[1].index).toBe(2);
      expect(result.shares[2].index).toBe(3);
    });

    it("should store shares in DB via INSERT", async () => {
      await manager.setupKeys({ keyId: "test-key-1" });

      // 3 shares = 3 INSERT calls
      expect(mockRunStmt.run).toHaveBeenCalledTimes(3);
    });

    it("should emit keys-setup event", async () => {
      const spy = vi.fn();
      manager.on("keys-setup", spy);

      await manager.setupKeys({ keyId: "test-key-1" });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          keyId: "test-key-1",
          shares: expect.any(Array),
        }),
      );
    });
  });

  // ============================================================
  // listKeys()
  // ============================================================

  describe("listKeys()", () => {
    it("should return empty array when no database", async () => {
      const m = new ThresholdSignatureManager(null);
      const result = await m.listKeys();
      expect(result).toEqual([]);
    });

    it("should call prepare with GROUP BY", async () => {
      await manager.listKeys();
      const prepareCall = mockDb.prepare.mock.calls.find((c) =>
        c[0].includes("GROUP BY"),
      );
      expect(prepareCall).toBeDefined();
    });

    it("should return rows from DB", async () => {
      const mockRows = [{ key_id: "k1", share_count: 3 }];
      mockAllStmt.all.mockReturnValue(mockRows);

      const result = await manager.listKeys();
      expect(result).toEqual(mockRows);
    });
  });

  // ============================================================
  // getKeyShares()
  // ============================================================

  describe("getKeyShares()", () => {
    it("should return empty array when no database", async () => {
      const m = new ThresholdSignatureManager(null);
      const result = await m.getKeyShares("k1");
      expect(result).toEqual([]);
    });

    it("should call prepare with WHERE key_id = ?", async () => {
      // Override prepare to track the SELECT with key_id
      const mockStmt = {
        all: vi.fn(() => []),
        get: vi.fn(() => null),
        run: vi.fn(),
      };
      mockDb.prepare = vi.fn(() => mockStmt);

      await manager.getKeyShares("test-key");
      const selectCall = mockDb.prepare.mock.calls.find((c) =>
        c[0].includes("key_id = ?"),
      );
      expect(selectCall).toBeDefined();
      expect(mockStmt.all).toHaveBeenCalledWith("test-key");
    });
  });

  // ============================================================
  // deleteKey()
  // ============================================================

  describe("deleteKey()", () => {
    it("should return error when no database", async () => {
      const m = new ThresholdSignatureManager(null);
      const result = await m.deleteKey("k1");
      expect(result.success).toBe(false);
      expect(result.error).toBe("No database");
    });

    it("should call DELETE and return success", async () => {
      const result = await manager.deleteKey("test-key");
      expect(result.success).toBe(true);
      expect(mockRunStmt.run).toHaveBeenCalledWith("test-key");
    });

    it("should emit key-deleted event", async () => {
      const spy = vi.fn();
      manager.on("key-deleted", spy);

      await manager.deleteKey("test-key");
      expect(spy).toHaveBeenCalledWith({ keyId: "test-key" });
    });
  });

  // ============================================================
  // sign()
  // ============================================================

  describe("sign()", () => {
    it("should throw if not initialized", async () => {
      const m = new ThresholdSignatureManager(mockDb);
      await expect(
        m.sign({ keyId: "k1", data: "test", shareSources: ["ukey", "simkey"] }),
      ).rejects.toThrow("ThresholdSignatureManager not initialized");
    });

    it("should throw if insufficient shares", async () => {
      await manager.initialize();
      await expect(
        manager.sign({ keyId: "k1", data: "test", shareSources: ["ukey"] }),
      ).rejects.toThrow("At least 2 shares required to sign");
    });

    it("should throw if shareSources is missing", async () => {
      await manager.initialize();
      await expect(manager.sign({ keyId: "k1", data: "test" })).rejects.toThrow(
        "At least 2 shares required to sign",
      );
    });

    it("should throw if keyId or data missing", async () => {
      await manager.initialize();
      await expect(
        manager.sign({ shareSources: ["ukey", "simkey"] }),
      ).rejects.toThrow("keyId and data are required");
    });
  });

  // ============================================================
  // _splitSecret()
  // ============================================================

  describe("_splitSecret()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("should return correct number of shares (3 buffers)", () => {
      const { randomBytes } = require("crypto");
      const secret = randomBytes(32);
      const shares = manager._splitSecret(secret, 2, 3);

      expect(shares).toHaveLength(3);
      shares.forEach((share) => {
        expect(Buffer.isBuffer(share)).toBe(true);
      });
    });

    it("should return different shares", () => {
      const { randomBytes } = require("crypto");
      const secret = randomBytes(32);
      const shares = manager._splitSecret(secret, 2, 3);

      // Shares should not all be identical
      const hexShares = shares.map((s) => s.toString("hex"));
      const uniqueShares = new Set(hexShares);
      expect(uniqueShares.size).toBeGreaterThan(1);
    });
  });

  // ============================================================
  // _encryptShare() / _decryptShare() roundtrip
  // ============================================================

  describe("_encryptShare / _decryptShare roundtrip", () => {
    it("should encrypt then decrypt to same data", () => {
      const { randomBytes } = require("crypto");
      const original = randomBytes(32);
      const source = "ukey";

      const encrypted = manager._encryptShare(original, source);
      expect(typeof encrypted).toBe("string"); // base64

      const decrypted = manager._decryptShare(encrypted, source);
      expect(Buffer.isBuffer(decrypted)).toBe(true);
      expect(decrypted.toString("hex")).toBe(original.toString("hex"));
    });

    it("should produce different ciphertext each time (random IV)", () => {
      const { randomBytes } = require("crypto");
      const data = randomBytes(32);
      const source = "simkey";

      const encrypted1 = manager._encryptShare(data, source);
      const encrypted2 = manager._encryptShare(data, source);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it("should fail to decrypt with wrong source", () => {
      const { randomBytes } = require("crypto");
      const data = randomBytes(32);

      const encrypted = manager._encryptShare(data, "ukey");
      expect(() => manager._decryptShare(encrypted, "tee")).toThrow();
    });
  });

  // ============================================================
  // getState()
  // ============================================================

  describe("getState()", () => {
    it("should return current state", () => {
      expect(manager.getState()).toBe(THRESHOLD_STATE.UNINITIALIZED);
    });

    it("should return ready after initialization", async () => {
      await manager.initialize();
      expect(manager.getState()).toBe(THRESHOLD_STATE.READY);
    });
  });

  // ============================================================
  // Singleton
  // ============================================================

  describe("singleton", () => {
    it("getThresholdSignatureManager returns same instance", () => {
      const a = getThresholdSignatureManager();
      const b = getThresholdSignatureManager();
      expect(a).toBe(b);
    });
  });
});
