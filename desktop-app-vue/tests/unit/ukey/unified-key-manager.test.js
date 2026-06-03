/**
 * UnifiedKeyManager Unit Tests
 * Target: src/main/ukey/unified-key-manager.js
 * Coverage: Key derivation, CRUD, primary key management, constants
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ============================================================
// Mocks
// ============================================================

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-" + Math.random().toString(36).substr(2, 9)),
}));

describe("UnifiedKeyManager", () => {
  let UnifiedKeyManager, KEY_PURPOSES, KEY_SOURCES, DERIVATION_PATHS;
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
      db: {
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
          if (sql.includes("SELECT") && sql.includes("id = ?")) {
            return mockGetStmt;
          }
          if (sql.includes("SELECT")) {
            return mockAllStmt;
          }
          return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
        }),
      },
      saveToFile: vi.fn(),
    };

    const mod = await import("../../../src/main/ukey/unified-key-manager.js");
    UnifiedKeyManager = mod.UnifiedKeyManager;
    KEY_PURPOSES = mod.KEY_PURPOSES;
    KEY_SOURCES = mod.KEY_SOURCES;
    DERIVATION_PATHS = mod.DERIVATION_PATHS;

    manager = new UnifiedKeyManager(mockDb);
  });

  afterEach(async () => {
    if (manager) {
      await manager.close();
    }
  });

  // ============================================================
  // Constructor & Init
  // ============================================================

  describe("constructor", () => {
    it("should create instance with database and empty state", () => {
      expect(manager.database).toBe(mockDb);
      expect(manager.initialized).toBe(false);
      expect(manager._derivedKeys.size).toBe(0);
    });
  });

  describe("initialize()", () => {
    it("should call _ensureTables and set initialized", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
      expect(mockDb.db.exec).toHaveBeenCalled();
    });
  });

  describe("_ensureTables()", () => {
    it("should create unified_keys table", () => {
      manager._ensureTables();
      const execCall = mockDb.db.exec.mock.calls[0][0];
      expect(execCall).toContain("CREATE TABLE IF NOT EXISTS unified_keys");
      expect(execCall).toContain("idx_unified_keys_purpose");
      expect(execCall).toContain("idx_unified_keys_source");
    });

    it("should not throw when database.db is missing", () => {
      const m = new UnifiedKeyManager({});
      m._ensureTables(); // should not throw
    });
  });

  // ============================================================
  // deriveKey
  // ============================================================

  describe("deriveKey()", () => {
    it("should generate ed25519 key pair and store in DB", async () => {
      const result = await manager.deriveKey("identity");

      expect(result.algorithm).toBe("ed25519");
      expect(result.publicKey).toContain("-----BEGIN PUBLIC KEY-----");
      expect(result.keyHash).toBeDefined();
      expect(result.id).toBeDefined();
      expect(mockRunStmt.run).toHaveBeenCalled();
      expect(mockDb.saveToFile).toHaveBeenCalled();
    });

    it("should use correct derivation path for IDENTITY purpose", async () => {
      const result = await manager.deriveKey("identity");
      expect(result.derivationPath).toBe(DERIVATION_PATHS.IDENTITY);
    });

    it("should use correct derivation path for SIGNING purpose", async () => {
      const result = await manager.deriveKey("signing");
      expect(result.derivationPath).toBe(DERIVATION_PATHS.SIGNING);
    });

    it("should use custom path when provided", async () => {
      const result = await manager.deriveKey("identity", {
        path: "m/44'/99'/0'/0",
      });
      expect(result.derivationPath).toBe("m/44'/99'/0'/0");
    });

    it("should emit key:derived event", async () => {
      const spy = vi.fn();
      manager.on("key:derived", spy);

      await manager.deriveKey("signing");
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: "signing",
          source: "software",
        }),
      );
    });

    it("should cache key in _derivedKeys map", async () => {
      const result = await manager.deriveKey("identity");
      expect(manager._derivedKeys.has(result.keyHash)).toBe(true);
    });

    it("should set source from options", async () => {
      const result = await manager.deriveKey("identity", {
        source: KEY_SOURCES.UKEY,
      });
      expect(result.source).toBe("ukey");
    });
  });

  // ============================================================
  // getKeysByPurpose
  // ============================================================

  describe("getKeysByPurpose()", () => {
    it("should query DB for keys with given purpose", async () => {
      const mockKeys = [{ id: "k1", purpose: "signing", key_hash: "abc" }];
      mockDb.db.prepare = vi.fn(() => ({
        all: vi.fn(() => mockKeys),
        get: vi.fn(() => null),
        run: vi.fn(),
      }));

      const result = await manager.getKeysByPurpose("signing");
      expect(result).toEqual(mockKeys);
    });

    it("should return empty array when no database", async () => {
      const m = new UnifiedKeyManager(null);
      const result = await m.getKeysByPurpose("signing");
      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // getPrimaryKey
  // ============================================================

  describe("getPrimaryKey()", () => {
    it("should return primary key for purpose", async () => {
      const mockKey = { id: "k1", purpose: "identity", is_primary: 1 };
      mockDb.db.prepare = vi.fn(() => ({
        get: vi.fn(() => mockKey),
        all: vi.fn(() => []),
        run: vi.fn(),
      }));

      const result = await manager.getPrimaryKey("identity");
      expect(result).toEqual(mockKey);
    });

    it("should return null when no primary key", async () => {
      mockDb.db.prepare = vi.fn(() => ({
        get: vi.fn(() => null),
        all: vi.fn(() => []),
        run: vi.fn(),
      }));

      const result = await manager.getPrimaryKey("identity");
      expect(result).toBeNull();
    });

    it("should return null when no database", async () => {
      const m = new UnifiedKeyManager(null);
      const result = await m.getPrimaryKey("identity");
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // setPrimaryKey
  // ============================================================

  describe("setPrimaryKey()", () => {
    it("should unset old primary and set new", async () => {
      const mockKey = { id: "k1", purpose: "identity" };
      const updateRuns = [];

      mockDb.db.prepare = vi.fn((sql) => {
        if (sql.includes("SELECT")) {
          return {
            get: vi.fn(() => mockKey),
            all: vi.fn(() => []),
            run: vi.fn(),
          };
        }
        if (sql.includes("UPDATE")) {
          return { run: vi.fn((...args) => updateRuns.push({ sql, args })) };
        }
        return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
      });

      const result = await manager.setPrimaryKey("k1");
      expect(result.success).toBe(true);
      expect(result.keyId).toBe("k1");
      expect(mockDb.saveToFile).toHaveBeenCalled();
    });

    it("should throw for unknown key", async () => {
      mockDb.db.prepare = vi.fn(() => ({
        get: vi.fn(() => null),
        all: vi.fn(() => []),
        run: vi.fn(),
      }));

      await expect(manager.setPrimaryKey("nonexistent")).rejects.toThrow(
        "Key not found",
      );
    });
  });

  // ============================================================
  // findKeyForDid + setDidForKey (#21 B.1 PR3)
  // ============================================================

  describe("findKeyForDid()", () => {
    it("returns entry when DID is bound", async () => {
      const mockEntry = {
        id: "k1",
        did: "did:cc:alice",
        source: "ukey",
        purpose: "signing",
      };
      mockDb.db.prepare = vi.fn(() => ({
        get: vi.fn(() => mockEntry),
        all: vi.fn(() => []),
        run: vi.fn(),
      }));
      const r = await manager.findKeyForDid("did:cc:alice");
      expect(r).toEqual(mockEntry);
    });

    it("returns null when DID is unbound", async () => {
      mockDb.db.prepare = vi.fn(() => ({
        get: vi.fn(() => undefined),
        all: vi.fn(() => []),
        run: vi.fn(),
      }));
      const r = await manager.findKeyForDid("did:cc:unbound");
      expect(r).toBeNull();
    });

    it("returns null when database missing", async () => {
      const m = new UnifiedKeyManager(null);
      const r = await m.findKeyForDid("did:cc:a");
      expect(r).toBeNull();
    });

    it("returns null for non-string DID input", async () => {
      const r1 = await manager.findKeyForDid(null);
      const r2 = await manager.findKeyForDid("");
      const r3 = await manager.findKeyForDid(123);
      expect(r1).toBeNull();
      expect(r2).toBeNull();
      expect(r3).toBeNull();
    });

    it("returns null on db.prepare throw (defensive)", async () => {
      mockDb.db.prepare = vi.fn(() => {
        throw new Error("SQL error");
      });
      const r = await manager.findKeyForDid("did:cc:a");
      expect(r).toBeNull();
    });
  });

  describe("setDidForKey()", () => {
    it("binds DID to existing key + emits did-bound event", async () => {
      const events = [];
      manager.on("key:did-bound", (e) => events.push(e));
      mockDb.db.prepare = vi.fn((sql) => {
        if (sql.includes("SELECT")) {
          return {
            get: vi.fn(() => ({ id: "k1" })),
            all: vi.fn(() => []),
            run: vi.fn(),
          };
        }
        if (sql.includes("UPDATE")) {
          return { run: vi.fn(), get: vi.fn(), all: vi.fn() };
        }
        return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
      });
      const r = await manager.setDidForKey("k1", "did:cc:alice");
      expect(r.success).toBe(true);
      expect(r.keyId).toBe("k1");
      expect(r.did).toBe("did:cc:alice");
      expect(events).toEqual([{ keyId: "k1", did: "did:cc:alice" }]);
      expect(mockDb.saveToFile).toHaveBeenCalled();
    });

    it("throws Key not found when keyId is unknown", async () => {
      mockDb.db.prepare = vi.fn(() => ({
        get: vi.fn(() => null),
        all: vi.fn(() => []),
        run: vi.fn(),
      }));
      await expect(manager.setDidForKey("missing", "did:cc:a")).rejects.toThrow(
        "Key not found",
      );
    });

    it("rejects missing keyId / did", async () => {
      await expect(manager.setDidForKey("", "did:cc:a")).rejects.toThrow(
        /keyId required/,
      );
      await expect(manager.setDidForKey("k1", "")).rejects.toThrow(
        /did required/,
      );
      await expect(manager.setDidForKey(null, "did:cc:a")).rejects.toThrow(
        /keyId required/,
      );
    });
  });

  // ============================================================
  // listKeys
  // ============================================================

  describe("listKeys()", () => {
    it("should return all keys", async () => {
      const mockKeys = [{ id: "k1" }, { id: "k2" }];
      mockAllStmt.all.mockReturnValue(mockKeys);

      const result = await manager.listKeys();
      expect(result).toEqual(mockKeys);
    });

    it("should return empty array when no database", async () => {
      const m = new UnifiedKeyManager(null);
      const result = await m.listKeys();
      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // revokeKey
  // ============================================================

  describe("revokeKey()", () => {
    it("should delete key and emit event", async () => {
      const spy = vi.fn();
      manager.on("key:revoked", spy);

      const result = await manager.revokeKey("k1");
      expect(result.success).toBe(true);
      expect(mockDb.saveToFile).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith({ keyId: "k1" });
    });
  });

  // ============================================================
  // close
  // ============================================================

  describe("close()", () => {
    it("should clear cache and reset state", async () => {
      await manager.deriveKey("identity");
      expect(manager._derivedKeys.size).toBeGreaterThan(0);

      await manager.close();
      expect(manager._derivedKeys.size).toBe(0);
      expect(manager.initialized).toBe(false);
    });
  });

  // ============================================================
  // Constants
  // ============================================================

  describe("constants", () => {
    it("KEY_PURPOSES should have 5 entries", () => {
      expect(KEY_PURPOSES.IDENTITY).toBe("identity");
      expect(KEY_PURPOSES.SIGNING).toBe("signing");
      expect(KEY_PURPOSES.ENCRYPTION).toBe("encryption");
      expect(KEY_PURPOSES.AUTHENTICATION).toBe("authentication");
      expect(KEY_PURPOSES.DELEGATION).toBe("delegation");
    });

    it("KEY_SOURCES should have UKEY, SIMKEY, TEE, SOFTWARE", () => {
      expect(KEY_SOURCES.UKEY).toBe("ukey");
      expect(KEY_SOURCES.SIMKEY).toBe("simkey");
      expect(KEY_SOURCES.TEE).toBe("tee");
      expect(KEY_SOURCES.SOFTWARE).toBe("software");
    });

    it("DERIVATION_PATHS should have standard BIP-32 paths", () => {
      expect(DERIVATION_PATHS.IDENTITY).toBe("m/44'/0'/0'/0");
      expect(DERIVATION_PATHS.SIGNING).toBe("m/44'/0'/0'/1");
      expect(DERIVATION_PATHS.ENCRYPTION).toBe("m/44'/0'/0'/2");
      expect(DERIVATION_PATHS.AUTHENTICATION).toBe("m/44'/0'/0'/3");
      expect(DERIVATION_PATHS.DID).toBe("m/44'/501'/0'/0");
    });
  });
});
