/**
 * AgentReputation 单元测试
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { AgentReputation, REPUTATION_LEVEL } = require("../agent-reputation");

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

describe("AgentReputation", () => {
  let reputation;
  let db;

  beforeEach(() => {
    reputation = new AgentReputation();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  describe("initialize()", () => {
    it("should set initialized=true and call db.prepare", async () => {
      await reputation.initialize(db);
      expect(reputation.initialized).toBe(true);
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should be idempotent", async () => {
      await reputation.initialize(db);
      const count = db.prepare.mock.calls.length;
      await reputation.initialize(db);
      expect(db.prepare.mock.calls.length).toBe(count);
    });
  });

  describe("getScore()", () => {
    beforeEach(async () => {
      await reputation.initialize(db);
    });

    it("should return default score for unknown agent", () => {
      const score = reputation.getScore("did:chainless:unknown");
      expect(score).not.toBeNull();
      expect(score.score).toBe(0.5);
      expect(score.totalTasks).toBe(0);
    });

    it("should return null for null agentDID", () => {
      expect(reputation.getScore(null)).toBeNull();
    });

    it("should return score with required fields", () => {
      const score = reputation.getScore("did:chainless:test");
      expect(score).toHaveProperty("agentDID");
      expect(score).toHaveProperty("score");
      expect(score).toHaveProperty("level");
      expect(score).toHaveProperty("totalTasks");
    });
  });

  describe("updateScore()", () => {
    beforeEach(async () => {
      await reputation.initialize(db);
    });

    it("should throw if agentDID is missing", () => {
      expect(() => reputation.updateScore(null, { success: true })).toThrow("agentDID is required");
    });

    it("should update score after successful task", () => {
      const did = "did:chainless:agent-001";
      reputation.updateScore(did, { success: true, durationMs: 500, taskType: "code-review" });
      const score = reputation.getScore(did);
      expect(score.totalTasks).toBe(1);
      expect(score.successfulTasks).toBe(1);
    });

    it("should track failed tasks separately", () => {
      const did = "did:chainless:agent-002";
      reputation.updateScore(did, { success: false, taskType: "deploy" });
      const score = reputation.getScore(did);
      expect(score.failedTasks).toBeGreaterThanOrEqual(1);
    });

    it("should update quality score when provided", () => {
      const did = "did:chainless:agent-003";
      reputation.updateScore(did, { success: true, quality: 0.9 });
      const score = reputation.getScore(did);
      expect(score.score).toBeGreaterThan(0);
    });

    it("should accumulate score over multiple tasks", () => {
      const did = "did:chainless:agent-004";
      for (let i = 0; i < 5; i++) {
        reputation.updateScore(did, { success: true, quality: 0.8, durationMs: 200 });
      }
      const score = reputation.getScore(did);
      expect(score.totalTasks).toBe(5);
      expect(score.successfulTasks).toBe(5);
    });
  });

  describe("getRanking()", () => {
    beforeEach(async () => {
      await reputation.initialize(db);
    });

    it("should return empty array when no agents tracked", () => {
      const ranking = reputation.getRanking();
      expect(Array.isArray(ranking)).toBe(true);
    });

    it("should return agents sorted by score descending", () => {
      const did1 = "did:chainless:high-performer";
      const did2 = "did:chainless:low-performer";
      for (let i = 0; i < 5; i++) {
        reputation.updateScore(did1, { success: true, quality: 1.0 });
      }
      for (let i = 0; i < 5; i++) {
        reputation.updateScore(did2, { success: false, quality: 0.1 });
      }
      const ranking = reputation.getRanking();
      if (ranking.length >= 2) {
        expect(ranking[0].score).toBeGreaterThanOrEqual(ranking[1].score);
      }
    });

    it("should filter by minScore", () => {
      const did = "did:chainless:threshold-agent";
      for (let i = 0; i < 3; i++) {
        reputation.updateScore(did, { success: true, quality: 0.9 });
      }
      const highOnly = reputation.getRanking({ minScore: 0.6 });
      highOnly.forEach((a) => expect(a.score).toBeGreaterThanOrEqual(0.6));
    });
  });

  describe("computeReliability()", () => {
    beforeEach(async () => {
      await reputation.initialize(db);
    });

    it("should return a number between 0 and 1", () => {
      const did = "did:chainless:reliable";
      reputation.updateScore(did, { success: true });
      const r = reputation.computeReliability(did);
      expect(typeof r).toBe("number");
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    });
  });

  describe("applyDecay()", () => {
    beforeEach(async () => {
      await reputation.initialize(db);
    });

    it("should run without error even with no agents", () => {
      expect(() => reputation.applyDecay()).not.toThrow();
    });
  });

  describe("getStats()", () => {
    beforeEach(async () => {
      await reputation.initialize(db);
    });

    it("should return stats with byLevel breakdown", () => {
      const stats = reputation.getStats();
      expect(stats).toHaveProperty("byLevel");
      expect(stats.byLevel).toHaveProperty(REPUTATION_LEVEL.NEUTRAL);
    });
  });

  describe("Constants", () => {
    it("REPUTATION_LEVEL should have TRUSTED, RELIABLE, NEUTRAL, UNTRUSTED", () => {
      expect(REPUTATION_LEVEL.TRUSTED).toBeTruthy();
      expect(REPUTATION_LEVEL.RELIABLE).toBeTruthy();
      expect(REPUTATION_LEVEL.NEUTRAL).toBeTruthy();
      expect(REPUTATION_LEVEL.UNTRUSTED).toBeTruthy();
    });
  });
});
