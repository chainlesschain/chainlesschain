import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { AgentRegistry } = require("../agent-registry");

/**
 * Build a fake better-sqlite3-style database with prepare() returning
 * an object that records calls and yields configurable rows.
 */
function makeFakeDb(overrides = {}) {
  const calls = [];
  const stmt = {
    run: vi.fn(),
    get: vi.fn(() => overrides.getRow || {}),
    all: vi.fn(() => overrides.allRows || []),
  };
  const db = {
    prepare: vi.fn((sql) => {
      calls.push(sql);
      return stmt;
    }),
  };
  return {
    database: { getDatabase: () => db },
    db,
    stmt,
    calls,
  };
}

function makeFakeTemplateManager(template) {
  return {
    getTemplate: vi.fn().mockResolvedValue(template),
  };
}

const SAMPLE_TEMPLATE = {
  id: "tpl-1",
  name: "Security Analyzer",
  type: "security",
  enabled: true,
  capabilities: ["owasp_scanning"],
  tools: ["code_analyzer"],
  system_prompt: "You analyze security",
  config: { temperature: 0.2 },
};

describe("AgentRegistry", () => {
  let fakeDb;
  let templateManager;
  let registry;

  beforeEach(() => {
    fakeDb = makeFakeDb();
    templateManager = makeFakeTemplateManager(SAMPLE_TEMPLATE);
    registry = new AgentRegistry({
      database: fakeDb.database,
      templateManager,
    });
  });

  describe("registerAgentType", () => {
    it("registers a new type with defaults", () => {
      const result = registry.registerAgentType("security", {
        description: "Security analysis",
      });
      expect(result.success).toBe(true);
      expect(result.type).toBe("security");
      expect(registry.hasAgentType("security")).toBe(true);
    });

    it("applies default config values", () => {
      registry.registerAgentType("security");
      const types = registry.getAgentTypes();
      const sec = types.find((t) => t.type === "security");
      expect(sec.maxInstances).toBe(5);
      expect(sec.defaultTimeout).toBe(60000);
      expect(sec.maxRetries).toBe(3);
    });

    it("emits type-registered event", () => {
      const listener = vi.fn();
      registry.on("type-registered", listener);
      registry.registerAgentType("security");
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "security" }),
      );
    });

    it("throws on invalid type input", () => {
      expect(() => registry.registerAgentType("")).toThrow();
      expect(() => registry.registerAgentType(null)).toThrow();
    });

    it("overwrites an existing type", () => {
      registry.registerAgentType("security", { maxInstances: 3 });
      registry.registerAgentType("security", { maxInstances: 10 });
      const types = registry.getAgentTypes();
      const sec = types.find((t) => t.type === "security");
      expect(sec.maxInstances).toBe(10);
    });
  });

  describe("hasAgentType / getAgentTypes", () => {
    it("hasAgentType returns false for unknown type", () => {
      expect(registry.hasAgentType("nope")).toBe(false);
    });

    it("getAgentTypes returns array with active instance counts", () => {
      registry.registerAgentType("security");
      const types = registry.getAgentTypes();
      expect(types).toHaveLength(1);
      expect(types[0].activeInstances).toBe(0);
    });
  });

  describe("unregisterAgentType", () => {
    it("returns TYPE_NOT_FOUND when type does not exist", () => {
      const result = registry.unregisterAgentType("nope");
      expect(result.success).toBe(false);
      expect(result.error).toBe("TYPE_NOT_FOUND");
    });

    it("unregisters a registered type", () => {
      registry.registerAgentType("security");
      const result = registry.unregisterAgentType("security");
      expect(result.success).toBe(true);
      expect(registry.hasAgentType("security")).toBe(false);
    });

    it("refuses to unregister when active instances exist", async () => {
      registry.registerAgentType("security", { maxInstances: 5 });
      await registry.createAgentInstance("tpl-1");
      const result = registry.unregisterAgentType("security");
      expect(result.success).toBe(false);
      expect(result.error).toBe("ACTIVE_INSTANCES_EXIST");
    });
  });

  describe("createAgentInstance", () => {
    it("creates an instance from a valid template", async () => {
      const instance = await registry.createAgentInstance("tpl-1", {
        taskDescription: "scan repo",
      });
      expect(instance.id).toBeDefined();
      expect(instance.type).toBe("security");
      expect(instance.state).toBe("running");
      expect(instance.taskDescription).toBe("scan repo");
      expect(instance.systemPrompt).toBe("You analyze security");
    });

    it("throws when template not found", async () => {
      templateManager.getTemplate.mockResolvedValue(null);
      await expect(registry.createAgentInstance("missing")).rejects.toThrow(
        /not found/,
      );
    });

    it("throws when template is disabled", async () => {
      templateManager.getTemplate.mockResolvedValue({
        ...SAMPLE_TEMPLATE,
        enabled: false,
      });
      await expect(registry.createAgentInstance("tpl-1")).rejects.toThrow(
        /disabled/,
      );
    });

    it("enforces type maxInstances limit", async () => {
      registry.registerAgentType("security", { maxInstances: 1 });
      await registry.createAgentInstance("tpl-1");
      await expect(registry.createAgentInstance("tpl-1")).rejects.toThrow(
        /Maximum instances/,
      );
    });

    it("emits instance-created event", async () => {
      const listener = vi.fn();
      registry.on("instance-created", listener);
      await registry.createAgentInstance("tpl-1");
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "security" }),
      );
    });

    it("survives database insert failures", async () => {
      fakeDb.stmt.run.mockImplementation(() => {
        throw new Error("DB write failed");
      });
      const instance = await registry.createAgentInstance("tpl-1");
      expect(instance).toBeDefined();
      expect(instance.state).toBe("running");
    });

    it("merges template config with override config", async () => {
      const instance = await registry.createAgentInstance("tpl-1", {
        temperature: 0.9,
      });
      expect(instance.config.temperature).toBe(0.9);
    });
  });

  describe("getActiveInstances / getInstance", () => {
    it("getActiveInstances returns only running instances", async () => {
      const a = await registry.createAgentInstance("tpl-1");
      const b = await registry.createAgentInstance("tpl-1");
      await registry.terminateInstance(b.id);
      const active = registry.getActiveInstances();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(a.id);
    });

    it("getInstance returns null for unknown id", () => {
      expect(registry.getInstance("nope")).toBeNull();
      expect(registry.getInstance(null)).toBeNull();
    });

    it("getInstance returns instance with stats", async () => {
      const inst = await registry.createAgentInstance("tpl-1");
      const fetched = registry.getInstance(inst.id);
      expect(fetched.id).toBe(inst.id);
      expect(fetched.stats).toBeDefined();
      expect(fetched.stats.tasksCompleted).toBe(0);
    });
  });

  describe("terminateInstance", () => {
    it("returns INSTANCE_ID_REQUIRED when id is missing", async () => {
      const result = await registry.terminateInstance(null);
      expect(result.success).toBe(false);
      expect(result.error).toBe("INSTANCE_ID_REQUIRED");
    });

    it("returns INSTANCE_NOT_FOUND for unknown id", async () => {
      const result = await registry.terminateInstance("nope");
      expect(result.success).toBe(false);
      expect(result.error).toBe("INSTANCE_NOT_FOUND");
    });

    it("transitions running → completed on success", async () => {
      const inst = await registry.createAgentInstance("tpl-1");
      const result = await registry.terminateInstance(inst.id, {
        result: { findings: [] },
        tokensUsed: 100,
      });
      expect(result.success).toBe(true);
      const fetched = registry.getInstance(inst.id);
      expect(fetched.state).toBe("completed");
      expect(fetched.stats.tasksCompleted).toBe(1);
      expect(fetched.stats.tokensUsed).toBe(100);
    });

    it("transitions to failed when success=false", async () => {
      const inst = await registry.createAgentInstance("tpl-1");
      await registry.terminateInstance(inst.id, {
        success: false,
        reason: "timeout",
      });
      const fetched = registry.getInstance(inst.id);
      expect(fetched.state).toBe("failed");
      expect(fetched.error).toBe("timeout");
      expect(fetched.stats.tasksFailed).toBe(1);
    });

    it("rejects double termination", async () => {
      const inst = await registry.createAgentInstance("tpl-1");
      await registry.terminateInstance(inst.id);
      const second = await registry.terminateInstance(inst.id);
      expect(second.success).toBe(false);
      expect(second.error).toBe("INSTANCE_NOT_RUNNING");
    });

    it("emits task-completed on success", async () => {
      const completedListener = vi.fn();
      registry.on("task-completed", completedListener);
      const inst = await registry.createAgentInstance("tpl-1");
      await registry.terminateInstance(inst.id, { result: { ok: true } });
      expect(completedListener).toHaveBeenCalled();
    });

    it("emits task-failed on failure", async () => {
      const failedListener = vi.fn();
      registry.on("task-failed", failedListener);
      const inst = await registry.createAgentInstance("tpl-1");
      await registry.terminateInstance(inst.id, {
        success: false,
        reason: "boom",
      });
      expect(failedListener).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "boom" }),
      );
    });
  });

  describe("cleanupTerminatedInstances", () => {
    it("removes terminated instances older than maxAge", async () => {
      const inst = await registry.createAgentInstance("tpl-1");
      await registry.terminateInstance(inst.id);
      // Manually backdate completedAt
      const internal = registry._activeInstances.get(inst.id);
      internal.completedAt = Date.now() - 10000;
      const result = registry.cleanupTerminatedInstances(5000);
      expect(result.cleaned).toBe(1);
      expect(registry.getInstance(inst.id)).toBeNull();
    });

    it("preserves running instances regardless of age", async () => {
      const inst = await registry.createAgentInstance("tpl-1");
      const internal = registry._activeInstances.get(inst.id);
      internal.createdAt = Date.now() - 1000000;
      const result = registry.cleanupTerminatedInstances(1000);
      expect(result.cleaned).toBe(0);
      expect(registry.getInstance(inst.id)).not.toBeNull();
    });
  });

  describe("getStatistics", () => {
    it("returns counts grouped by state", async () => {
      registry.registerAgentType("security");
      const a = await registry.createAgentInstance("tpl-1");
      const b = await registry.createAgentInstance("tpl-1");
      await registry.terminateInstance(b.id);

      // Mock DB queries used by getStatistics
      fakeDb.stmt.get.mockImplementation(() => ({
        total_tasks: 2,
        successful: 1,
        failed: 0,
        pending: 1,
        total_tokens: 0,
        count: 2,
      }));
      fakeDb.stmt.all.mockReturnValue([
        { template_type: "security", count: 2 },
      ]);

      const stats = await registry.getStatistics();
      expect(stats.registeredTypes).toBe(1);
      expect(stats.types).toContain("security");
      expect(stats.instances.active).toBe(1);
      expect(stats.instances.completed).toBe(1);
      expect(stats.history.totalTasks).toBe(2);
      void a; // silence unused
    });
  });

  describe("getPerformanceStats", () => {
    it("aggregates stats from db with optional filters", async () => {
      fakeDb.stmt.all.mockReturnValue([
        {
          template_type: "security",
          total: 5,
          successes: 4,
          failures: 1,
          avg_duration_ms: 1234.5,
          min_duration_ms: 500,
          max_duration_ms: 2000,
          total_tokens: 1000,
          avg_tokens: 200,
        },
      ]);
      fakeDb.stmt.get.mockReturnValue({
        total: 5,
        successes: 4,
        failures: 1,
        avg_duration_ms: 1234.5,
        total_tokens: 1000,
      });

      const result = await registry.getPerformanceStats({
        type: "security",
        since: 1000,
      });
      expect(result.overall.totalTasks).toBe(5);
      expect(result.overall.successes).toBe(4);
      expect(result.overall.successRate).toBe("80.00%");
      expect(result.byType).toHaveLength(1);
      expect(result.byType[0].type).toBe("security");
      expect(result.byType[0].successRate).toBe("80.00%");
      expect(result.byType[0].avgDurationMs).toBe(1235); // rounded
    });

    it("returns N/A success rate when no tasks", async () => {
      fakeDb.stmt.all.mockReturnValue([]);
      fakeDb.stmt.get.mockReturnValue({
        total: 0,
        successes: null,
        failures: null,
        avg_duration_ms: null,
        total_tokens: null,
      });
      const result = await registry.getPerformanceStats();
      expect(result.overall.totalTasks).toBe(0);
      expect(result.overall.successRate).toBe("N/A");
    });
  });
});
