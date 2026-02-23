/**
 * PromptOptimizer 单元测试 — v2.1.0
 *
 * 覆盖：initialize、recordExecution（SHA-256 hash）、createVariant、
 *       optimizePrompt（no-data / analyzed）、compareVariants、getStats
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
const { PromptOptimizer } = require("../prompt-optimizer");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeVariantRow(overrides = {}) {
  return {
    id: "var-001",
    skill_name: "code-review",
    variant_name: "v1",
    prompt_text: "Review this code carefully",
    success_rate: 0.75,
    use_count: 10,
    is_active: 1,
    created_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue({ count: 0, avg: 0 }),
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

describe("PromptOptimizer", () => {
  let po;
  let db;

  beforeEach(() => {
    po = new PromptOptimizer();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create tables and set initialized=true", async () => {
      await po.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
      expect(po.initialized).toBe(true);
    });

    it("should be idempotent on double initialize", async () => {
      await po.initialize(db);
      await po.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
    });

    it("should call getStats after table creation", async () => {
      // getStats does COUNT queries — verify no exceptions
      await expect(po.initialize(db)).resolves.not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // recordExecution
  // ─────────────────────────────────────────────────────────────────────────
  describe("recordExecution()", () => {
    beforeEach(async () => {
      await po.initialize(db);
    });

    it("should throw when skillName is missing", () => {
      expect(() => po.recordExecution({ promptText: "test" })).toThrow(
        "skillName is required",
      );
    });

    it("should return execution object with id and promptHash", () => {
      const exec = po.recordExecution({
        skillName: "summarize",
        promptText: "Summarize the following text",
        resultSuccess: true,
        executionTimeMs: 500,
      });

      expect(exec.id).toBeTruthy();
      expect(exec.promptHash).toBeTruthy();
      expect(exec.promptHash).toHaveLength(16); // slice(0,16) of sha256
    });

    it("should produce consistent SHA-256 hash for same prompt text", () => {
      const exec1 = po.recordExecution({ skillName: "s1", promptText: "hello world" });
      const exec2 = po.recordExecution({ skillName: "s1", promptText: "hello world" });

      expect(exec1.promptHash).toBe(exec2.promptHash);
    });

    it("should produce different hashes for different prompt text", () => {
      const exec1 = po.recordExecution({ skillName: "s1", promptText: "prompt A" });
      const exec2 = po.recordExecution({ skillName: "s1", promptText: "prompt B" });

      expect(exec1.promptHash).not.toBe(exec2.promptHash);
    });

    it("should store resultSuccess as 0/1 integer", () => {
      const execSuccess = po.recordExecution({ skillName: "s1", resultSuccess: true });
      const execFail = po.recordExecution({ skillName: "s1", resultSuccess: false });

      expect(execSuccess.resultSuccess).toBe(1);
      expect(execFail.resultSuccess).toBe(0);
    });

    it("should persist to DB via db.run()", () => {
      po.recordExecution({ skillName: "s1", promptText: "test" });

      expect(db.run).toHaveBeenCalled();
    });

    it("should handle empty promptText gracefully", () => {
      const exec = po.recordExecution({ skillName: "s1" });
      expect(exec.promptHash).toBeTruthy(); // hash of ""
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createVariant
  // ─────────────────────────────────────────────────────────────────────────
  describe("createVariant()", () => {
    beforeEach(async () => {
      await po.initialize(db);
    });

    it("should throw when skillName or promptText missing", () => {
      expect(() => po.createVariant({ skillName: "s1" })).toThrow(
        "skillName and promptText are required",
      );
      expect(() => po.createVariant({ promptText: "test" })).toThrow(
        "skillName and promptText are required",
      );
    });

    it("should return variant with id and isActive=true", () => {
      const variant = po.createVariant({
        skillName: "code-review",
        variantName: "v-concise",
        promptText: "Be concise. Review the code.",
      });

      expect(variant.id).toBeTruthy();
      expect(variant.isActive).toBe(true);
      expect(variant.successRate).toBe(0);
      expect(variant.useCount).toBe(0);
    });

    it("should auto-generate variantName when not provided", () => {
      const variant = po.createVariant({
        skillName: "summarize",
        promptText: "Summarize",
      });

      expect(variant.variantName).toBeTruthy();
      expect(variant.variantName).toMatch(/^variant-/);
    });

    it("should persist to DB via db.run()", () => {
      po.createVariant({ skillName: "s1", promptText: "p1" });
      expect(db.run).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // optimizePrompt
  // ─────────────────────────────────────────────────────────────────────────
  describe("optimizePrompt()", () => {
    beforeEach(async () => {
      await po.initialize(db);
    });

    it("should return no-data status when no execution history", () => {
      db._prep.all.mockReturnValueOnce([]); // hashStats = []

      const result = po.optimizePrompt("unknown-skill");

      expect(result.status).toBe("no-data");
      expect(result.skillName).toBe("unknown-skill");
    });

    it("should return analyzed status when execution history exists", () => {
      const hashStats = [
        {
          prompt_hash: "abc123",
          prompt_text: "Review carefully",
          total: 10,
          successes: 8,
          avg_time: 300,
        },
        {
          prompt_hash: "def456",
          prompt_text: "Quick review",
          total: 5,
          successes: 2,
          avg_time: 150,
        },
      ];
      db._prep.all
        .mockReturnValueOnce(hashStats)  // hashStats query
        .mockReturnValueOnce([]);        // failures query

      const result = po.optimizePrompt("code-review");

      expect(result.status).toBe("analyzed");
      expect(result.skillName).toBe("code-review");
      expect(result.variants).toHaveLength(2);
      expect(result.best).toBeDefined();
      expect(result.best.successRate).toBeCloseTo(0.8, 2);
    });

    it("should suggest variant-performance-gap when gap > 0.1", () => {
      const hashStats = [
        { prompt_hash: "h1", prompt_text: "Good prompt", total: 10, successes: 9, avg_time: 200 },
        { prompt_hash: "h2", prompt_text: "Bad prompt",  total: 10, successes: 1, avg_time: 500 },
      ];
      db._prep.all
        .mockReturnValueOnce(hashStats)
        .mockReturnValueOnce([]);

      const result = po.optimizePrompt("skill-x");

      const gapSuggestion = result.suggestions.find(
        (s) => s.type === "variant-performance-gap",
      );
      expect(gapSuggestion).toBeDefined();
    });

    it("should include failure-feedback suggestion when failures exist", () => {
      const hashStats = [
        { prompt_hash: "h1", prompt_text: "P", total: 5, successes: 2, avg_time: 100 },
      ];
      db._prep.all
        .mockReturnValueOnce(hashStats)
        .mockReturnValueOnce([{ feedback: "Not enough detail" }]);

      const result = po.optimizePrompt("skill-y");

      const feedbackSuggestion = result.suggestions.find(
        (s) => s.type === "failure-feedback",
      );
      expect(feedbackSuggestion).toBeDefined();
      expect(feedbackSuggestion.feedback).toContain("Not enough detail");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // compareVariants
  // ─────────────────────────────────────────────────────────────────────────
  describe("compareVariants()", () => {
    beforeEach(async () => {
      await po.initialize(db);
    });

    it("should return error when one or both variants not found", () => {
      db._prep.get.mockReturnValue(null);

      const result = po.compareVariants("id-a", "id-b");

      expect(result).toHaveProperty("error");
    });

    it("should identify the winner by higher success_rate", () => {
      const rowA = makeVariantRow({ id: "va", success_rate: 0.9, use_count: 10 });
      const rowB = makeVariantRow({ id: "vb", success_rate: 0.5, use_count: 8 });

      db._prep.get
        .mockReturnValueOnce(rowA)
        .mockReturnValueOnce(rowB);

      const result = po.compareVariants("va", "vb");

      expect(result.winner).toBe("va");
      expect(result.successRateDiff).toBeCloseTo(0.4, 2);
    });

    it("should return tie when success rates are equal", () => {
      const rowA = makeVariantRow({ id: "va", success_rate: 0.7, use_count: 5 });
      const rowB = makeVariantRow({ id: "vb", success_rate: 0.7, use_count: 5 });

      db._prep.get
        .mockReturnValueOnce(rowA)
        .mockReturnValueOnce(rowB);

      const result = po.compareVariants("va", "vb");

      expect(result.winner).toBe("tie");
    });

    it("should report sufficient=true when both have >= 5 uses", () => {
      const rowA = makeVariantRow({ id: "va", use_count: 6 });
      const rowB = makeVariantRow({ id: "vb", use_count: 7 });

      db._prep.get
        .mockReturnValueOnce(rowA)
        .mockReturnValueOnce(rowB);

      const result = po.compareVariants("va", "vb");

      expect(result.sufficient).toBe(true);
    });

    it("should report sufficient=false when either has < 5 uses", () => {
      const rowA = makeVariantRow({ id: "va", use_count: 3 });
      const rowB = makeVariantRow({ id: "vb", use_count: 10 });

      db._prep.get
        .mockReturnValueOnce(rowA)
        .mockReturnValueOnce(rowB);

      const result = po.compareVariants("va", "vb");

      expect(result.sufficient).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await po.initialize(db);
    });

    it("should return zero stats for empty DB", () => {
      db._prep.get
        .mockReturnValueOnce({ count: 0 }) // totalExecutions
        .mockReturnValueOnce({ count: 0 }) // totalVariants
        .mockReturnValueOnce({ count: 0 }) // activeVariants
        .mockReturnValueOnce({ count: 0 }) // skillsCovered
        .mockReturnValueOnce({ avg: null }); // avgSuccessRate

      const stats = po.getStats();

      expect(stats).toMatchObject({
        totalExecutions: 0,
        totalVariants: 0,
        activeVariants: 0,
        skillsCovered: 0,
        avgSuccessRate: 0,
      });
    });

    it("should return correct stats from DB", () => {
      db._prep.get
        .mockReturnValueOnce({ count: 50 })   // totalExecutions
        .mockReturnValueOnce({ count: 5 })    // totalVariants
        .mockReturnValueOnce({ count: 4 })    // activeVariants
        .mockReturnValueOnce({ count: 3 })    // skillsCovered
        .mockReturnValueOnce({ avg: 0.72 });  // avgSuccessRate

      const stats = po.getStats();

      expect(stats.totalExecutions).toBe(50);
      expect(stats.totalVariants).toBe(5);
      expect(stats.activeVariants).toBe(4);
      expect(stats.skillsCovered).toBe(3);
      expect(stats.avgSuccessRate).toBe(0.72);
    });
  });
});
