import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-pqc-uuid-001"),
}));

let mockRunStmt, mockGetStmt, mockAllStmt, mockDb;
let PQCMigrationManager,
  getPQCMigrationManager,
  PQC_ALGORITHMS,
  KEY_PURPOSES,
  MIGRATION_STATUS;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockGetStmt = { get: vi.fn(() => null) };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (
        sql.includes("INSERT") ||
        sql.includes("UPDATE") ||
        sql.includes("DELETE")
      ) {
        return mockRunStmt;
      }
      if (
        sql.includes("SELECT") &&
        (sql.includes("= ?") || sql.includes("id"))
      ) {
        return mockGetStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };

  const mod = await import("../../../src/main/ukey/pqc-migration-manager.js");
  PQCMigrationManager = mod.PQCMigrationManager;
  getPQCMigrationManager = mod.getPQCMigrationManager;
  PQC_ALGORITHMS = mod.PQC_ALGORITHMS;
  KEY_PURPOSES = mod.KEY_PURPOSES;
  MIGRATION_STATUS = mod.MIGRATION_STATUS;
});

describe("PQC_ALGORITHMS constants", () => {
  it("should have ML-KEM and ML-DSA algorithms", () => {
    expect(PQC_ALGORITHMS.ML_KEM_768).toBe("ML-KEM-768");
    expect(PQC_ALGORITHMS.ML_KEM_1024).toBe("ML-KEM-1024");
    expect(PQC_ALGORITHMS.ML_DSA_65).toBe("ML-DSA-65");
    expect(PQC_ALGORITHMS.ML_DSA_87).toBe("ML-DSA-87");
  });

  it("should have hybrid algorithms", () => {
    expect(PQC_ALGORITHMS.HYBRID_X25519_ML_KEM).toBe("X25519-ML-KEM-768");
    expect(PQC_ALGORITHMS.HYBRID_ED25519_ML_DSA).toBe("Ed25519-ML-DSA-65");
  });
});

describe("KEY_PURPOSES constants", () => {
  it("should define encryption, signing, key_exchange", () => {
    expect(KEY_PURPOSES.ENCRYPTION).toBe("encryption");
    expect(KEY_PURPOSES.SIGNING).toBe("signing");
    expect(KEY_PURPOSES.KEY_EXCHANGE).toBe("key_exchange");
  });
});

describe("MIGRATION_STATUS constants", () => {
  it("should define all statuses", () => {
    expect(MIGRATION_STATUS.PENDING).toBe("pending");
    expect(MIGRATION_STATUS.IN_PROGRESS).toBe("in_progress");
    expect(MIGRATION_STATUS.COMPLETED).toBe("completed");
    expect(MIGRATION_STATUS.FAILED).toBe("failed");
    expect(MIGRATION_STATUS.ROLLED_BACK).toBe("rolled_back");
  });
});

describe("PQCMigrationManager", () => {
  let manager;

  beforeEach(() => {
    manager = new PQCMigrationManager({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(manager.initialized).toBe(false);
      expect(manager._keys).toBeInstanceOf(Map);
      expect(manager._keys.size).toBe(0);
      expect(manager._migrationPlans).toBeInstanceOf(Map);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });

    it("should call _ensureTables", async () => {
      const spy = vi.spyOn(manager, "_ensureTables");
      await manager.initialize();
      expect(spy).toHaveBeenCalled();
    });

    it("should load existing keys from DB", async () => {
      mockAllStmt.all.mockReturnValueOnce([
        {
          id: "k1",
          algorithm: "ML-KEM-768",
          purpose: "encryption",
          status: "active",
          metadata: "{}",
        },
      ]);
      await manager.initialize();
      expect(manager._keys.size).toBe(1);
    });
  });

  describe("_ensureTables()", () => {
    it("should call db.exec with CREATE TABLE pqc_keys", () => {
      manager._ensureTables();
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS pqc_keys");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS pqc_migration_status");
    });

    it("should not throw if database is null", () => {
      const m = new PQCMigrationManager(null);
      expect(() => m._ensureTables()).not.toThrow();
    });
  });

  describe("generateKey()", () => {
    it("should throw for invalid algorithm", async () => {
      await expect(
        manager.generateKey({ algorithm: "RSA", purpose: "encryption" }),
      ).rejects.toThrow("Invalid algorithm");
    });

    it("should throw for invalid purpose", async () => {
      await expect(
        manager.generateKey({ algorithm: "ML-KEM-768", purpose: "invalid" }),
      ).rejects.toThrow("Invalid purpose");
    });

    it("should generate key and add to Map", async () => {
      const key = await manager.generateKey({
        algorithm: "ML-KEM-768",
        purpose: "encryption",
      });
      expect(key.id).toBe("test-pqc-uuid-001");
      expect(key.algorithm).toBe("ML-KEM-768");
      expect(key.purpose).toBe("encryption");
      expect(key.status).toBe("active");
      expect(key.key_size).toBe(768);
      expect(manager._keys.has(key.id)).toBe(true);
    });

    it("should set key_size to 1024 for higher-security algorithms", async () => {
      const key = await manager.generateKey({
        algorithm: "ML-KEM-1024",
        purpose: "encryption",
      });
      expect(key.key_size).toBe(1024);
    });

    it("should support hybrid mode", async () => {
      const key = await manager.generateKey({
        algorithm: "X25519-ML-KEM-768",
        purpose: "key_exchange",
        hybridMode: true,
        classicalAlgorithm: "X25519",
      });
      expect(key.hybrid_mode).toBe(1);
      expect(key.classical_algorithm).toBe("X25519");
    });

    it("should insert into DB", async () => {
      await manager.generateKey({ algorithm: "ML-DSA-65", purpose: "signing" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("listKeys()", () => {
    it("should return all keys", async () => {
      manager._keys.set("k1", {
        id: "k1",
        algorithm: "ML-KEM-768",
        status: "active",
      });
      manager._keys.set("k2", {
        id: "k2",
        algorithm: "ML-DSA-65",
        status: "active",
      });
      const keys = await manager.listKeys();
      expect(keys).toHaveLength(2);
    });

    it("should filter by algorithm", async () => {
      manager._keys.set("k1", {
        id: "k1",
        algorithm: "ML-KEM-768",
        status: "active",
      });
      manager._keys.set("k2", {
        id: "k2",
        algorithm: "ML-DSA-65",
        status: "active",
      });
      const keys = await manager.listKeys({ algorithm: "ML-KEM-768" });
      expect(keys).toHaveLength(1);
      expect(keys[0].algorithm).toBe("ML-KEM-768");
    });

    it("should return empty array when no keys", async () => {
      const keys = await manager.listKeys();
      expect(keys).toEqual([]);
    });
  });

  describe("getMigrationStatus()", () => {
    it("should return plans from DB", async () => {
      mockAllStmt.all.mockReturnValueOnce([
        { id: "p1", plan_name: "Test", status: "completed" },
      ]);
      const plans = await manager.getMigrationStatus();
      expect(plans).toHaveLength(1);
    });
  });

  describe("executeMigration()", () => {
    it("should throw if planName is missing", async () => {
      await expect(manager.executeMigration({})).rejects.toThrow(
        "Plan name is required",
      );
    });

    it("should throw if targetAlgorithm is missing", async () => {
      await expect(
        manager.executeMigration({ planName: "test" }),
      ).rejects.toThrow("Target algorithm is required");
    });

    it("should throw for invalid target algorithm", async () => {
      await expect(
        manager.executeMigration({
          planName: "test",
          targetAlgorithm: "invalid",
        }),
      ).rejects.toThrow("Invalid target algorithm");
    });

    it("should execute migration and return plan", async () => {
      const plan = await manager.executeMigration({
        planName: "Migrate to PQC",
        targetAlgorithm: "ML-KEM-768",
      });
      expect(plan.plan_name).toBe("Migrate to PQC");
      expect(plan.target_algorithm).toBe("ML-KEM-768");
      expect(plan.status).toBeDefined();
    });
  });

  describe("buildPQCContext()", () => {
    it("should return null when no keys", () => {
      expect(manager.buildPQCContext("hint", 5)).toBeNull();
    });

    it("should return context string when keys exist", () => {
      manager._keys.set("k1", { algorithm: "ML-KEM-768" });
      const ctx = manager.buildPQCContext("hint", 5);
      expect(ctx).toContain("[PQC Status]");
      expect(ctx).toContain("ML-KEM-768");
    });
  });

  describe("getPQCMigrationManager singleton", () => {
    it("should return an instance", () => {
      const instance = getPQCMigrationManager();
      expect(instance).toBeInstanceOf(PQCMigrationManager);
    });
  });
});
