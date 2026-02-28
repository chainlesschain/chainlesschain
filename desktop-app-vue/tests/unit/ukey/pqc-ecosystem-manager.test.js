import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-001") }));

let mockRunStmt, mockAllStmt, mockDb;
let PQCEcosystemManager, getPQCEcosystemManager, MIGRATION_STATUS;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };
  const mod = await import("../../../src/main/ukey/pqc-ecosystem-manager.js");
  PQCEcosystemManager = mod.PQCEcosystemManager;
  getPQCEcosystemManager = mod.getPQCEcosystemManager;
  MIGRATION_STATUS = mod.MIGRATION_STATUS;
});

describe("PQCEcosystemManager", () => {
  let manager;
  beforeEach(() => {
    manager = new PQCEcosystemManager({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(manager.initialized).toBe(false);
      expect(manager._migrations).toBeInstanceOf(Map);
      expect(manager._subsystems).toContain("p2p");
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      manager._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain(
        "CREATE TABLE IF NOT EXISTS pqc_subsystem_migrations",
      );
    });
  });

  describe("getCoverage()", () => {
    it("should return coverage for all subsystems", async () => {
      const coverage = await manager.getCoverage();
      expect(coverage).toHaveProperty("p2p");
      expect(coverage).toHaveProperty("did");
      expect(coverage).toHaveProperty("storage");
      expect(coverage.p2p.percentage).toBe(0);
    });
  });

  describe("migrateSubsystem()", () => {
    it("should throw if subsystem is missing", async () => {
      await expect(manager.migrateSubsystem({})).rejects.toThrow(
        "Subsystem is required",
      );
    });

    it("should reject unknown subsystem", async () => {
      await expect(
        manager.migrateSubsystem({ subsystem: "unknown" }),
      ).rejects.toThrow("Unknown subsystem: unknown");
    });

    it("should migrate valid subsystem", async () => {
      const result = await manager.migrateSubsystem({ subsystem: "p2p" });
      expect(result.subsystem).toBe("p2p");
      expect(result.status).toBe("completed");
      expect(result.progress).toBe(100.0);
    });

    it("should persist to DB", async () => {
      await manager.migrateSubsystem({ subsystem: "did" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("updateFirmwarePQC()", () => {
    it("should throw if firmware version missing", async () => {
      await expect(manager.updateFirmwarePQC()).rejects.toThrow(
        "Firmware version is required",
      );
    });

    it("should update firmware PQC", async () => {
      const result = await manager.updateFirmwarePQC("2.0.0");
      expect(result.firmwareVersion).toBe("2.0.0");
      expect(result.pqcEnabled).toBe(true);
      expect(result.algorithm).toBe("ML-DSA-65");
    });
  });

  describe("verifyMigration()", () => {
    it("should verify migration status", async () => {
      const result = await manager.verifyMigration();
      expect(result).toHaveProperty("verified");
      expect(result).toHaveProperty("coverage");
      expect(result).toHaveProperty("verifiedAt");
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      manager._migrations.set("m1", {});
      await manager.close();
      expect(manager._migrations.size).toBe(0);
      expect(manager.initialized).toBe(false);
    });
  });

  describe("getSingleton", () => {
    it("should return instance", () => {
      const instance = getPQCEcosystemManager();
      expect(instance).toBeInstanceOf(PQCEcosystemManager);
    });
  });
});
