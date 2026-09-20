/**
 * Token Tracker IPC handlers.
 *
 * The tracker and its database remain private to the main process. Every
 * renderer-facing result is projected to a bounded plain-data contract.
 *
 * @module token-tracker-ipc
 */

const defaultIpcGuard = require("../ipc/ipc-guard");
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");
const {
  projectConversationStats,
  projectCostBreakdown,
  projectCostEstimate,
  projectOperationResult,
  projectPricingCatalog,
  projectTimeSeries,
  projectTrackerBudget,
  projectUsageRecord,
  projectUsageStats,
} = require("./llm-ipc-token-projection");

const VALID_RESET_PERIODS = new Set(["daily", "weekly", "monthly", "all"]);
const VALID_INTERVALS = new Set(["hour", "day", "week"]);

let tokenTrackerInstance = null;

function setTokenTrackerInstance(tracker) {
  tokenTrackerInstance = tracker;
}

function getTokenTrackerInstance() {
  return tokenTrackerInstance;
}

function fixedFailure(privacy, operation) {
  privacy.failure(operation);
  return Object.freeze({
    success: false,
    error: "LLM IPC operation failed",
    code: "CC_LLM_IPC_OPERATION_FAILED",
  });
}

function trackerOrFailure(privacy, operation) {
  const tracker = getTokenTrackerInstance();
  return tracker ? { tracker } : { failure: fixedFailure(privacy, operation) };
}

function successReceipt(extra = {}) {
  return projectOperationResult({ success: true }, extra);
}

function registerTokenTrackerIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
  tokenTracker,
} = {}) {
  const privacy = createLlmIpcPrivacy("tracker");
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  if (ipcGuard.isModuleRegistered("token-tracker-ipc")) {
    privacy.event("handlers-already-registered");
    return;
  }

  const ipcMain = injectedIpcMain || require("electron").ipcMain;
  if (tokenTracker) {
    setTokenTrackerInstance(tokenTracker);
  }

  privacy.event("handlers-registering");

  ipcMain.handle("tracker:get-usage-stats", async (_event, options = {}) => {
    const lookup = trackerOrFailure(privacy, "get-usage-stats");
    if (lookup.failure) {
      return lookup.failure;
    }
    try {
      return Object.freeze({
        success: true,
        stats: projectUsageStats(await lookup.tracker.getUsageStats(options)),
      });
    } catch {
      return fixedFailure(privacy, "get-usage-stats");
    }
  });

  ipcMain.handle("tracker:get-time-series", async (_event, options = {}) => {
    const lookup = trackerOrFailure(privacy, "get-time-series");
    if (lookup.failure) {
      return lookup.failure;
    }
    try {
      const interval = VALID_INTERVALS.has(options.interval)
        ? options.interval
        : "day";
      return Object.freeze({
        success: true,
        data: projectTimeSeries(
          await lookup.tracker.getTimeSeriesData(options),
        ),
        interval,
      });
    } catch {
      return fixedFailure(privacy, "get-time-series");
    }
  });

  ipcMain.handle("tracker:get-cost-breakdown", async (_event, options = {}) => {
    const lookup = trackerOrFailure(privacy, "get-cost-breakdown");
    if (lookup.failure) {
      return lookup.failure;
    }
    try {
      return Object.freeze({
        success: true,
        breakdown: projectCostBreakdown(
          await lookup.tracker.getCostBreakdown(options),
        ),
      });
    } catch {
      return fixedFailure(privacy, "get-cost-breakdown");
    }
  });

  ipcMain.handle("tracker:get-pricing", async () => {
    try {
      const { PRICING_DATA } = require("./token-tracker.js");
      return Object.freeze({
        success: true,
        pricing: projectPricingCatalog(PRICING_DATA),
      });
    } catch {
      return fixedFailure(privacy, "get-pricing");
    }
  });

  ipcMain.handle("tracker:calculate-cost", async (_event, params = {}) => {
    const lookup = trackerOrFailure(privacy, "calculate-cost");
    if (lookup.failure) {
      return lookup.failure;
    }
    try {
      const {
        provider,
        model,
        inputTokens = 0,
        outputTokens = 0,
        cachedTokens = 0,
      } = params;
      if (!provider || !model) {
        return fixedFailure(privacy, "calculate-cost");
      }
      return Object.freeze({
        success: true,
        cost: projectCostEstimate(
          lookup.tracker.calculateCost(
            provider,
            model,
            inputTokens,
            outputTokens,
            cachedTokens,
          ),
        ),
      });
    } catch {
      return fixedFailure(privacy, "calculate-cost");
    }
  });

  ipcMain.handle("tracker:get-budget", async (_event, userId = "default") => {
    const lookup = trackerOrFailure(privacy, "get-budget");
    if (lookup.failure) {
      return lookup.failure;
    }
    try {
      return Object.freeze({
        success: true,
        config: projectTrackerBudget(
          await lookup.tracker.getBudgetConfig(userId),
        ),
      });
    } catch {
      return fixedFailure(privacy, "get-budget");
    }
  });

  ipcMain.handle("tracker:set-budget", async (_event, params = {}) => {
    const lookup = trackerOrFailure(privacy, "set-budget");
    if (lookup.failure) {
      return lookup.failure;
    }
    try {
      const userId = params.userId || "default";
      await lookup.tracker.saveBudgetConfig(userId, {
        dailyLimit: params.dailyLimit,
        weeklyLimit: params.weeklyLimit,
        monthlyLimit: params.monthlyLimit,
        warningThreshold: params.warningThreshold,
        criticalThreshold: params.criticalThreshold,
        desktopAlerts: params.desktopAlerts,
        autoPauseOnLimit: params.autoPauseOnLimit,
        autoSwitchToCheaperModel: params.autoSwitchToCheaperModel,
      });
      return successReceipt();
    } catch {
      return fixedFailure(privacy, "set-budget");
    }
  });

  ipcMain.handle(
    "tracker:reset-budget-counters",
    async (_event, params = {}) => {
      const lookup = trackerOrFailure(privacy, "reset-budget-counters");
      if (lookup.failure) {
        return lookup.failure;
      }
      try {
        const userId = params.userId || "default";
        const period = params.period || "all";
        if (!VALID_RESET_PERIODS.has(period)) {
          return fixedFailure(privacy, "reset-budget-counters");
        }
        if (!(await lookup.tracker.getBudgetConfig(userId))) {
          return fixedFailure(privacy, "reset-budget-counters");
        }

        const updates = {};
        const now = Date.now();
        if (period === "daily" || period === "all") {
          updates.current_daily_spend = 0;
          updates.daily_reset_at = now + 24 * 60 * 60 * 1000;
        }
        if (period === "weekly" || period === "all") {
          updates.current_weekly_spend = 0;
          updates.weekly_reset_at = now + 7 * 24 * 60 * 60 * 1000;
        }
        if (period === "monthly" || period === "all") {
          updates.current_monthly_spend = 0;
          updates.monthly_reset_at = now + 30 * 24 * 60 * 60 * 1000;
        }

        const setClauses = Object.keys(updates)
          .map((key) => `${key} = ?`)
          .join(", ");
        lookup.tracker.db
          .prepare(
            `UPDATE llm_budget_config
             SET ${setClauses}, updated_at = ?
             WHERE user_id = ?`,
          )
          .run(...Object.values(updates), now, userId);

        return successReceipt({
          resetPeriods:
            period === "all" ? ["daily", "weekly", "monthly"] : [period],
        });
      } catch {
        return fixedFailure(privacy, "reset-budget-counters");
      }
    },
  );

  ipcMain.handle("tracker:record-usage", async (_event, params = {}) => {
    const lookup = trackerOrFailure(privacy, "record-usage");
    if (lookup.failure) {
      return lookup.failure;
    }
    try {
      if (!params.provider || !params.model) {
        return fixedFailure(privacy, "record-usage");
      }
      return Object.freeze({
        success: true,
        record: projectUsageRecord(await lookup.tracker.recordUsage(params)),
      });
    } catch {
      return fixedFailure(privacy, "record-usage");
    }
  });

  ipcMain.handle("tracker:export-report", async (_event, options = {}) => {
    const lookup = trackerOrFailure(privacy, "export-report");
    if (lookup.failure) {
      return lookup.failure;
    }
    try {
      await lookup.tracker.exportCostReport(options);
      return successReceipt();
    } catch {
      return fixedFailure(privacy, "export-report");
    }
  });

  ipcMain.handle(
    "tracker:get-conversation-stats",
    async (_event, conversationId) => {
      const lookup = trackerOrFailure(privacy, "get-conversation-stats");
      if (lookup.failure) {
        return lookup.failure;
      }
      if (!conversationId) {
        return fixedFailure(privacy, "get-conversation-stats");
      }
      try {
        const summary = lookup.tracker.db
          .prepare(
            `SELECT total_input_tokens, total_output_tokens,
                    total_cost_usd, total_cost_cny
             FROM conversations
             WHERE id = ?`,
          )
          .get(conversationId);
        const byModel = lookup.tracker.db
          .prepare(
            `SELECT COUNT(*) as call_count, provider, model,
                    SUM(input_tokens) as input_tokens,
                    SUM(output_tokens) as output_tokens,
                    SUM(cost_usd) as cost_usd,
                    AVG(response_time) as avg_response_time
             FROM llm_usage_log
             WHERE conversation_id = ?
             GROUP BY provider, model
             ORDER BY cost_usd DESC`,
          )
          .all(conversationId);
        return Object.freeze({
          success: true,
          ...projectConversationStats(summary, byModel),
        });
      } catch {
        return fixedFailure(privacy, "get-conversation-stats");
      }
    },
  );

  ipcMain.handle("tracker:set-exchange-rate", async (_event, rate) => {
    const lookup = trackerOrFailure(privacy, "set-exchange-rate");
    if (lookup.failure) {
      return lookup.failure;
    }
    try {
      if (
        typeof rate !== "number" ||
        !Number.isFinite(rate) ||
        rate <= 0 ||
        rate > Number.MAX_SAFE_INTEGER
      ) {
        return fixedFailure(privacy, "set-exchange-rate");
      }
      lookup.tracker.options.exchangeRate = rate;
      return successReceipt();
    } catch {
      return fixedFailure(privacy, "set-exchange-rate");
    }
  });

  ipcGuard.markModuleRegistered("token-tracker-ipc");
  privacy.event("handlers-registered");
}

function unregisterTokenTrackerIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;
  if (!ipcGuard.isModuleRegistered("token-tracker-ipc")) {
    return;
  }

  const ipcMain = injectedIpcMain || require("electron").ipcMain;
  const channels = [
    "tracker:get-usage-stats",
    "tracker:get-time-series",
    "tracker:get-cost-breakdown",
    "tracker:get-pricing",
    "tracker:calculate-cost",
    "tracker:get-budget",
    "tracker:set-budget",
    "tracker:reset-budget-counters",
    "tracker:record-usage",
    "tracker:export-report",
    "tracker:get-conversation-stats",
    "tracker:set-exchange-rate",
  ];
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  setTokenTrackerInstance(null);
  ipcGuard.unmarkModuleRegistered("token-tracker-ipc");
  createLlmIpcPrivacy("tracker").event("handlers-unregistered");
}

module.exports = {
  getTokenTrackerInstance,
  registerTokenTrackerIPC,
  setTokenTrackerInstance,
  unregisterTokenTrackerIPC,
};
