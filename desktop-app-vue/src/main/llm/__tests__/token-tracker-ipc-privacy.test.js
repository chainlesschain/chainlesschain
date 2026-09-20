import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const {
  getTokenTrackerInstance,
  registerTokenTrackerIPC,
  setTokenTrackerInstance,
  unregisterTokenTrackerIPC,
} = require("../token-tracker-ipc");

function capture(tokenTracker) {
  const handlers = new Map();
  const ipcMain = {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel) => handlers.delete(channel)),
  };
  const ipcGuard = {
    isModuleRegistered: vi.fn(() => false),
    markModuleRegistered: vi.fn(),
    unmarkModuleRegistered: vi.fn(),
  };
  registerTokenTrackerIPC({ ipcMain, ipcGuard, tokenTracker });
  return { handlers, ipcGuard, ipcMain };
}

describe("standalone Token Tracker IPC privacy", () => {
  beforeEach(() => setTokenTrackerInstance(null));
  afterEach(() => setTokenTrackerInstance(null));

  it("projects all successful tracker and database results", async () => {
    const privateValue = "private-tracker-value";
    const updateRun = vi.fn();
    const db = {
      prepare: vi.fn((sql) => {
        if (sql.includes("UPDATE llm_budget_config")) {
          return { run: updateRun };
        }
        if (sql.includes("FROM conversations")) {
          return {
            get: vi.fn(() => ({
              total_input_tokens: 10,
              total_output_tokens: 5,
              total_cost_usd: 0.2,
              total_cost_cny: 1.4,
              private_column: privateValue,
            })),
          };
        }
        return {
          all: vi.fn(() => [
            {
              provider: "openai",
              model: "public-model",
              call_count: 2,
              input_tokens: 10,
              output_tokens: 5,
              cost_usd: 0.2,
              avg_response_time: 30,
              private_column: privateValue,
            },
          ]),
        };
      }),
    };
    const tracker = {
      db,
      options: { exchangeRate: 7.2 },
      getUsageStats: vi.fn().mockResolvedValue({
        totalCalls: 2,
        totalTokens: 15,
        totalCostUsd: 0.2,
        userId: privateValue,
      }),
      getTimeSeriesData: vi.fn().mockResolvedValue([
        {
          timestamp: 1000,
          calls: 2,
          tokens: 15,
          costUsd: 0.2,
          date: privateValue,
        },
      ]),
      getCostBreakdown: vi.fn().mockResolvedValue({
        byProvider: [
          {
            provider: "openai",
            calls: 2,
            tokens: 15,
            cost_usd: 0.2,
            privateField: privateValue,
          },
        ],
        byModel: [],
        privateField: privateValue,
      }),
      calculateCost: vi.fn().mockReturnValue({
        costUsd: 0.2,
        costCny: 1.4,
        pricing: { input: 1, output: 2, endpoint: privateValue },
        privateField: privateValue,
      }),
      getBudgetConfig: vi.fn().mockResolvedValue({
        id: privateValue,
        user_id: privateValue,
        daily_limit_usd: 1,
        weekly_limit_usd: 5,
        monthly_limit_usd: 20,
        current_daily_spend: 0.25,
        current_weekly_spend: 1,
        current_monthly_spend: 2,
        warning_threshold: 0.8,
        critical_threshold: 0.95,
        desktop_alerts: 1,
        auto_pause_on_limit: 1,
        auto_switch_to_cheaper_model: 0,
        daily_reset_at: 100,
        weekly_reset_at: 200,
        monthly_reset_at: 300,
      }),
      saveBudgetConfig: vi.fn().mockResolvedValue({
        success: true,
        privateField: privateValue,
      }),
      recordUsage: vi.fn().mockResolvedValue({
        id: privateValue,
        totalTokens: 15,
        costUsd: 0.2,
        costCny: 1.4,
        privateField: privateValue,
      }),
      exportCostReport: vi.fn().mockResolvedValue({
        success: true,
        filePath: `C:\\${privateValue}\\report.csv`,
      }),
    };
    const { handlers } = capture(tracker);

    const results = {
      usage: await handlers.get("tracker:get-usage-stats")(),
      series: await handlers.get("tracker:get-time-series")(
        {},
        {
          interval: privateValue,
        },
      ),
      breakdown: await handlers.get("tracker:get-cost-breakdown")(),
      cost: await handlers.get("tracker:calculate-cost")(
        {},
        {
          provider: "openai",
          model: "public-model",
        },
      ),
      budget: await handlers.get("tracker:get-budget")({}, privateValue),
      setBudget: await handlers.get("tracker:set-budget")(
        {},
        {
          userId: privateValue,
        },
      ),
      reset: await handlers.get("tracker:reset-budget-counters")(
        {},
        {
          userId: privateValue,
          period: "all",
        },
      ),
      record: await handlers.get("tracker:record-usage")(
        {},
        {
          provider: "openai",
          model: "public-model",
        },
      ),
      exported: await handlers.get("tracker:export-report")(),
      conversation: await handlers.get("tracker:get-conversation-stats")(
        {},
        privateValue,
      ),
      exchange: await handlers.get("tracker:set-exchange-rate")({}, 7.3),
    };

    expect(results.series.interval).toBe("day");
    expect(results.series.data[0].date).toBe("1970-01-01T00:00:01.000Z");
    expect(results.cost).toEqual({
      success: true,
      cost: {
        costUsd: 0.2,
        costCny: 1.4,
        pricing: { input: 1, output: 2, cache: 0 },
      },
    });
    expect(results.budget.config).toMatchObject({
      dailyLimit: 1,
      currentDailySpend: 0.25,
      dailyUsagePercent: 25,
      desktopAlerts: true,
    });
    expect(results.setBudget).toEqual({ success: true });
    expect(results.reset).toEqual({
      success: true,
      resetPeriods: ["daily", "weekly", "monthly"],
    });
    expect(results.record).toEqual({
      success: true,
      record: { totalTokens: 15, costUsd: 0.2, costCny: 1.4 },
    });
    expect(results.exported).toEqual({ success: true });
    expect(results.conversation).toEqual({
      success: true,
      summary: {
        totalInputTokens: 10,
        totalOutputTokens: 5,
        totalCostUsd: 0.2,
        totalCostCny: 1.4,
      },
      byModel: [
        {
          provider: "openai",
          model: "public-model",
          callCount: 2,
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.2,
          avgResponseTime: 30,
        },
      ],
    });
    expect(results.exchange).toEqual({ success: true });
    expect(tracker.options.exchangeRate).toBe(7.3);
    expect(updateRun).toHaveBeenCalledOnce();
    expect(JSON.stringify(results)).not.toContain(privateValue);
  });

  it("projects the static pricing catalog to numeric leaves", async () => {
    const { handlers } = capture({});

    const result = await handlers.get("tracker:get-pricing")();

    expect(result.success).toBe(true);
    expect(Object.keys(result.pricing).length).toBeGreaterThan(0);
    for (const models of Object.values(result.pricing)) {
      for (const price of Object.values(models)) {
        expect(Object.keys(price)).toEqual(["input", "output", "cache"]);
        expect(Object.values(price).every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("returns stable failures without caught error content", async () => {
    const privateValue = "private-provider-error";
    const { handlers } = capture({
      getUsageStats: vi.fn().mockRejectedValue(new Error(privateValue)),
      exportCostReport: vi.fn().mockRejectedValue(new Error(privateValue)),
    });
    const expected = {
      success: false,
      error: "LLM IPC operation failed",
      code: "CC_LLM_IPC_OPERATION_FAILED",
    };

    expect(await handlers.get("tracker:get-usage-stats")()).toEqual(expected);
    expect(await handlers.get("tracker:export-report")()).toEqual(expected);
    expect(await handlers.get("tracker:calculate-cost")({}, {})).toEqual(
      expected,
    );
    expect(JSON.stringify(expected)).not.toContain(privateValue);
  });

  it("unregisters all handlers and clears the tracker reference", () => {
    const tracker = {};
    const { handlers, ipcGuard, ipcMain } = capture(tracker);
    ipcGuard.isModuleRegistered.mockReturnValue(true);

    unregisterTokenTrackerIPC({ ipcMain, ipcGuard });

    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(12);
    expect(handlers.size).toBe(0);
    expect(getTokenTrackerInstance()).toBeNull();
    expect(ipcGuard.unmarkModuleRegistered).toHaveBeenCalledWith(
      "token-tracker-ipc",
    );
  });

  it("keeps dynamic errors and direct logging out of the adapter source", () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(
      path.join(testDir, "..", "token-tracker-ipc.js"),
      "utf8",
    );

    expect(source).not.toMatch(/\.message\b/);
    expect(source).not.toMatch(
      /\b(?:logger|console)\.(?:info|warn|error)\s*\(/,
    );
    expect(source).not.toContain("filePath");
  });
});
