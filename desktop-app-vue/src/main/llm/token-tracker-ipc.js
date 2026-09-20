/**
 * Token Tracker IPC handlers.
 *
 * The tracker and its database remain private to the main process. Every
 * renderer-facing result is projected to a bounded plain-data contract.
 *
 * @module token-tracker-ipc
 */

const { types } = require("node:util");
const defaultIpcGuard = require("../ipc/ipc-guard");
const {
  createLlmCoreIpcAuthorization,
} = require("./llm-core-ipc-authorization");
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
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_TOKEN_COUNT = 1_000_000_000;
const MAX_BUDGET_USD = 1_000_000_000;
const RANGE_KEYS = new Set([
  "startDate",
  "endDate",
  "provider",
  "interval",
  "format",
]);
const BUDGET_KEYS = new Set([
  "dailyLimit",
  "weeklyLimit",
  "monthlyLimit",
  "warningThreshold",
  "criticalThreshold",
  "desktopAlerts",
  "autoPauseOnLimit",
  "autoSwitchToCheaperModel",
]);
const ESTIMATE_KEYS = new Set([
  "provider",
  "model",
  "inputTokens",
  "outputTokens",
  "cachedTokens",
]);
const RESET_KEYS = new Set(["period"]);
const RECORD_KEYS = new Set([
  "conversationId",
  "messageId",
  "provider",
  "model",
  "inputTokens",
  "outputTokens",
  "cachedTokens",
  "wasCached",
  "wasCompressed",
  "compressionRatio",
  "responseTime",
]);
const TRACKER_CHANNEL_OPERATIONS = Object.freeze({
  "tracker:get-usage-stats": "tracker-get-usage-stats",
  "tracker:get-time-series": "tracker-get-time-series",
  "tracker:get-cost-breakdown": "tracker-get-cost-breakdown",
  "tracker:get-pricing": "tracker-get-pricing",
  "tracker:calculate-cost": "tracker-calculate-cost",
  "tracker:get-budget": "tracker-get-budget",
  "tracker:set-budget": "tracker-set-budget",
  "tracker:reset-budget-counters": "tracker-reset-budget-counters",
  "tracker:record-usage": "tracker-record-usage",
  "tracker:export-report": "tracker-export-report",
  "tracker:get-conversation-stats": "tracker-get-conversation-stats",
  "tracker:set-exchange-rate": "tracker-set-exchange-rate",
});

let tokenTrackerInstance = null;

function ownData(source, key) {
  if (
    !source ||
    types.isProxy(source) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(source))
  ) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function authorizedActor(request) {
  const actorDid = ownData(request, "actorDid");
  if (
    typeof actorDid !== "string" ||
    actorDid.length < 1 ||
    actorDid.length > 512 ||
    /\p{Cc}/u.test(actorDid)
  ) {
    throw new TypeError("Invalid tracker actor");
  }
  return actorDid;
}

function descriptorsFor(value, allowedKeys) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid tracker input");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      !allowedKeys.has(key) ||
      descriptors[key]?.enumerable !== true ||
      !Object.hasOwn(descriptors[key], "value")
    ) {
      throw new TypeError("Invalid tracker field");
    }
  }
  return descriptors;
}

function boundedText(value, maximum, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) {
    return null;
  }
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError("Invalid tracker identifier");
  }
  return value;
}

function timestamp(value, fallback) {
  const normalized = value ?? fallback;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < 0 ||
    normalized > MAX_TIMESTAMP
  ) {
    throw new TypeError("Invalid tracker timestamp");
  }
  return normalized;
}

function normalizeRange(value, actorDid, kind) {
  const descriptors = descriptorsFor(value, RANGE_KEYS);
  const now = Date.now();
  const startDate = timestamp(
    descriptors.startDate?.value,
    now - (kind === "export" ? 30 : 7) * 24 * 60 * 60 * 1000,
  );
  const endDate = timestamp(descriptors.endDate?.value, now);
  if (startDate > endDate || endDate - startDate > MAX_RANGE_MS) {
    throw new TypeError("Invalid tracker date range");
  }
  const normalized = { startDate, endDate, userId: actorDid };
  if (kind === "usage" && descriptors.provider) {
    normalized.provider = boundedText(descriptors.provider.value, 128);
  }
  if (kind === "time-series") {
    const interval = descriptors.interval?.value ?? "day";
    if (!VALID_INTERVALS.has(interval)) {
      throw new TypeError("Invalid tracker interval");
    }
    normalized.interval = interval;
  }
  if (kind === "export") {
    const format = descriptors.format?.value ?? "csv";
    if (format !== "csv") {throw new TypeError("Invalid tracker report format");}
    normalized.format = format;
  }
  for (const key of Object.keys(descriptors)) {
    const allowed =
      key === "startDate" ||
      key === "endDate" ||
      (kind === "usage" && key === "provider") ||
      (kind === "time-series" && key === "interval") ||
      (kind === "export" && key === "format");
    if (!allowed) {throw new TypeError("Unexpected tracker range field");}
  }
  return Object.freeze(normalized);
}

function budgetNumber(descriptors, key, maximum = MAX_BUDGET_USD) {
  const value = descriptors[key]?.value;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new TypeError("Invalid tracker budget number");
  }
  return value;
}

function budgetFlag(descriptors, key, fallback) {
  const value = descriptors[key]?.value ?? fallback;
  if (typeof value !== "boolean") {
    throw new TypeError("Invalid tracker budget flag");
  }
  return value;
}

function normalizeBudget(value) {
  const descriptors = descriptorsFor(value, BUDGET_KEYS);
  const warningThreshold = budgetNumber(descriptors, "warningThreshold", 1);
  const criticalThreshold = budgetNumber(descriptors, "criticalThreshold", 1);
  if (warningThreshold > criticalThreshold) {
    throw new TypeError("Invalid tracker budget thresholds");
  }
  return Object.freeze({
    dailyLimit: budgetNumber(descriptors, "dailyLimit"),
    weeklyLimit: budgetNumber(descriptors, "weeklyLimit"),
    monthlyLimit: budgetNumber(descriptors, "monthlyLimit"),
    warningThreshold,
    criticalThreshold,
    desktopAlerts: budgetFlag(descriptors, "desktopAlerts", true),
    autoPauseOnLimit: budgetFlag(descriptors, "autoPauseOnLimit", false),
    autoSwitchToCheaperModel: budgetFlag(
      descriptors,
      "autoSwitchToCheaperModel",
      true,
    ),
  });
}

function tokenCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TOKEN_COUNT) {
    throw new TypeError("Invalid tracker token count");
  }
  return value;
}

function normalizeEstimate(value) {
  const descriptors = descriptorsFor(value, ESTIMATE_KEYS);
  return Object.freeze({
    provider: boundedText(descriptors.provider?.value, 128),
    model: boundedText(descriptors.model?.value, 256),
    inputTokens: tokenCount(descriptors.inputTokens?.value ?? 0),
    outputTokens: tokenCount(descriptors.outputTokens?.value ?? 0),
    cachedTokens: tokenCount(descriptors.cachedTokens?.value ?? 0),
  });
}

function booleanField(descriptors, key, fallback) {
  const value = descriptors[key]?.value ?? fallback;
  if (typeof value !== "boolean") {throw new TypeError("Invalid tracker flag");}
  return value;
}

function normalizeRecord(value, actorDid) {
  const descriptors = descriptorsFor(value, RECORD_KEYS);
  const ratio = descriptors.compressionRatio?.value ?? 1;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new TypeError("Invalid tracker compression ratio");
  }
  const responseTime = descriptors.responseTime?.value;
  if (
    responseTime !== undefined &&
    (!Number.isSafeInteger(responseTime) ||
      responseTime < 0 ||
      responseTime > 86_400_000)
  ) {
    throw new TypeError("Invalid tracker response time");
  }
  return Object.freeze({
    conversationId: boundedText(descriptors.conversationId?.value, 256, {
      optional: true,
    }),
    messageId: boundedText(descriptors.messageId?.value, 256, {
      optional: true,
    }),
    provider: boundedText(descriptors.provider?.value, 128),
    model: boundedText(descriptors.model?.value, 256),
    inputTokens: tokenCount(descriptors.inputTokens?.value ?? 0),
    outputTokens: tokenCount(descriptors.outputTokens?.value ?? 0),
    cachedTokens: tokenCount(descriptors.cachedTokens?.value ?? 0),
    wasCached: booleanField(descriptors, "wasCached", false),
    wasCompressed: booleanField(descriptors, "wasCompressed", false),
    compressionRatio: ratio,
    responseTime,
    endpoint: null,
    userId: actorDid,
    updateConversationTotals: false,
  });
}

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
  mainWindow,
  didManager,
  getMainWindow,
  getCurrentIdentity,
  authorizePurpose,
  coreAuthorization: injectedAuthorization,
  trackerPrivacy,
} = {}) {
  const privacy = trackerPrivacy || createLlmIpcPrivacy("tracker");
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  if (ipcGuard.isModuleRegistered("token-tracker-ipc")) {
    privacy.event("handlers-already-registered");
    return;
  }

  const ipcMain = injectedIpcMain || require("electron").ipcMain;
  if (tokenTracker !== undefined) {
    setTokenTrackerInstance(tokenTracker || null);
  }

  const authorization =
    injectedAuthorization ||
    createLlmCoreIpcAuthorization({
      getMainWindow: getMainWindow || (() => mainWindow || null),
      getCurrentIdentity:
        getCurrentIdentity ||
        (() => didManager?.getCurrentIdentity?.() || null),
      authorizePurpose,
    });
  const authorizedIpcMain = {
    handle(channel, handler) {
      const authorizationOperation = TRACKER_CHANNEL_OPERATIONS[channel];
      ipcMain.handle(channel, async (event, ...args) => {
        let actorDid;
        try {
          actorDid = authorizedActor(
            await authorization.authorize(event, authorizationOperation),
          );
        } catch {
          throw privacy.authorizationFailure(authorizationOperation);
        }
        return handler(event, actorDid, ...args);
      });
    },
  };

  privacy.event("handlers-registering");

  authorizedIpcMain.handle(
    "tracker:get-usage-stats",
    async (_event, actorDid, ...args) => {
      const lookup = trackerOrFailure(privacy, "get-usage-stats");
      if (lookup.failure) {
        return lookup.failure;
      }
      try {
        if (args.length > 1) {throw new TypeError("Invalid tracker input count");}
        const options = normalizeRange(args[0] ?? {}, actorDid, "usage");
        return Object.freeze({
          success: true,
          stats: projectUsageStats(await lookup.tracker.getUsageStats(options)),
        });
      } catch {
        return fixedFailure(privacy, "get-usage-stats");
      }
    },
  );

  authorizedIpcMain.handle(
    "tracker:get-time-series",
    async (_event, actorDid, ...args) => {
      const lookup = trackerOrFailure(privacy, "get-time-series");
      if (lookup.failure) {
        return lookup.failure;
      }
      try {
        if (args.length > 1) {throw new TypeError("Invalid tracker input count");}
        const options = normalizeRange(args[0] ?? {}, actorDid, "time-series");
        return Object.freeze({
          success: true,
          data: projectTimeSeries(
            await lookup.tracker.getTimeSeriesData(options),
          ),
          interval: options.interval,
        });
      } catch {
        return fixedFailure(privacy, "get-time-series");
      }
    },
  );

  authorizedIpcMain.handle(
    "tracker:get-cost-breakdown",
    async (_event, actorDid, ...args) => {
      const lookup = trackerOrFailure(privacy, "get-cost-breakdown");
      if (lookup.failure) {
        return lookup.failure;
      }
      try {
        if (args.length > 1) {throw new TypeError("Invalid tracker input count");}
        const options = normalizeRange(args[0] ?? {}, actorDid, "cost");
        return Object.freeze({
          success: true,
          breakdown: projectCostBreakdown(
            await lookup.tracker.getCostBreakdown(options),
          ),
        });
      } catch {
        return fixedFailure(privacy, "get-cost-breakdown");
      }
    },
  );

  authorizedIpcMain.handle(
    "tracker:get-pricing",
    async (_event, _actorDid, ...args) => {
      try {
        if (args.length !== 0)
          {throw new TypeError("Invalid tracker input count");}
        const { PRICING_DATA } = require("./token-tracker.js");
        return Object.freeze({
          success: true,
          pricing: projectPricingCatalog(PRICING_DATA),
        });
      } catch {
        return fixedFailure(privacy, "get-pricing");
      }
    },
  );

  authorizedIpcMain.handle(
    "tracker:calculate-cost",
    async (_event, _actorDid, ...args) => {
      const lookup = trackerOrFailure(privacy, "calculate-cost");
      if (lookup.failure) {
        return lookup.failure;
      }
      try {
        if (args.length !== 1)
          {throw new TypeError("Invalid tracker input count");}
        const { provider, model, inputTokens, outputTokens, cachedTokens } =
          normalizeEstimate(args[0]);
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
    },
  );

  authorizedIpcMain.handle(
    "tracker:get-budget",
    async (_event, actorDid, ...args) => {
      const lookup = trackerOrFailure(privacy, "get-budget");
      if (lookup.failure) {
        return lookup.failure;
      }
      try {
        if (args.length !== 0)
          {throw new TypeError("Invalid tracker input count");}
        return Object.freeze({
          success: true,
          config: projectTrackerBudget(
            await lookup.tracker.getBudgetConfig(actorDid),
          ),
        });
      } catch {
        return fixedFailure(privacy, "get-budget");
      }
    },
  );

  authorizedIpcMain.handle(
    "tracker:set-budget",
    async (_event, actorDid, ...args) => {
      const lookup = trackerOrFailure(privacy, "set-budget");
      if (lookup.failure) {
        return lookup.failure;
      }
      try {
        if (args.length !== 1)
          {throw new TypeError("Invalid tracker input count");}
        await lookup.tracker.saveBudgetConfig(
          actorDid,
          normalizeBudget(args[0]),
        );
        return successReceipt();
      } catch {
        return fixedFailure(privacy, "set-budget");
      }
    },
  );

  authorizedIpcMain.handle(
    "tracker:reset-budget-counters",
    async (_event, actorDid, ...args) => {
      const lookup = trackerOrFailure(privacy, "reset-budget-counters");
      if (lookup.failure) {
        return lookup.failure;
      }
      try {
        if (args.length > 1) {throw new TypeError("Invalid tracker input count");}
        const descriptors = descriptorsFor(args[0] ?? {}, RESET_KEYS);
        const period = descriptors.period?.value ?? "all";
        if (!VALID_RESET_PERIODS.has(period)) {
          return fixedFailure(privacy, "reset-budget-counters");
        }
        if (!(await lookup.tracker.getBudgetConfig(actorDid))) {
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
          .run(...Object.values(updates), now, actorDid);

        return successReceipt({
          resetPeriods:
            period === "all" ? ["daily", "weekly", "monthly"] : [period],
        });
      } catch {
        return fixedFailure(privacy, "reset-budget-counters");
      }
    },
  );

  authorizedIpcMain.handle(
    "tracker:record-usage",
    async (_event, actorDid, ...args) => {
      const lookup = trackerOrFailure(privacy, "record-usage");
      if (lookup.failure) {
        return lookup.failure;
      }
      try {
        if (args.length !== 1)
          {throw new TypeError("Invalid tracker input count");}
        return Object.freeze({
          success: true,
          record: projectUsageRecord(
            await lookup.tracker.recordUsage(
              normalizeRecord(args[0], actorDid),
            ),
          ),
        });
      } catch {
        return fixedFailure(privacy, "record-usage");
      }
    },
  );

  authorizedIpcMain.handle(
    "tracker:export-report",
    async (_event, actorDid, ...args) => {
      const lookup = trackerOrFailure(privacy, "export-report");
      if (lookup.failure) {
        return lookup.failure;
      }
      try {
        if (args.length > 1) {throw new TypeError("Invalid tracker input count");}
        const options = normalizeRange(args[0] ?? {}, actorDid, "export");
        await lookup.tracker.exportCostReport(options);
        return successReceipt();
      } catch {
        return fixedFailure(privacy, "export-report");
      }
    },
  );

  authorizedIpcMain.handle(
    "tracker:get-conversation-stats",
    async (_event, actorDid, ...args) => {
      const lookup = trackerOrFailure(privacy, "get-conversation-stats");
      if (lookup.failure) {
        return lookup.failure;
      }
      try {
        if (args.length !== 1)
          {throw new TypeError("Invalid tracker input count");}
        const conversationId = boundedText(args[0], 256);
        const summary = lookup.tracker.db
          .prepare(
            `SELECT SUM(input_tokens) as total_input_tokens,
                    SUM(output_tokens) as total_output_tokens,
                    SUM(cost_usd) as total_cost_usd,
                    SUM(cost_cny) as total_cost_cny
             FROM llm_usage_log
             WHERE conversation_id = ? AND user_id = ?`,
          )
          .get(conversationId, actorDid);
        const byModel = lookup.tracker.db
          .prepare(
            `SELECT COUNT(*) as call_count, provider, model,
                    SUM(input_tokens) as input_tokens,
                    SUM(output_tokens) as output_tokens,
                    SUM(cost_usd) as cost_usd,
                    AVG(response_time) as avg_response_time
             FROM llm_usage_log
             WHERE conversation_id = ? AND user_id = ?
             GROUP BY provider, model
             ORDER BY cost_usd DESC`,
          )
          .all(conversationId, actorDid);
        return Object.freeze({
          success: true,
          ...projectConversationStats(summary, byModel),
        });
      } catch {
        return fixedFailure(privacy, "get-conversation-stats");
      }
    },
  );

  authorizedIpcMain.handle(
    "tracker:set-exchange-rate",
    async (_event, _actorDid, ...args) => {
      const lookup = trackerOrFailure(privacy, "set-exchange-rate");
      if (lookup.failure) {
        return lookup.failure;
      }
      try {
        if (args.length !== 1)
          {throw new TypeError("Invalid tracker input count");}
        const rate = args[0];
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
    },
  );

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
