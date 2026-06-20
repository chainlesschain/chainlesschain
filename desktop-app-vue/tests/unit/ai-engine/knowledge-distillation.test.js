import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * KnowledgeDistillation 单元测试 — 覆盖此前无测试的纯逻辑：
 * 任务类型复杂度评分、复杂度加权求和、复杂度分级、模型路由决策。
 */

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let KnowledgeDistillation, ComplexityLevel, ModelType;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod =
    await import("../../../src/main/ai-engine/knowledge-distillation.js");
  KnowledgeDistillation = mod.KnowledgeDistillation;
  ComplexityLevel = mod.ComplexityLevel;
  ModelType = mod.ModelType;
});

describe("_evaluateTaskTypeComplexity", () => {
  it("maps simple / medium / complex / unknown intent types", () => {
    const kd = new KnowledgeDistillation();
    expect(kd._evaluateTaskTypeComplexity([{ type: "READ_FILE" }])).toBe(0.2);
    expect(kd._evaluateTaskTypeComplexity([{ type: "WRITE_FILE" }])).toBe(0.5);
    expect(kd._evaluateTaskTypeComplexity([{ type: "CODE_GENERATION" }])).toBe(
      0.8,
    );
    // unknown type defaults to medium (0.5)
    expect(kd._evaluateTaskTypeComplexity([{ type: "SOMETHING_NEW" }])).toBe(
      0.5,
    );
  });

  it("averages across intents and returns 0.5 for empty", () => {
    const kd = new KnowledgeDistillation();
    // (0.2 + 0.8) / 2 = 0.5
    expect(
      kd._evaluateTaskTypeComplexity([
        { type: "READ_FILE" },
        { type: "CODE_GENERATION" },
      ]),
    ).toBeCloseTo(0.5);
    expect(kd._evaluateTaskTypeComplexity([])).toBe(0.5);
  });
});

describe("_calculateComplexityScore", () => {
  it("is the weighted sum of features", () => {
    const kd = new KnowledgeDistillation();
    // weights: intentCount .3, parameterComplexity .2, taskType .3, contextSize .2
    const score = kd._calculateComplexityScore({
      intentCount: 1,
      parameterComplexity: 0,
      taskType: 1,
      contextSize: 0,
    });
    expect(score).toBeCloseTo(0.6);
  });
});

describe("evaluateComplexity", () => {
  it("classifies a trivial empty task as SIMPLE", () => {
    const kd = new KnowledgeDistillation();
    const c = kd.evaluateComplexity({ intents: [], context: {} });
    expect(c.level).toBe(ComplexityLevel.SIMPLE);
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThan(0.35);
    expect(c.features).toHaveProperty("taskType");
  });

  it("classifies a heavy multi-intent code task as COMPLEX", () => {
    const kd = new KnowledgeDistillation();
    const intents = Array.from({ length: 5 }, () => ({
      type: "CODE_GENERATION",
      params: { a: 1, b: 2, c: 3, d: 4, e: 5 },
    }));
    const c = kd.evaluateComplexity({ intents, context: {} });
    expect(c.level).toBe(ComplexityLevel.COMPLEX);
    expect(c.score).toBeGreaterThanOrEqual(0.6);
  });

  it("respects a custom complexityThreshold", () => {
    const kd = new KnowledgeDistillation({ complexityThreshold: 0.05 });
    // empty task scores ~0.15 → now above 0.05 → not SIMPLE
    const c = kd.evaluateComplexity({ intents: [], context: {} });
    expect(c.level).not.toBe(ComplexityLevel.SIMPLE);
  });
});

describe("routeToModel", () => {
  it("routes SIMPLE → small model", () => {
    const kd = new KnowledgeDistillation();
    const r = kd.routeToModel({ level: ComplexityLevel.SIMPLE, score: 0.1 });
    expect(r.modelType).toBe(ModelType.SMALL);
    expect(r.modelName).toBe(kd.config.smallModel);
    expect(r.reason).toBe("simple_task");
  });

  it("routes MEDIUM and COMPLEX → large model with matching reason", () => {
    const kd = new KnowledgeDistillation();
    const med = kd.routeToModel({ level: ComplexityLevel.MEDIUM, score: 0.5 });
    expect(med.modelType).toBe(ModelType.LARGE);
    expect(med.reason).toBe("medium_task");

    const cmp = kd.routeToModel({ level: ComplexityLevel.COMPLEX, score: 0.8 });
    expect(cmp.modelType).toBe(ModelType.LARGE);
    expect(cmp.reason).toBe("complex_task");
  });

  it("forces the large model when distillation is disabled", () => {
    const kd = new KnowledgeDistillation({ enableDistillation: false });
    const r = kd.routeToModel({ level: ComplexityLevel.SIMPLE, score: 0.1 });
    expect(r.modelType).toBe(ModelType.LARGE);
    expect(r.reason).toBe("distillation_disabled");
  });
});
