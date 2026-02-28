import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-sla-uuid-001"),
}));

let mockRunStmt, mockAllStmt, mockDb;
let SLAManager, getSLAManager, CONTRACT_STATUS, VIOLATION_SEVERITY;

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

  const mod = await import("../../../src/main/ai-engine/cowork/sla-manager.js");
  SLAManager = mod.SLAManager;
  getSLAManager = mod.getSLAManager;
  CONTRACT_STATUS = mod.CONTRACT_STATUS;
  VIOLATION_SEVERITY = mod.VIOLATION_SEVERITY;
});

describe("Constants", () => {
  it("should define CONTRACT_STATUS", () => {
    expect(CONTRACT_STATUS.DRAFT).toBe("draft");
    expect(CONTRACT_STATUS.ACTIVE).toBe("active");
    expect(CONTRACT_STATUS.VIOLATED).toBe("violated");
  });

  it("should define VIOLATION_SEVERITY", () => {
    expect(VIOLATION_SEVERITY.CRITICAL).toBe("critical");
    expect(VIOLATION_SEVERITY.MAJOR).toBe("major");
    expect(VIOLATION_SEVERITY.MINOR).toBe("minor");
  });
});

describe("SLAManager", () => {
  let manager;

  beforeEach(() => {
    manager = new SLAManager({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(manager.initialized).toBe(false);
      expect(manager._contracts).toBeInstanceOf(Map);
      expect(manager._violations).toBeInstanceOf(Map);
      expect(manager._autoEscalation).toBe(true);
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
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS sla_contracts");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS sla_violations");
    });
  });

  describe("createContract()", () => {
    it("should throw if name is missing", async () => {
      await expect(manager.createContract({})).rejects.toThrow(
        "Contract name is required",
      );
    });

    it("should create contract with defaults", async () => {
      const contract = await manager.createContract({ name: "test-sla" });
      expect(contract.name).toBe("test-sla");
      expect(contract.status).toBe("draft");
      expect(contract.guarantees).toBeDefined();
    });

    it("should persist to DB", async () => {
      await manager.createContract({ name: "test" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("listContracts()", () => {
    it("should return from in-memory", async () => {
      const m = new SLAManager(null);
      m._contracts.set("c1", { id: "c1", status: "active" });
      const contracts = await m.listContracts();
      expect(contracts).toHaveLength(1);
    });

    it("should filter by status", async () => {
      const m = new SLAManager(null);
      m._contracts.set("c1", { id: "c1", status: "active" });
      m._contracts.set("c2", { id: "c2", status: "expired" });
      const contracts = await m.listContracts({ status: "active" });
      expect(contracts).toHaveLength(1);
    });
  });

  describe("checkCompliance()", () => {
    it("should throw if contractId is missing", async () => {
      await expect(manager.checkCompliance()).rejects.toThrow(
        "Contract ID is required",
      );
    });

    it("should throw if contract not found", async () => {
      await expect(manager.checkCompliance("nonexistent")).rejects.toThrow(
        "Contract not found",
      );
    });

    it("should check compliance for contract", async () => {
      manager._contracts.set("c1", {
        id: "c1",
        guarantees: {
          maxExecutionMs: 30000,
          minAvailability: 0.99,
          minQualityScore: 0.8,
        },
      });
      const result = await manager.checkCompliance("c1");
      expect(result.contractId).toBe("c1");
      expect(result.metrics).toBeDefined();
      expect(result.isCompliant).toBeDefined();
    });
  });

  describe("getDashboard()", () => {
    it("should return dashboard summary", async () => {
      const dashboard = await manager.getDashboard();
      expect(dashboard.contracts).toBeDefined();
      expect(dashboard.violations).toBeDefined();
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      manager._contracts.set("c1", {});
      await manager.close();
      expect(manager._contracts.size).toBe(0);
      expect(manager.initialized).toBe(false);
    });
  });

  describe("getSLAManager singleton", () => {
    it("should return an instance", () => {
      const instance = getSLAManager();
      expect(instance).toBeInstanceOf(SLAManager);
    });
  });
});
