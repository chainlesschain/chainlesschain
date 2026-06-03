/**
 * AutoRemediator 单元测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  AutoRemediator,
  REMEDIATION_STATUS,
  ACTION_TYPES,
} = require("../auto-remediator");

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

describe("AutoRemediator", () => {
  let remediator;
  let db;

  beforeEach(() => {
    remediator = new AutoRemediator();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  describe("initialize()", () => {
    it("should set initialized=true and call db.prepare", async () => {
      await remediator.initialize(db);
      expect(remediator.initialized).toBe(true);
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should load built-in playbooks on first init", async () => {
      await remediator.initialize(db);
      expect(remediator.getPlaybooks().length).toBeGreaterThan(0);
    });

    it("should be idempotent", async () => {
      await remediator.initialize(db);
      const count = db.prepare.mock.calls.length;
      await remediator.initialize(db);
      expect(db.prepare.mock.calls.length).toBe(count);
    });

    it("should accept optional deps", async () => {
      const mockDeps = {
        rollbackManager: { initialized: true },
        alertManager: { initialized: true },
      };
      await remediator.initialize(db, mockDeps);
      expect(remediator.initialized).toBe(true);
      expect(remediator.rollbackManager).toBe(mockDeps.rollbackManager);
    });
  });

  describe("createPlaybook()", () => {
    beforeEach(async () => {
      await remediator.initialize(db);
    });

    it("should create a playbook and return it with an id", () => {
      const pb = remediator.createPlaybook({
        name: "restart-service",
        description: "Restart a service",
        steps: [{ action: "service-restart", target: "app" }],
      });

      expect(pb.id).toBeTruthy();
      expect(pb.name).toBe("restart-service");
      expect(pb.steps).toHaveLength(1);
      expect(pb.enabled).toBe(true);
    });

    it("should emit playbook:created event", () => {
      const listener = vi.fn();
      remediator.on("playbook:created", listener);
      remediator.createPlaybook({ name: "test-pb" });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should store playbook in the playbooks map", () => {
      const countBefore = remediator.getPlaybooks().length;
      remediator.createPlaybook({ name: "new-playbook" });
      expect(remediator.getPlaybooks().length).toBe(countBefore + 1);
    });
  });

  describe("getPlaybook()", () => {
    beforeEach(async () => {
      await remediator.initialize(db);
    });

    it("should return a specific playbook by id", () => {
      const pb = remediator.createPlaybook({ name: "find-me" });
      const found = remediator.getPlaybook(pb.id);
      expect(found).not.toBeNull();
      expect(found.name).toBe("find-me");
    });

    it("should return null/undefined for unknown id", () => {
      const result = remediator.getPlaybook("nonexistent-id");
      expect(result).toBeFalsy();
    });
  });

  describe("updatePlaybook()", () => {
    beforeEach(async () => {
      await remediator.initialize(db);
    });

    it("should update playbook properties", () => {
      const pb = remediator.createPlaybook({ name: "original-name" });
      const updated = remediator.updatePlaybook(pb.id, {
        name: "updated-name",
        enabled: false,
      });
      expect(updated.name).toBe("updated-name");
      expect(updated.enabled).toBe(false);
    });

    it("should throw for unknown playbook id", () => {
      expect(() =>
        remediator.updatePlaybook("nonexistent", { name: "x" }),
      ).toThrow();
    });
  });

  describe("triggerRemediation()", () => {
    beforeEach(async () => {
      await remediator.initialize(db);
    });

    it("should return SKIPPED when disabled", async () => {
      remediator.configure({ enabled: false });
      const result = await remediator.triggerRemediation({
        id: "inc-001",
        metricName: "error_rate",
      });
      expect(result.status).toBe(REMEDIATION_STATUS.SKIPPED);
    });

    it("should return SKIPPED with no-matching-playbook for unknown metric", async () => {
      // Custom metric with unique name that won't match any built-in playbook
      const result = await remediator.triggerRemediation({
        id: "inc-001",
        metricName: "completely_unknown_xyz_metric_12345",
        severity: "P3",
      });
      expect(result.status).toBe(REMEDIATION_STATUS.SKIPPED);
      expect(result.reason).toBe("no-matching-playbook");
    });
  });

  describe("getStats()", () => {
    beforeEach(async () => {
      await remediator.initialize(db);
    });

    it("should return stats with playbookCount and activeRemediations", () => {
      const stats = remediator.getStats();
      expect(stats).toHaveProperty("playbookCount");
      expect(stats).toHaveProperty("activeRemediations");
      expect(stats.playbookCount).toBeGreaterThan(0);
    });
  });

  describe("getConfig() / configure()", () => {
    beforeEach(async () => {
      await remediator.initialize(db);
    });

    it("should return current config", () => {
      const config = remediator.getConfig();
      expect(config).toHaveProperty("enabled");
      expect(config).toHaveProperty("maxConcurrentRemediations");
    });

    it("should update config fields", () => {
      remediator.configure({ enabled: false });
      expect(remediator.getConfig().enabled).toBe(false);
    });
  });

  describe("Constants", () => {
    it("REMEDIATION_STATUS should have expected values", () => {
      expect(REMEDIATION_STATUS.RUNNING).toBeTruthy();
      expect(REMEDIATION_STATUS.SUCCESS).toBeTruthy();
      expect(REMEDIATION_STATUS.FAILED).toBeTruthy();
      expect(REMEDIATION_STATUS.SKIPPED).toBeTruthy();
    });

    it("ACTION_TYPES should have expected action types", () => {
      expect(ACTION_TYPES).toBeTruthy();
      const keys = Object.keys(ACTION_TYPES);
      expect(keys.length).toBeGreaterThan(0);
    });
  });
});
