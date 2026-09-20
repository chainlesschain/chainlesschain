import { describe, expect, it, vi } from "vitest";

const { registerTokenHandlers } = require("../llm-ipc-token");

function capture(overrides = {}) {
  const handlers = new Map();
  registerTokenHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    managerRef: { current: null },
    database: null,
    tokenTracker: null,
    responseCache: null,
    coreAuthorization: {
      authorize: vi.fn(async () => ({
        actorDid: "did:key:token-test",
        tenantId: "tenant:test",
      })),
    },
    ...overrides,
  });
  return handlers;
}

describe("LLM token IPC success privacy", () => {
  it("projects usage, time-series, and breakdown results", async () => {
    const privateValue = "private-token-tracker-field";
    const tokenTracker = {
      getUsageStats: vi.fn().mockResolvedValue({
        totalCalls: 4,
        totalInputTokens: 10,
        totalOutputTokens: 6,
        totalTokens: 16,
        totalCostUsd: 2,
        totalCostCny: 14,
        cachedCalls: 1,
        compressedCalls: 2,
        cacheHitRate: 25,
        avgResponseTime: 100,
        startDate: privateValue,
        userId: privateValue,
        privateField: privateValue,
      }),
      getTimeSeriesData: vi.fn().mockResolvedValue([
        {
          timestamp: 1000,
          date: privateValue,
          calls: 1,
          tokens: 5,
          costUsd: 0.25,
          userId: privateValue,
          privateField: privateValue,
        },
      ]),
      getCostBreakdown: vi.fn().mockResolvedValue({
        byProvider: [
          {
            provider: "openai",
            calls: 1,
            tokens: 5,
            cost_usd: 0.25,
            privateField: privateValue,
          },
        ],
        byModel: [
          {
            provider: "openai",
            model: "public-model",
            calls: 1,
            totalTokens: 5,
            costUsd: 0.25,
            privateField: privateValue,
          },
        ],
        privateField: privateValue,
      }),
    };
    const handlers = capture({ tokenTracker });

    const usage = await handlers.get("llm:get-usage-stats")();
    const series = await handlers.get("llm:get-time-series")();
    const breakdown = await handlers.get("llm:get-cost-breakdown")();

    expect(usage).toEqual({
      totalCalls: 4,
      totalInputTokens: 10,
      totalOutputTokens: 6,
      totalTokens: 16,
      totalCostUsd: 2,
      totalCostCny: 14,
      totalCost: 2,
      cachedCalls: 1,
      compressedCalls: 2,
      cachedTokens: 0,
      cacheHitRate: 25,
      avgResponseTime: 100,
      avgCostPerCall: 0.5,
      weekTokens: 0,
      weekCost: 0,
    });
    expect(series).toEqual([
      {
        timestamp: 1000,
        date: "1970-01-01T00:00:01.000Z",
        calls: 1,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 5,
        tokens: 5,
        costUsd: 0.25,
        costCny: 0,
        cost: 0.25,
      },
    ]);
    expect(breakdown).toEqual({
      byProvider: [
        {
          provider: "openai",
          calls: 1,
          tokens: 5,
          cost_usd: 0.25,
          cost_cny: 0,
          cost: 0.25,
        },
      ],
      byModel: [
        {
          provider: "openai",
          model: "public-model",
          calls: 1,
          tokens: 5,
          cost_usd: 0.25,
          cost_cny: 0,
          cost: 0.25,
        },
      ],
    });
    expect(JSON.stringify({ usage, series, breakdown })).not.toContain(
      privateValue,
    );
  });

  it("projects budget rows and nested cache statistics", async () => {
    const privateValue = "private-budget-field";
    const handlers = capture({
      tokenTracker: {
        getBudgetConfig: vi.fn().mockResolvedValue({
          id: privateValue,
          user_id: privateValue,
          daily_limit_usd: 1,
          weekly_limit_usd: 5,
          monthly_limit_usd: 20,
          current_daily_spend: 0.1,
          current_weekly_spend: 0.5,
          current_monthly_spend: 2,
          warning_threshold: 0.8,
          critical_threshold: 0.95,
          desktop_alerts: 1,
          auto_pause_on_limit: 1,
          auto_switch_to_cheaper_model: 0,
          daily_reset_at: 100,
          weekly_reset_at: 200,
          monthly_reset_at: 300,
          privateField: privateValue,
        }),
      },
      responseCache: {
        getStats: vi.fn().mockResolvedValue({
          runtime: {
            hits: 8,
            misses: 2,
            hitRate: "80.00%",
            privateField: privateValue,
          },
          database: {
            totalEntries: 4,
            expiredEntries: 1,
            totalHits: 10,
            totalTokensSaved: 400,
            avgHitsPerEntry: "2.50",
            privateField: privateValue,
          },
          config: { localPath: privateValue },
          privateField: privateValue,
        }),
      },
    });

    const budget = await handlers.get("llm:get-budget")();
    const cache = await handlers.get("llm:get-cache-stats")();

    expect(budget).toEqual({
      dailyLimit: 1,
      weeklyLimit: 5,
      monthlyLimit: 20,
      dailySpend: 0.1,
      weeklySpend: 0.5,
      monthlySpend: 2,
      warningThreshold: 0.8,
      criticalThreshold: 0.95,
      desktopAlerts: true,
      autoPauseOnLimit: true,
      autoSwitchToCheaperModel: false,
      dailyResetAt: 100,
      weeklyResetAt: 200,
      monthlyResetAt: 300,
    });
    expect(cache).toEqual({
      totalEntries: 4,
      expiredEntries: 1,
      totalHits: 10,
      totalTokensSaved: 400,
      totalCostSaved: 0,
      avgHitsPerEntry: 2.5,
      hitRate: 80,
    });
    expect(JSON.stringify({ budget, cache })).not.toContain(privateValue);
  });

  it("returns fixed mutation, export, and service-control receipts", async () => {
    const privateValue = "C:\\private\\llm-cost-report.csv";
    const handlers = capture({
      tokenTracker: {
        saveBudgetConfig: vi.fn().mockResolvedValue({
          success: true,
          userId: privateValue,
        }),
        exportCostReport: vi.fn().mockResolvedValue({
          success: true,
          filePath: privateValue,
        }),
      },
      responseCache: { clearExpired: vi.fn().mockResolvedValue(7) },
      managerRef: {
        current: {
          resumeService: vi.fn().mockResolvedValue({
            success: true,
            message: privateValue,
          }),
          pauseService: vi.fn().mockResolvedValue({
            success: false,
            message: privateValue,
          }),
        },
      },
    });

    const results = [
      await handlers.get("llm:set-budget")(
        {},
        {
          dailyLimit: 5,
          weeklyLimit: 20,
          monthlyLimit: 50,
          warningThreshold: 0.8,
          criticalThreshold: 0.95,
          desktopAlerts: true,
          autoPauseOnLimit: false,
          autoSwitchToCheaperModel: true,
        },
      ),
      await handlers.get("llm:export-cost-report")(),
      await handlers.get("llm:clear-cache")(),
      await handlers.get("llm:resume-service")(),
      await handlers.get("llm:pause-service")(),
    ];

    expect(results).toEqual([
      { success: true },
      { success: true },
      { success: true, deletedCount: 7 },
      { success: true },
      { success: false },
    ]);
    expect(JSON.stringify(results)).not.toContain(privateValue);
  });

  it("projects cost estimates and budget decisions", async () => {
    const privateValue = "private-manager-field";
    const handlers = capture({
      managerRef: {
        current: {
          calculateCostEstimate: vi.fn().mockReturnValue({
            costUsd: 0.2,
            costCny: 1.4,
            pricing: {
              input: 1,
              output: 2,
              cache: 0.5,
              endpoint: privateValue,
            },
            privateField: privateValue,
          }),
          canPerformOperation: vi.fn().mockResolvedValue({
            allowed: false,
            reason: privateValue,
            privateField: privateValue,
          }),
        },
      },
    });

    const estimate = await handlers.get("llm:calculate-cost-estimate")(
      {},
      {
        provider: "openai",
        model: "public-model",
        inputTokens: 10,
        outputTokens: 5,
      },
    );
    const decision = await handlers.get("llm:can-perform-operation")({}, 15);

    expect(estimate).toEqual({
      costUsd: 0.2,
      costCny: 1.4,
      pricing: { input: 1, output: 2, cache: 0.5 },
    });
    expect(decision).toEqual({ allowed: false, reason: "budget-limit" });
    expect(JSON.stringify({ estimate, decision })).not.toContain(privateValue);
  });
});
