/**
 * PipelineOrchestrator 单元测试 — v3.1
 *
 * 覆盖：initialize、createPipeline（模板/验证）、startPipeline、
 *       pausePipeline、resumePipeline、cancelPipeline、
 *       approveGate、rejectGate、getStatus、getAllPipelines、
 *       getArtifacts、getTemplates、getConfig
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const {
  PipelineOrchestrator,
  PIPELINE_STATUS,
  STAGE_STATUS,
  STAGE_NAMES,
  ARTIFACT_TYPES,
  PIPELINE_TEMPLATES,
} = require("../pipeline-orchestrator");

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PipelineOrchestrator", () => {
  let orchestrator;
  let db;

  beforeEach(() => {
    orchestrator = new PipelineOrchestrator();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true and use DB via prepare", async () => {
      await orchestrator.initialize(db);

      expect(orchestrator.initialized).toBe(true);
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should load active pipelines from DB", async () => {
      db._prep.all.mockReturnValueOnce([
        {
          id: "pipe-001",
          name: "Feature Dev",
          template: "feature",
          requirement: "Add user profile",
          status: "running",
          config: "{}",
          created_at: "2025-01-01",
          started_at: "2025-01-01",
          completed_at: null,
          current_stage: "code-generation",
          metadata: "{}",
        },
      ]).mockReturnValue([]); // subsequent calls return empty

      await orchestrator.initialize(db);

      expect(orchestrator._pipelines.size).toBe(1);
    });

    it("should be idempotent", async () => {
      await orchestrator.initialize(db);
      const firstCallCount = db.exec.mock.calls.length;
      await orchestrator.initialize(db);
      expect(db.exec.mock.calls.length).toBe(firstCallCount);
    });

    it("should accept optional deps", async () => {
      const mockDeps = {
        requirementParser: { initialized: true },
        deployAgent: { initialized: true },
      };
      await orchestrator.initialize(db, mockDeps);
      expect(orchestrator.initialized).toBe(true);
      expect(orchestrator._requirementParser).toBe(mockDeps.requirementParser);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createPipeline
  // ─────────────────────────────────────────────────────────────────────────
  describe("createPipeline()", () => {
    beforeEach(async () => {
      await orchestrator.initialize(db);
    });

    it("should create a pipeline with 'feature' template", async () => {
      const result = await orchestrator.createPipeline({
        name: "User Auth Feature",
        template: "feature",
        requirement: "Implement JWT authentication",
      });

      expect(result.id).toBeTruthy();
      expect(result.status).toBe(PIPELINE_STATUS.CREATED);
      // Retrieve full details from status
      const pipeline = orchestrator.getStatus(result.id);
      expect(pipeline.name).toBe("User Auth Feature");
      expect(pipeline.template).toBe("feature");
    });

    it("should use 'feature' template by default", async () => {
      const result = await orchestrator.createPipeline({
        name: "My Pipeline",
      });

      const pipeline = orchestrator.getStatus(result.id);
      expect(pipeline.template).toBe("feature");
    });

    it("should create a pipeline with 'bugfix' template", async () => {
      const result = await orchestrator.createPipeline({
        name: "Fix Auth Bug",
        template: "bugfix",
      });

      const pipeline = orchestrator.getStatus(result.id);
      expect(pipeline.template).toBe("bugfix");
    });

    it("should throw if name is missing", async () => {
      await expect(
        orchestrator.createPipeline({ template: "feature" }),
      ).rejects.toThrow("name is required");
    });

    it("should throw for unknown template", async () => {
      await expect(
        orchestrator.createPipeline({ name: "Test", template: "unknown-template" }),
      ).rejects.toThrow();
    });

    it("should store pipeline in memory map", async () => {
      const result = await orchestrator.createPipeline({ name: "Test Pipeline" });

      expect(orchestrator._pipelines.has(result.id)).toBe(true);
    });

    it("should merge config overrides", async () => {
      const result = await orchestrator.createPipeline({
        name: "Custom Config",
        template: "feature",
        config: { autoApprove: true },
      });

      // Config is stored in the internal pipeline object
      expect(orchestrator._pipelines.get(result.id).config.autoApprove).toBe(true);
    });

    it("should emit pipeline:created event", async () => {
      const listener = vi.fn();
      orchestrator.on("pipeline:created", listener);

      await orchestrator.createPipeline({ name: "Emitting Pipeline" });

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // startPipeline
  // ─────────────────────────────────────────────────────────────────────────
  describe("startPipeline()", () => {
    beforeEach(async () => {
      await orchestrator.initialize(db);
    });

    it("should change status from CREATED to RUNNING", async () => {
      const result = await orchestrator.createPipeline({ name: "Start Test" });
      const started = await orchestrator.startPipeline(result.id);

      expect([PIPELINE_STATUS.RUNNING, PIPELINE_STATUS.GATE_WAITING]).toContain(
        started.status,
      );
    });

    it("should throw for unknown pipeline id", async () => {
      await expect(
        orchestrator.startPipeline("nonexistent-id"),
      ).rejects.toThrow();
    });

    it("should throw if pipeline is already running", async () => {
      const result = await orchestrator.createPipeline({ name: "Already Running" });
      await orchestrator.startPipeline(result.id);

      await expect(
        orchestrator.startPipeline(result.id),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // pausePipeline / resumePipeline
  // ─────────────────────────────────────────────────────────────────────────
  describe("pausePipeline() / resumePipeline()", () => {
    beforeEach(async () => {
      await orchestrator.initialize(db);
    });

    it("should pause a running pipeline", async () => {
      const result = await orchestrator.createPipeline({ name: "Pause Test" });
      await orchestrator.startPipeline(result.id);
      const paused = await orchestrator.pausePipeline(result.id);

      expect(paused.status).toBe(PIPELINE_STATUS.PAUSED);
    });

    it("should resume a paused pipeline", async () => {
      const result = await orchestrator.createPipeline({ name: "Resume Test" });
      await orchestrator.startPipeline(result.id);
      await orchestrator.pausePipeline(result.id);
      const resumed = await orchestrator.resumePipeline(result.id);

      expect([PIPELINE_STATUS.RUNNING, PIPELINE_STATUS.GATE_WAITING]).toContain(
        resumed.status,
      );
    });

    it("should throw if pipeline not found for pause", async () => {
      await expect(
        async () => orchestrator.pausePipeline("nonexistent"),
      ).rejects.toThrow();
    });

    it("should throw if pipeline not found for resume", async () => {
      await expect(
        async () => orchestrator.resumePipeline("nonexistent"),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // cancelPipeline
  // ─────────────────────────────────────────────────────────────────────────
  describe("cancelPipeline()", () => {
    beforeEach(async () => {
      await orchestrator.initialize(db);
    });

    it("should cancel a created pipeline", async () => {
      const result = await orchestrator.createPipeline({ name: "Cancel Test" });
      const cancelled = await orchestrator.cancelPipeline(result.id, "User requested");

      expect(cancelled.status).toBe(PIPELINE_STATUS.CANCELLED);
    });

    it("should cancel a running pipeline", async () => {
      const result = await orchestrator.createPipeline({ name: "Cancel Running" });
      await orchestrator.startPipeline(result.id);
      const cancelled = await orchestrator.cancelPipeline(result.id, "Timeout");

      expect(cancelled.status).toBe(PIPELINE_STATUS.CANCELLED);
    });

    it("should throw if pipeline not found", async () => {
      await expect(
        async () => orchestrator.cancelPipeline("nonexistent"),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // approveGate / rejectGate
  // ─────────────────────────────────────────────────────────────────────────
  describe("approveGate() / rejectGate()", () => {
    beforeEach(async () => {
      await orchestrator.initialize(db);
    });

    it("should throw for stage not in gate-waiting state", async () => {
      const result = await orchestrator.createPipeline({ name: "Gate Test" });

      await expect(
        async () => orchestrator.approveGate(result.id, "nonexistent-stage", {}),
      ).rejects.toThrow();
    });

    it("should throw for unknown pipeline id on rejectGate", async () => {
      await expect(
        async () => orchestrator.rejectGate("nonexistent", "stage-id", {}),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStatus / getAllPipelines
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStatus() / getAllPipelines()", () => {
    beforeEach(async () => {
      await orchestrator.initialize(db);
    });

    it("should retrieve pipeline status by id", async () => {
      const created = await orchestrator.createPipeline({ name: "Fetch Me" });
      const fetched = orchestrator.getStatus(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe("Fetch Me");
    });

    it("should throw for unknown id in getStatus", () => {
      expect(() => orchestrator.getStatus("nonexistent")).toThrow();
    });

    it("should return all pipelines", async () => {
      await orchestrator.createPipeline({ name: "Pipeline A" });
      await orchestrator.createPipeline({ name: "Pipeline B" });

      const all = orchestrator.getAllPipelines();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter getAllPipelines by status", async () => {
      const r1 = await orchestrator.createPipeline({ name: "Status Filter 1" });
      await orchestrator.createPipeline({ name: "Status Filter 2" });
      await orchestrator.cancelPipeline(r1.id, "test");

      const cancelled = orchestrator.getAllPipelines({ status: "cancelled" });
      expect(cancelled.every((p) => p.status === "cancelled")).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getTemplates
  // ─────────────────────────────────────────────────────────────────────────
  describe("getTemplates()", () => {
    beforeEach(async () => {
      await orchestrator.initialize(db);
    });

    it("should return all built-in templates", () => {
      const templates = orchestrator.getTemplates();

      const ids = templates.map((t) => t.id);
      expect(ids).toContain("feature");
      expect(ids).toContain("bugfix");
      expect(ids).toContain("refactor");
      expect(ids).toContain("security-audit");
    });

    it("feature template should have 7 stages", () => {
      const templates = orchestrator.getTemplates();
      const featureTpl = templates.find((t) => t.id === "feature");
      expect(featureTpl.stages).toHaveLength(STAGE_NAMES.length);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getArtifacts
  // ─────────────────────────────────────────────────────────────────────────
  describe("getArtifacts()", () => {
    beforeEach(async () => {
      await orchestrator.initialize(db);
    });

    it("should return empty array when no artifacts", async () => {
      const result = await orchestrator.createPipeline({ name: "Artifact Test" });
      db._prep.all.mockReturnValue([]);

      const artifacts = orchestrator.getArtifacts(result.id);
      expect(Array.isArray(artifacts)).toBe(true);
    });

    it("should return artifacts from DB", async () => {
      const result = await orchestrator.createPipeline({ name: "Artifact Test 2" });
      db._prep.all.mockReturnValue([
        {
          id: "art-001",
          pipeline_id: result.id,
          stage_id: "stage-001",
          artifact_type: "spec",
          content: "{}",
          file_path: null,
          metadata: "{}",
          created_at: "2025-01-01",
        },
      ]);

      const artifacts = orchestrator.getArtifacts(result.id);
      expect(artifacts.length).toBe(1);
      expect(artifacts[0].artifactType).toBe("spec");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getConfig / configure
  // ─────────────────────────────────────────────────────────────────────────
  describe("getConfig() / configure()", () => {
    beforeEach(async () => {
      await orchestrator.initialize(db);
    });

    it("should return current config", () => {
      const config = orchestrator.getConfig();
      expect(config).toHaveProperty("maxConcurrentPipelines");
      expect(config).toHaveProperty("defaultTimeout");
      expect(config).toHaveProperty("autoApproveConfidenceThreshold");
    });

    it("should update config fields", () => {
      orchestrator.configure({ maxConcurrentPipelines: 5 });
      const config = orchestrator.getConfig();
      expect(config.maxConcurrentPipelines).toBe(5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getAllPipelines as stats substitute
  // ─────────────────────────────────────────────────────────────────────────
  describe("getAllPipelines() counts", () => {
    beforeEach(async () => {
      await orchestrator.initialize(db);
    });

    it("should count all pipelines via getAllPipelines", async () => {
      await orchestrator.createPipeline({ name: "Stats Pipeline 1" });
      await orchestrator.createPipeline({ name: "Stats Pipeline 2" });

      const all = orchestrator.getAllPipelines();
      expect(all.length).toBeGreaterThanOrEqual(2);
      // Check that status field exists on each entry
      all.forEach((p) => expect(p.status).toBeTruthy());
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("Constants", () => {
    it("PIPELINE_STATUS should have all expected values", () => {
      expect(PIPELINE_STATUS.CREATED).toBe("created");
      expect(PIPELINE_STATUS.RUNNING).toBe("running");
      expect(PIPELINE_STATUS.PAUSED).toBe("paused");
      expect(PIPELINE_STATUS.COMPLETED).toBe("completed");
      expect(PIPELINE_STATUS.FAILED).toBe("failed");
      expect(PIPELINE_STATUS.CANCELLED).toBe("cancelled");
    });

    it("STAGE_NAMES should have 7 stages", () => {
      expect(STAGE_NAMES).toHaveLength(7);
      expect(STAGE_NAMES).toContain("requirement-parsing");
      expect(STAGE_NAMES).toContain("deploy");
      expect(STAGE_NAMES).toContain("monitoring");
    });

    it("ARTIFACT_TYPES should have expected types", () => {
      expect(ARTIFACT_TYPES).toContain("spec");
      expect(ARTIFACT_TYPES).toContain("code");
      expect(ARTIFACT_TYPES).toContain("deploy-log");
    });

    it("PIPELINE_TEMPLATES should have 4 templates", () => {
      const keys = Object.keys(PIPELINE_TEMPLATES);
      expect(keys).toContain("feature");
      expect(keys).toContain("bugfix");
      expect(keys).toContain("refactor");
      expect(keys).toContain("security-audit");
    });
  });
});
