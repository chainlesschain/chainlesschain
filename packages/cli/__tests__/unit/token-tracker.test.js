import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  calculateCost,
  recordUsage,
  getUsageStats,
  getCostBreakdown,
  getRecentUsage,
  getTodayStats,
} from "../../src/lib/token-tracker.js";

describe("token-tracker", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  afterEach(() => {
    db.close();
  });

  // ── calculateCost ──

  describe("calculateCost", () => {
    it("returns 0 for ollama (free)", () => {
      expect(calculateCost("ollama", "qwen2:7b", 1000, 500)).toBe(0);
    });

    it("returns 0 for ollama regardless of token count", () => {
      expect(calculateCost("ollama", "llama3", 10_000_000, 5_000_000)).toBe(0);
    });

    it("calculates OpenAI GPT-4o cost", () => {
      const cost = calculateCost("openai", "gpt-4o", 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(12.5, 1); // $2.5 input + $10 output
    });

    it("calculates OpenAI GPT-4o-mini cost", () => {
      const cost = calculateCost("openai", "gpt-4o-mini", 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(0.75, 2); // $0.15 + $0.6
    });

    it("calculates OpenAI GPT-4-turbo cost", () => {
      const cost = calculateCost("openai", "gpt-4-turbo", 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(40, 1); // $10 + $30
    });

    it("calculates OpenAI o1 cost", () => {
      const cost = calculateCost("openai", "o1", 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(75, 1); // $15 + $60
    });

    it("calculates Anthropic Claude Sonnet cost", () => {
      const cost = calculateCost(
        "anthropic",
        "claude-sonnet-4-6",
        1_000_000,
        1_000_000,
      );
      expect(cost).toBeCloseTo(18, 1); // $3 + $15
    });

    it("calculates Anthropic Claude Opus cost", () => {
      const cost = calculateCost(
        "anthropic",
        "claude-opus-4-6",
        1_000_000,
        1_000_000,
      );
      expect(cost).toBeCloseTo(90, 1); // $15 + $75
    });

    it("calculates Anthropic Claude Haiku cost", () => {
      const cost = calculateCost(
        "anthropic",
        "claude-haiku-4-5-20251001",
        1_000_000,
        1_000_000,
      );
      expect(cost).toBeCloseTo(4.8, 1); // $0.8 + $4
    });

    it("calculates DeepSeek cost", () => {
      const cost = calculateCost(
        "deepseek",
        "deepseek-chat",
        1_000_000,
        1_000_000,
      );
      expect(cost).toBeCloseTo(0.42, 2); // $0.14 + $0.28
    });

    it("calculates DashScope cost", () => {
      const cost = calculateCost(
        "dashscope",
        "qwen-turbo",
        1_000_000,
        1_000_000,
      );
      expect(cost).toBeCloseTo(0.9, 2); // $0.3 + $0.6
    });

    it("calculates DashScope qwen-plus cost", () => {
      const cost = calculateCost(
        "dashscope",
        "qwen-plus",
        1_000_000,
        1_000_000,
      );
      expect(cost).toBeCloseTo(2.8, 2); // $0.8 + $2
    });

    it("uses default pricing for unknown model within known provider", () => {
      const cost = calculateCost("openai", "unknown-model", 1_000_000, 0);
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeCloseTo(2.5, 1); // default input price
    });

    it("uses default pricing for unknown anthropic model", () => {
      const cost = calculateCost(
        "anthropic",
        "future-model",
        1_000_000,
        1_000_000,
      );
      expect(cost).toBeCloseTo(18, 1); // default: $3 + $15
    });

    it("returns 0 for unknown provider", () => {
      expect(calculateCost("unknown", "model", 1000, 500)).toBe(0);
    });

    it("returns 0 for zero tokens", () => {
      expect(calculateCost("openai", "gpt-4o", 0, 0)).toBe(0);
    });

    it("handles input-only cost", () => {
      const cost = calculateCost("openai", "gpt-4o", 1_000_000, 0);
      expect(cost).toBeCloseTo(2.5, 1);
    });

    it("handles output-only cost", () => {
      const cost = calculateCost("openai", "gpt-4o", 0, 1_000_000);
      expect(cost).toBeCloseTo(10, 1);
    });

    it("handles small token counts", () => {
      const cost = calculateCost("openai", "gpt-4o", 100, 50);
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(0.001);
    });
  });

  // ── recordUsage ──

  describe("recordUsage", () => {
    it("records usage and returns summary", () => {
      const result = recordUsage(db, {
        provider: "ollama",
        model: "qwen2:7b",
        inputTokens: 100,
        outputTokens: 50,
        responseTimeMs: 500,
      });

      expect(result.id).toBeDefined();
      expect(result.id.length).toBe(16);
      expect(result.totalTokens).toBe(150);
      expect(result.costUsd).toBe(0);
    });

    it("records OpenAI usage with cost", () => {
      const result = recordUsage(db, {
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
      });

      expect(result.costUsd).toBeGreaterThan(0);
      expect(result.totalTokens).toBe(1500);
    });

    it("persists to database with all fields", () => {
      recordUsage(db, {
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 100,
        outputTokens: 50,
        responseTimeMs: 350,
        endpoint: "/chat/completions",
      });

      const rows = db.data.get("llm_usage_log") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].provider).toBe("openai");
      expect(rows[0].model).toBe("gpt-4o");
      expect(rows[0].input_tokens).toBe(100);
      expect(rows[0].output_tokens).toBe(50);
      expect(rows[0].total_tokens).toBe(150);
      expect(rows[0].response_time_ms).toBe(350);
      expect(rows[0].endpoint).toBe("/chat/completions");
      expect(rows[0].cost_usd).toBeGreaterThan(0);
    });

    it("defaults to 0 tokens when not specified", () => {
      const result = recordUsage(db, {
        provider: "ollama",
        model: "qwen2:7b",
      });

      expect(result.totalTokens).toBe(0);
    });

    it("defaults to empty endpoint", () => {
      recordUsage(db, {
        provider: "ollama",
        model: "qwen2:7b",
        inputTokens: 10,
        outputTokens: 5,
      });

      const rows = db.data.get("llm_usage_log") || [];
      expect(rows[0].endpoint).toBe("");
    });

    it("generates unique IDs for each record", () => {
      const r1 = recordUsage(db, {
        provider: "ollama",
        model: "a",
        inputTokens: 1,
        outputTokens: 1,
      });
      const r2 = recordUsage(db, {
        provider: "ollama",
        model: "b",
        inputTokens: 1,
        outputTokens: 1,
      });
      expect(r1.id).not.toBe(r2.id);
    });
  });

  // ── getUsageStats ──

  describe("getUsageStats", () => {
    it("returns zeroes for empty table", () => {
      const stats = getUsageStats(db);
      expect(stats.total_calls).toBe(0);
      expect(stats.total_input_tokens).toBe(0);
      expect(stats.total_output_tokens).toBe(0);
      expect(stats.total_tokens).toBe(0);
      expect(stats.total_cost_usd).toBe(0);
      expect(stats.avg_response_time_ms).toBe(0);
    });

    it("returns stats after recording usage", () => {
      recordUsage(db, {
        provider: "ollama",
        model: "a",
        inputTokens: 100,
        outputTokens: 50,
      });
      recordUsage(db, {
        provider: "ollama",
        model: "a",
        inputTokens: 200,
        outputTokens: 100,
      });

      const stats = getUsageStats(db);
      expect(stats.total_calls).toBe(2);
    });

    it("handles null safety on aggregate results", () => {
      // Even with no rows, the function should not crash
      const stats = getUsageStats(db);
      expect(stats).toBeDefined();
      expect(typeof stats.total_calls).toBe("number");
      expect(typeof stats.total_cost_usd).toBe("number");
    });
  });

  // ── getCostBreakdown ──

  describe("getCostBreakdown", () => {
    it("returns empty array when no usage", () => {
      const breakdown = getCostBreakdown(db);
      expect(breakdown).toEqual([]);
    });

    it("groups by provider and model", () => {
      recordUsage(db, {
        provider: "ollama",
        model: "qwen2:7b",
        inputTokens: 100,
        outputTokens: 50,
      });
      recordUsage(db, {
        provider: "ollama",
        model: "qwen2:7b",
        inputTokens: 200,
        outputTokens: 100,
      });
      recordUsage(db, {
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 500,
        outputTokens: 200,
      });

      const breakdown = getCostBreakdown(db);
      expect(breakdown.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── getRecentUsage ──

  describe("getRecentUsage", () => {
    it("returns empty array when no usage", () => {
      const recent = getRecentUsage(db);
      expect(recent).toEqual([]);
    });

    it("returns recent entries", () => {
      recordUsage(db, {
        provider: "ollama",
        model: "a",
        inputTokens: 10,
        outputTokens: 5,
      });
      recordUsage(db, {
        provider: "ollama",
        model: "b",
        inputTokens: 20,
        outputTokens: 10,
      });

      const recent = getRecentUsage(db, 5);
      expect(recent.length).toBe(2);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        recordUsage(db, {
          provider: "ollama",
          model: "qwen2:7b",
          inputTokens: 10,
          outputTokens: 5,
        });
      }

      const recent = getRecentUsage(db, 3);
      expect(recent.length).toBe(3);
    });

    it("uses default limit of 20", () => {
      for (let i = 0; i < 25; i++) {
        recordUsage(db, {
          provider: "ollama",
          model: "qwen2:7b",
          inputTokens: 1,
          outputTokens: 1,
        });
      }

      const recent = getRecentUsage(db);
      expect(recent.length).toBe(20);
    });
  });

  // ── getTodayStats ──

  describe("getTodayStats", () => {
    it("returns stats for today", () => {
      recordUsage(db, {
        provider: "ollama",
        model: "a",
        inputTokens: 100,
        outputTokens: 50,
      });
      const stats = getTodayStats(db);
      expect(stats).toBeDefined();
      expect(typeof stats.total_calls).toBe("number");
    });

    it("returns zeroes when no today data", () => {
      const stats = getTodayStats(db);
      expect(stats.total_calls).toBe(0);
    });
  });

  // ── Multiple records persistence ──

  describe("database persistence", () => {
    it("stores multiple records", () => {
      recordUsage(db, {
        provider: "ollama",
        model: "qwen2:7b",
        inputTokens: 100,
        outputTokens: 50,
      });
      recordUsage(db, {
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 500,
        outputTokens: 200,
      });

      const rows = db.data.get("llm_usage_log") || [];
      expect(rows.length).toBe(2);
      expect(rows[0].provider).toBe("ollama");
      expect(rows[1].provider).toBe("openai");
      expect(rows[0].input_tokens).toBe(100);
      expect(rows[1].input_tokens).toBe(500);
    });

    it("stores cost_usd correctly for paid providers", () => {
      recordUsage(db, {
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });

      const rows = db.data.get("llm_usage_log") || [];
      expect(rows[0].cost_usd).toBeCloseTo(12.5, 1);
    });

    it("creates table on first call", () => {
      expect(db.tables.has("llm_usage_log")).toBe(false);
      recordUsage(db, {
        provider: "ollama",
        model: "a",
        inputTokens: 1,
        outputTokens: 1,
      });
      expect(db.tables.has("llm_usage_log")).toBe(true);
    });
  });
});
