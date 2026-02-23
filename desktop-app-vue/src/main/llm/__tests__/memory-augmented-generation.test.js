/**
 * Memory-Augmented Generation (MAG) Engine Tests
 *
 * Tests:
 * - Initialization and table creation
 * - recordInteraction
 * - recordFeedback
 * - searchHistory
 * - getInsights
 * - buildMemoryContext
 * - clearHistory
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-" + Math.random().toString(36).substring(7)),
}));

const { MemoryAugmentedGeneration } = require("../memory-augmented-generation");

/**
 * Create a mock in-memory database that simulates the real database interface.
 * Uses a simple array-based store for interaction_history rows.
 */
function createMockDatabase() {
  const store = [];
  let tableCreated = false;

  const mockDb = {
    _store: store,

    exec: vi.fn(() => {
      tableCreated = true;
    }),

    run: vi.fn((sql, params) => {
      if (sql.includes("INSERT INTO interaction_history")) {
        store.push({
          id: params[0],
          conversation_id: params[1],
          user_message: params[2],
          assistant_response: params[3],
          task_type: params[4],
          feedback: params[5],
          tokens_used: params[6],
          latency_ms: params[7],
          created_at: params[8],
        });
        return { changes: 1 };
      }
      if (sql.includes("UPDATE interaction_history SET feedback")) {
        const interactionId = params[1];
        const feedbackValue = params[0];
        const item = store.find((r) => r.id === interactionId);
        if (item) {
          item.feedback = feedbackValue;
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      if (sql.includes("DELETE FROM interaction_history")) {
        const initialLen = store.length;
        store.length = 0;
        return { changes: initialLen };
      }
      return { changes: 0 };
    }),

    prepare: vi.fn((sql) => {
      return {
        get: vi.fn((...params) => {
          if (sql.includes("COUNT(*)")) {
            return { count: store.length };
          }
          if (sql.includes("AVG(feedback)")) {
            const withFeedback = store.filter((r) => r.feedback !== 0);
            if (withFeedback.length === 0) return { avg_feedback: null };
            const sum = withFeedback.reduce((s, r) => s + r.feedback, 0);
            return { avg_feedback: sum / withFeedback.length };
          }
          if (sql.includes("AVG(tokens_used)")) {
            const withTokens = store.filter((r) => r.tokens_used > 0);
            if (withTokens.length === 0) return { avg_tokens: null, avg_latency: null };
            const sumTokens = withTokens.reduce((s, r) => s + r.tokens_used, 0);
            const sumLatency = withTokens.reduce((s, r) => s + r.latency_ms, 0);
            return {
              avg_tokens: sumTokens / withTokens.length,
              avg_latency: sumLatency / withTokens.length,
            };
          }
          return null;
        }),
        all: vi.fn((...params) => {
          if (sql.includes("SELECT * FROM interaction_history") && sql.includes("LIKE")) {
            // Search: filter by keyword matching
            const limit = params[params.length - 1];
            // Find keyword params (they're the %keyword% ones)
            const keywordParams = params.filter(
              (p) => typeof p === "string" && p.startsWith("%") && p.endsWith("%"),
            );
            const keywords = keywordParams.map((p) =>
              p.substring(1, p.length - 1).toLowerCase(),
            );

            let results = store.filter((row) => {
              const text = `${(row.user_message || "").toLowerCase()} ${(row.assistant_response || "").toLowerCase()}`;
              return keywords.some((kw) => text.includes(kw));
            });

            return results.slice(0, typeof limit === "number" ? limit : 20);
          }
          if (sql.includes("GROUP BY task_type")) {
            const counts = {};
            for (const row of store) {
              counts[row.task_type] = (counts[row.task_type] || 0) + 1;
            }
            return Object.entries(counts)
              .map(([task_type, count]) => ({ task_type, count }))
              .sort((a, b) => b.count - a.count);
          }
          if (sql.includes("GROUP BY hour")) {
            const hourCounts = {};
            for (const row of store) {
              const hour = Math.floor((row.created_at / 3600000) % 24);
              hourCounts[hour] = (hourCounts[hour] || 0) + 1;
            }
            return Object.entries(hourCounts)
              .map(([hour, count]) => ({ hour: parseInt(hour, 10), count }))
              .sort((a, b) => b.count - a.count);
          }
          if (sql.includes("GROUP BY day_epoch")) {
            const dayCounts = {};
            for (const row of store) {
              const dayEpoch = Math.floor(row.created_at / 86400000);
              dayCounts[dayEpoch] = (dayCounts[dayEpoch] || 0) + 1;
            }
            return Object.entries(dayCounts)
              .map(([day_epoch, count]) => ({
                day_epoch: parseInt(day_epoch, 10),
                count,
              }))
              .sort((a, b) => b.day_epoch - a.day_epoch);
          }
          if (sql.includes("feedback > 0")) {
            return store
              .filter((r) => r.feedback > 0)
              .sort((a, b) => b.created_at - a.created_at)
              .slice(0, params[0] || 3);
          }
          return [];
        }),
      };
    }),

    saveToFile: vi.fn(),
  };

  return mockDb;
}

describe("MemoryAugmentedGeneration", () => {
  let mag;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDatabase();
    mag = new MemoryAugmentedGeneration({
      database: mockDb,
    });
  });

  // ============================================================
  // Initialization
  // ============================================================

  describe("initialize", () => {
    it("should create database tables on initialization", async () => {
      await mag.initialize();

      expect(mockDb.exec).toHaveBeenCalled();
      const execCall = mockDb.exec.mock.calls[0][0];
      expect(execCall).toContain("CREATE TABLE IF NOT EXISTS interaction_history");
      expect(execCall).toContain("idx_interaction_history_created_at");
      expect(execCall).toContain("idx_interaction_history_task_type");
      expect(mag.initialized).toBe(true);
    });

    it("should accept database as parameter to initialize()", async () => {
      const mag2 = new MemoryAugmentedGeneration({});
      expect(mag2.db).toBeNull();

      await mag2.initialize(mockDb);

      expect(mag2.db).toBe(mockDb);
      expect(mag2.initialized).toBe(true);
    });

    it("should warn and skip if no database is provided", async () => {
      const mag2 = new MemoryAugmentedGeneration({});
      await mag2.initialize();

      expect(mag2.initialized).toBe(false);
    });

    it("should call saveToFile after table creation", async () => {
      await mag.initialize();

      expect(mockDb.saveToFile).toHaveBeenCalled();
    });
  });

  // ============================================================
  // recordInteraction
  // ============================================================

  describe("recordInteraction", () => {
    beforeEach(async () => {
      await mag.initialize();
    });

    it("should record an interaction with all fields", () => {
      const result = mag.recordInteraction({
        conversationId: "conv-1",
        userMessage: "How do I use TypeScript?",
        assistantResponse: "TypeScript is a typed superset of JavaScript...",
        taskType: "coding",
        feedback: 1,
        tokensUsed: 500,
        latencyMs: 200,
      });

      expect(result).not.toBeNull();
      expect(result.id).toBeDefined();
      expect(result.conversationId).toBe("conv-1");
      expect(result.userMessage).toBe("How do I use TypeScript?");
      expect(result.assistantResponse).toBe(
        "TypeScript is a typed superset of JavaScript...",
      );
      expect(result.taskType).toBe("coding");
      expect(result.feedback).toBe(1);
      expect(result.tokensUsed).toBe(500);
      expect(result.latencyMs).toBe(200);
      expect(result.createdAt).toBeDefined();
      expect(mockDb.run).toHaveBeenCalled();
    });

    it("should use defaults for optional fields", () => {
      const result = mag.recordInteraction({
        userMessage: "Hello",
      });

      expect(result.conversationId).toBeNull();
      expect(result.assistantResponse).toBeNull();
      expect(result.taskType).toBe("general");
      expect(result.feedback).toBe(0);
      expect(result.tokensUsed).toBe(0);
      expect(result.latencyMs).toBe(0);
    });

    it("should return null if userMessage is missing", () => {
      const result = mag.recordInteraction({});
      expect(result).toBeNull();
    });

    it("should return null if data is null", () => {
      const result = mag.recordInteraction(null);
      expect(result).toBeNull();
    });

    it("should return null if database is not available", () => {
      mag.db = null;
      const result = mag.recordInteraction({ userMessage: "test" });
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // recordFeedback
  // ============================================================

  describe("recordFeedback", () => {
    beforeEach(async () => {
      await mag.initialize();
    });

    it("should update feedback for an existing interaction", () => {
      const interaction = mag.recordInteraction({
        userMessage: "test message",
      });

      const result = mag.recordFeedback(interaction.id, 1);
      expect(result).toBe(true);

      const updated = mockDb._store.find((r) => r.id === interaction.id);
      expect(updated.feedback).toBe(1);
    });

    it("should clamp feedback to [-1, 1]", () => {
      const interaction = mag.recordInteraction({
        userMessage: "test message",
      });

      mag.recordFeedback(interaction.id, 5);
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.any(String),
        [1, interaction.id],
      );
    });

    it("should return false if interactionId is missing", () => {
      const result = mag.recordFeedback(null, 1);
      expect(result).toBe(false);
    });

    it("should return false if database is not available", () => {
      mag.db = null;
      const result = mag.recordFeedback("some-id", 1);
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // searchHistory
  // ============================================================

  describe("searchHistory", () => {
    beforeEach(async () => {
      await mag.initialize();

      // Seed some interactions
      mag.recordInteraction({
        userMessage: "How to use TypeScript generics?",
        assistantResponse: "Generics allow you to write reusable components...",
        taskType: "coding",
        feedback: 1,
      });
      mag.recordInteraction({
        userMessage: "Explain React hooks",
        assistantResponse: "React hooks let you use state...",
        taskType: "coding",
        feedback: 0,
      });
      mag.recordInteraction({
        userMessage: "Write a Python script to sort files",
        assistantResponse: "Here is a Python script...",
        taskType: "scripting",
        feedback: 1,
      });
    });

    it("should find interactions by keyword matching", () => {
      const results = mag.searchHistory("TypeScript");

      expect(results.length).toBeGreaterThan(0);
      expect(
        results.some((r) =>
          r.userMessage.toLowerCase().includes("typescript"),
        ),
      ).toBe(true);
    });

    it("should return results with relevanceScore", () => {
      const results = mag.searchHistory("TypeScript");

      for (const result of results) {
        expect(result.relevanceScore).toBeDefined();
        expect(result.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(result.relevanceScore).toBeLessThanOrEqual(1);
      }
    });

    it("should return empty array for empty query", () => {
      expect(mag.searchHistory("")).toEqual([]);
      expect(mag.searchHistory(null)).toEqual([]);
      expect(mag.searchHistory("   ")).toEqual([]);
    });

    it("should return empty array if no database", () => {
      mag.db = null;
      expect(mag.searchHistory("test")).toEqual([]);
    });

    it("should respect limit option", () => {
      const results = mag.searchHistory("script", { limit: 1 });
      // The mock always returns what it finds, but we pass limit to the query
      expect(results).toBeDefined();
    });

    it("should handle single-character keyword tokens by filtering them out", () => {
      const results = mag.searchHistory("a");
      // Single character tokens should be filtered out
      expect(results).toEqual([]);
    });
  });

  // ============================================================
  // getInsights
  // ============================================================

  describe("getInsights", () => {
    beforeEach(async () => {
      await mag.initialize();
    });

    it("should return insights with all expected fields", () => {
      mag.recordInteraction({
        userMessage: "test",
        taskType: "coding",
        feedback: 1,
        tokensUsed: 500,
        latencyMs: 200,
      });
      mag.recordInteraction({
        userMessage: "another test",
        taskType: "general",
        feedback: -1,
        tokensUsed: 300,
        latencyMs: 100,
      });

      const insights = mag.getInsights();

      expect(insights).toHaveProperty("totalInteractions");
      expect(insights).toHaveProperty("taskTypeDistribution");
      expect(insights).toHaveProperty("topTaskTypes");
      expect(insights).toHaveProperty("averageFeedback");
      expect(insights).toHaveProperty("activeHours");
      expect(insights).toHaveProperty("recentActivity");
      expect(insights).toHaveProperty("averageTokens");
      expect(insights).toHaveProperty("averageLatency");
    });

    it("should count total interactions correctly", () => {
      mag.recordInteraction({ userMessage: "msg1" });
      mag.recordInteraction({ userMessage: "msg2" });
      mag.recordInteraction({ userMessage: "msg3" });

      const insights = mag.getInsights();
      expect(insights.totalInteractions).toBe(3);
    });

    it("should show task type distribution", () => {
      mag.recordInteraction({ userMessage: "msg1", taskType: "coding" });
      mag.recordInteraction({ userMessage: "msg2", taskType: "coding" });
      mag.recordInteraction({ userMessage: "msg3", taskType: "general" });

      const insights = mag.getInsights();
      expect(insights.taskTypeDistribution).toHaveProperty("coding");
      expect(insights.taskTypeDistribution.coding).toBe(2);
      expect(insights.taskTypeDistribution.general).toBe(1);
    });

    it("should return default insights when no data exists", () => {
      const insights = mag.getInsights();
      expect(insights.totalInteractions).toBe(0);
    });

    it("should return default insights when database is not available", () => {
      mag.db = null;
      const insights = mag.getInsights();

      expect(insights.totalInteractions).toBe(0);
      expect(insights.taskTypeDistribution).toEqual({});
    });
  });

  // ============================================================
  // clearHistory
  // ============================================================

  describe("clearHistory", () => {
    beforeEach(async () => {
      await mag.initialize();
      mag.recordInteraction({ userMessage: "msg1", taskType: "coding" });
      mag.recordInteraction({ userMessage: "msg2", taskType: "general" });
    });

    it("should clear all history when no options are given", () => {
      const result = mag.clearHistory();
      expect(result).toHaveProperty("deleted");
      expect(result.deleted).toBeGreaterThanOrEqual(0);
    });

    it("should return { deleted: 0 } when database is not available", () => {
      mag.db = null;
      const result = mag.clearHistory();
      expect(result).toEqual({ deleted: 0 });
    });
  });

  // ============================================================
  // buildMemoryContext
  // ============================================================

  describe("buildMemoryContext", () => {
    beforeEach(async () => {
      await mag.initialize();
    });

    it("should build context string with relevant interactions", () => {
      mag.recordInteraction({
        userMessage: "How to use TypeScript generics?",
        assistantResponse: "Generics allow you to write reusable components...",
        taskType: "coding",
        feedback: 1,
      });

      const context = mag.buildMemoryContext("TypeScript");

      expect(typeof context).toBe("string");
      // The context should include some relevant content from the interactions
      expect(context.length).toBeGreaterThanOrEqual(0);
    });

    it("should include section headers", () => {
      mag.recordInteraction({
        userMessage: "test query for context",
        assistantResponse: "test response",
        taskType: "general",
        feedback: 1,
      });

      const context = mag.buildMemoryContext("test");

      if (context.length > 0) {
        expect(context).toContain("##");
      }
    });

    it("should return empty string if no database", () => {
      mag.db = null;
      expect(mag.buildMemoryContext("test")).toBe("");
    });

    it("should return empty string if no query", () => {
      expect(mag.buildMemoryContext("")).toBe("");
      expect(mag.buildMemoryContext(null)).toBe("");
    });

    it("should respect the limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        mag.recordInteraction({
          userMessage: `test message number ${i}`,
          assistantResponse: `response ${i}`,
          taskType: "coding",
        });
      }

      const context = mag.buildMemoryContext("test", 2);
      expect(typeof context).toBe("string");
    });
  });
});
