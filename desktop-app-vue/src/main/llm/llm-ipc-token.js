/**
 * LLM IPC handlers — token group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-token
 */
const { types } = require("node:util");
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");
const {
  projectBudget,
  projectBudgetDecision,
  projectCacheStats,
  projectCostBreakdown,
  projectCostEstimate,
  projectOperationResult,
  projectTimeSeries,
  projectUsageStats,
} = require("./llm-ipc-token-projection");

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
    throw new TypeError("Invalid token actor");
  }
  return actorDid;
}

function descriptorsFor(value, allowedKeys) {
  if (
    !value ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid token input");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      !allowedKeys.has(key) ||
      descriptors[key]?.enumerable !== true ||
      !Object.hasOwn(descriptors[key], "value")
    ) {
      throw new TypeError("Invalid token field");
    }
  }
  return descriptors;
}

function boundedText(value, maximum) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError("Invalid token identifier");
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
    throw new TypeError("Invalid token timestamp");
  }
  return normalized;
}

function normalizeRange(value, actorDid, kind) {
  const descriptors = descriptorsFor(value, RANGE_KEYS);
  const now = Date.now();
  const defaultDays = kind === "export" ? 30 : 7;
  const startDate = timestamp(
    descriptors.startDate?.value,
    now - defaultDays * 24 * 60 * 60 * 1000,
  );
  const endDate = timestamp(descriptors.endDate?.value, now);
  if (startDate > endDate || endDate - startDate > MAX_RANGE_MS) {
    throw new TypeError("Invalid token date range");
  }
  const result = { startDate, endDate, userId: actorDid };
  if (kind === "usage" && descriptors.provider) {
    result.provider = boundedText(descriptors.provider.value, 128);
  }
  if (kind === "time-series") {
    const interval = descriptors.interval?.value ?? "day";
    if (!["hour", "day", "week"].includes(interval)) {
      throw new TypeError("Invalid time-series interval");
    }
    result.interval = interval;
  }
  if (kind === "export") {
    const format = descriptors.format?.value ?? "csv";
    if (format !== "csv") {
      throw new TypeError("Invalid report format");
    }
    result.format = format;
  }
  for (const key of Object.keys(descriptors)) {
    const allowedForKind =
      key === "startDate" ||
      key === "endDate" ||
      (kind === "usage" && key === "provider") ||
      (kind === "time-series" && key === "interval") ||
      (kind === "export" && key === "format");
    if (!allowedForKind) {
      throw new TypeError("Unexpected token range field");
    }
  }
  return Object.freeze(result);
}

function budgetNumber(descriptors, key, maximum = MAX_BUDGET_USD) {
  const value = descriptors[key]?.value;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new TypeError("Invalid budget number");
  }
  return value;
}

function budgetFlag(descriptors, key, fallback) {
  const value = descriptors[key]?.value ?? fallback;
  if (typeof value !== "boolean") {
    throw new TypeError("Invalid budget flag");
  }
  return value;
}

function normalizeBudget(value) {
  const descriptors = descriptorsFor(value, BUDGET_KEYS);
  const warningThreshold = budgetNumber(descriptors, "warningThreshold", 1);
  const criticalThreshold = budgetNumber(descriptors, "criticalThreshold", 1);
  if (warningThreshold > criticalThreshold) {
    throw new TypeError("Invalid budget thresholds");
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
    throw new TypeError("Invalid token count");
  }
  return value;
}

function normalizeEstimate(value) {
  const descriptors = descriptorsFor(value, ESTIMATE_KEYS);
  return Object.freeze({
    provider: boundedText(descriptors.provider?.value, 128),
    model: boundedText(descriptors.model?.value, 256),
    inputTokens: tokenCount(descriptors.inputTokens?.value),
    outputTokens: tokenCount(descriptors.outputTokens?.value),
    cachedTokens: tokenCount(descriptors.cachedTokens?.value ?? 0),
  });
}

function registerTokenHandlers(ctx) {
  const { ipcMain, managerRef, database, tokenTracker, responseCache } = ctx;
  const privacy = ctx.tokenPrivacy || createLlmIpcPrivacy("token");
  const authorization = ctx.coreAuthorization;
  if (!authorization || typeof authorization.authorize !== "function") {
    throw new TypeError("LLM token IPC authorization is required");
  }
  const authorizedIpcMain = {
    handle(channel, handler) {
      const operation = channel.replace(/^llm:/u, "");
      ipcMain.handle(channel, async (event, ...args) => {
        let actorDid;
        try {
          actorDid = authorizedActor(
            await authorization.authorize(event, operation),
          );
        } catch {
          throw privacy.authorizationFailure(operation);
        }
        return handler(event, actorDid, ...args);
      });
    },
  };

  // ============================================================
  // Token 追踪与成本管理 (Token Tracking & Cost Management) - 8 handlers
  // ============================================================

  /**
   * 获取 Token 使用统计
   * Channel: 'llm:get-usage-stats'
   */
  authorizedIpcMain.handle(
    "llm:get-usage-stats",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length > 1) {
          throw new TypeError("Invalid usage input count");
        }
        const options = normalizeRange(args[0] ?? {}, actorDid, "usage");
        if (tokenTracker) {
          return projectUsageStats(await tokenTracker.getUsageStats(options));
        }

        // Fallback: 直接从数据库查询
        if (!database) {
          throw new Error("数据库未初始化");
        }

        const {
          startDate = Date.now() - 7 * 24 * 60 * 60 * 1000,
          endDate = Date.now(),
        } = options;

        const sql = `
        SELECT
          COUNT(*) as total_calls,
          COALESCE(SUM(input_tokens), 0) as total_input_tokens,
          COALESCE(SUM(output_tokens), 0) as total_output_tokens,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(cost_usd), 0) as total_cost_usd,
          COALESCE(SUM(cost_cny), 0) as total_cost_cny,
          COALESCE(SUM(CASE WHEN was_cached = 1 THEN 1 ELSE 0 END), 0) as cached_calls,
          COALESCE(SUM(CASE WHEN was_compressed = 1 THEN 1 ELSE 0 END), 0) as compressed_calls,
          COALESCE(AVG(response_time), 0) as avg_response_time
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ? AND user_id = ?
      `;

        const stmt = database.prepare(sql);
        const stats = stmt.get([startDate, endDate, actorDid]);

        const cacheHitRate =
          stats.total_calls > 0
            ? (((stats.cached_calls || 0) / stats.total_calls) * 100).toFixed(2)
            : 0;

        return projectUsageStats({
          totalCalls: stats.total_calls || 0,
          totalInputTokens: stats.total_input_tokens || 0,
          totalOutputTokens: stats.total_output_tokens || 0,
          totalTokens: stats.total_tokens || 0,
          totalCostUsd: stats.total_cost_usd || 0,
          totalCostCny: stats.total_cost_cny || 0,
          cachedCalls: stats.cached_calls || 0,
          compressedCalls: stats.compressed_calls || 0,
          cacheHitRate: parseFloat(cacheHitRate),
          avgResponseTime: Math.round(stats.avg_response_time || 0),
        });
      } catch {
        throw privacy.failure("get-usage-stats");
      }
    },
  );

  /**
   * 获取时间序列数据
   * Channel: 'llm:get-time-series'
   */
  authorizedIpcMain.handle(
    "llm:get-time-series",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length > 1) {
          throw new TypeError("Invalid time-series input count");
        }
        const options = normalizeRange(args[0] ?? {}, actorDid, "time-series");
        if (tokenTracker) {
          return projectTimeSeries(
            await tokenTracker.getTimeSeriesData(options),
          );
        }

        // Fallback: 直接从数据库查询
        if (!database) {
          throw new Error("数据库未初始化");
        }

        const {
          startDate = Date.now() - 7 * 24 * 60 * 60 * 1000,
          endDate = Date.now(),
          interval = "day",
        } = options;

        let bucketSize;
        switch (interval) {
          case "hour":
            bucketSize = 60 * 60 * 1000;
            break;
          case "day":
            bucketSize = 24 * 60 * 60 * 1000;
            break;
          case "week":
            bucketSize = 7 * 24 * 60 * 60 * 1000;
            break;
          default:
            bucketSize = 24 * 60 * 60 * 1000;
        }

        const sql = `
        SELECT
          (created_at / ${bucketSize}) * ${bucketSize} as time_bucket,
          COUNT(*) as calls,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(cost_usd), 0) as cost_usd,
          COALESCE(SUM(cost_cny), 0) as cost_cny
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ? AND user_id = ?
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
      `;

        const stmt = database.prepare(sql);
        const rows = stmt.all([startDate, endDate, actorDid]);

        return projectTimeSeries(
          rows.map((row) => ({
            timestamp: row.time_bucket,
            date: new Date(row.time_bucket).toISOString(),
            calls: row.calls || 0,
            inputTokens: row.input_tokens || 0,
            outputTokens: row.output_tokens || 0,
            totalTokens: row.total_tokens || 0,
            costUsd: row.cost_usd || 0,
            costCny: row.cost_cny || 0,
          })),
        );
      } catch {
        throw privacy.failure("get-time-series");
      }
    },
  );

  /**
   * 获取成本分解
   * Channel: 'llm:get-cost-breakdown'
   */
  authorizedIpcMain.handle(
    "llm:get-cost-breakdown",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length > 1) {
          throw new TypeError("Invalid cost breakdown input count");
        }
        const options = normalizeRange(args[0] ?? {}, actorDid, "cost");
        if (tokenTracker) {
          return projectCostBreakdown(
            await tokenTracker.getCostBreakdown(options),
          );
        }

        // Fallback: 直接从数据库查询
        if (!database) {
          throw new Error("数据库未初始化");
        }

        const {
          startDate = Date.now() - 7 * 24 * 60 * 60 * 1000,
          endDate = Date.now(),
        } = options;

        // 按提供商分组
        const providerSql = `
        SELECT
          provider,
          COUNT(*) as calls,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(cost_usd), 0) as cost_usd,
          COALESCE(SUM(cost_cny), 0) as cost_cny
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ? AND user_id = ?
        GROUP BY provider
        ORDER BY cost_usd DESC
      `;

        const providerStmt = database.prepare(providerSql);
        const byProvider = providerStmt.all([startDate, endDate, actorDid]);

        // 按模型分组
        const modelSql = `
        SELECT
          provider,
          model,
          COUNT(*) as calls,
          COALESCE(SUM(total_tokens), 0) as total_tokens,
          COALESCE(SUM(cost_usd), 0) as cost_usd,
          COALESCE(SUM(cost_cny), 0) as cost_cny
        FROM llm_usage_log
        WHERE created_at >= ? AND created_at <= ? AND user_id = ?
        GROUP BY provider, model
        ORDER BY cost_usd DESC
        LIMIT 10
      `;

        const modelStmt = database.prepare(modelSql);
        const byModel = modelStmt.all([startDate, endDate, actorDid]);

        return projectCostBreakdown({
          byProvider: byProvider.map((row) => ({
            provider: row.provider,
            calls: row.calls || 0,
            totalTokens: row.total_tokens || 0,
            costUsd: row.cost_usd || 0,
            costCny: row.cost_cny || 0,
          })),
          byModel: byModel.map((row) => ({
            provider: row.provider,
            model: row.model,
            calls: row.calls || 0,
            totalTokens: row.total_tokens || 0,
            costUsd: row.cost_usd || 0,
            costCny: row.cost_cny || 0,
          })),
        });
      } catch {
        throw privacy.failure("get-cost-breakdown");
      }
    },
  );

  /**
   * 获取预算配置
   * Channel: 'llm:get-budget'
   */
  authorizedIpcMain.handle(
    "llm:get-budget",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length !== 0) {
          throw new TypeError("Unexpected budget read input");
        }
        if (!tokenTracker) {
          throw new Error("Token 追踪器未初始化");
        }

        return projectBudget(await tokenTracker.getBudgetConfig(actorDid));
      } catch {
        throw privacy.failure("get-budget");
      }
    },
  );

  /**
   * 设置预算配置
   * Channel: 'llm:set-budget'
   */
  authorizedIpcMain.handle(
    "llm:set-budget",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length !== 1) {
          throw new TypeError("Invalid budget input count");
        }
        if (!tokenTracker) {
          throw new Error("Token 追踪器未初始化");
        }
        const config = normalizeBudget(args[0]);

        return projectOperationResult(
          await tokenTracker.saveBudgetConfig(actorDid, config),
        );
      } catch {
        throw privacy.failure("set-budget");
      }
    },
  );

  /**
   * 导出成本报告
   * Channel: 'llm:export-cost-report'
   */
  authorizedIpcMain.handle(
    "llm:export-cost-report",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length > 1) {
          throw new TypeError("Invalid report input count");
        }
        if (!tokenTracker) {
          throw new Error("Token 追踪器未初始化");
        }
        const options = normalizeRange(args[0] ?? {}, actorDid, "export");

        return projectOperationResult(
          await tokenTracker.exportCostReport(options),
        );
      } catch {
        throw privacy.failure("export-cost-report");
      }
    },
  );

  /**
   * 清除响应缓存
   * Channel: 'llm:clear-cache'
   */
  authorizedIpcMain.handle(
    "llm:clear-cache",
    async (_event, _actorDid, ...args) => {
      try {
        if (args.length > 1) {
          throw new TypeError("Invalid cache clear input count");
        }
        if (!responseCache) {
          throw new Error("响应缓存未初始化");
        }
        const options = args[0] ?? { expiredOnly: true };
        const descriptors = descriptorsFor(options, new Set(["expiredOnly"]));
        const expiredOnly = descriptors.expiredOnly?.value ?? true;
        if (typeof expiredOnly !== "boolean") {
          throw new TypeError("Invalid cache clear option");
        }
        const operation = expiredOnly
          ? responseCache.clearExpired
          : responseCache.clear;
        if (typeof operation !== "function") {
          throw new TypeError("Cache clear operation is unavailable");
        }
        const deletedCount = await operation.call(responseCache);
        return projectOperationResult(
          { success: true },
          {
            deletedCount:
              Number.isSafeInteger(deletedCount) && deletedCount >= 0
                ? deletedCount
                : 0,
          },
        );
      } catch {
        throw privacy.failure("clear-cache");
      }
    },
  );

  /**
   * 获取缓存统计信息
   * Channel: 'llm:get-cache-stats'
   */
  authorizedIpcMain.handle(
    "llm:get-cache-stats",
    async (_event, _actorDid, ...args) => {
      try {
        if (args.length !== 0) {
          throw new TypeError("Unexpected cache stats input");
        }
        if (!responseCache) {
          throw new Error("响应缓存未初始化");
        }

        return projectCacheStats(await responseCache.getStats());
      } catch {
        throw privacy.failure("get-cache-stats");
      }
    },
  );

  /**
   * 恢复 LLM 服务（预算超限暂停后）
   * Channel: 'llm:resume-service'
   */
  authorizedIpcMain.handle(
    "llm:resume-service",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length !== 0) {
          throw new TypeError("Unexpected service resume input");
        }
        if (!managerRef.current) {
          throw new Error("LLM 服务未初始化");
        }

        const result = await managerRef.current.resumeService(actorDid);

        privacy.event("service-resumed");

        return projectOperationResult(result);
      } catch {
        throw privacy.failure("resume-service");
      }
    },
  );

  /**
   * 暂停 LLM 服务（手动暂停）
   * Channel: 'llm:pause-service'
   */
  authorizedIpcMain.handle(
    "llm:pause-service",
    async (_event, _actorDid, ...args) => {
      try {
        if (args.length !== 0) {
          throw new TypeError("Unexpected service pause input");
        }
        if (!managerRef.current) {
          throw new Error("LLM 服务未初始化");
        }

        const result = await managerRef.current.pauseService();

        privacy.event("service-paused");

        return projectOperationResult(result);
      } catch {
        throw privacy.failure("pause-service");
      }
    },
  );

  /**
   * 计算成本估算
   * Channel: 'llm:calculate-cost-estimate'
   */
  authorizedIpcMain.handle(
    "llm:calculate-cost-estimate",
    async (_event, _actorDid, ...args) => {
      try {
        if (args.length !== 1) {
          throw new TypeError("Invalid estimate input count");
        }
        if (!managerRef.current) {
          throw new Error("LLM 服务未初始化");
        }
        const { provider, model, inputTokens, outputTokens, cachedTokens } =
          normalizeEstimate(args[0]);

        return projectCostEstimate(
          managerRef.current.calculateCostEstimate(
            provider,
            model,
            inputTokens,
            outputTokens,
            cachedTokens,
          ),
        );
      } catch {
        throw privacy.failure("calculate-cost-estimate");
      }
    },
  );

  /**
   * 检查是否可以执行操作（预算检查）
   * Channel: 'llm:can-perform-operation'
   */
  authorizedIpcMain.handle(
    "llm:can-perform-operation",
    async (_event, actorDid, ...args) => {
      try {
        if (args.length > 1) {
          throw new TypeError("Invalid budget decision input count");
        }
        if (!managerRef.current) {
          throw new Error("LLM 服务未初始化");
        }
        const estimatedTokens = tokenCount(args[0] ?? 0);

        return projectBudgetDecision(
          await managerRef.current.canPerformOperation(
            estimatedTokens,
            actorDid,
          ),
        );
      } catch {
        throw privacy.failure("can-perform-operation");
      }
    },
  );
}

module.exports = { registerTokenHandlers };
