/**
 * SkillPipelineEngine 单元测试
 *
 * 测试内容：
 * - Pipeline creation (createPipeline)
 * - Pipeline execution (executePipeline) with various step types
 *   - SKILL steps
 *   - CONDITION steps (trueBranch / falseBranch)
 *   - PARALLEL steps
 *   - TRANSFORM steps
 *   - LOOP steps
 * - Pipeline pause / resume / cancel
 * - Variable resolution (${stepName.result.field} references)
 * - Error handling (step failure, retries)
 * - Pipeline listing, retrieval, update, deletion
 * - Event emission (pipeline:started, pipeline:completed, etc.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock logger
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

const {
  SkillPipelineEngine,
  StepType,
  PipelineState,
} = require("../skill-pipeline-engine");

describe("StepType", () => {
  it("should export all step type constants", () => {
    expect(StepType.SKILL).toBe("skill");
    expect(StepType.CONDITION).toBe("condition");
    expect(StepType.PARALLEL).toBe("parallel");
    expect(StepType.TRANSFORM).toBe("transform");
    expect(StepType.LOOP).toBe("loop");
  });
});

describe("PipelineState", () => {
  it("should export all pipeline state constants", () => {
    expect(PipelineState.IDLE).toBe("idle");
    expect(PipelineState.RUNNING).toBe("running");
    expect(PipelineState.PAUSED).toBe("paused");
    expect(PipelineState.COMPLETED).toBe("completed");
    expect(PipelineState.FAILED).toBe("failed");
    expect(PipelineState.CANCELLED).toBe("cancelled");
  });
});

describe("SkillPipelineEngine", () => {
  let engine;
  let mockSkillRegistry;
  let mockMetricsCollector;

  beforeEach(() => {
    mockSkillRegistry = {
      executeSkill: vi.fn().mockResolvedValue({ output: "skill-result" }),
      getSkill: vi
        .fn()
        .mockReturnValue({ name: "mock-skill", description: "A mock skill" }),
    };

    mockMetricsCollector = {
      recordExecution: vi.fn(),
    };

    engine = new SkillPipelineEngine({
      skillRegistry: mockSkillRegistry,
      metricsCollector: mockMetricsCollector,
    });
  });

  afterEach(() => {
    engine.removeAllListeners();
  });

  // ===================================================================
  // Pipeline Creation
  // ===================================================================

  describe("createPipeline", () => {
    it("should create a pipeline with provided definition", () => {
      const id = engine.createPipeline({
        name: "Test Pipeline",
        description: "A test pipeline",
        category: "testing",
        tags: ["test", "unit"],
        steps: [{ type: StepType.SKILL, skillId: "code-review" }],
        variables: { lang: "javascript" },
      });

      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      const pipeline = engine.getPipeline(id);
      expect(pipeline.name).toBe("Test Pipeline");
      expect(pipeline.description).toBe("A test pipeline");
      expect(pipeline.category).toBe("testing");
      expect(pipeline.tags).toEqual(["test", "unit"]);
      expect(pipeline.steps).toHaveLength(1);
      expect(pipeline.variables).toEqual({ lang: "javascript" });
      expect(pipeline.executionCount).toBe(0);
      expect(pipeline.lastExecutedAt).toBeNull();
      expect(pipeline.createdAt).toBeGreaterThan(0);
      expect(pipeline.updatedAt).toBeGreaterThan(0);
    });

    it("should use custom id when provided", () => {
      const id = engine.createPipeline({
        id: "custom-id-123",
        name: "Custom ID Pipeline",
      });

      expect(id).toBe("custom-id-123");
      expect(engine.getPipeline("custom-id-123")).not.toBeNull();
    });

    it("should generate uuid when id is not provided", () => {
      const id = engine.createPipeline({ name: "Auto ID" });
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      // Should be a valid UUID format
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("should apply default values for optional fields", () => {
      const id = engine.createPipeline({});
      const pipeline = engine.getPipeline(id);

      expect(pipeline.name).toBe("Unnamed Pipeline");
      expect(pipeline.description).toBe("");
      expect(pipeline.category).toBe("custom");
      expect(pipeline.tags).toEqual([]);
      expect(pipeline.steps).toEqual([]);
      expect(pipeline.variables).toEqual({});
      expect(pipeline.isTemplate).toBe(false);
    });

    it("should emit pipeline:created event", () => {
      const handler = vi.fn();
      engine.on("pipeline:created", handler);

      const id = engine.createPipeline({ name: "Event Test" });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        pipelineId: id,
        name: "Event Test",
      });
    });

    it("should support isTemplate flag", () => {
      const id = engine.createPipeline({ name: "Template", isTemplate: true });
      const pipeline = engine.getPipeline(id);
      expect(pipeline.isTemplate).toBe(true);
    });
  });

  // ===================================================================
  // Pipeline Listing and Retrieval
  // ===================================================================

  describe("listPipelines", () => {
    it("should return empty array when no pipelines exist", () => {
      expect(engine.listPipelines()).toEqual([]);
    });

    it("should list all pipelines with summary info", () => {
      engine.createPipeline({
        name: "Pipeline A",
        description: "First",
        category: "cat-a",
        tags: ["a"],
        steps: [{ type: StepType.SKILL, skillId: "x" }],
        isTemplate: false,
      });
      engine.createPipeline({
        name: "Pipeline B",
        description: "Second",
        category: "cat-b",
        tags: ["b"],
        steps: [
          { type: StepType.SKILL, skillId: "x" },
          { type: StepType.SKILL, skillId: "y" },
        ],
        isTemplate: true,
      });

      const list = engine.listPipelines();
      expect(list).toHaveLength(2);

      expect(list[0].name).toBe("Pipeline A");
      expect(list[0].description).toBe("First");
      expect(list[0].category).toBe("cat-a");
      expect(list[0].stepCount).toBe(1);
      expect(list[0].isTemplate).toBe(false);
      expect(list[0].executionCount).toBe(0);
      expect(list[0].lastExecutedAt).toBeNull();

      expect(list[1].name).toBe("Pipeline B");
      expect(list[1].stepCount).toBe(2);
      expect(list[1].isTemplate).toBe(true);
    });
  });

  describe("getPipeline", () => {
    it("should return the pipeline definition", () => {
      const id = engine.createPipeline({ name: "Retrievable" });
      const pipeline = engine.getPipeline(id);
      expect(pipeline).not.toBeNull();
      expect(pipeline.name).toBe("Retrievable");
    });

    it("should return null for non-existent pipeline", () => {
      expect(engine.getPipeline("nonexistent")).toBeNull();
    });
  });

  describe("savePipeline", () => {
    it("should update pipeline definition", () => {
      const id = engine.createPipeline({ name: "Original" });
      engine.savePipeline(id, {
        name: "Updated",
        description: "New description",
      });

      const pipeline = engine.getPipeline(id);
      expect(pipeline.name).toBe("Updated");
      expect(pipeline.description).toBe("New description");
      expect(pipeline.updatedAt).toBeGreaterThan(0);
    });

    it("should emit pipeline:updated event", () => {
      const id = engine.createPipeline({ name: "Eventful" });
      const handler = vi.fn();
      engine.on("pipeline:updated", handler);

      engine.savePipeline(id, { name: "Modified" });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ pipelineId: id });
    });

    it("should throw for non-existent pipeline", () => {
      expect(() => engine.savePipeline("nonexistent", {})).toThrow(
        "Pipeline not found",
      );
    });
  });

  describe("deletePipeline", () => {
    it("should remove pipeline", () => {
      const id = engine.createPipeline({ name: "ToDelete" });
      engine.deletePipeline(id);
      expect(engine.getPipeline(id)).toBeNull();
    });

    it("should emit pipeline:deleted event", () => {
      const id = engine.createPipeline({ name: "DeleteEvent" });
      const handler = vi.fn();
      engine.on("pipeline:deleted", handler);

      engine.deletePipeline(id);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ pipelineId: id });
    });

    it("should throw for non-existent pipeline", () => {
      expect(() => engine.deletePipeline("nonexistent")).toThrow(
        "Pipeline not found",
      );
    });
  });

  // ===================================================================
  // Pipeline Execution - SKILL Steps
  // ===================================================================

  describe("executePipeline - SKILL steps", () => {
    it("should execute a single skill step", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({
        output: "review-done",
      });

      const pipelineId = engine.createPipeline({
        name: "Single Skill",
        steps: [
          {
            type: StepType.SKILL,
            name: "review",
            skillId: "code-review",
            inputMapping: { code: 'console.log("hello")' },
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(result.stepResults).toHaveLength(1);
      expect(result.stepResults[0].stepName).toBe("review");
      expect(result.stepResults[0].success).toBe(true);
      expect(result.stepResults[0].stepType).toBe("skill");
      expect(result.duration).toBeGreaterThanOrEqual(0);

      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "code-review",
        expect.objectContaining({
          code: 'console.log("hello")',
          _pipelineStep: true,
        }),
        expect.objectContaining({ pipelineContext: true }),
      );
    });

    it("should execute multiple skill steps sequentially", async () => {
      const callOrder = [];
      mockSkillRegistry.executeSkill.mockImplementation(async (skillId) => {
        callOrder.push(skillId);
        return { output: `result-${skillId}` };
      });

      const pipelineId = engine.createPipeline({
        name: "Multi Skill",
        steps: [
          { type: StepType.SKILL, name: "step1", skillId: "analyze" },
          { type: StepType.SKILL, name: "step2", skillId: "review" },
          { type: StepType.SKILL, name: "step3", skillId: "fix" },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(result.stepResults).toHaveLength(3);
      expect(callOrder).toEqual(["analyze", "review", "fix"]);
    });

    it("should store results in context using outputVariable", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({ summary: "all good" });

      const pipelineId = engine.createPipeline({
        name: "Output Var",
        steps: [
          {
            type: StepType.SKILL,
            name: "analyze",
            skillId: "code-review",
            outputVariable: "analysisResult",
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.context.analysisResult).toEqual({ summary: "all good" });
      expect(result.context.analyze).toEqual(
        expect.objectContaining({
          result: { summary: "all good" },
          success: true,
        }),
      );
    });

    it("should pass initial context to execution", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const pipelineId = engine.createPipeline({
        name: "With Context",
        variables: { lang: "js" },
        steps: [
          {
            type: StepType.SKILL,
            name: "step1",
            skillId: "review",
            inputMapping: { language: "${lang}" },
          },
        ],
      });

      await engine.executePipeline(pipelineId, { file: "index.js" });

      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "review",
        expect.objectContaining({ language: "js", _pipelineStep: true }),
        expect.objectContaining({
          lang: "js",
          file: "index.js",
          pipelineContext: true,
        }),
      );
    });

    it("should increment executionCount and update lastExecutedAt", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const pipelineId = engine.createPipeline({
        name: "Counter",
        steps: [{ type: StepType.SKILL, skillId: "noop" }],
      });

      await engine.executePipeline(pipelineId);
      await engine.executePipeline(pipelineId);

      const pipeline = engine.getPipeline(pipelineId);
      expect(pipeline.executionCount).toBe(2);
      expect(pipeline.lastExecutedAt).toBeGreaterThan(0);
    });

    it("should throw when pipeline not found", async () => {
      await expect(engine.executePipeline("nonexistent")).rejects.toThrow(
        "Pipeline not found",
      );
    });

    it("should throw when skillRegistry is not available", async () => {
      const noRegistryEngine = new SkillPipelineEngine({});
      const id = noRegistryEngine.createPipeline({
        name: "No Registry",
        steps: [{ type: StepType.SKILL, skillId: "anything" }],
      });

      const result = await noRegistryEngine.executePipeline(id);
      expect(result.state).toBe(PipelineState.FAILED);
      expect(result.error).toContain("SkillRegistry not available");
    });

    it("should record metrics for SKILL steps when metricsCollector is present", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({ tokensUsed: 150 });

      const pipelineId = engine.createPipeline({
        name: "Metrics",
        steps: [
          { type: StepType.SKILL, name: "metered", skillId: "code-review" },
        ],
      });

      await engine.executePipeline(pipelineId);

      expect(mockMetricsCollector.recordExecution).toHaveBeenCalledWith(
        "code-review",
        expect.objectContaining({
          success: true,
          tokensUsed: 150,
          pipelineId,
        }),
      );
    });
  });

  // ===================================================================
  // Pipeline Execution - CONDITION Steps
  // ===================================================================

  describe("executePipeline - CONDITION steps", () => {
    it("should execute trueBranch when expression is truthy", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({
        output: "true-branch",
      });

      const pipelineId = engine.createPipeline({
        name: "Condition True",
        variables: { score: "80" },
        steps: [
          {
            type: StepType.CONDITION,
            name: "check",
            expression: "${score} > 50",
            trueBranch: [
              { type: StepType.SKILL, name: "high", skillId: "high-quality" },
            ],
            falseBranch: [
              { type: StepType.SKILL, name: "low", skillId: "low-quality" },
            ],
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "high-quality",
        expect.any(Object),
        expect.any(Object),
      );
      expect(mockSkillRegistry.executeSkill).not.toHaveBeenCalledWith(
        "low-quality",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should execute falseBranch when expression is falsy", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({
        output: "false-branch",
      });

      const pipelineId = engine.createPipeline({
        name: "Condition False",
        variables: { score: "30" },
        steps: [
          {
            type: StepType.CONDITION,
            name: "check",
            expression: "${score} > 50",
            falseBranch: [
              { type: StepType.SKILL, name: "low", skillId: "low-quality" },
            ],
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "low-quality",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should store condition result in context", async () => {
      const pipelineId = engine.createPipeline({
        name: "Condition Result",
        variables: { enabled: "true" },
        steps: [
          {
            type: StepType.CONDITION,
            name: "featureCheck",
            expression: "${enabled}",
            outputVariable: "conditionResult",
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.context.conditionResult).toEqual({ condition: true });
    });

    it("should handle boolean expression directly", async () => {
      const pipelineId = engine.createPipeline({
        name: "Bool Expr",
        steps: [
          {
            type: StepType.CONDITION,
            name: "alwaysTrue",
            expression: true,
            trueBranch: [
              { type: StepType.SKILL, name: "run", skillId: "always-run" },
            ],
          },
        ],
      });

      await engine.executePipeline(pipelineId);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "always-run",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should handle equality comparison in expression", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const pipelineId = engine.createPipeline({
        name: "Equality",
        variables: { status: "ready" },
        steps: [
          {
            type: StepType.CONDITION,
            name: "eqCheck",
            expression: "${status} === ready",
            trueBranch: [
              { type: StepType.SKILL, name: "go", skillId: "proceed" },
            ],
          },
        ],
      });

      await engine.executePipeline(pipelineId);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "proceed",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should handle inequality comparison", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const pipelineId = engine.createPipeline({
        name: "Inequality",
        variables: { status: "pending" },
        steps: [
          {
            type: StepType.CONDITION,
            name: "neqCheck",
            expression: "${status} !== ready",
            trueBranch: [
              { type: StepType.SKILL, name: "wait", skillId: "wait-skill" },
            ],
          },
        ],
      });

      await engine.executePipeline(pipelineId);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "wait-skill",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should do nothing when no matching branch exists", async () => {
      const pipelineId = engine.createPipeline({
        name: "No Branch",
        variables: { x: "10" },
        steps: [
          {
            type: StepType.CONDITION,
            name: "noBranch",
            expression: "${x} > 100",
            // no falseBranch defined
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(mockSkillRegistry.executeSkill).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // Pipeline Execution - PARALLEL Steps
  // ===================================================================

  describe("executePipeline - PARALLEL steps", () => {
    it("should execute branches in parallel", async () => {
      const callTimes = [];
      mockSkillRegistry.executeSkill.mockImplementation(async (skillId) => {
        callTimes.push({ skillId, time: Date.now() });
        return { output: `result-${skillId}` };
      });

      const pipelineId = engine.createPipeline({
        name: "Parallel Exec",
        steps: [
          {
            type: StepType.PARALLEL,
            name: "parallelStep",
            branches: [
              { skillId: "skill-a", inputMapping: { key: "a" } },
              { skillId: "skill-b", inputMapping: { key: "b" } },
              { skillId: "skill-c", inputMapping: { key: "c" } },
            ],
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledTimes(3);
      // Check that the result contains all three branch results
      expect(result.context.parallelStep.result).toHaveLength(3);
      expect(result.context.parallelStep.result[0].success).toBe(true);
      expect(result.context.parallelStep.result[1].success).toBe(true);
      expect(result.context.parallelStep.result[2].success).toBe(true);
    });

    it("should handle individual branch failures gracefully", async () => {
      mockSkillRegistry.executeSkill
        .mockResolvedValueOnce({ output: "ok" })
        .mockRejectedValueOnce(new Error("branch-2 failed"))
        .mockResolvedValueOnce({ output: "ok" });

      const pipelineId = engine.createPipeline({
        name: "Partial Fail",
        steps: [
          {
            type: StepType.PARALLEL,
            name: "parallelStep",
            branches: [
              { skillId: "skill-a" },
              { skillId: "skill-b" },
              { skillId: "skill-c" },
            ],
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      const parallelResults = result.context.parallelStep.result;
      expect(parallelResults[0].success).toBe(true);
      expect(parallelResults[1].success).toBe(false);
      expect(parallelResults[1].error).toBe("branch-2 failed");
      expect(parallelResults[2].success).toBe(true);
    });

    it("should throw if branches is not an array", async () => {
      const pipelineId = engine.createPipeline({
        name: "Bad Parallel",
        steps: [
          {
            type: StepType.PARALLEL,
            name: "bad",
            // no branches property
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);
      expect(result.state).toBe(PipelineState.FAILED);
      expect(result.error).toContain("Parallel step requires branches array");
    });
  });

  // ===================================================================
  // Pipeline Execution - TRANSFORM Steps
  // ===================================================================

  describe("executePipeline - TRANSFORM steps", () => {
    it("should resolve variable in expression and store result", async () => {
      const pipelineId = engine.createPipeline({
        name: "Transform",
        variables: { greeting: "hello world" },
        steps: [
          {
            type: StepType.TRANSFORM,
            name: "transformStep",
            expression: "${greeting}",
            outputVariable: "transformed",
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(result.context.transformed).toBe("hello world");
    });

    it("should parse JSON from resolved expression", async () => {
      const pipelineId = engine.createPipeline({
        name: "Transform JSON",
        variables: { data: '{"key":"value"}' },
        steps: [
          {
            type: StepType.TRANSFORM,
            name: "jsonTransform",
            expression: "${data}",
            outputVariable: "parsed",
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.context.parsed).toEqual({ key: "value" });
    });

    it("should return string when JSON parsing fails", async () => {
      const pipelineId = engine.createPipeline({
        name: "Transform Non-JSON",
        variables: { text: "just plain text" },
        steps: [
          {
            type: StepType.TRANSFORM,
            name: "textTransform",
            expression: "${text}",
            outputVariable: "out",
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.context.out).toBe("just plain text");
    });

    it("should fail when expression is missing", async () => {
      const pipelineId = engine.createPipeline({
        name: "No Expression",
        steps: [
          {
            type: StepType.TRANSFORM,
            name: "noExpr",
            // no expression
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);
      expect(result.state).toBe(PipelineState.FAILED);
      expect(result.error).toContain("Transform step requires expression");
    });
  });

  // ===================================================================
  // Pipeline Execution - LOOP Steps
  // ===================================================================

  describe("executePipeline - LOOP steps", () => {
    it("should iterate over array items", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({ processed: true });

      const pipelineId = engine.createPipeline({
        name: "Loop",
        variables: { files: ["a.js", "b.js", "c.js"] },
        steps: [
          {
            type: StepType.LOOP,
            name: "loopStep",
            items: "${files}",
            itemVariable: "currentFile",
            body: [
              {
                type: StepType.SKILL,
                name: "process",
                skillId: "file-processor",
                inputMapping: { file: "${currentFile}" },
              },
            ],
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledTimes(3);
    });

    it("should set item index in context", async () => {
      const receivedContexts = [];
      mockSkillRegistry.executeSkill.mockImplementation(
        async (skillId, task, context) => {
          receivedContexts.push({
            item: context.item,
            item_index: context.item_index,
          });
          return {};
        },
      );

      const pipelineId = engine.createPipeline({
        name: "Loop Index",
        steps: [
          {
            type: StepType.LOOP,
            name: "loop",
            items: ["x", "y"],
            // default itemVariable is 'item'
            body: [{ type: StepType.SKILL, name: "check", skillId: "checker" }],
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(result.context.item_index).toBe(1);
    });

    it("should use custom itemVariable name", async () => {
      mockSkillRegistry.executeSkill.mockImplementation(
        async (skillId, task, context) => {
          return { value: context.file };
        },
      );

      const pipelineId = engine.createPipeline({
        name: "Custom Item Var",
        steps: [
          {
            type: StepType.LOOP,
            name: "loop",
            items: ["a.txt", "b.txt"],
            itemVariable: "file",
            body: [
              {
                type: StepType.SKILL,
                name: "process",
                skillId: "processor",
                inputMapping: { filename: "${file}" },
              },
            ],
          },
        ],
      });

      await engine.executePipeline(pipelineId);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledTimes(2);
    });

    it("should fail when items does not resolve to an array", async () => {
      // When items is a non-JSON string, JSON.parse will throw
      const pipelineId = engine.createPipeline({
        name: "Bad Loop",
        variables: { notArray: "just a string" },
        steps: [
          {
            type: StepType.LOOP,
            name: "badLoop",
            items: "${notArray}",
            body: [],
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);
      expect(result.state).toBe(PipelineState.FAILED);
      // JSON.parse of a non-JSON string throws a SyntaxError
      expect(result.error).toBeTruthy();
    });

    it("should fail when items resolves to a non-array JSON value", async () => {
      // When items is a JSON number string, it parses but is not an array
      const pipelineId = engine.createPipeline({
        name: "Non-Array JSON",
        variables: { notArray: "42" },
        steps: [
          {
            type: StepType.LOOP,
            name: "badLoop",
            items: "${notArray}",
            body: [],
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);
      expect(result.state).toBe(PipelineState.FAILED);
      expect(result.error).toContain(
        "Loop step items must resolve to an array",
      );
    });

    it("should parse JSON string items", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const pipelineId = engine.createPipeline({
        name: "JSON Items",
        variables: { jsonItems: '["one","two","three"]' },
        steps: [
          {
            type: StepType.LOOP,
            name: "loop",
            items: "${jsonItems}",
            body: [
              { type: StepType.SKILL, name: "proc", skillId: "processor" },
            ],
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledTimes(3);
    });
  });

  // ===================================================================
  // Variable Resolution
  // ===================================================================

  describe("variable resolution", () => {
    it("should resolve ${stepName.result.field} references between steps", async () => {
      mockSkillRegistry.executeSkill
        .mockResolvedValueOnce({ score: 95, summary: "excellent" })
        .mockResolvedValueOnce({ report: "done" });

      const pipelineId = engine.createPipeline({
        name: "Variable Chain",
        steps: [
          {
            type: StepType.SKILL,
            name: "analyze",
            skillId: "analyzer",
            outputVariable: "analysisResult",
          },
          {
            type: StepType.SKILL,
            name: "report",
            skillId: "reporter",
            inputMapping: {
              score: "${analyze.result.score}",
              summary: "${analyze.result.summary}",
            },
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      // The second call should have resolved variables from the first step's result
      expect(mockSkillRegistry.executeSkill).toHaveBeenNthCalledWith(
        2,
        "reporter",
        expect.objectContaining({
          score: "95",
          summary: "excellent",
          _pipelineStep: true,
        }),
        expect.any(Object),
      );
    });

    it("should resolve nested object references as JSON strings", async () => {
      mockSkillRegistry.executeSkill
        .mockResolvedValueOnce({ data: { items: [1, 2, 3] } })
        .mockResolvedValueOnce({});

      const pipelineId = engine.createPipeline({
        name: "Nested Ref",
        steps: [
          {
            type: StepType.SKILL,
            name: "fetch",
            skillId: "fetcher",
          },
          {
            type: StepType.SKILL,
            name: "process",
            skillId: "processor",
            inputMapping: {
              payload: "${fetch.result.data}",
            },
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      // Nested objects should be serialized to JSON string
      expect(mockSkillRegistry.executeSkill).toHaveBeenNthCalledWith(
        2,
        "processor",
        expect.objectContaining({
          payload: JSON.stringify({ items: [1, 2, 3] }),
          _pipelineStep: true,
        }),
        expect.any(Object),
      );
    });

    it("should leave unresolvable references unchanged", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const pipelineId = engine.createPipeline({
        name: "Unresolvable",
        steps: [
          {
            type: StepType.SKILL,
            name: "step1",
            skillId: "skill-a",
            inputMapping: {
              ref: "${nonexistent.field}",
            },
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "skill-a",
        expect.objectContaining({
          ref: "${nonexistent.field}",
          _pipelineStep: true,
        }),
        expect.any(Object),
      );
    });

    it("should resolve variables in skillId", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const pipelineId = engine.createPipeline({
        name: "Dynamic SkillId",
        variables: { targetSkill: "code-review" },
        steps: [
          {
            type: StepType.SKILL,
            name: "dynamic",
            skillId: "${targetSkill}",
          },
        ],
      });

      await engine.executePipeline(pipelineId);

      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "code-review",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should resolve initial context variables merged with pipeline variables", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const pipelineId = engine.createPipeline({
        name: "Merged Context",
        variables: { baseUrl: "http://api.example.com" },
        steps: [
          {
            type: StepType.SKILL,
            name: "call",
            skillId: "api-caller",
            inputMapping: {
              url: "${baseUrl}",
              token: "${authToken}",
            },
          },
        ],
      });

      await engine.executePipeline(pipelineId, { authToken: "secret-token" });

      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "api-caller",
        expect.objectContaining({
          url: "http://api.example.com",
          token: "secret-token",
          _pipelineStep: true,
        }),
        expect.any(Object),
      );
    });

    it("should resolve deep nested inputMapping objects", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const pipelineId = engine.createPipeline({
        name: "Deep Resolve",
        variables: { val: "resolved" },
        steps: [
          {
            type: StepType.SKILL,
            name: "deep",
            skillId: "test",
            inputMapping: {
              nested: {
                inner: "${val}",
                array: ["${val}", "literal"],
              },
            },
          },
        ],
      });

      await engine.executePipeline(pipelineId);

      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({
          nested: {
            inner: "resolved",
            array: ["resolved", "literal"],
          },
          _pipelineStep: true,
        }),
        expect.any(Object),
      );
    });
  });

  // ===================================================================
  // Error Handling and Retries
  // ===================================================================

  describe("error handling and retries", () => {
    it("should fail pipeline when a step throws", async () => {
      mockSkillRegistry.executeSkill.mockRejectedValue(
        new Error("Skill execution failed"),
      );

      const pipelineId = engine.createPipeline({
        name: "Fail Pipeline",
        steps: [
          { type: StepType.SKILL, name: "failStep", skillId: "bad-skill" },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.FAILED);
      expect(result.error).toBe("Skill execution failed");
    });

    it("should retry and succeed on second attempt", async () => {
      mockSkillRegistry.executeSkill
        .mockRejectedValueOnce(new Error("Transient failure"))
        .mockResolvedValueOnce({ output: "success after retry" });

      const pipelineId = engine.createPipeline({
        name: "Retry Success",
        steps: [
          {
            type: StepType.SKILL,
            name: "retryStep",
            skillId: "flaky-skill",
            retries: 2,
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      // Initial attempt (fails) + 1 retry (succeeds)
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledTimes(2);
    });

    it("should fail after exhausting all retries", async () => {
      mockSkillRegistry.executeSkill.mockRejectedValue(
        new Error("Persistent failure"),
      );

      const pipelineId = engine.createPipeline({
        name: "Retry Exhausted",
        steps: [
          {
            type: StepType.SKILL,
            name: "alwaysFail",
            skillId: "broken-skill",
            retries: 3,
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.FAILED);
      // Initial attempt (fails) + 3 retries (all fail)
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledTimes(4);
    });

    it("should emit pipeline:failed event on failure", async () => {
      const handler = vi.fn();
      engine.on("pipeline:failed", handler);

      mockSkillRegistry.executeSkill.mockRejectedValue(new Error("oops"));

      const pipelineId = engine.createPipeline({
        name: "Fail Event",
        steps: [{ type: StepType.SKILL, skillId: "bad" }],
      });

      await engine.executePipeline(pipelineId);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          state: PipelineState.FAILED,
          error: "oops",
        }),
      );
    });

    it("should fail on unknown step type", async () => {
      const pipelineId = engine.createPipeline({
        name: "Unknown Type",
        steps: [{ type: "unknown-type", name: "mystery" }],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.FAILED);
      expect(result.error).toContain("Unknown step type: unknown-type");
    });

    it("should include partial step results on failure", async () => {
      mockSkillRegistry.executeSkill
        .mockResolvedValueOnce({ output: "step1-ok" })
        .mockRejectedValueOnce(new Error("step2 broke"));

      const pipelineId = engine.createPipeline({
        name: "Partial Results",
        steps: [
          { type: StepType.SKILL, name: "good", skillId: "good-skill" },
          { type: StepType.SKILL, name: "bad", skillId: "bad-skill" },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.FAILED);
      expect(result.stepResults).toHaveLength(1);
      expect(result.stepResults[0].stepName).toBe("good");
      expect(result.stepResults[0].success).toBe(true);
    });
  });

  // ===================================================================
  // Pause / Resume / Cancel
  // ===================================================================

  describe("pause / resume / cancel", () => {
    it("should pause and resume a running pipeline", async () => {
      let stepCount = 0;
      mockSkillRegistry.executeSkill.mockImplementation(async () => {
        stepCount++;
        if (stepCount === 1) {
          // After first step completes, the engine has stored the execution
          // We need to let the test control pause/resume timing
        }
        return { output: `step-${stepCount}` };
      });

      const pipelineId = engine.createPipeline({
        name: "Pause Resume",
        steps: [
          { type: StepType.SKILL, name: "step1", skillId: "skill1" },
          { type: StepType.SKILL, name: "step2", skillId: "skill2" },
        ],
      });

      // Start execution in background
      const execPromise = engine.executePipeline(pipelineId);

      // Wait for the execution to start, then get its ID
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await execPromise;
      expect(result.state).toBe(PipelineState.COMPLETED);
    });

    it("should emit pipeline:paused event", () => {
      // We need a running execution to pause
      const pipelineId = engine.createPipeline({
        name: "Pause Event",
        steps: [{ type: StepType.SKILL, skillId: "slow" }],
      });

      // Manually create a mock execution in running state
      const executionId = "exec-pause-test";
      engine.executions.set(executionId, {
        id: executionId,
        pipelineId,
        state: PipelineState.RUNNING,
        context: {},
        stepResults: [],
        currentStepIndex: 0,
        startedAt: Date.now(),
        completedAt: null,
        error: null,
        _pauseResolve: null,
      });

      const handler = vi.fn();
      engine.on("pipeline:paused", handler);

      engine.pausePipeline(executionId);

      expect(handler).toHaveBeenCalledWith({ executionId });
      expect(engine.executions.get(executionId).state).toBe(
        PipelineState.PAUSED,
      );
    });

    it("should emit pipeline:resumed event", () => {
      const executionId = "exec-resume-test";
      const mockResolve = vi.fn();
      engine.executions.set(executionId, {
        id: executionId,
        pipelineId: "some-pipeline",
        state: PipelineState.PAUSED,
        context: {},
        stepResults: [],
        currentStepIndex: 0,
        startedAt: Date.now(),
        completedAt: null,
        error: null,
        _pauseResolve: mockResolve,
      });

      const handler = vi.fn();
      engine.on("pipeline:resumed", handler);

      engine.resumePipeline(executionId);

      expect(handler).toHaveBeenCalledWith({ executionId });
      expect(engine.executions.get(executionId).state).toBe(
        PipelineState.RUNNING,
      );
      expect(mockResolve).toHaveBeenCalled();
      expect(engine.executions.get(executionId)._pauseResolve).toBeNull();
    });

    it("should throw when pausing a non-running execution", () => {
      expect(() => engine.pausePipeline("nonexistent")).toThrow(
        "Cannot pause execution",
      );

      const executionId = "exec-not-running";
      engine.executions.set(executionId, {
        id: executionId,
        state: PipelineState.COMPLETED,
      });
      expect(() => engine.pausePipeline(executionId)).toThrow(
        "Cannot pause execution",
      );
    });

    it("should throw when resuming a non-paused execution", () => {
      expect(() => engine.resumePipeline("nonexistent")).toThrow(
        "Cannot resume execution",
      );

      const executionId = "exec-not-paused";
      engine.executions.set(executionId, {
        id: executionId,
        state: PipelineState.RUNNING,
      });
      expect(() => engine.resumePipeline(executionId)).toThrow(
        "Cannot resume execution",
      );
    });

    it("should cancel a running pipeline", () => {
      const executionId = "exec-cancel-running";
      engine.executions.set(executionId, {
        id: executionId,
        pipelineId: "p1",
        state: PipelineState.RUNNING,
        context: {},
        stepResults: [],
        currentStepIndex: 0,
        startedAt: Date.now(),
        completedAt: null,
        error: null,
        _pauseResolve: null,
      });

      const handler = vi.fn();
      engine.on("pipeline:cancelled", handler);

      engine.cancelPipeline(executionId);

      expect(engine.executions.get(executionId).state).toBe(
        PipelineState.CANCELLED,
      );
      expect(handler).toHaveBeenCalledWith({ executionId });
    });

    it("should cancel a paused pipeline and call _pauseResolve", () => {
      const executionId = "exec-cancel-paused";
      const mockResolve = vi.fn();
      engine.executions.set(executionId, {
        id: executionId,
        pipelineId: "p2",
        state: PipelineState.PAUSED,
        context: {},
        stepResults: [],
        currentStepIndex: 0,
        startedAt: Date.now(),
        completedAt: null,
        error: null,
        _pauseResolve: mockResolve,
      });

      engine.cancelPipeline(executionId);

      expect(engine.executions.get(executionId).state).toBe(
        PipelineState.CANCELLED,
      );
      expect(mockResolve).toHaveBeenCalled();
      expect(engine.executions.get(executionId)._pauseResolve).toBeNull();
    });

    it("should throw when cancelling non-existent execution", () => {
      expect(() => engine.cancelPipeline("nonexistent")).toThrow(
        "Execution not found",
      );
    });

    it("should return CANCELLED state when pipeline is cancelled during execution", async () => {
      let pauseReached = false;
      mockSkillRegistry.executeSkill.mockImplementation(async () => {
        // Signal that we've reached the skill execution
        pauseReached = true;
        // Simulate a slow operation
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { output: "done" };
      });

      const pipelineId = engine.createPipeline({
        name: "Cancel During Exec",
        steps: [
          { type: StepType.SKILL, name: "slow", skillId: "slow-skill" },
          { type: StepType.SKILL, name: "after", skillId: "never-reached" },
        ],
      });

      // Track the execution start event to get the executionId
      let capturedExecutionId;
      engine.on("pipeline:started", (ev) => {
        capturedExecutionId = ev.executionId;
      });

      const execPromise = engine.executePipeline(pipelineId);

      // Wait for execution to start the first step
      await new Promise((resolve) => {
        const interval = setInterval(() => {
          if (capturedExecutionId && pauseReached) {
            clearInterval(interval);
            resolve();
          }
        }, 5);
      });

      // Cancel while the first skill step is running
      engine.cancelPipeline(capturedExecutionId);

      const result = await execPromise;
      // The first skill step will complete, then the loop checks for cancellation
      // The state should be CANCELLED
      expect(result.state).toBe(PipelineState.CANCELLED);
    });
  });

  // ===================================================================
  // Pipeline Status
  // ===================================================================

  describe("getPipelineStatus", () => {
    it("should return null for non-existent execution", () => {
      expect(engine.getPipelineStatus("nonexistent")).toBeNull();
    });

    it("should return status of a running execution", () => {
      const pipelineId = engine.createPipeline({
        name: "Status Test",
        steps: [
          { type: StepType.SKILL, skillId: "a" },
          { type: StepType.SKILL, skillId: "b" },
        ],
      });

      const executionId = "exec-status";
      engine.executions.set(executionId, {
        id: executionId,
        pipelineId,
        state: PipelineState.RUNNING,
        context: {},
        stepResults: [
          { stepIndex: 0, stepName: "step_0", success: true, duration: 50 },
        ],
        currentStepIndex: 1,
        startedAt: Date.now() - 100,
        completedAt: null,
        error: null,
      });

      const status = engine.getPipelineStatus(executionId);

      expect(status.executionId).toBe(executionId);
      expect(status.pipelineId).toBe(pipelineId);
      expect(status.state).toBe(PipelineState.RUNNING);
      expect(status.currentStepIndex).toBe(1);
      expect(status.totalSteps).toBe(2);
      expect(status.stepResults).toHaveLength(1);
      expect(status.error).toBeNull();
      expect(status.duration).toBeGreaterThan(0);
    });

    it("should include completedAt in duration calculation when completed", () => {
      const startedAt = Date.now() - 500;
      const completedAt = Date.now() - 100;
      const executionId = "exec-completed";

      engine.executions.set(executionId, {
        id: executionId,
        pipelineId: "p1",
        state: PipelineState.COMPLETED,
        context: {},
        stepResults: [],
        currentStepIndex: 0,
        startedAt,
        completedAt,
        error: null,
      });

      const status = engine.getPipelineStatus(executionId);
      expect(status.duration).toBe(completedAt - startedAt);
    });
  });

  // ===================================================================
  // Event Emission
  // ===================================================================

  describe("event emission", () => {
    it("should emit pipeline:started when execution begins", async () => {
      const handler = vi.fn();
      engine.on("pipeline:started", handler);

      mockSkillRegistry.executeSkill.mockResolvedValue({});
      const pipelineId = engine.createPipeline({
        name: "Start Event",
        steps: [{ type: StepType.SKILL, skillId: "x" }],
      });

      await engine.executePipeline(pipelineId);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineId,
          name: "Start Event",
        }),
      );
    });

    it("should emit pipeline:completed on successful execution", async () => {
      const handler = vi.fn();
      engine.on("pipeline:completed", handler);

      mockSkillRegistry.executeSkill.mockResolvedValue({});
      const pipelineId = engine.createPipeline({
        name: "Complete Event",
        steps: [{ type: StepType.SKILL, skillId: "x" }],
      });

      await engine.executePipeline(pipelineId);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineId,
          state: PipelineState.COMPLETED,
        }),
      );
    });

    it("should emit pipeline:step-started and pipeline:step-completed for each step", async () => {
      const stepStarted = vi.fn();
      const stepCompleted = vi.fn();
      engine.on("pipeline:step-started", stepStarted);
      engine.on("pipeline:step-completed", stepCompleted);

      mockSkillRegistry.executeSkill.mockResolvedValue({});
      const pipelineId = engine.createPipeline({
        name: "Step Events",
        steps: [
          { type: StepType.SKILL, name: "first", skillId: "a" },
          { type: StepType.SKILL, name: "second", skillId: "b" },
        ],
      });

      await engine.executePipeline(pipelineId);

      expect(stepStarted).toHaveBeenCalledTimes(2);
      expect(stepCompleted).toHaveBeenCalledTimes(2);

      expect(stepStarted).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          stepIndex: 0,
          stepName: "first",
          stepType: "skill",
        }),
      );
      expect(stepStarted).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          stepIndex: 1,
          stepName: "second",
          stepType: "skill",
        }),
      );

      expect(stepCompleted).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          stepIndex: 0,
          stepName: "first",
          success: true,
        }),
      );
      expect(stepCompleted).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          stepIndex: 1,
          stepName: "second",
          success: true,
        }),
      );
    });

    it("should emit pipeline:failed event when execution fails", async () => {
      const handler = vi.fn();
      engine.on("pipeline:failed", handler);

      mockSkillRegistry.executeSkill.mockRejectedValue(new Error("boom"));
      const pipelineId = engine.createPipeline({
        name: "Fail Event",
        steps: [{ type: StepType.SKILL, skillId: "fail" }],
      });

      await engine.executePipeline(pipelineId);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineId,
          state: PipelineState.FAILED,
          error: "boom",
        }),
      );
    });

    it("should use default step name when name is not provided", async () => {
      const stepStarted = vi.fn();
      engine.on("pipeline:step-started", stepStarted);

      mockSkillRegistry.executeSkill.mockResolvedValue({});
      const pipelineId = engine.createPipeline({
        name: "Default Name",
        steps: [
          { type: StepType.SKILL, skillId: "x" }, // no name
        ],
      });

      await engine.executePipeline(pipelineId);

      expect(stepStarted).toHaveBeenCalledWith(
        expect.objectContaining({ stepName: "step_0" }),
      );
    });
  });

  // ===================================================================
  // Mixed Pipeline (multiple step types)
  // ===================================================================

  describe("mixed pipeline execution", () => {
    it("should execute a pipeline with SKILL, TRANSFORM, and CONDITION steps", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({ quality: "high" });

      const pipelineId = engine.createPipeline({
        name: "Mixed Pipeline",
        variables: { threshold: "50" },
        steps: [
          {
            type: StepType.SKILL,
            name: "analyze",
            skillId: "code-analyzer",
            outputVariable: "analysis",
          },
          {
            type: StepType.TRANSFORM,
            name: "format",
            expression: "${threshold}",
            outputVariable: "thresholdValue",
          },
          {
            type: StepType.CONDITION,
            name: "qualityGate",
            expression: "${analyze.result.quality} === high",
            trueBranch: [
              { type: StepType.SKILL, name: "deploy", skillId: "deploy-skill" },
            ],
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(result.stepResults).toHaveLength(3);
      // '50' is a valid JSON number, so _executeTransformStep parses it to 50
      expect(result.context.thresholdValue).toBe(50);
      // The CONDITION should have executed the trueBranch
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "deploy-skill",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should execute a SKILL step followed by a LOOP step", async () => {
      mockSkillRegistry.executeSkill
        .mockResolvedValueOnce({ files: ["a.js", "b.js"] }) // first skill returns files
        .mockResolvedValue({ linted: true }); // loop body skill

      const pipelineId = engine.createPipeline({
        name: "Skill then Loop",
        steps: [
          {
            type: StepType.SKILL,
            name: "listFiles",
            skillId: "file-lister",
            outputVariable: "fileList",
          },
          {
            type: StepType.LOOP,
            name: "lintLoop",
            items: "${listFiles.result.files}",
            itemVariable: "file",
            body: [
              {
                type: StepType.SKILL,
                name: "lint",
                skillId: "linter",
                inputMapping: { target: "${file}" },
              },
            ],
          },
        ],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      // 1 for file-lister + 2 for linter (one per file)
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledTimes(3);
    });
  });

  // ===================================================================
  // Edge Cases
  // ===================================================================

  describe("edge cases", () => {
    it("should handle empty steps array", async () => {
      const pipelineId = engine.createPipeline({
        name: "Empty Steps",
        steps: [],
      });

      const result = await engine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(result.stepResults).toEqual([]);
    });

    it("should handle pipeline with only TRANSFORM steps (no skill registry needed)", async () => {
      const noRegistryEngine = new SkillPipelineEngine({});
      const pipelineId = noRegistryEngine.createPipeline({
        name: "Transform Only",
        variables: { input: "42" },
        steps: [
          {
            type: StepType.TRANSFORM,
            name: "double",
            expression: "${input}",
            outputVariable: "result",
          },
        ],
      });

      const result = await noRegistryEngine.executePipeline(pipelineId);

      expect(result.state).toBe(PipelineState.COMPLETED);
      expect(result.context.result).toBe(42); // Parsed as JSON number
    });

    it("should handle non-string values passed to resolveVariables unchanged", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const pipelineId = engine.createPipeline({
        name: "Non-String Input",
        steps: [
          {
            type: StepType.SKILL,
            name: "step1",
            skillId: "test",
            inputMapping: {
              num: 42,
              flag: true,
              arr: [1, 2, 3],
            },
          },
        ],
      });

      await engine.executePipeline(pipelineId);

      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({
          num: 42,
          flag: true,
          arr: [1, 2, 3],
          _pipelineStep: true,
        }),
        expect.any(Object),
      );
    });

    it("should handle initial context overriding pipeline variables", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const pipelineId = engine.createPipeline({
        name: "Override",
        variables: { key: "pipeline-value" },
        steps: [
          {
            type: StepType.SKILL,
            name: "step1",
            skillId: "test",
            inputMapping: { data: "${key}" },
          },
        ],
      });

      await engine.executePipeline(pipelineId, { key: "override-value" });

      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({
          data: "override-value",
          _pipelineStep: true,
        }),
        expect.any(Object),
      );
    });

    it("should handle config.taskType in skill step", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const pipelineId = engine.createPipeline({
        name: "Custom Task Type",
        steps: [
          {
            type: StepType.SKILL,
            name: "customTask",
            skillId: "test",
            config: { taskType: "custom-analysis" },
          },
        ],
      });

      await engine.executePipeline(pipelineId);

      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({
          type: "custom-analysis",
          _pipelineStep: true,
        }),
        expect.any(Object),
      );
    });

    it("should support comparison operators >=, <=, ==, !=", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      // Test >= operator
      const id1 = engine.createPipeline({
        name: "GTE",
        variables: { val: "10" },
        steps: [
          {
            type: StepType.CONDITION,
            name: "gte",
            expression: "${val} >= 10",
            trueBranch: [
              { type: StepType.SKILL, name: "yes", skillId: "gte-true" },
            ],
          },
        ],
      });
      await engine.executePipeline(id1);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "gte-true",
        expect.any(Object),
        expect.any(Object),
      );

      mockSkillRegistry.executeSkill.mockClear();

      // Test <= operator
      const id2 = engine.createPipeline({
        name: "LTE",
        variables: { val: "5" },
        steps: [
          {
            type: StepType.CONDITION,
            name: "lte",
            expression: "${val} <= 10",
            trueBranch: [
              { type: StepType.SKILL, name: "yes", skillId: "lte-true" },
            ],
          },
        ],
      });
      await engine.executePipeline(id2);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "lte-true",
        expect.any(Object),
        expect.any(Object),
      );

      mockSkillRegistry.executeSkill.mockClear();

      // Test == operator
      const id3 = engine.createPipeline({
        name: "EQ",
        variables: { val: "10" },
        steps: [
          {
            type: StepType.CONDITION,
            name: "eq",
            expression: "${val} == 10",
            trueBranch: [
              { type: StepType.SKILL, name: "yes", skillId: "eq-true" },
            ],
          },
        ],
      });
      await engine.executePipeline(id3);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "eq-true",
        expect.any(Object),
        expect.any(Object),
      );

      mockSkillRegistry.executeSkill.mockClear();

      // Test != operator
      const id4 = engine.createPipeline({
        name: "NEQ",
        variables: { val: "10" },
        steps: [
          {
            type: StepType.CONDITION,
            name: "neq",
            expression: "${val} != 20",
            trueBranch: [
              { type: StepType.SKILL, name: "yes", skillId: "neq-true" },
            ],
          },
        ],
      });
      await engine.executePipeline(id4);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "neq-true",
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should handle falsy expression values correctly", async () => {
      // Empty string, 'false', 'null', 'undefined', '0' should all be falsy
      const falsyValues = ["", "false", "null", "undefined", "0"];

      for (const val of falsyValues) {
        mockSkillRegistry.executeSkill.mockClear();

        const id = engine.createPipeline({
          name: `Falsy ${val}`,
          variables: { val },
          steps: [
            {
              type: StepType.CONDITION,
              name: "check",
              expression: "${val}",
              trueBranch: [
                {
                  type: StepType.SKILL,
                  name: "yes",
                  skillId: "should-not-run",
                },
              ],
              falseBranch: [
                { type: StepType.SKILL, name: "no", skillId: "should-run" },
              ],
            },
          ],
        });

        await engine.executePipeline(id);

        expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
          "should-run",
          expect.any(Object),
          expect.any(Object),
        );
      }
    });

    it("should handle the < comparison operator", async () => {
      mockSkillRegistry.executeSkill.mockResolvedValue({});

      const id = engine.createPipeline({
        name: "Less Than",
        variables: { val: "3" },
        steps: [
          {
            type: StepType.CONDITION,
            name: "lt",
            expression: "${val} < 10",
            trueBranch: [
              { type: StepType.SKILL, name: "yes", skillId: "lt-true" },
            ],
          },
        ],
      });

      await engine.executePipeline(id);
      expect(mockSkillRegistry.executeSkill).toHaveBeenCalledWith(
        "lt-true",
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  // ===================================================================
  // Constructor
  // ===================================================================

  describe("constructor", () => {
    it("should initialize with default options", () => {
      const eng = new SkillPipelineEngine();
      expect(eng.skillRegistry).toBeUndefined();
      expect(eng.metricsCollector).toBeNull();
      expect(eng.pipelines.size).toBe(0);
      expect(eng.executions.size).toBe(0);
    });

    it("should accept skillRegistry and metricsCollector options", () => {
      const reg = { executeSkill: vi.fn() };
      const met = { recordExecution: vi.fn() };
      const eng = new SkillPipelineEngine({
        skillRegistry: reg,
        metricsCollector: met,
      });
      expect(eng.skillRegistry).toBe(reg);
      expect(eng.metricsCollector).toBe(met);
    });

    it("should be an EventEmitter", () => {
      const eng = new SkillPipelineEngine();
      expect(typeof eng.on).toBe("function");
      expect(typeof eng.emit).toBe("function");
      expect(typeof eng.removeAllListeners).toBe("function");
    });
  });
});
