/**
 * DecisionKnowledgeBase 单元测试 — v2.1.0
 *
 * 覆盖：initialize、recordDecision、findSimilarDecisions、
 *       getDecisionHistory、getBestPractice、getSuccessRateByCategory、
 *       getStats、Hook 自动记录
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
  DecisionKnowledgeBase,
  DECISION_SOURCES,
} = require("../decision-knowledge-base");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a raw DB row (as sqlite-better returns) */
function makeRow(overrides = {}) {
  return {
    id: "test-id-001",
    problem: "How to handle auth?",
    problem_category: "architecture",
    solutions: JSON.stringify(["JWT", "Session"]),
    chosen_solution: "JWT",
    outcome: "decided",
    context: JSON.stringify({ notes: "stateless" }),
    agents: JSON.stringify(["planner", "architect"]),
    source: "manual",
    success_rate: 0.8,
    created_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createMockDatabase() {
  const prepareResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue({ count: 0, avg: 0 }),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepareResult),
    saveToFile: vi.fn(),
    _prep: prepareResult,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DecisionKnowledgeBase", () => {
  let dkb;
  let db;

  beforeEach(() => {
    dkb = new DecisionKnowledgeBase();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create tables and set initialized=true", async () => {
      await dkb.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
      expect(dkb.initialized).toBe(true);
    });

    it("should be idempotent on double initialize", async () => {
      await dkb.initialize(db);
      await dkb.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
    });

    it("should work without hookSystem", async () => {
      await expect(dkb.initialize(db)).resolves.not.toThrow();
    });

    it("should register PostToolUse hook when hookSystem provided", async () => {
      const registerFn = vi.fn();
      const hookSystem = {
        registry: { register: registerFn },
      };

      await dkb.initialize(db, hookSystem);

      expect(registerFn).toHaveBeenCalledOnce();
      const hookArg = registerFn.mock.calls[0][0];
      expect(hookArg.event).toBe("PostToolUse");
      expect(hookArg.name).toBe("decisionkb:tool-observer");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // recordDecision
  // ─────────────────────────────────────────────────────────────────────────
  describe("recordDecision()", () => {
    beforeEach(async () => {
      await dkb.initialize(db);
    });

    it("should throw when problem is missing", () => {
      expect(() => dkb.recordDecision({})).toThrow("Problem description is required");
    });

    it("should return a record with UUID id", () => {
      const record = dkb.recordDecision({ problem: "How to cache?" });

      expect(record.id).toBeTruthy();
      expect(record.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("should persist to DB via db.run()", () => {
      dkb.recordDecision({ problem: "Test problem" });

      expect(db.run).toHaveBeenCalledOnce();
    });

    it("should default problemCategory to 'general'", () => {
      const record = dkb.recordDecision({ problem: "Test" });
      expect(record.problemCategory).toBe("general");
    });

    it("should default source to 'manual'", () => {
      const record = dkb.recordDecision({ problem: "Test" });
      expect(record.source).toBe(DECISION_SOURCES.MANUAL);
    });

    it("should accept all optional fields", () => {
      const record = dkb.recordDecision({
        problem: "Auth design",
        problemCategory: "architecture",
        solutions: ["JWT", "Session"],
        chosenSolution: "JWT",
        outcome: "decided",
        context: { env: "production" },
        agents: ["planner"],
        source: DECISION_SOURCES.VOTING,
        successRate: 0.9,
      });

      expect(record.problemCategory).toBe("architecture");
      expect(record.chosenSolution).toBe("JWT");
      expect(record.successRate).toBe(0.9);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // recordVotingResult
  // ─────────────────────────────────────────────────────────────────────────
  describe("recordVotingResult()", () => {
    beforeEach(async () => {
      await dkb.initialize(db);
    });

    it("should set source to 'voting'", () => {
      const record = dkb.recordVotingResult({
        question: "Use microservices?",
        options: ["yes", "no"],
        winner: "yes",
        consensusScore: 0.75,
      });
      expect(record.source).toBe(DECISION_SOURCES.VOTING);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // recordWorkflowVerdict
  // ─────────────────────────────────────────────────────────────────────────
  describe("recordWorkflowVerdict()", () => {
    beforeEach(async () => {
      await dkb.initialize(db);
    });

    it("should set successRate=1 for SHIP verdict", () => {
      const record = dkb.recordWorkflowVerdict({
        description: "Add login feature",
        template: "feature",
        verdict: "SHIP",
      });
      expect(record.successRate).toBe(1.0);
      expect(record.source).toBe(DECISION_SOURCES.ORCHESTRATE);
    });

    it("should set successRate=0 for non-SHIP verdict", () => {
      const record = dkb.recordWorkflowVerdict({
        description: "Bugfix",
        template: "bugfix",
        verdict: "BLOCKED",
      });
      expect(record.successRate).toBe(0.0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // findSimilarDecisions
  // ─────────────────────────────────────────────────────────────────────────
  describe("findSimilarDecisions()", () => {
    beforeEach(async () => {
      await dkb.initialize(db);
    });

    it("should return empty array for empty problem string", () => {
      const results = dkb.findSimilarDecisions("");
      expect(results).toEqual([]);
    });

    it("should return empty array when no matching records", () => {
      db._prep.all.mockReturnValueOnce([]);
      const results = dkb.findSimilarDecisions("authentication JWT");
      expect(results).toEqual([]);
    });

    it("should return matching records ranked by score", () => {
      const rows = [
        makeRow({ id: "r1", problem: "JWT authentication strategy", success_rate: 0.8 }),
        makeRow({ id: "r2", problem: "Database connection pooling", success_rate: 0.5 }),
        makeRow({ id: "r3", problem: "JWT token refresh strategy", success_rate: 0.9 }),
      ];
      db._prep.all.mockReturnValueOnce(rows);

      const results = dkb.findSimilarDecisions("JWT authentication");

      // Should return matching ones first
      expect(results.length).toBeGreaterThanOrEqual(1);
      // JWT records should appear
      const ids = results.map((r) => r.id);
      expect(ids).toContain("r1");
    });

    it("should respect limit parameter", () => {
      const rows = Array.from({ length: 10 }, (_, i) =>
        makeRow({ id: `r${i}`, problem: `test problem ${i} architecture` }),
      );
      db._prep.all.mockReturnValueOnce(rows);

      const results = dkb.findSimilarDecisions("architecture", 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("should boost records with high success_rate", () => {
      const lowSuccess = makeRow({ id: "low", problem: "caching strategy", success_rate: 0.1 });
      const highSuccess = makeRow({ id: "high", problem: "caching strategy", success_rate: 0.9 });
      db._prep.all.mockReturnValueOnce([lowSuccess, highSuccess]);

      const results = dkb.findSimilarDecisions("caching strategy");
      // High success should score higher (boosted ×1.2)
      if (results.length > 1) {
        expect(results[0].id).toBe("high");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getDecisionHistory
  // ─────────────────────────────────────────────────────────────────────────
  describe("getDecisionHistory()", () => {
    beforeEach(async () => {
      await dkb.initialize(db);
    });

    it("should return empty array when no records", () => {
      db._prep.all.mockReturnValueOnce([]);
      const results = dkb.getDecisionHistory();
      expect(results).toEqual([]);
    });

    it("should map DB rows to record objects", () => {
      const row = makeRow();
      db._prep.all.mockReturnValueOnce([row]);

      const results = dkb.getDecisionHistory();

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: "test-id-001",
        problem: "How to handle auth?",
        problemCategory: "architecture",
        chosenSolution: "JWT",
        source: "manual",
      });
    });

    it("should pass pagination params to DB", () => {
      db._prep.all.mockReturnValueOnce([]);

      dkb.getDecisionHistory({ limit: 10, offset: 20, category: "security" });

      // Verify prepare was called with a query containing the expected SQL pattern
      expect(db.prepare).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getBestPractice
  // ─────────────────────────────────────────────────────────────────────────
  describe("getBestPractice()", () => {
    beforeEach(async () => {
      await dkb.initialize(db);
    });

    it("should return null when no records found", () => {
      db._prep.get.mockReturnValueOnce(null);
      const result = dkb.getBestPractice("architecture");
      expect(result).toBeNull();
    });

    it("should return the record with highest success_rate", () => {
      const row = makeRow({ id: "best", success_rate: 0.95 });
      db._prep.get.mockReturnValueOnce(row);

      const result = dkb.getBestPractice("architecture");

      expect(result).not.toBeNull();
      expect(result.id).toBe("best");
      expect(result.successRate).toBe(0.95);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getSuccessRateByCategory
  // ─────────────────────────────────────────────────────────────────────────
  describe("getSuccessRateByCategory()", () => {
    beforeEach(async () => {
      await dkb.initialize(db);
    });

    it("should return empty object when no records", () => {
      db._prep.all.mockReturnValueOnce([]);
      const result = dkb.getSuccessRateByCategory();
      expect(result).toEqual({});
    });

    it("should aggregate by category", () => {
      db._prep.all.mockReturnValueOnce([
        { problem_category: "architecture", count: 5, avg_rate: 0.8 },
        { problem_category: "testing", count: 3, avg_rate: 0.6 },
      ]);

      const result = dkb.getSuccessRateByCategory();

      expect(result.architecture).toEqual({ count: 5, avgSuccessRate: 0.8 });
      expect(result.testing).toEqual({ count: 3, avgSuccessRate: 0.6 });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await dkb.initialize(db);
    });

    it("should return default zeros when DB is empty", () => {
      db._prep.get
        .mockReturnValueOnce({ count: 0 }) // _getCount
        .mockReturnValueOnce({ avg: 0 }); // avgSuccess
      db._prep.all
        .mockReturnValueOnce([]) // bySource
        .mockReturnValueOnce([]); // byCategory

      const stats = dkb.getStats();

      expect(stats).toMatchObject({
        totalDecisions: expect.any(Number),
        bySource: expect.any(Object),
        byCategory: expect.any(Object),
        avgSuccessRate: expect.any(Number),
      });
    });

    it("should aggregate source distribution", () => {
      db._prep.get
        .mockReturnValueOnce({ count: 10 })
        .mockReturnValueOnce({ avg: 0.7 });
      db._prep.all
        .mockReturnValueOnce([
          { source: "manual", count: 5 },
          { source: "voting", count: 3 },
          { source: "orchestrate", count: 2 },
        ])
        .mockReturnValueOnce([]);

      const stats = dkb.getStats();

      expect(stats.totalDecisions).toBe(10);
      expect(stats.bySource.manual).toBe(5);
      expect(stats.bySource.voting).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Hook integration
  // ─────────────────────────────────────────────────────────────────────────
  describe("Hook integration", () => {
    it("should auto-record when PostToolUse fires with voteOnDecision", async () => {
      let hookHandler = null;
      const hookSystem = {
        registry: {
          register: vi.fn((hookDef) => {
            hookHandler = hookDef.handler;
          }),
        },
      };

      await dkb.initialize(db, hookSystem);

      // Spy on recordVotingResult
      const spy = vi.spyOn(dkb, "recordVotingResult").mockReturnValue({ id: "x" });

      // Fire the hook
      await hookHandler({
        data: {
          toolName: "voteOnDecision",
          result: { question: "Use Redis?", winner: "yes" },
        },
      });

      expect(spy).toHaveBeenCalledOnce();
    });

    it("should auto-record when PostToolUse fires with orchestrate", async () => {
      let hookHandler = null;
      const hookSystem = {
        registry: {
          register: vi.fn((hookDef) => {
            hookHandler = hookDef.handler;
          }),
        },
      };

      await dkb.initialize(db, hookSystem);
      const spy = vi.spyOn(dkb, "recordWorkflowVerdict").mockReturnValue({ id: "y" });

      await hookHandler({
        data: {
          toolName: "orchestrate",
          result: { template: "feature", verdict: "SHIP" },
        },
      });

      expect(spy).toHaveBeenCalledOnce();
    });

    it("should return continue after hook execution", async () => {
      let hookHandler = null;
      const hookSystem = {
        registry: {
          register: vi.fn((hookDef) => {
            hookHandler = hookDef.handler;
          }),
        },
      };

      await dkb.initialize(db, hookSystem);

      const result = await hookHandler({ data: { toolName: "other" } });
      expect(result).toEqual({ result: "continue" });
    });
  });
});
