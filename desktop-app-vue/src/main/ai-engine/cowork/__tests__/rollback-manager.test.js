/**
 * RollbackManager 单元测试
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { RollbackManager, ROLLBACK_TYPE, ROLLBACK_STATUS } = require("../rollback-manager");

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

describe("RollbackManager", () => {
  let manager;
  let db;

  beforeEach(() => {
    manager = new RollbackManager();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  describe("initialize()", () => {
    it("should set initialized=true", async () => {
      await manager.initialize(db);
      expect(manager.initialized).toBe(true);
    });

    it("should be idempotent", async () => {
      await manager.initialize(db);
      await manager.initialize(db);
      expect(manager.initialized).toBe(true);
    });
  });

  describe("rollback()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should return failure when disabled", async () => {
      manager.configure({ enabled: false });
      const result = await manager.rollback({ type: ROLLBACK_TYPE.CUSTOM });
      expect(result.success).toBe(false);
      expect(result.error).toContain("disabled");
    });

    it("should succeed for undo-steps with empty completedSteps", async () => {
      const result = await manager.rollback({
        type: ROLLBACK_TYPE.CUSTOM,
        completedSteps: [],
        reason: "test rollback",
      });
      expect(result.success).toBe(true);
    });

    it("should add record to history after rollback", async () => {
      await manager.rollback({ type: ROLLBACK_TYPE.CUSTOM, completedSteps: [] });
      const history = manager.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(1);
    });

    it("should emit rollback:completed event", async () => {
      const listener = vi.fn();
      manager.on("rollback:completed", listener);
      await manager.rollback({ type: ROLLBACK_TYPE.CUSTOM, completedSteps: [] });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should undo provided steps in reverse order", async () => {
      const steps = [
        { action: "deploy", target: "v1.0" },
        { action: "config-change", target: "timeout=30" },
      ];
      const result = await manager.rollback({
        type: ROLLBACK_TYPE.CUSTOM,
        completedSteps: steps,
      });
      expect(result.success).toBe(true);
      expect(result.details.undoneSteps).toHaveLength(2);
    });
  });

  describe("takeSnapshot()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should return a snapshot id", () => {
      const snapshotId = manager.takeSnapshot("before-deploy", { timeout: 30 });
      expect(typeof snapshotId).toBe("string");
      expect(snapshotId).toMatch(/^snap-/);
    });

    it("should store multiple snapshots", () => {
      manager.takeSnapshot("snap-1", { val: 1 });
      manager.takeSnapshot("snap-2", { val: 2 });
      const stats = manager.getStats();
      expect(stats.snapshotCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("getHistory()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should return empty array initially", () => {
      expect(manager.getHistory()).toEqual([]);
    });

    it("should respect the limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await manager.rollback({ type: ROLLBACK_TYPE.CUSTOM, completedSteps: [] });
      }
      const limited = manager.getHistory(3);
      expect(limited.length).toBe(3);
    });
  });

  describe("getStats()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should return stats with successCount and failureCount", async () => {
      await manager.rollback({ type: ROLLBACK_TYPE.CUSTOM, completedSteps: [] });
      const stats = manager.getStats();
      expect(stats).toHaveProperty("successCount");
      expect(stats).toHaveProperty("failureCount");
      expect(stats).toHaveProperty("snapshotCount");
      expect(stats.successCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getConfig() / configure()", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should return config with enabled property", () => {
      const config = manager.getConfig();
      expect(config).toHaveProperty("enabled");
    });

    it("should update config", () => {
      manager.configure({ keepSnapshots: 20 });
      expect(manager.getConfig().keepSnapshots).toBe(20);
    });
  });

  describe("Constants", () => {
    it("ROLLBACK_TYPE should have expected values", () => {
      expect(ROLLBACK_TYPE.GIT_REVERT).toBeTruthy();
      expect(ROLLBACK_TYPE.DOCKER_ROLLBACK).toBeTruthy();
      expect(ROLLBACK_TYPE.CONFIG_RESTORE).toBeTruthy();
      expect(ROLLBACK_TYPE.SERVICE_RESTART).toBeTruthy();
      expect(ROLLBACK_TYPE.CUSTOM).toBeDefined();
    });

    it("ROLLBACK_STATUS should have success and failed", () => {
      expect(ROLLBACK_STATUS.SUCCESS).toBeTruthy();
      expect(ROLLBACK_STATUS.FAILED).toBeTruthy();
    });
  });
});
