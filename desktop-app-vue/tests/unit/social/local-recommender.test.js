/**
 * LocalRecommender Unit Tests
 *
 * Covers:
 * - Constructor: initialized=false, database set, _cache is Map, _interestProfiler null
 * - initialize(): sets initialized, calls _ensureTables
 * - _ensureTables(): calls db.exec with CREATE TABLE content_recommendations
 * - setInterestProfiler(): sets _interestProfiler
 * - getRecommendations(): returns empty for no results, queries DB with correct params
 * - markViewed(): calls UPDATE with viewed_at
 * - provideFeedback(): calls UPDATE on status
 * - _cosineSimilarity(): returns 1.0 for identical, 0 for orthogonal, correct for known vectors
 * - getStats(): returns counts
 * - Singleton: getLocalRecommender returns same instance
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock uuid ────────────────────────────────────────────────────────────────
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ─── Module under test ───────────────────────────────────────────────────────
const {
  LocalRecommender,
  getLocalRecommender,
} = require("../../../src/main/social/local-recommender.js");

// ─── DB mock factory ─────────────────────────────────────────────────────────
let mockRunStmt, mockGetStmt, mockAllStmt, mockDb;

beforeEach(() => {
  uuidCounter = 0;
  mockRunStmt = { run: vi.fn() };
  mockGetStmt = { get: vi.fn(() => null) };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (
        sql.includes("INSERT") ||
        sql.includes("UPDATE") ||
        sql.includes("DELETE")
      ) {
        return mockRunStmt;
      }
      if (
        sql.includes("SELECT") &&
        (sql.includes("= ?") || sql.includes("id"))
      ) {
        return mockGetStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
    saveToFile: vi.fn(),
  };
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("LocalRecommender", () => {
  // ── Constructor ──────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should set initialized to false", () => {
      const rec = new LocalRecommender({ db: mockDb });
      expect(rec.initialized).toBe(false);
    });

    it("should store the database reference", () => {
      const database = { db: mockDb };
      const rec = new LocalRecommender(database);
      expect(rec.database).toBe(database);
    });

    it("should initialize _cache as a Map", () => {
      const rec = new LocalRecommender({ db: mockDb });
      expect(rec._cache).toBeInstanceOf(Map);
      expect(rec._cache.size).toBe(0);
    });

    it("should initialize _interestProfiler as null", () => {
      const rec = new LocalRecommender({ db: mockDb });
      expect(rec._interestProfiler).toBeNull();
    });
  });

  // ── initialize() ────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      const rec = new LocalRecommender({ db: mockDb });
      await rec.initialize();
      expect(rec.initialized).toBe(true);
    });

    it("should call _ensureTables", async () => {
      const rec = new LocalRecommender({ db: mockDb });
      const spy = vi.spyOn(rec, "_ensureTables");
      await rec.initialize();
      expect(spy).toHaveBeenCalled();
    });
  });

  // ── _ensureTables() ─────────────────────────────────────────────────────────
  describe("_ensureTables()", () => {
    it("should call db.exec with CREATE TABLE content_recommendations", () => {
      const rec = new LocalRecommender({ db: mockDb });
      rec._ensureTables();
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain(
        "CREATE TABLE IF NOT EXISTS content_recommendations",
      );
    });

    it("should create indexes for user_id and score", () => {
      const rec = new LocalRecommender({ db: mockDb });
      rec._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("idx_content_recommendations_user");
      expect(sql).toContain("idx_content_recommendations_score");
    });

    it("should not throw if database is null", () => {
      const rec = new LocalRecommender(null);
      expect(() => rec._ensureTables()).not.toThrow();
    });
  });

  // ── setInterestProfiler() ───────────────────────────────────────────────────
  describe("setInterestProfiler()", () => {
    it("should set _interestProfiler", () => {
      const rec = new LocalRecommender({ db: mockDb });
      const profiler = { getProfile: vi.fn() };
      rec.setInterestProfiler(profiler);
      expect(rec._interestProfiler).toBe(profiler);
    });
  });

  // ── getRecommendations() ────────────────────────────────────────────────────
  describe("getRecommendations()", () => {
    it("should return empty array when no results", async () => {
      mockAllStmt.all.mockReturnValue([]);
      // prepare returns allStmt for SELECT queries
      mockDb.prepare.mockReturnValue(mockAllStmt);
      const rec = new LocalRecommender({ db: mockDb });
      const results = await rec.getRecommendations({
        userId: "user1",
        limit: 10,
      });
      expect(results).toEqual([]);
    });

    it("should return empty array when database is null", async () => {
      const rec = new LocalRecommender(null);
      const results = await rec.getRecommendations({ userId: "user1" });
      expect(results).toEqual([]);
    });

    it("should query DB with correct default params (limit=20, minScore=0.3)", async () => {
      const rows = [
        { id: "r1", user_id: "user1", content_id: "c1", score: 0.9 },
      ];
      mockAllStmt.all.mockReturnValue(rows);
      mockDb.prepare.mockReturnValue(mockAllStmt);

      const rec = new LocalRecommender({ db: mockDb });
      const results = await rec.getRecommendations({ userId: "user1" });

      expect(mockDb.prepare).toHaveBeenCalled();
      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain("user_id = ?");
      expect(sql).toContain("score >= ?");
      expect(sql).toContain("LIMIT ?");
      // Called with userId, minScore, limit
      expect(mockAllStmt.all).toHaveBeenCalledWith("user1", 0.3, 20);
      expect(results).toEqual(rows);
    });

    it("should add content_type filter when provided", async () => {
      mockAllStmt.all.mockReturnValue([]);
      mockDb.prepare.mockReturnValue(mockAllStmt);

      const rec = new LocalRecommender({ db: mockDb });
      await rec.getRecommendations({
        userId: "user1",
        contentType: "article",
        limit: 5,
        minScore: 0.5,
      });

      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain("content_type = ?");
      expect(mockAllStmt.all).toHaveBeenCalledWith("user1", 0.5, "article", 5);
    });
  });

  // ── markViewed() ────────────────────────────────────────────────────────────
  describe("markViewed()", () => {
    it("should call UPDATE with viewed_at for the given id", async () => {
      mockDb.prepare.mockReturnValue(mockRunStmt);
      const rec = new LocalRecommender({ db: mockDb });
      const result = await rec.markViewed("rec-123");

      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalled();
      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain("UPDATE content_recommendations");
      expect(sql).toContain("viewed_at");
      expect(mockRunStmt.run).toHaveBeenCalledWith(
        expect.any(Number),
        "rec-123",
      );
    });

    it("should return false when database is null", async () => {
      const rec = new LocalRecommender(null);
      const result = await rec.markViewed("rec-123");
      expect(result).toBe(false);
    });
  });

  // ── provideFeedback() ───────────────────────────────────────────────────────
  describe("provideFeedback()", () => {
    it("should call UPDATE on status with feedback value", async () => {
      mockDb.prepare.mockReturnValue(mockRunStmt);
      const rec = new LocalRecommender({ db: mockDb });
      const result = await rec.provideFeedback({
        recommendationId: "rec-1",
        feedback: "liked",
      });

      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalled();
      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain("UPDATE content_recommendations");
      expect(sql).toContain("status = ?");
      expect(mockRunStmt.run).toHaveBeenCalledWith("liked", "rec-1");
    });

    it("should return false when database is null", async () => {
      const rec = new LocalRecommender(null);
      const result = await rec.provideFeedback({
        recommendationId: "r1",
        feedback: "dismissed",
      });
      expect(result).toBe(false);
    });
  });

  // ── _cosineSimilarity() ─────────────────────────────────────────────────────
  describe("_cosineSimilarity()", () => {
    let rec;
    beforeEach(() => {
      rec = new LocalRecommender({ db: mockDb });
    });

    it("should return 1.0 for identical vectors", () => {
      const vec = [1, 2, 3];
      const result = rec._cosineSimilarity(vec, vec);
      expect(result).toBeCloseTo(1.0, 5);
    });

    it("should return 0 for orthogonal vectors", () => {
      const result = rec._cosineSimilarity([1, 0], [0, 1]);
      expect(result).toBeCloseTo(0, 5);
    });

    it("should return correct value for known vectors", () => {
      // cos([1,0,1], [0,1,1]) = 1 / (sqrt(2)*sqrt(2)) = 0.5
      const result = rec._cosineSimilarity([1, 0, 1], [0, 1, 1]);
      expect(result).toBeCloseTo(0.5, 5);
    });

    it("should return 0 for empty vectors", () => {
      expect(rec._cosineSimilarity([], [])).toBe(0);
    });

    it("should return 0 for null vectors", () => {
      expect(rec._cosineSimilarity(null, [1, 2])).toBe(0);
      expect(rec._cosineSimilarity([1, 2], null)).toBe(0);
    });
  });

  // ── getStats() ──────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    it("should return aggregated counts from DB", async () => {
      const groupRows = [
        { status: "pending", count: 5 },
        { status: "liked", count: 3 },
        { status: "dismissed", count: 2 },
      ];
      const viewedRow = { count: 4 };

      let callCount = 0;
      mockDb.prepare.mockImplementation((sql) => {
        callCount++;
        if (sql.includes("GROUP BY")) {
          return { all: vi.fn(() => groupRows) };
        }
        if (sql.includes("viewed_at IS NOT NULL")) {
          return { get: vi.fn(() => viewedRow) };
        }
        return mockAllStmt;
      });

      const rec = new LocalRecommender({ db: mockDb });
      const stats = await rec.getStats("user1");

      expect(stats.total).toBe(10);
      expect(stats.pending).toBe(5);
      expect(stats.liked).toBe(3);
      expect(stats.dismissed).toBe(2);
      expect(stats.viewed).toBe(4);
    });

    it("should return zeroes when database is null", async () => {
      const rec = new LocalRecommender(null);
      const stats = await rec.getStats("user1");
      expect(stats).toEqual({
        total: 0,
        pending: 0,
        liked: 0,
        dismissed: 0,
        saved: 0,
        viewed: 0,
      });
    });
  });

  // ── Singleton ───────────────────────────────────────────────────────────────
  describe("Singleton", () => {
    it("getLocalRecommender returns the same instance", () => {
      const a = getLocalRecommender();
      const b = getLocalRecommender();
      expect(a).toBe(b);
    });
  });
});
