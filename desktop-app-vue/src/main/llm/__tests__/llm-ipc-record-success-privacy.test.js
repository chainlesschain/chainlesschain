import { beforeEach, describe, expect, it } from "vitest";

const { registerAlertHandlers } = require("../llm-ipc-alert");
const { registerBudgetHandlers } = require("../llm-ipc-budgets");
const { registerRetentionHandlers } = require("../llm-ipc-retention");

function capture(register, database) {
  const handlers = new Map();
  register({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    database,
    coreAuthorization: {
      authorize: async () => ({
        actorDid: "did:key:record-test",
        tenantId: "tenant:test",
      }),
    },
  });
  return handlers;
}

describe("LLM IPC database record success privacy", () => {
  let privateValue;

  beforeEach(() => {
    privateValue = "private-database-field";
  });

  it("projects alert rows and details to the fields consumed by the UI", async () => {
    const row = {
      id: "alert-1",
      user_id: "private-user",
      type: "budget",
      level: "warning",
      title: "Budget warning",
      message: "The configured threshold was reached",
      details: JSON.stringify({
        budgetType: "monthly",
        percentage: 85,
        spent: 8.5,
        limit: 10,
        providerCredential: privateValue,
      }),
      dismissed: 0,
      dismissed_by: privateValue,
      related_provider: privateValue,
      created_at: 123456,
      updated_at: 123999,
      private_column: privateValue,
    };
    const handlers = capture(registerAlertHandlers, {
      prepare: () => ({ all: () => [row] }),
    });

    const result = await handlers.get("llm:get-alert-history")();

    expect(result).toEqual([
      {
        id: "alert-1",
        type: "budget",
        level: "warning",
        title: "Budget warning",
        message: "The configured threshold was reached",
        details: {
          budgetType: "monthly",
          percentage: 85,
          spent: 8.5,
          limit: 10,
        },
        dismissed: false,
        timestamp: 123456,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private-");
  });

  it("projects model budget rows without database identity fields", async () => {
    const row = {
      id: "private-row-id",
      user_id: "private-user",
      provider: "openai",
      model: "public-model",
      daily_limit_usd: 1,
      weekly_limit_usd: 5,
      monthly_limit_usd: 10,
      current_daily_spend: 0.1,
      current_weekly_spend: 0.5,
      current_monthly_spend: 1,
      total_calls: 7,
      total_tokens: 700,
      total_cost_usd: 1.25,
      enabled: 1,
      alert_on_limit: 1,
      block_on_limit: 0,
      created_at: 123,
      updated_at: 456,
      private_column: privateValue,
    };
    const handlers = capture(registerBudgetHandlers, {
      prepare: () => ({ all: () => [row] }),
    });

    const result = await handlers.get("llm:get-model-budgets")();

    expect(result).toEqual([
      {
        provider: "openai",
        model: "public-model",
        daily_limit_usd: 1,
        weekly_limit_usd: 5,
        monthly_limit_usd: 10,
        current_daily_spend: 0.1,
        current_weekly_spend: 0.5,
        current_monthly_spend: 1,
        total_calls: 7,
        total_tokens: 700,
        total_cost_usd: 1.25,
        enabled: true,
        alertOnLimit: true,
        blockOnLimit: false,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private-");
  });

  it("projects retention rows without user and database metadata", async () => {
    const row = {
      id: "private-row-id",
      user_id: "private-user",
      usage_log_retention_days: 90,
      cache_retention_days: 7,
      alert_history_retention_days: 30,
      auto_cleanup_enabled: 1,
      last_cleanup_at: 987654,
      created_at: 123,
      updated_at: 456,
      private_column: privateValue,
    };
    const handlers = capture(registerRetentionHandlers, {
      prepare: () => ({ get: () => row }),
    });

    const result = await handlers.get("llm:get-retention-config")();

    expect(result).toEqual({
      usageLogRetentionDays: 90,
      cacheRetentionDays: 7,
      alertHistoryRetentionDays: 30,
      autoCleanupEnabled: true,
      lastCleanupAt: 987654,
    });
    expect(JSON.stringify(result)).not.toContain("private-");
  });
});
