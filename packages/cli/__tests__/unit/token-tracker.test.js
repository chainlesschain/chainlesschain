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

// ── V2 Surface ──

import {
  BUDGET_MATURITY_V2,
  USAGE_RECORD_LIFECYCLE_V2,
  TOKEN_DEFAULT_MAX_ACTIVE_BUDGETS_PER_OWNER,
  TOKEN_DEFAULT_MAX_PENDING_RECORDS_PER_BUDGET,
  TOKEN_DEFAULT_BUDGET_IDLE_MS,
  TOKEN_DEFAULT_RECORD_STUCK_MS,
  getMaxActiveBudgetsPerOwnerV2,
  setMaxActiveBudgetsPerOwnerV2,
  getMaxPendingRecordsPerBudgetV2,
  setMaxPendingRecordsPerBudgetV2,
  getBudgetIdleMsV2,
  setBudgetIdleMsV2,
  getRecordStuckMsV2,
  setRecordStuckMsV2,
  registerBudgetV2,
  getBudgetV2,
  listBudgetsV2,
  setBudgetStatusV2,
  activateBudgetV2,
  suspendBudgetV2,
  archiveBudgetV2,
  touchBudgetV2,
  getActiveBudgetCountV2,
  createUsageRecordV2,
  getUsageRecordV2,
  listUsageRecordsV2,
  setUsageRecordStatusV2,
  recordUsageV2,
  billUsageV2,
  rejectUsageV2,
  refundUsageV2,
  getPendingRecordCountV2,
  autoSuspendIdleBudgetsV2,
  autoRejectStaleRecordsV2,
  getTokenTrackerStatsV2,
  _resetStateTokenTrackerV2,
} from "../../src/lib/token-tracker.js";

describe("token-tracker V2", () => {
  beforeEach(() => {
    _resetStateTokenTrackerV2();
  });

  describe("enums", () => {
    it("BUDGET_MATURITY_V2 has 4 frozen states", () => {
      expect(Object.values(BUDGET_MATURITY_V2)).toEqual([
        "planning",
        "active",
        "suspended",
        "archived",
      ]);
      expect(Object.isFrozen(BUDGET_MATURITY_V2)).toBe(true);
    });

    it("USAGE_RECORD_LIFECYCLE_V2 has 5 frozen states", () => {
      expect(Object.values(USAGE_RECORD_LIFECYCLE_V2)).toEqual([
        "pending",
        "recorded",
        "billed",
        "rejected",
        "refunded",
      ]);
      expect(Object.isFrozen(USAGE_RECORD_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("config defaults & setters", () => {
    it("defaults match constants", () => {
      expect(getMaxActiveBudgetsPerOwnerV2()).toBe(
        TOKEN_DEFAULT_MAX_ACTIVE_BUDGETS_PER_OWNER,
      );
      expect(getMaxPendingRecordsPerBudgetV2()).toBe(
        TOKEN_DEFAULT_MAX_PENDING_RECORDS_PER_BUDGET,
      );
      expect(getBudgetIdleMsV2()).toBe(TOKEN_DEFAULT_BUDGET_IDLE_MS);
      expect(getRecordStuckMsV2()).toBe(TOKEN_DEFAULT_RECORD_STUCK_MS);
    });

    it("setters update values", () => {
      setMaxActiveBudgetsPerOwnerV2(20);
      expect(getMaxActiveBudgetsPerOwnerV2()).toBe(20);
      setMaxPendingRecordsPerBudgetV2(99);
      expect(getMaxPendingRecordsPerBudgetV2()).toBe(99);
      setBudgetIdleMsV2(60_000);
      expect(getBudgetIdleMsV2()).toBe(60_000);
      setRecordStuckMsV2(5_000);
      expect(getRecordStuckMsV2()).toBe(5_000);
    });

    it("setters floor non-integers", () => {
      setMaxActiveBudgetsPerOwnerV2(7.9);
      expect(getMaxActiveBudgetsPerOwnerV2()).toBe(7);
    });

    it("setters reject zero/negative/NaN", () => {
      expect(() => setMaxActiveBudgetsPerOwnerV2(0)).toThrow();
      expect(() => setMaxPendingRecordsPerBudgetV2(-1)).toThrow();
      expect(() => setBudgetIdleMsV2(NaN)).toThrow();
      expect(() => setRecordStuckMsV2("nope")).toThrow();
    });

    it("_resetState restores defaults", () => {
      setMaxActiveBudgetsPerOwnerV2(99);
      _resetStateTokenTrackerV2();
      expect(getMaxActiveBudgetsPerOwnerV2()).toBe(
        TOKEN_DEFAULT_MAX_ACTIVE_BUDGETS_PER_OWNER,
      );
    });
  });

  describe("registerBudgetV2", () => {
    it("creates planning budget", () => {
      const b = registerBudgetV2("b1", {
        ownerId: "u1",
        label: "Q1 Budget",
        now: 1000,
      });
      expect(b.status).toBe("planning");
      expect(b.ownerId).toBe("u1");
      expect(b.activatedAt).toBeNull();
      expect(b.archivedAt).toBeNull();
      expect(b.createdAt).toBe(1000);
    });

    it("rejects invalid id/owner/label", () => {
      expect(() =>
        registerBudgetV2("", { ownerId: "u", label: "L" }),
      ).toThrow();
      expect(() =>
        registerBudgetV2("b", { ownerId: "", label: "L" }),
      ).toThrow();
      expect(() =>
        registerBudgetV2("b", { ownerId: "u", label: "" }),
      ).toThrow();
    });

    it("rejects duplicate id", () => {
      registerBudgetV2("b1", { ownerId: "u", label: "L" });
      expect(() =>
        registerBudgetV2("b1", { ownerId: "u", label: "L2" }),
      ).toThrow(/already exists/);
    });

    it("returns defensive copy", () => {
      const b = registerBudgetV2("b1", {
        ownerId: "u",
        label: "L",
        metadata: { k: "v" },
      });
      b.metadata.k = "tampered";
      const re = getBudgetV2("b1");
      expect(re.metadata.k).toBe("v");
    });
  });

  describe("budget transitions", () => {
    beforeEach(() => {
      registerBudgetV2("b1", { ownerId: "u1", label: "L", now: 1000 });
    });

    it("planning→active stamps activatedAt", () => {
      const b = activateBudgetV2("b1", { now: 2000 });
      expect(b.status).toBe("active");
      expect(b.activatedAt).toBe(2000);
    });

    it("suspended→active recovery preserves activatedAt", () => {
      activateBudgetV2("b1", { now: 2000 });
      suspendBudgetV2("b1", { now: 3000 });
      const b = activateBudgetV2("b1", { now: 4000 });
      expect(b.activatedAt).toBe(2000);
      expect(b.status).toBe("active");
    });

    it("→archived stamps archivedAt and is terminal", () => {
      const b = archiveBudgetV2("b1", { now: 5000 });
      expect(b.status).toBe("archived");
      expect(b.archivedAt).toBe(5000);
      expect(() => activateBudgetV2("b1")).toThrow(/terminal/);
    });

    it("rejects unknown status", () => {
      expect(() => setBudgetStatusV2("b1", "bogus")).toThrow(/unknown/);
    });

    it("rejects illegal transition planning→suspended", () => {
      expect(() => suspendBudgetV2("b1")).toThrow(/cannot transition/);
    });

    it("rejects missing budget", () => {
      expect(() => activateBudgetV2("nope")).toThrow(/not found/);
    });

    it("per-owner cap enforced on planning→active only", () => {
      setMaxActiveBudgetsPerOwnerV2(2);
      registerBudgetV2("b2", { ownerId: "u1", label: "L" });
      registerBudgetV2("b3", { ownerId: "u1", label: "L" });
      activateBudgetV2("b1");
      activateBudgetV2("b2");
      expect(() => activateBudgetV2("b3")).toThrow(/active-budget cap/);
    });

    it("suspended→active recovery exempt from cap", () => {
      setMaxActiveBudgetsPerOwnerV2(2);
      registerBudgetV2("b2", { ownerId: "u1", label: "L" });
      registerBudgetV2("b3", { ownerId: "u1", label: "L" });
      activateBudgetV2("b1");
      activateBudgetV2("b2");
      suspendBudgetV2("b1");
      activateBudgetV2("b3");
      // b1 recovery should still be allowed even though u1 already at cap
      const b1 = activateBudgetV2("b1");
      expect(b1.status).toBe("active");
    });

    it("per-owner cap is owner-scoped", () => {
      setMaxActiveBudgetsPerOwnerV2(1);
      registerBudgetV2("b2", { ownerId: "u2", label: "L" });
      activateBudgetV2("b1");
      const b = activateBudgetV2("b2");
      expect(b.status).toBe("active");
    });
  });

  describe("touchBudgetV2", () => {
    it("updates lastSeenAt without changing status", () => {
      registerBudgetV2("b1", { ownerId: "u", label: "L", now: 1000 });
      activateBudgetV2("b1", { now: 2000 });
      const b = touchBudgetV2("b1", { now: 9999 });
      expect(b.lastSeenAt).toBe(9999);
      expect(b.status).toBe("active");
    });

    it("throws on missing", () => {
      expect(() => touchBudgetV2("nope")).toThrow(/not found/);
    });
  });

  describe("listBudgetsV2 + getActiveBudgetCountV2", () => {
    it("filters by ownerId and status", () => {
      registerBudgetV2("b1", { ownerId: "u1", label: "L" });
      registerBudgetV2("b2", { ownerId: "u1", label: "L" });
      registerBudgetV2("b3", { ownerId: "u2", label: "L" });
      activateBudgetV2("b1");
      expect(listBudgetsV2({ ownerId: "u1" })).toHaveLength(2);
      expect(listBudgetsV2({ status: "active" })).toHaveLength(1);
      expect(listBudgetsV2({ ownerId: "u2", status: "planning" })).toHaveLength(
        1,
      );
    });

    it("getActiveBudgetCountV2 counts only active for owner", () => {
      registerBudgetV2("b1", { ownerId: "u1", label: "L" });
      registerBudgetV2("b2", { ownerId: "u1", label: "L" });
      registerBudgetV2("b3", { ownerId: "u2", label: "L" });
      activateBudgetV2("b1");
      activateBudgetV2("b3");
      expect(getActiveBudgetCountV2("u1")).toBe(1);
      expect(getActiveBudgetCountV2("u2")).toBe(1);
    });
  });

  describe("createUsageRecordV2", () => {
    beforeEach(() => {
      registerBudgetV2("b1", { ownerId: "u1", label: "L" });
    });

    it("creates pending record", () => {
      const r = createUsageRecordV2("r1", {
        budgetId: "b1",
        units: 100,
        now: 1000,
      });
      expect(r.status).toBe("pending");
      expect(r.units).toBe(100);
      expect(r.recordedAt).toBeNull();
      expect(r.settledAt).toBeNull();
    });

    it("accepts units=0", () => {
      const r = createUsageRecordV2("r1", { budgetId: "b1", units: 0 });
      expect(r.units).toBe(0);
    });

    it("rejects units<0/NaN", () => {
      expect(() =>
        createUsageRecordV2("r1", { budgetId: "b1", units: -1 }),
      ).toThrow();
      expect(() =>
        createUsageRecordV2("r2", { budgetId: "b1", units: NaN }),
      ).toThrow();
    });

    it("rejects invalid id/budgetId", () => {
      expect(() =>
        createUsageRecordV2("", { budgetId: "b1", units: 1 }),
      ).toThrow();
      expect(() =>
        createUsageRecordV2("r1", { budgetId: "", units: 1 }),
      ).toThrow();
    });

    it("rejects duplicate id", () => {
      createUsageRecordV2("r1", { budgetId: "b1", units: 1 });
      expect(() =>
        createUsageRecordV2("r1", { budgetId: "b1", units: 1 }),
      ).toThrow(/already exists/);
    });

    it("per-budget cap counts pending+recorded", () => {
      setMaxPendingRecordsPerBudgetV2(2);
      createUsageRecordV2("r1", { budgetId: "b1", units: 1 });
      createUsageRecordV2("r2", { budgetId: "b1", units: 1 });
      expect(() =>
        createUsageRecordV2("r3", { budgetId: "b1", units: 1 }),
      ).toThrow(/pending-record cap/);
      // recorded counts toward cap
      recordUsageV2("r1");
      expect(() =>
        createUsageRecordV2("r3", { budgetId: "b1", units: 1 }),
      ).toThrow(/pending-record cap/);
    });

    it("per-budget cap excludes terminals", () => {
      setMaxPendingRecordsPerBudgetV2(2);
      createUsageRecordV2("r1", { budgetId: "b1", units: 1 });
      createUsageRecordV2("r2", { budgetId: "b1", units: 1 });
      rejectUsageV2("r1");
      const r3 = createUsageRecordV2("r3", { budgetId: "b1", units: 1 });
      expect(r3.status).toBe("pending");
    });
  });

  describe("record transitions", () => {
    beforeEach(() => {
      registerBudgetV2("b1", { ownerId: "u1", label: "L" });
      createUsageRecordV2("r1", { budgetId: "b1", units: 50, now: 1000 });
    });

    it("pending→recorded stamps recordedAt", () => {
      const r = recordUsageV2("r1", { now: 2000 });
      expect(r.status).toBe("recorded");
      expect(r.recordedAt).toBe(2000);
      expect(r.settledAt).toBeNull();
    });

    it("recorded→billed stamps settledAt (terminal)", () => {
      recordUsageV2("r1", { now: 2000 });
      const r = billUsageV2("r1", { now: 3000 });
      expect(r.status).toBe("billed");
      expect(r.settledAt).toBe(3000);
      expect(() => refundUsageV2("r1")).toThrow(/terminal/);
    });

    it("recorded→refunded stamps settledAt (terminal)", () => {
      recordUsageV2("r1", { now: 2000 });
      const r = refundUsageV2("r1", { now: 3000 });
      expect(r.status).toBe("refunded");
      expect(r.settledAt).toBe(3000);
    });

    it("pending→rejected stamps settledAt", () => {
      const r = rejectUsageV2("r1", { now: 2500 });
      expect(r.status).toBe("rejected");
      expect(r.settledAt).toBe(2500);
    });

    it("pending cannot bill directly", () => {
      expect(() => billUsageV2("r1")).toThrow(/cannot transition/);
    });

    it("rejects unknown status", () => {
      expect(() => setUsageRecordStatusV2("r1", "bogus")).toThrow(/unknown/);
    });

    it("rejects missing record", () => {
      expect(() => recordUsageV2("nope")).toThrow(/not found/);
    });
  });

  describe("listUsageRecordsV2 + getPendingRecordCountV2", () => {
    beforeEach(() => {
      registerBudgetV2("b1", { ownerId: "u", label: "L" });
      registerBudgetV2("b2", { ownerId: "u", label: "L" });
      createUsageRecordV2("r1", { budgetId: "b1", units: 1 });
      createUsageRecordV2("r2", { budgetId: "b1", units: 1 });
      createUsageRecordV2("r3", { budgetId: "b2", units: 1 });
      recordUsageV2("r1");
    });

    it("filters by budgetId/status", () => {
      expect(listUsageRecordsV2({ budgetId: "b1" })).toHaveLength(2);
      expect(listUsageRecordsV2({ status: "pending" })).toHaveLength(2);
      expect(
        listUsageRecordsV2({ budgetId: "b1", status: "recorded" }),
      ).toHaveLength(1);
    });

    it("getPendingRecordCountV2 counts pending+recorded", () => {
      expect(getPendingRecordCountV2("b1")).toBe(2);
      expect(getPendingRecordCountV2("b2")).toBe(1);
      rejectUsageV2("r2");
      expect(getPendingRecordCountV2("b1")).toBe(1);
    });
  });

  describe("autoSuspendIdleBudgetsV2", () => {
    it("flips active→suspended when idle past threshold", () => {
      registerBudgetV2("b1", { ownerId: "u", label: "L", now: 1000 });
      activateBudgetV2("b1", { now: 1000 });
      setBudgetIdleMsV2(500);
      const flipped = autoSuspendIdleBudgetsV2({ now: 2000 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("suspended");
    });

    it("skips non-active budgets", () => {
      registerBudgetV2("b1", { ownerId: "u", label: "L", now: 1000 });
      // planning, not active
      setBudgetIdleMsV2(500);
      const flipped = autoSuspendIdleBudgetsV2({ now: 999_999 });
      expect(flipped).toHaveLength(0);
    });

    it("preserves under-threshold budgets", () => {
      registerBudgetV2("b1", { ownerId: "u", label: "L", now: 1000 });
      activateBudgetV2("b1", { now: 1000 });
      setBudgetIdleMsV2(5000);
      const flipped = autoSuspendIdleBudgetsV2({ now: 2000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoRejectStaleRecordsV2", () => {
    beforeEach(() => {
      registerBudgetV2("b1", { ownerId: "u", label: "L" });
    });

    it("flips pending→rejected when stuck", () => {
      createUsageRecordV2("r1", { budgetId: "b1", units: 1, now: 1000 });
      setRecordStuckMsV2(500);
      const flipped = autoRejectStaleRecordsV2({ now: 2000 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("rejected");
      expect(flipped[0].settledAt).toBe(2000);
    });

    it("flips recorded→rejected when stuck", () => {
      createUsageRecordV2("r1", { budgetId: "b1", units: 1, now: 1000 });
      recordUsageV2("r1", { now: 1000 });
      setRecordStuckMsV2(500);
      const flipped = autoRejectStaleRecordsV2({ now: 2000 });
      expect(flipped).toHaveLength(1);
    });

    it("skips terminal records", () => {
      createUsageRecordV2("r1", { budgetId: "b1", units: 1, now: 1000 });
      rejectUsageV2("r1", { now: 1000 });
      setRecordStuckMsV2(500);
      const flipped = autoRejectStaleRecordsV2({ now: 999_999 });
      expect(flipped).toHaveLength(0);
    });

    it("preserves under-threshold records", () => {
      createUsageRecordV2("r1", { budgetId: "b1", units: 1, now: 1000 });
      setRecordStuckMsV2(5000);
      const flipped = autoRejectStaleRecordsV2({ now: 2000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getTokenTrackerStatsV2", () => {
    it("returns zero-init counts when empty", () => {
      const s = getTokenTrackerStatsV2();
      expect(s.totalBudgetsV2).toBe(0);
      expect(s.totalRecordsV2).toBe(0);
      expect(s.budgetsByStatus).toEqual({
        planning: 0,
        active: 0,
        suspended: 0,
        archived: 0,
      });
      expect(s.recordsByStatus).toEqual({
        pending: 0,
        recorded: 0,
        billed: 0,
        rejected: 0,
        refunded: 0,
      });
    });

    it("counts by status and includes config snapshot", () => {
      registerBudgetV2("b1", { ownerId: "u", label: "L" });
      registerBudgetV2("b2", { ownerId: "u", label: "L" });
      activateBudgetV2("b1");
      createUsageRecordV2("r1", { budgetId: "b1", units: 1 });
      recordUsageV2("r1");
      setMaxActiveBudgetsPerOwnerV2(7);
      const s = getTokenTrackerStatsV2();
      expect(s.totalBudgetsV2).toBe(2);
      expect(s.budgetsByStatus.active).toBe(1);
      expect(s.budgetsByStatus.planning).toBe(1);
      expect(s.totalRecordsV2).toBe(1);
      expect(s.recordsByStatus.recorded).toBe(1);
      expect(s.maxActiveBudgetsPerOwner).toBe(7);
    });
  });
});
