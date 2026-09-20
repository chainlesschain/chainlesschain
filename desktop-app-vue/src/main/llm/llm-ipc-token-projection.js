"use strict";

const { types } = require("node:util");
const {
  boundedNumber,
  boundedString,
  ownData,
} = require("./llm-ipc-success-projection");

const MAX_TIME_SERIES_POINTS = 10000;
const MAX_BREAKDOWN_ROWS = 1000;
const MAX_PRICING_PROVIDERS = 64;
const MAX_PRICING_MODELS = 2000;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function numberField(value, key) {
  return boundedNumber(ownData(value, key)) ?? 0;
}

function firstNumber(value, keys) {
  for (const key of keys) {
    const number = boundedNumber(ownData(value, key));
    if (number !== undefined) {
      return number;
    }
  }
  return 0;
}

function safeArray(value, limit, project) {
  if (!Array.isArray(value) || types.isProxy(value)) {
    return [];
  }
  const projected = [];
  const length = Math.min(value.length, limit);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      continue;
    }
    const item = project(descriptor.value);
    if (item !== null) {
      projected.push(item);
    }
  }
  return projected;
}

function projectUsageStats(value) {
  const totalCalls = numberField(value, "totalCalls");
  const totalCostUsd = numberField(value, "totalCostUsd");
  const avgCostPerCall = boundedNumber(ownData(value, "avgCostPerCall"));
  return Object.freeze({
    totalCalls,
    totalInputTokens: numberField(value, "totalInputTokens"),
    totalOutputTokens: numberField(value, "totalOutputTokens"),
    totalTokens: numberField(value, "totalTokens"),
    totalCostUsd,
    totalCostCny: numberField(value, "totalCostCny"),
    totalCost: firstNumber(value, ["totalCost", "totalCostUsd"]),
    cachedCalls: numberField(value, "cachedCalls"),
    compressedCalls: numberField(value, "compressedCalls"),
    cachedTokens: numberField(value, "cachedTokens"),
    cacheHitRate: numberField(value, "cacheHitRate"),
    avgResponseTime: numberField(value, "avgResponseTime"),
    avgCostPerCall:
      avgCostPerCall ?? (totalCalls > 0 ? totalCostUsd / totalCalls : 0),
    weekTokens: numberField(value, "weekTokens"),
    weekCost: numberField(value, "weekCost"),
  });
}

function projectTimeSeriesPoint(value) {
  const timestamp = boundedNumber(ownData(value, "timestamp"));
  if (timestamp === undefined || timestamp > MAX_TIMESTAMP) {
    return null;
  }
  const tokens = firstNumber(value, ["tokens", "totalTokens"]);
  const costUsd = firstNumber(value, ["costUsd", "cost", "cost_usd"]);
  return Object.freeze({
    timestamp,
    date: new Date(timestamp).toISOString(),
    calls: numberField(value, "calls"),
    inputTokens: numberField(value, "inputTokens"),
    outputTokens: numberField(value, "outputTokens"),
    totalTokens: firstNumber(value, ["totalTokens", "tokens"]),
    tokens,
    costUsd,
    costCny: firstNumber(value, ["costCny", "cost_cny"]),
    cost: costUsd,
  });
}

function projectTimeSeries(value) {
  return safeArray(value, MAX_TIME_SERIES_POINTS, projectTimeSeriesPoint);
}

function projectBreakdownRow(value) {
  const provider = boundedString(ownData(value, "provider"));
  if (provider === undefined) {
    return null;
  }
  const model = boundedString(ownData(value, "model"));
  const tokens = firstNumber(value, ["tokens", "totalTokens", "total_tokens"]);
  const costUsd = firstNumber(value, ["cost_usd", "costUsd", "cost"]);
  const costCny = firstNumber(value, ["cost_cny", "costCny"]);
  return Object.freeze({
    provider,
    ...(model === undefined ? {} : { model }),
    calls: numberField(value, "calls"),
    tokens,
    cost_usd: costUsd,
    cost_cny: costCny,
    cost: costUsd,
  });
}

function projectCostBreakdown(value) {
  return Object.freeze({
    byProvider: safeArray(
      ownData(value, "byProvider"),
      MAX_BREAKDOWN_ROWS,
      projectBreakdownRow,
    ),
    byModel: safeArray(
      ownData(value, "byModel"),
      MAX_BREAKDOWN_ROWS,
      projectBreakdownRow,
    ),
  });
}

function projectBudget(value) {
  if (!value) {
    return null;
  }
  return Object.freeze({
    dailyLimit: firstNumber(value, ["dailyLimit", "daily_limit_usd"]),
    weeklyLimit: firstNumber(value, ["weeklyLimit", "weekly_limit_usd"]),
    monthlyLimit: firstNumber(value, ["monthlyLimit", "monthly_limit_usd"]),
    dailySpend: firstNumber(value, ["dailySpend", "current_daily_spend"]),
    weeklySpend: firstNumber(value, ["weeklySpend", "current_weekly_spend"]),
    monthlySpend: firstNumber(value, ["monthlySpend", "current_monthly_spend"]),
    warningThreshold: firstNumber(value, [
      "warningThreshold",
      "warning_threshold",
    ]),
    criticalThreshold: firstNumber(value, [
      "criticalThreshold",
      "critical_threshold",
    ]),
    desktopAlerts:
      ownData(value, "desktopAlerts") === true ||
      ownData(value, "desktop_alerts") === 1,
    autoPauseOnLimit:
      ownData(value, "autoPauseOnLimit") === true ||
      ownData(value, "auto_pause_on_limit") === 1,
    autoSwitchToCheaperModel:
      ownData(value, "autoSwitchToCheaperModel") === true ||
      ownData(value, "auto_switch_to_cheaper_model") === 1,
    dailyResetAt: firstNumber(value, ["dailyResetAt", "daily_reset_at"]),
    weeklyResetAt: firstNumber(value, ["weeklyResetAt", "weekly_reset_at"]),
    monthlyResetAt: firstNumber(value, ["monthlyResetAt", "monthly_reset_at"]),
  });
}

function usagePercent(spend, limit) {
  if (limit <= 0) {
    return 0;
  }
  return Number(Math.min((spend / limit) * 100, 100).toFixed(2));
}

function projectTrackerBudget(value) {
  const budget = projectBudget(value);
  if (!budget) {
    return null;
  }
  return Object.freeze({
    dailyLimit: budget.dailyLimit,
    weeklyLimit: budget.weeklyLimit,
    monthlyLimit: budget.monthlyLimit,
    currentDailySpend: budget.dailySpend,
    currentWeeklySpend: budget.weeklySpend,
    currentMonthlySpend: budget.monthlySpend,
    dailyUsagePercent: usagePercent(budget.dailySpend, budget.dailyLimit),
    weeklyUsagePercent: usagePercent(budget.weeklySpend, budget.weeklyLimit),
    monthlyUsagePercent: usagePercent(budget.monthlySpend, budget.monthlyLimit),
    warningThreshold: budget.warningThreshold,
    criticalThreshold: budget.criticalThreshold,
    desktopAlerts: budget.desktopAlerts,
    autoPauseOnLimit: budget.autoPauseOnLimit,
    autoSwitchToCheaperModel: budget.autoSwitchToCheaperModel,
    dailyResetAt: budget.dailyResetAt,
    weeklyResetAt: budget.weeklyResetAt,
    monthlyResetAt: budget.monthlyResetAt,
  });
}

function plainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !types.isProxy(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function dataEntries(value, limit) {
  if (!plainObject(value)) {
    return [];
  }
  const entries = [];
  for (const key of Object.keys(Object.getOwnPropertyDescriptors(value))) {
    if (entries.length >= limit || FORBIDDEN_KEYS.has(key)) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor?.enumerable &&
      "value" in descriptor &&
      boundedString(key) !== undefined
    ) {
      entries.push([key, descriptor.value]);
    }
  }
  return entries;
}

function projectPricingCatalog(value) {
  const catalog = {};
  for (const [provider, providerPricing] of dataEntries(
    value,
    MAX_PRICING_PROVIDERS,
  )) {
    const models = {};
    for (const [model, price] of dataEntries(
      providerPricing,
      MAX_PRICING_MODELS,
    )) {
      Object.defineProperty(models, model, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: Object.freeze({
          input: numberField(price, "input"),
          output: numberField(price, "output"),
          cache: numberField(price, "cache"),
        }),
      });
    }
    Object.defineProperty(catalog, provider, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: Object.freeze(models),
    });
  }
  return Object.freeze(catalog);
}

function projectUsageRecord(value) {
  return Object.freeze({
    totalTokens: numberField(value, "totalTokens"),
    costUsd: numberField(value, "costUsd"),
    costCny: numberField(value, "costCny"),
  });
}

function projectConversationRow(value) {
  const provider = boundedString(ownData(value, "provider"));
  const model = boundedString(ownData(value, "model"));
  if (provider === undefined || model === undefined) {
    return null;
  }
  return Object.freeze({
    provider,
    model,
    callCount: firstNumber(value, ["callCount", "call_count"]),
    inputTokens: firstNumber(value, ["inputTokens", "input_tokens"]),
    outputTokens: firstNumber(value, ["outputTokens", "output_tokens"]),
    costUsd: firstNumber(value, ["costUsd", "cost_usd"]),
    avgResponseTime: firstNumber(value, [
      "avgResponseTime",
      "avg_response_time",
    ]),
  });
}

function projectConversationStats(summary, rows) {
  return Object.freeze({
    summary: summary
      ? Object.freeze({
          totalInputTokens: firstNumber(summary, [
            "totalInputTokens",
            "total_input_tokens",
          ]),
          totalOutputTokens: firstNumber(summary, [
            "totalOutputTokens",
            "total_output_tokens",
          ]),
          totalCostUsd: firstNumber(summary, [
            "totalCostUsd",
            "total_cost_usd",
          ]),
          totalCostCny: firstNumber(summary, [
            "totalCostCny",
            "total_cost_cny",
          ]),
        })
      : null,
    byModel: safeArray(rows, MAX_BREAKDOWN_ROWS, projectConversationRow),
  });
}

function percentNumber(value) {
  const direct = boundedNumber(value);
  if (direct !== undefined) {
    return direct;
  }
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !/^\d+(?:\.\d+)?%?$/.test(value)
  ) {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function projectCacheStats(value) {
  if (!value) {
    return null;
  }
  const runtime = ownData(value, "runtime");
  const database = ownData(value, "database");
  return Object.freeze({
    totalEntries:
      firstNumber(value, ["totalEntries"]) ||
      numberField(database, "totalEntries"),
    expiredEntries:
      firstNumber(value, ["expiredEntries"]) ||
      numberField(database, "expiredEntries"),
    totalHits:
      firstNumber(value, ["totalHits"]) || numberField(database, "totalHits"),
    totalTokensSaved:
      firstNumber(value, ["totalTokensSaved"]) ||
      numberField(database, "totalTokensSaved"),
    totalCostSaved: numberField(value, "totalCostSaved"),
    avgHitsPerEntry:
      firstNumber(value, ["avgHitsPerEntry"]) ||
      percentNumber(ownData(database, "avgHitsPerEntry")),
    hitRate:
      firstNumber(value, ["hitRate"]) ||
      percentNumber(ownData(runtime, "hitRate")),
  });
}

function projectOperationResult(value, extra = {}) {
  return Object.freeze({
    success: ownData(value, "success") === true,
    ...extra,
  });
}

function projectCostEstimate(value) {
  const pricing = ownData(value, "pricing");
  return Object.freeze({
    costUsd: numberField(value, "costUsd"),
    costCny: numberField(value, "costCny"),
    pricing:
      pricing == null
        ? null
        : Object.freeze({
            input: numberField(pricing, "input"),
            output: numberField(pricing, "output"),
            cache: numberField(pricing, "cache"),
          }),
  });
}

function projectBudgetDecision(value) {
  const allowed = ownData(value, "allowed") === true;
  return Object.freeze({
    allowed,
    ...(allowed ? {} : { reason: "budget-limit" }),
  });
}

module.exports = {
  projectBudget,
  projectBudgetDecision,
  projectCacheStats,
  projectConversationStats,
  projectCostBreakdown,
  projectCostEstimate,
  projectOperationResult,
  projectPricingCatalog,
  projectTimeSeries,
  projectTrackerBudget,
  projectUsageRecord,
  projectUsageStats,
};
