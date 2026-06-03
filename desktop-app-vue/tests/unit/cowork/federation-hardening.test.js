import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-fed-hard-uuid-001"),
}));

let mockRunStmt, mockAllStmt, mockDb;
let FederationHardening, getFederationHardening, CIRCUIT_STATE, HEALTH_STATUS;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
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
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };

  const mod =
    await import("../../../src/main/ai-engine/cowork/federation-hardening.js");
  FederationHardening = mod.FederationHardening;
  getFederationHardening = mod.getFederationHardening;
  CIRCUIT_STATE = mod.CIRCUIT_STATE;
  HEALTH_STATUS = mod.HEALTH_STATUS;
});

describe("Constants", () => {
  it("should define CIRCUIT_STATE", () => {
    expect(CIRCUIT_STATE.CLOSED).toBe("closed");
    expect(CIRCUIT_STATE.OPEN).toBe("open");
    expect(CIRCUIT_STATE.HALF_OPEN).toBe("half_open");
  });

  it("should define HEALTH_STATUS", () => {
    expect(HEALTH_STATUS.HEALTHY).toBe("healthy");
    expect(HEALTH_STATUS.DEGRADED).toBe("degraded");
    expect(HEALTH_STATUS.UNHEALTHY).toBe("unhealthy");
  });
});

describe("FederationHardening", () => {
  let manager;

  beforeEach(() => {
    manager = new FederationHardening({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(manager.initialized).toBe(false);
      expect(manager._circuitBreakers).toBeInstanceOf(Map);
      expect(manager._healthChecks).toBeInstanceOf(Map);
      expect(manager._failureThreshold).toBe(5);
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
        "CREATE TABLE IF NOT EXISTS federation_circuit_breakers",
      );
      expect(sql).toContain(
        "CREATE TABLE IF NOT EXISTS federation_health_checks",
      );
    });

    it("should not throw if database is null", () => {
      const m = new FederationHardening(null);
      expect(() => m._ensureTables()).not.toThrow();
    });
  });

  describe("getStatus()", () => {
    it("should return status summary", async () => {
      const status = await manager.getStatus();
      expect(status.circuitBreakers).toBeDefined();
      expect(status.healthChecks).toBeDefined();
      expect(status.config).toBeDefined();
    });
  });

  describe("getCircuitBreakers()", () => {
    it("should return circuit breakers array", async () => {
      manager._circuitBreakers.set("node1", {
        node_id: "node1",
        state: "closed",
      });
      const breakers = await manager.getCircuitBreakers();
      expect(breakers).toHaveLength(1);
    });
  });

  describe("resetCircuit()", () => {
    it("should throw if nodeId is missing", async () => {
      await expect(manager.resetCircuit()).rejects.toThrow(
        "Node ID is required",
      );
    });

    it("should reset circuit to closed", async () => {
      manager._circuitBreakers.set("node1", {
        id: "cb1",
        node_id: "node1",
        state: "open",
        failure_count: 5,
      });
      const result = await manager.resetCircuit("node1");
      expect(result.state).toBe("closed");
      expect(result.failure_count).toBe(0);
    });

    it("should create new circuit if not exists", async () => {
      const result = await manager.resetCircuit("new-node");
      expect(result.state).toBe("closed");
    });
  });

  describe("recordFailure()", () => {
    it("should throw if nodeId is missing", async () => {
      await expect(manager.recordFailure()).rejects.toThrow(
        "Node ID is required",
      );
    });

    it("should increment failure count", async () => {
      const result = await manager.recordFailure("node1");
      expect(result.failure_count).toBe(1);
    });

    it("should open circuit when threshold exceeded", async () => {
      manager._failureThreshold = 2;
      await manager.recordFailure("node1");
      const result = await manager.recordFailure("node1");
      expect(result.state).toBe("open");
    });
  });

  describe("runHealthCheck()", () => {
    it("should return health check result", async () => {
      const check = await manager.runHealthCheck("node1");
      expect(check.node_id).toBe("node1");
      expect(check.status).toBeDefined();
      expect(check.latency_ms).toBeDefined();
    });

    it("should default to self if no nodeId", async () => {
      const check = await manager.runHealthCheck();
      expect(check.node_id).toBe("self");
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      manager._circuitBreakers.set("n1", {});
      await manager.close();
      expect(manager._circuitBreakers.size).toBe(0);
      expect(manager.initialized).toBe(false);
    });
  });

  describe("getFederationHardening singleton", () => {
    it("should return an instance", () => {
      const instance = getFederationHardening();
      expect(instance).toBeInstanceOf(FederationHardening);
    });
  });
});
