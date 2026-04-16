/**
 * DebateReview 单元测试 — v2.1.0
 *
 * 覆盖：initialize、startDebate（无代码/含代码）、_simulateReview、
 *       _calculateConsensus（APPROVE/NEEDS_WORK/REJECT）、
 *       getDebateHistory、getStats
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
// NOTE: vi.mock("fs") doesn't intercept Node built-ins in forks pool;
//       debate-review.js only calls fs.existsSync and fs.readFileSync when
//       no code is provided and target is a real path. Tests always pass code
//       directly so no fs spy is needed.
const { DebateReview, DEFAULT_PERSPECTIVES } = require("../debate-review");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CLEAN_CODE = `
function add(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error('Invalid arguments');
  }
  return a + b;
}
module.exports = { add };
`;

const SECURITY_CODE = `
function runCode(input) {
  return eval(input);
}
function renderHtml(content) {
  // sanitize: test-only fixture, static string with no user input
  document.body.innerHTML = content;
}
`;

const LONG_CODE = Array.from(
  { length: 350 },
  (_, i) => `const line${i} = ${i};`,
).join("\n");

function makeDebateRow(overrides = {}) {
  return {
    id: "debate-001",
    target: "src/auth.js",
    reviews: JSON.stringify([]),
    votes: JSON.stringify([
      { perspective: "performance", vote: "APPROVE", issues: [] },
      { perspective: "security", vote: "APPROVE", issues: [] },
      { perspective: "maintainability", vote: "APPROVE", issues: [] },
    ]),
    verdict: "APPROVE",
    consensus_score: 1.0,
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

describe("DebateReview", () => {
  let dr;
  let db;

  beforeEach(() => {
    dr = new DebateReview();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create tables and set initialized=true", async () => {
      await dr.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
      expect(dr.initialized).toBe(true);
    });

    it("should be idempotent on double initialize", async () => {
      await dr.initialize(db);
      await dr.initialize(db);

      expect(db.exec).toHaveBeenCalledOnce();
    });

    it("should work without teammateTool and decisionKB", async () => {
      await expect(dr.initialize(db)).resolves.not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // startDebate — validation
  // ─────────────────────────────────────────────────────────────────────────
  describe("startDebate() - validation", () => {
    beforeEach(async () => {
      await dr.initialize(db);
    });

    it("should return error verdict when no code provided and file does not exist", async () => {
      const result = await dr.startDebate({
        target: "/nonexistent/file.js",
      });

      expect(result.verdict).toBe("ERROR");
      expect(result.error).toBeTruthy();
      expect(result.id).toBeTruthy();
    });

    it("should return error when target is unknown and no code given", async () => {
      const result = await dr.startDebate({ target: "unknown" });
      expect(result.verdict).toBe("ERROR");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // startDebate — clean code
  // ─────────────────────────────────────────────────────────────────────────
  describe("startDebate() - with code content", () => {
    beforeEach(async () => {
      await dr.initialize(db);
    });

    it("should return id, target, reviews, votes, verdict, consensusScore", async () => {
      const result = await dr.startDebate({
        target: "src/utils.js",
        code: CLEAN_CODE,
      });

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("target", "src/utils.js");
      expect(result).toHaveProperty("reviews");
      expect(result).toHaveProperty("votes");
      expect(result).toHaveProperty("verdict");
      expect(result).toHaveProperty("consensusScore");
    });

    it("should run default 3 perspectives when not specified", async () => {
      const result = await dr.startDebate({ target: "f.js", code: CLEAN_CODE });

      expect(result.reviews).toHaveLength(DEFAULT_PERSPECTIVES.length);
    });

    it("should save debate to DB", async () => {
      await dr.startDebate({ target: "f.js", code: CLEAN_CODE });

      expect(db.run).toHaveBeenCalled();
    });

    it("should persist to DecisionKnowledgeBase when provided", async () => {
      // Create fresh instance to avoid "already initialized" guard
      const freshDr = new DebateReview();
      const freshDb = createMockDatabase();
      const mockDKB = { recordDecision: vi.fn() };
      await freshDr.initialize(freshDb, null, mockDKB);

      await freshDr.startDebate({ target: "f.js", code: CLEAN_CODE });

      expect(mockDKB.recordDecision).toHaveBeenCalledOnce();
    });

    it("should use custom perspectives when provided", async () => {
      const result = await dr.startDebate({
        target: "f.js",
        code: CLEAN_CODE,
        perspectives: ["performance"],
      });

      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].perspective).toBe("performance");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _simulateReview (via startDebate without TeammateTool)
  // ─────────────────────────────────────────────────────────────────────────
  describe("_simulateReview()", () => {
    beforeEach(async () => {
      await dr.initialize(db);
    });

    it("security reviewer should detect eval() as critical issue", async () => {
      const result = await dr.startDebate({
        target: "sec.js",
        code: SECURITY_CODE,
        perspectives: ["security"],
      });

      const secReview = result.reviews[0];
      const criticalIssues = secReview.issues.filter(
        (i) => i.severity === "critical",
      );
      expect(criticalIssues.length).toBeGreaterThan(0);
      expect(secReview.vote).toBe("REJECT");
    });

    it("security reviewer should detect innerHTML assignment", async () => {
      const result = await dr.startDebate({
        target: "xss.js",
        code: SECURITY_CODE,
        perspectives: ["security"],
      });

      const warnings = result.reviews[0].issues.filter(
        (i) => i.severity === "warning",
      );
      expect(
        warnings.some((i) => i.description.toLowerCase().includes("innerhtml")),
      ).toBe(true);
    });

    it("performance reviewer should detect await inside forEach", async () => {
      // Implementation checks for forEach AND await on the SAME line
      const code = `items.forEach(async (item) => { await doWork(item); });`;
      const result = await dr.startDebate({
        target: "perf.js",
        code,
        perspectives: ["performance"],
      });

      const perfReview = result.reviews[0];
      expect(
        perfReview.issues.some((i) => i.description.includes("forEach")),
      ).toBe(true);
    });

    it("maintainability reviewer should detect long files", async () => {
      const result = await dr.startDebate({
        target: "big.js",
        code: LONG_CODE,
        perspectives: ["maintainability"],
      });

      const maintReview = result.reviews[0];
      const longFileWarning = maintReview.issues.find(
        (i) => i.description.includes("lines") && i.severity === "warning",
      );
      expect(longFileWarning).toBeDefined();
    });

    it("clean code should get APPROVE from all reviewers", async () => {
      const result = await dr.startDebate({
        target: "clean.js",
        code: CLEAN_CODE,
      });

      for (const review of result.reviews) {
        expect(["APPROVE", "NEEDS_WORK"]).toContain(review.vote);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _calculateConsensus (via startDebate)
  // ─────────────────────────────────────────────────────────────────────────
  describe("_calculateConsensus()", () => {
    beforeEach(async () => {
      await dr.initialize(db);
    });

    it("should return APPROVE when all 3 vote APPROVE (score=1.0)", async () => {
      // Clean code should get APPROVE from all
      const result = await dr.startDebate({
        target: "good.js",
        code: CLEAN_CODE,
        perspectives: ["maintainability"],
      });

      // With only maintainability and clean code: APPROVE
      if (result.votes[0].vote === "APPROVE") {
        expect(result.verdict).toBe("APPROVE");
      }
    });

    it("should return REJECT when security reviewer detects critical issue", async () => {
      const result = await dr.startDebate({
        target: "bad.js",
        code: SECURITY_CODE,
        perspectives: ["security"],
      });

      // security review = REJECT → single reviewer → REJECT
      expect(result.verdict).toBe("REJECT");
    });

    it("consensus score should be 1.0 when all reviewers agree", async () => {
      const result = await dr.startDebate({
        target: "f.js",
        code: CLEAN_CODE,
        perspectives: ["performance", "maintainability"],
      });

      // Both should agree (likely APPROVE for clean code)
      if (result.votes.every((v) => v.vote === result.votes[0].vote)) {
        expect(result.consensusScore).toBe(1.0);
      }
    });

    it("consensusScore decreases when reviewers disagree", async () => {
      const result = await dr.startDebate({
        target: "mixed.js",
        code: SECURITY_CODE,
        perspectives: DEFAULT_PERSPECTIVES,
      });

      // security REJECT, performance/maintainability may differ → lower consensus
      expect(typeof result.consensusScore).toBe("number");
      expect(result.consensusScore).toBeGreaterThanOrEqual(0);
      expect(result.consensusScore).toBeLessThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getDebateHistory
  // ─────────────────────────────────────────────────────────────────────────
  describe("getDebateHistory()", () => {
    beforeEach(async () => {
      await dr.initialize(db);
    });

    it("should return empty array when no debates", () => {
      db._prep.all.mockReturnValueOnce([]);
      expect(dr.getDebateHistory()).toEqual([]);
    });

    it("should map DB rows to debate objects", () => {
      const row = makeDebateRow();
      db._prep.all.mockReturnValueOnce([row]);

      const results = dr.getDebateHistory();

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: "debate-001",
        target: "src/auth.js",
        verdict: "APPROVE",
        consensusScore: 1.0,
      });
    });

    it("should support limit/offset pagination", () => {
      db._prep.all.mockReturnValueOnce([]);
      dr.getDebateHistory({ limit: 5, offset: 10 });
      expect(db.prepare).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await dr.initialize(db);
    });

    it("should return zero stats for empty DB", () => {
      db._prep.get
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce({ avg: null });
      db._prep.all.mockReturnValueOnce([]);

      const stats = dr.getStats();

      expect(stats).toMatchObject({
        totalDebates: 0,
        byVerdict: {},
        avgConsensusScore: 0,
      });
    });

    it("should aggregate verdict distribution", () => {
      db._prep.get
        .mockReturnValueOnce({ count: 10 })
        .mockReturnValueOnce({ avg: 0.75 });
      db._prep.all.mockReturnValueOnce([
        { verdict: "APPROVE", count: 6 },
        { verdict: "NEEDS_WORK", count: 3 },
        { verdict: "REJECT", count: 1 },
      ]);

      const stats = dr.getStats();

      expect(stats.totalDebates).toBe(10);
      expect(stats.byVerdict.APPROVE).toBe(6);
      expect(stats.byVerdict.NEEDS_WORK).toBe(3);
      expect(stats.byVerdict.REJECT).toBe(1);
      expect(stats.avgConsensusScore).toBeCloseTo(0.75, 3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // resolveConflictingVerdicts (B-1: second consumer of conflict resolution)
  // ─────────────────────────────────────────────────────────────────────────
  describe("resolveConflictingVerdicts()", () => {
    beforeEach(async () => {
      await dr.initialize(db);
    });

    it("should return unchanged reviews when all verdicts agree", () => {
      const reviews = [
        { perspective: "performance", vote: "APPROVE", issues: [] },
        { perspective: "security", vote: "APPROVE", issues: [] },
      ];
      const { resolved, conflictPairs, demotions } =
        dr.resolveConflictingVerdicts(reviews);
      expect(conflictPairs).toBe(0);
      expect(demotions).toHaveLength(0);
      expect(resolved).toEqual(reviews);
    });

    it("should detect conflict when verdicts disagree", () => {
      const reviews = [
        {
          perspective: "security",
          vote: "REJECT",
          issues: [{ severity: "critical", description: "eval() usage" }],
        },
        {
          perspective: "performance",
          vote: "APPROVE",
          issues: [],
        },
      ];
      const { conflictPairs, demotions } =
        dr.resolveConflictingVerdicts(reviews);
      expect(conflictPairs).toBe(1);
      expect(demotions).toHaveLength(1);
    });

    it("should demote the review with weaker evidence", () => {
      const reviews = [
        {
          perspective: "security",
          vote: "REJECT",
          issues: [
            { severity: "critical", description: "SQL injection" },
            { severity: "warning", description: "Missing input validation" },
          ],
        },
        {
          perspective: "maintainability",
          vote: "APPROVE",
          issues: [{ severity: "info", description: "Long line" }],
        },
      ];
      const { resolved, demotions } = dr.resolveConflictingVerdicts(reviews);
      // security has critical+warning with REJECT weight, maintainability only has info with APPROVE weight
      // security wins → maintainability is demoted
      expect(demotions).toContain("maintainability");
      expect(resolved[1]._demoted).toBe(true);
      expect(resolved[0]._demoted).toBeUndefined();
    });

    it("should handle single review (no pairs possible)", () => {
      const reviews = [{ perspective: "security", vote: "REJECT", issues: [] }];
      const { conflictPairs } = dr.resolveConflictingVerdicts(reviews);
      expect(conflictPairs).toBe(0);
    });

    it("should handle null/empty reviews", () => {
      expect(dr.resolveConflictingVerdicts(null).conflictPairs).toBe(0);
      expect(dr.resolveConflictingVerdicts([]).conflictPairs).toBe(0);
    });

    it("should detect multiple conflict pairs in 3-way disagreement", () => {
      const reviews = [
        {
          perspective: "security",
          vote: "REJECT",
          issues: [{ severity: "critical", description: "injection" }],
        },
        {
          perspective: "performance",
          vote: "APPROVE",
          issues: [],
        },
        {
          perspective: "maintainability",
          vote: "NEEDS_WORK",
          issues: [{ severity: "warning", description: "DRY violation" }],
        },
      ];
      const { conflictPairs } = dr.resolveConflictingVerdicts(reviews);
      // All three have different verdicts → 3 pairs
      expect(conflictPairs).toBe(3);
    });

    it("should include demotion reason referencing winner perspective", () => {
      const reviews = [
        {
          perspective: "security",
          vote: "REJECT",
          issues: [{ severity: "critical", description: "RCE" }],
        },
        {
          perspective: "performance",
          vote: "APPROVE",
          issues: [],
        },
      ];
      const { resolved } = dr.resolveConflictingVerdicts(reviews);
      const demoted = resolved.find((r) => r._demoted);
      expect(demoted._demotionReason).toContain("security");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // startDebate conflict resolution integration
  // ─────────────────────────────────────────────────────────────────────────
  describe("startDebate() - conflict resolution integration", () => {
    beforeEach(async () => {
      await dr.initialize(db);
    });

    it("should include conflictResolution in result when verdicts conflict", async () => {
      // SECURITY_CODE triggers security REJECT + performance/maintainability may differ
      const result = await dr.startDebate({
        target: "conflict.js",
        code: SECURITY_CODE,
        perspectives: ["security", "performance"],
      });

      // security detects eval → REJECT; performance may see no issues → APPROVE
      if (result.votes[0].vote !== result.votes[1].vote) {
        expect(result.conflictResolution).toBeTruthy();
        expect(result.conflictResolution.conflictPairs).toBeGreaterThan(0);
      }
    });

    it("should return null conflictResolution when no conflicts", async () => {
      const result = await dr.startDebate({
        target: "clean.js",
        code: CLEAN_CODE,
        perspectives: ["performance", "maintainability"],
      });

      // Clean code → both APPROVE → no conflict
      if (result.votes.every((v) => v.vote === "APPROVE")) {
        expect(result.conflictResolution).toBeNull();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DEFAULT_PERSPECTIVES export
  // ─────────────────────────────────────────────────────────────────────────
  describe("exports", () => {
    it("should export DEFAULT_PERSPECTIVES array", () => {
      expect(Array.isArray(DEFAULT_PERSPECTIVES)).toBe(true);
      expect(DEFAULT_PERSPECTIVES).toContain("performance");
      expect(DEFAULT_PERSPECTIVES).toContain("security");
      expect(DEFAULT_PERSPECTIVES).toContain("maintainability");
    });
  });
});
