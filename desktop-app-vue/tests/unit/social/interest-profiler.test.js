/**
 * InterestProfiler Unit Tests
 *
 * Covers:
 * - Constructor: initialized=false, _profiles is Map
 * - initialize(): sets initialized
 * - _ensureTables(): calls db.exec with CREATE TABLE user_interest_profiles
 * - getProfile(): returns null for unknown user, returns parsed profile from DB
 * - updateProfile(): creates new profile if none exists, merges with decay
 * - _mergeTopics(): applies decay to existing, adds new topics
 * - _normalizeWeights(): weights sum to ~1.0
 * - Singleton: getInterestProfiler returns same instance
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
  InterestProfiler,
  getInterestProfiler,
} = require("../../../src/main/social/interest-profiler.js");

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

describe("InterestProfiler", () => {
  // ── Constructor ──────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should set initialized to false", () => {
      const profiler = new InterestProfiler({ db: mockDb });
      expect(profiler.initialized).toBe(false);
    });

    it("should initialize _profiles as a Map", () => {
      const profiler = new InterestProfiler({ db: mockDb });
      expect(profiler._profiles).toBeInstanceOf(Map);
      expect(profiler._profiles.size).toBe(0);
    });

    it("should store the database reference", () => {
      const database = { db: mockDb };
      const profiler = new InterestProfiler(database);
      expect(profiler.database).toBe(database);
    });
  });

  // ── initialize() ────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      const profiler = new InterestProfiler({ db: mockDb });
      await profiler.initialize();
      expect(profiler.initialized).toBe(true);
    });

    it("should call _ensureTables", async () => {
      const profiler = new InterestProfiler({ db: mockDb });
      const spy = vi.spyOn(profiler, "_ensureTables");
      await profiler.initialize();
      expect(spy).toHaveBeenCalled();
    });
  });

  // ── _ensureTables() ─────────────────────────────────────────────────────────
  describe("_ensureTables()", () => {
    it("should call db.exec with CREATE TABLE user_interest_profiles", () => {
      const profiler = new InterestProfiler({ db: mockDb });
      profiler._ensureTables();
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain(
        "CREATE TABLE IF NOT EXISTS user_interest_profiles",
      );
    });

    it("should create index on user_id", () => {
      const profiler = new InterestProfiler({ db: mockDb });
      profiler._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("idx_user_interest_profiles_user");
    });

    it("should not throw if database is null", () => {
      const profiler = new InterestProfiler(null);
      expect(() => profiler._ensureTables()).not.toThrow();
    });
  });

  // ── getProfile() ────────────────────────────────────────────────────────────
  describe("getProfile()", () => {
    it("should return null for unknown user not in DB", async () => {
      mockGetStmt.get.mockReturnValue(null);
      const profiler = new InterestProfiler({ db: mockDb });
      const result = await profiler.getProfile("unknown-user");
      expect(result).toBeNull();
    });

    it("should return null when database is null", async () => {
      const profiler = new InterestProfiler(null);
      const result = await profiler.getProfile("user1");
      expect(result).toBeNull();
    });

    it("should return parsed profile from DB", async () => {
      const dbRow = {
        id: "profile-1",
        user_id: "user1",
        topics: JSON.stringify({ tech: 0.6, music: 0.4 }),
        interaction_weights: JSON.stringify({ like: 0.7, share: 0.3 }),
        last_updated: 1700000000,
        update_count: 5,
      };
      mockGetStmt.get.mockReturnValue(dbRow);

      const profiler = new InterestProfiler({ db: mockDb });
      const result = await profiler.getProfile("user1");

      expect(result).not.toBeNull();
      expect(result.id).toBe("profile-1");
      expect(result.userId).toBe("user1");
      expect(result.topics).toEqual({ tech: 0.6, music: 0.4 });
      expect(result.interactionWeights).toEqual({ like: 0.7, share: 0.3 });
      expect(result.updateCount).toBe(5);
    });

    it("should return cached profile on second call", async () => {
      const dbRow = {
        id: "profile-1",
        user_id: "user1",
        topics: "{}",
        interaction_weights: "{}",
        last_updated: 1700000000,
        update_count: 1,
      };
      mockGetStmt.get.mockReturnValue(dbRow);

      const profiler = new InterestProfiler({ db: mockDb });
      const first = await profiler.getProfile("user1");
      const second = await profiler.getProfile("user1");
      expect(first).toBe(second);
      // DB prepare should only be called once since second call uses cache
      expect(mockDb.prepare).toHaveBeenCalledTimes(1);
    });
  });

  // ── updateProfile() ─────────────────────────────────────────────────────────
  describe("updateProfile()", () => {
    it("should return null for empty interactions", async () => {
      const profiler = new InterestProfiler({ db: mockDb });
      const result = await profiler.updateProfile({
        userId: "user1",
        interactions: [],
      });
      expect(result).toBeNull();
    });

    it("should create new profile if none exists", async () => {
      mockGetStmt.get.mockReturnValue(null);
      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes("SELECT")) {
          return mockGetStmt;
        }
        if (sql.includes("INSERT")) {
          return mockRunStmt;
        }
        return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
      });

      const profiler = new InterestProfiler({ db: mockDb });
      const result = await profiler.updateProfile({
        userId: "user1",
        interactions: [{ topics: ["tech", "ai"], weight: 2, type: "like" }],
      });

      expect(result).not.toBeNull();
      expect(result.userId).toBe("user1");
      expect(result.updateCount).toBe(1);
      expect(result.topics).toHaveProperty("tech");
      expect(result.topics).toHaveProperty("ai");
    });

    it("should merge with decay when existing profile found", async () => {
      // Set up existing profile in cache
      const profiler = new InterestProfiler({ db: mockDb });
      profiler._profiles.set("user1", {
        id: "existing-id",
        userId: "user1",
        topics: { tech: 0.6, music: 0.4 },
        interactionWeights: { like: 1.0 },
        lastUpdated: 1700000000,
        updateCount: 3,
      });

      mockDb.prepare.mockImplementation((sql) => {
        if (sql.includes("INSERT")) {
          return mockRunStmt;
        }
        if (sql.includes("SELECT")) {
          return mockGetStmt;
        }
        return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
      });

      const result = await profiler.updateProfile({
        userId: "user1",
        interactions: [{ topics: ["sports"], weight: 1, type: "share" }],
      });

      expect(result).not.toBeNull();
      expect(result.updateCount).toBe(4);
      // Old topics should be decayed, new topic added
      expect(result.topics).toHaveProperty("sports");
      expect(result.topics).toHaveProperty("tech");
    });
  });

  // ── _mergeTopics() ──────────────────────────────────────────────────────────
  describe("_mergeTopics()", () => {
    let profiler;
    beforeEach(() => {
      profiler = new InterestProfiler({ db: mockDb });
    });

    it("should apply decay to existing topics", () => {
      const existing = { tech: 1.0 };
      const newTopics = {};
      const merged = profiler._mergeTopics(existing, newTopics, 0.5);
      // After decay: tech = 1.0 * 0.5 = 0.5, normalized = 1.0
      expect(merged.tech).toBeCloseTo(1.0, 3);
    });

    it("should add new topics", () => {
      const existing = {};
      const newTopics = { art: 3, science: 7 };
      const merged = profiler._mergeTopics(existing, newTopics, 0.9);
      expect(merged).toHaveProperty("art");
      expect(merged).toHaveProperty("science");
    });

    it("should combine existing and new topics with decay", () => {
      const existing = { tech: 1.0 };
      const newTopics = { tech: 1.0, music: 1.0 };
      const merged = profiler._mergeTopics(existing, newTopics, 0.9);
      // tech = 1.0 * 0.9 + 1.0 = 1.9, music = 1.0
      // total = 2.9, tech_norm ~ 0.6552, music_norm ~ 0.3448
      expect(merged.tech).toBeGreaterThan(merged.music);
    });
  });

  // ── _normalizeWeights() ─────────────────────────────────────────────────────
  describe("_normalizeWeights()", () => {
    let profiler;
    beforeEach(() => {
      profiler = new InterestProfiler({ db: mockDb });
    });

    it("should normalize weights to sum to ~1.0", () => {
      const weights = { a: 3, b: 7 };
      const normalized = profiler._normalizeWeights(weights);
      const sum = Object.values(normalized).reduce((acc, v) => acc + v, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    });

    it("should return empty object for empty input", () => {
      expect(profiler._normalizeWeights({})).toEqual({});
    });

    it("should return empty object for null input", () => {
      expect(profiler._normalizeWeights(null)).toEqual({});
    });

    it("should handle single weight", () => {
      const normalized = profiler._normalizeWeights({ only: 5 });
      expect(normalized.only).toBeCloseTo(1.0, 3);
    });
  });

  // ── Singleton ───────────────────────────────────────────────────────────────
  describe("Singleton", () => {
    it("getInterestProfiler returns the same instance", () => {
      const a = getInterestProfiler();
      const b = getInterestProfiler();
      expect(a).toBe(b);
    });
  });
});
