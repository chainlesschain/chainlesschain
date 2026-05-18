/**
 * ABComparator 单元测试 — v2.1.0
 *
 * 覆盖：initialize、compare（参数验证/变体生成/基准测试/胜者决定）、
 *       _benchmarkVariant、_scoreErrorHandling、_scoreReadability、
 *       _extractCode、getComparisonHistory、getStats
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
const { ABComparator } = require("../ab-comparator");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeComparisonRow(overrides = {}) {
  return {
    id: "cmp-001",
    task_description: "Implement user authentication",
    variants: JSON.stringify([
      {
        name: "concise-agent",
        code: "const auth = (u, p) => u && p;",
        style: "concise",
      },
      {
        name: "robust-agent",
        code: "function auth(u, p) { try { if (!u || !p) throw new Error('Invalid'); return true; } catch(e) { return false; } }",
        style: "robust",
      },
    ]),
    winner: "robust-agent",
    scores: JSON.stringify({
      "concise-agent": {
        conciseness: 90,
        errorHandling: 50,
        readability: 75,
        total: 70,
      },
      "robust-agent": {
        conciseness: 60,
        errorHandling: 90,
        readability: 80,
        total: 77,
      },
    }),
    created_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue({ count: 0 }),
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

describe("ABComparator", () => {
  let abc;
  let db;

  beforeEach(() => {
    abc = new ABComparator();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create tables and set initialized=true", async () => {
      await abc.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
      expect(abc.initialized).toBe(true);
    });

    it("should be idempotent on double initialize", async () => {
      await abc.initialize(db);
      await abc.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
    });

    it("should work without agentCoordinator and decisionKB", async () => {
      await expect(abc.initialize(db)).resolves.not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // compare — validation
  // ─────────────────────────────────────────────────────────────────────────
  describe("compare() - validation", () => {
    beforeEach(async () => {
      await abc.initialize(db);
    });

    it("should return error when taskDescription is missing", async () => {
      const result = await abc.compare({});
      expect(result).toHaveProperty("error", "taskDescription is required");
      expect(result).toHaveProperty("id");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // compare — variant generation
  // ─────────────────────────────────────────────────────────────────────────
  describe("compare() - variant generation", () => {
    beforeEach(async () => {
      await abc.initialize(db);
    });

    it("should generate default 3 variants", async () => {
      const result = await abc.compare({
        taskDescription: "Write a function to reverse a string",
      });

      expect(result.variants).toHaveLength(3);
    });

    it("should respect variantCount parameter (max 5)", async () => {
      const result2 = await abc.compare({
        taskDescription: "Capitalize words",
        variantCount: 2,
      });
      expect(result2.variants).toHaveLength(2);

      const result5 = await abc.compare({
        taskDescription: "Sort array",
        variantCount: 5,
      });
      expect(result5.variants).toHaveLength(5);
    });

    it("should cap variantCount at MAX_VARIANTS=5", async () => {
      const result = await abc.compare({
        taskDescription: "Parse JSON",
        variantCount: 10,
      });
      expect(result.variants).toHaveLength(5);
    });

    it("should include name and style in each variant", async () => {
      const result = await abc.compare({
        taskDescription: "Validate email",
        variantCount: 2,
      });

      for (const v of result.variants) {
        expect(v).toHaveProperty("name");
        expect(v).toHaveProperty("style");
        expect(v).toHaveProperty("code");
      }
    });

    it("should use placeholder code when no agentCoordinator", async () => {
      const result = await abc.compare({
        taskDescription: "Compute factorial",
        variantCount: 1,
      });

      expect(result.variants[0].code).toContain("placeholder");
    });

    it("should use agentCoordinator when provided", async () => {
      // Create fresh instance to avoid "already initialized" guard
      const freshAbc = new ABComparator();
      const freshDb = createMockDatabase();
      const mockCoordinator = {
        assignTask: vi.fn().mockResolvedValue({
          output:
            "```js\nfunction factorial(n) { return n <= 1 ? 1 : n * factorial(n-1); }\n```",
        }),
      };
      await freshAbc.initialize(freshDb, mockCoordinator);

      const result = await freshAbc.compare({
        taskDescription: "Compute factorial",
        variantCount: 1,
      });

      expect(mockCoordinator.assignTask).toHaveBeenCalledOnce();
      expect(result.variants[0].code).toContain("factorial");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // compare — benchmarking & winner
  // ─────────────────────────────────────────────────────────────────────────
  describe("compare() - benchmarking", () => {
    beforeEach(async () => {
      await abc.initialize(db);
    });

    it("should produce scores for each variant by default", async () => {
      const result = await abc.compare({
        taskDescription: "Validate input",
        variantCount: 2,
      });

      expect(Object.keys(result.scores).length).toBe(2);
    });

    it("should identify a winner", async () => {
      const result = await abc.compare({
        taskDescription: "Format date string",
        variantCount: 3,
      });

      expect(result.winner).toBeTruthy();
      expect(Object.keys(result.scores)).toContain(result.winner);
    });

    it("should skip benchmarking when benchmark=false", async () => {
      const result = await abc.compare({
        taskDescription: "Simple task",
        variantCount: 2,
        benchmark: false,
      });

      expect(Object.keys(result.scores)).toHaveLength(0);
      // Winner falls back to first variant
      expect(result.winner).toBe(result.variants[0].name);
    });

    it("should save comparison to DB", async () => {
      await abc.compare({ taskDescription: "Any task" });
      expect(db.run).toHaveBeenCalled();
    });

    it("should record to DecisionKnowledgeBase when provided", async () => {
      // Create fresh instance to avoid "already initialized" guard
      const freshAbc = new ABComparator();
      const freshDb = createMockDatabase();
      const mockDKB = { recordDecision: vi.fn() };
      await freshAbc.initialize(freshDb, null, mockDKB);

      await freshAbc.compare({ taskDescription: "Test task" });

      expect(mockDKB.recordDecision).toHaveBeenCalledOnce();
    });

    it("should include duration in result", async () => {
      const result = await abc.compare({ taskDescription: "Timed task" });
      expect(typeof result.duration).toBe("number");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _benchmarkVariant
  // ─────────────────────────────────────────────────────────────────────────
  describe("_benchmarkVariant()", () => {
    beforeEach(async () => {
      await abc.initialize(db);
    });

    it("should return scores with conciseness/errorHandling/readability/total", () => {
      const variant = {
        name: "test",
        code: "function foo(x) { return x; }",
      };
      const scores = abc._benchmarkVariant(variant);

      expect(scores).toHaveProperty("conciseness");
      expect(scores).toHaveProperty("errorHandling");
      expect(scores).toHaveProperty("readability");
      expect(scores).toHaveProperty("total");
    });

    it("should score conciseness higher for shorter code", () => {
      const short = abc._benchmarkVariant({ code: "const f = (x) => x;" });
      const longCode = Array.from(
        { length: 20 },
        (_, i) => `const v${i} = ${i};`,
      ).join("\n");
      const long = abc._benchmarkVariant({ code: longCode });

      expect(short.conciseness).toBeGreaterThan(long.conciseness);
    });

    it("total should be a number between 0 and 100", () => {
      const scores = abc._benchmarkVariant({ code: "// simple comment" });
      expect(scores.total).toBeGreaterThanOrEqual(0);
      expect(scores.total).toBeLessThanOrEqual(100);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _scoreErrorHandling
  // ─────────────────────────────────────────────────────────────────────────
  describe("_scoreErrorHandling()", () => {
    beforeEach(async () => {
      await abc.initialize(db);
    });

    it("should give baseline score of 50 for empty code", () => {
      const score = abc._scoreErrorHandling("");
      expect(score).toBe(50);
    });

    it("should add points for try/catch blocks", () => {
      const code = "try { doSomething(); } catch(e) { console.error(e); }";
      const score = abc._scoreErrorHandling(code);
      expect(score).toBeGreaterThan(50);
    });

    it("should add points for throw new Error", () => {
      const code = "if (!x) throw new Error('x required');";
      const score = abc._scoreErrorHandling(code);
      expect(score).toBeGreaterThan(50);
    });

    it("should not exceed 100", () => {
      const code = `
try { doSomething(); } catch(e) { throw new Error(e); }
if (!x) throw new Error('x is null');
if (!y) throw new Error('y is null');
      `;
      const score = abc._scoreErrorHandling(code);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _scoreReadability
  // ─────────────────────────────────────────────────────────────────────────
  describe("_scoreReadability()", () => {
    beforeEach(async () => {
      await abc.initialize(db);
    });

    it("should give higher score for code with short lines and comments", () => {
      const readable = `
// This function adds two numbers
function addNumbers(firstNum, secondNum) {
  return firstNum + secondNum;
}`;
      const score = abc._scoreReadability(readable);
      expect(score).toBeGreaterThan(60);
    });

    it("should penalize code with very long lines", () => {
      const longLine = "x".repeat(130) + " = something;";
      const score = abc._scoreReadability(longLine);
      expect(score).toBeLessThanOrEqual(60);
    });

    it("should score within 0-100 range", () => {
      const score1 = abc._scoreReadability("const x = 1;");
      const score2 = abc._scoreReadability("// " + "x".repeat(200));
      expect(score1).toBeGreaterThanOrEqual(0);
      expect(score1).toBeLessThanOrEqual(100);
      expect(score2).toBeGreaterThanOrEqual(0);
      expect(score2).toBeLessThanOrEqual(100);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _extractCode
  // ─────────────────────────────────────────────────────────────────────────
  describe("_extractCode()", () => {
    beforeEach(async () => {
      await abc.initialize(db);
    });

    it("should extract code from markdown code block", () => {
      const output = "Here is the code:\n```js\nconst x = 1;\n```\nEnd.";
      const code = abc._extractCode(output);
      expect(code).toBe("const x = 1;");
    });

    it("should return raw output when no code block", () => {
      const output = "const x = 1;";
      expect(abc._extractCode(output)).toBe("const x = 1;");
    });

    it("should return empty string for null/undefined", () => {
      expect(abc._extractCode(null)).toBe("");
      expect(abc._extractCode(undefined)).toBe("");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getComparisonHistory
  // ─────────────────────────────────────────────────────────────────────────
  describe("getComparisonHistory()", () => {
    beforeEach(async () => {
      await abc.initialize(db);
    });

    it("should return empty array when no comparisons", () => {
      db._prep.all.mockReturnValueOnce([]);
      expect(abc.getComparisonHistory()).toEqual([]);
    });

    it("should map DB rows to comparison objects", () => {
      const row = makeComparisonRow();
      db._prep.all.mockReturnValueOnce([row]);

      const results = abc.getComparisonHistory();

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: "cmp-001",
        taskDescription: "Implement user authentication",
        winner: "robust-agent",
      });
      expect(results[0].variants).toHaveLength(2);
    });

    it("should support limit/offset pagination", () => {
      db._prep.all.mockReturnValueOnce([]);
      abc.getComparisonHistory({ limit: 5, offset: 10 });
      expect(db.prepare).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // compareStream — Phase F StreamRouter-compatible async generator
  // ─────────────────────────────────────────────────────────────────────────
  describe("compareStream()", () => {
    beforeEach(async () => {
      await abc.initialize(db);
    });

    async function collectStream(gen) {
      const events = [];
      for await (const ev of gen) {
        events.push(ev);
      }
      return events;
    }

    it("should yield start event first with comparisonId and taskDescription", async () => {
      const events = await collectStream(
        abc.compareStream({
          taskDescription: "Reverse a string",
          variantCount: 2,
        }),
      );

      const start = events[0];
      expect(start.type).toBe("start");
      expect(start.comparisonId).toBeTruthy();
      expect(start.taskDescription).toBe("Reverse a string");
      expect(start.variantCount).toBe(2);
      expect(start.ts).toBeTypeOf("number");
    });

    it("should yield one message event per variant", async () => {
      const events = await collectStream(
        abc.compareStream({ taskDescription: "Sort array", variantCount: 3 }),
      );

      const variantMessages = events.filter(
        (e) => e.type === "message" && e.variant,
      );
      expect(variantMessages).toHaveLength(3);
      variantMessages.forEach((m, i) => {
        expect(m.variantIndex).toBe(i);
        expect(m.variant).toHaveProperty("name");
        expect(m.content).toContain(m.variant.name);
      });
    });

    it("should yield benchmark message and end event with result", async () => {
      const events = await collectStream(
        abc.compareStream({ taskDescription: "Parse JSON", variantCount: 2 }),
      );

      const benchmark = events.find(
        (e) => e.type === "message" && e.phase === "benchmark",
      );
      expect(benchmark).toBeTruthy();
      expect(benchmark.content).toContain("Winner:");

      const end = events[events.length - 1];
      expect(end.type).toBe("end");
      expect(end.result).toBeTruthy();
      expect(end.result.winner).toBeTruthy();
      expect(end.ts).toBeTypeOf("number");
    });

    it("should yield error + end when taskDescription is missing", async () => {
      const events = await collectStream(abc.compareStream({}));

      const errorEv = events.find((e) => e.type === "error");
      expect(errorEv).toBeTruthy();
      expect(errorEv.error).toContain("taskDescription");

      const end = events[events.length - 1];
      expect(end.type).toBe("end");
      expect(end.result.error).toBeTruthy();
    });

    it("should produce event sequence: start → messages → benchmark → end", async () => {
      const events = await collectStream(
        abc.compareStream({ taskDescription: "Test", variantCount: 1 }),
      );

      const types = events.map((e) =>
        e.phase === "benchmark" ? "benchmark" : e.type,
      );
      expect(types[0]).toBe("start");
      expect(types[1]).toBe("message"); // variant
      expect(types[2]).toBe("benchmark");
      expect(types[3]).toBe("end");
    });

    it("compare() should return same result as end event (backward compat)", async () => {
      const syncResult = await abc.compare({
        taskDescription: "Add numbers",
        variantCount: 2,
      });

      const abc2 = new ABComparator();
      const db2 = createMockDatabase();
      await abc2.initialize(db2);
      const events = await collectStream(
        abc2.compareStream({ taskDescription: "Add numbers", variantCount: 2 }),
      );
      const streamResult = events[events.length - 1].result;

      expect(syncResult.taskDescription).toBe(streamResult.taskDescription);
      expect(syncResult.variants).toHaveLength(streamResult.variants.length);
      expect(syncResult.winner).toBe(streamResult.winner);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // COMPARE_STREAM_EVENTS export
  // ─────────────────────────────────────────────────────────────────────────
  describe("COMPARE_STREAM_EVENTS", () => {
    it("should export a frozen array with start/message/error/end", () => {
      const mod = require("../ab-comparator");
      expect(mod.COMPARE_STREAM_EVENTS).toBeTruthy();
      expect(mod.COMPARE_STREAM_EVENTS).toContain("start");
      expect(mod.COMPARE_STREAM_EVENTS).toContain("message");
      expect(mod.COMPARE_STREAM_EVENTS).toContain("error");
      expect(mod.COMPARE_STREAM_EVENTS).toContain("end");
      expect(Object.isFrozen(mod.COMPARE_STREAM_EVENTS)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await abc.initialize(db);
    });

    it("should return zero stats for empty DB", () => {
      db._prep.get
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce({ count: 0 });
      db._prep.all.mockReturnValueOnce([]);

      const stats = abc.getStats();

      expect(stats).toMatchObject({
        totalComparisons: 0,
        withWinner: 0,
        winsByAgent: {},
      });
    });

    it("should track wins by agent name", () => {
      db._prep.get
        .mockReturnValueOnce({ count: 5 }) // total
        .mockReturnValueOnce({ count: 5 }); // withWinner
      db._prep.all.mockReturnValueOnce([
        { winner: "robust-agent" },
        { winner: "concise-agent" },
        { winner: "robust-agent" },
        { winner: "readable-agent" },
        { winner: "robust-agent" },
      ]);

      const stats = abc.getStats();

      expect(stats.totalComparisons).toBe(5);
      expect(stats.winsByAgent["robust-agent"]).toBe(3);
      expect(stats.winsByAgent["concise-agent"]).toBe(1);
      expect(stats.winsByAgent["readable-agent"]).toBe(1);
    });
  });
});
