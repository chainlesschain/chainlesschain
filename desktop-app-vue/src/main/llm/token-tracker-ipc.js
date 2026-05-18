/**
 * Token Tracker IPC 处理器
 *
 * 提供 LLM Token 追踪和成本管理的前端访问接口
 * 支持使用统计、预算管理、成本分析、报告导出
 *
 * 功能：
 * - 使用统计和时间序列数据
 * - 成本分解（按提供商/模型）
 * - 预算配置和告警
 * - 成本报告导出
 * - 实时定价信息
 *
 * @module token-tracker-ipc
 */

const { logger } = require("../utils/logger.js");
const defaultIpcGuard = require("../ipc/ipc-guard");

// 模块级别的实例引用
let tokenTrackerInstance = null;

/**
 * 设置 TokenTracker 实例
 * @param {Object} tracker - TokenTracker 实例
 */
function setTokenTrackerInstance(tracker) {
  tokenTrackerInstance = tracker;
}

/**
 * 获取 TokenTracker 实例
 * @returns {Object|null}
 */
function getTokenTrackerInstance() {
  return tokenTrackerInstance;
}

/**
 * 注册 Token Tracker IPC 处理器
 * @param {Object} dependencies - 依赖
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象
 * @param {Object} [dependencies.ipcGuard] - IPC 防重复注册守卫
 * @param {Object} [dependencies.tokenTracker] - TokenTracker 实例
 * @param {Object} [dependencies.database] - 数据库实例（用于创建新的 TokenTracker）
 */
function registerTokenTrackerIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
  tokenTracker,
  database,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  // 防止重复注册
  if (ipcGuard.isModuleRegistered("token-tracker-ipc")) {
    logger.info("[Token Tracker IPC] Handlers already registered, skipping...");
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 设置实例
  if (tokenTracker) {
    setTokenTrackerInstance(tokenTracker);
  }

  logger.info("[Token Tracker IPC] Registering handlers...");

  // ============================================================
  // 辅助函数
  // ============================================================

  /**
   * 获取 Tracker 实例，如果不存在则返回错误
   */
  function getTrackerOrError() {
    const tracker = getTokenTrackerInstance();
    if (!tracker) {
      return {
        success: false,
        error: "Token tracker not initialized",
      };
    }
    return { success: true, tracker };
  }

  // ============================================================
  // 统计信息 (Statistics) - 5 handlers
  // ============================================================

  /**
   * 获取使用统计
   * Channel: 'tracker:get-usage-stats'
   *
   * @param {Object} options - 查询选项
   * @param {number} [options.startDate] - 开始时间戳
   * @param {number} [options.endDate] - 结束时间戳
   * @param {string} [options.provider] - 提供商过滤
   * @returns {Object} 使用统计数据
   */
  ipcMain.handle("tracker:get-usage-stats", async (_event, options = {}) => {
    try {
      const result = getTrackerOrError();
      if (!result.success) {
        return result;
      }

      const stats = await result.tracker.getUsageStats(options);

      return {
        success: true,
        stats,
      };
    } catch (error) {
      logger.error("[Token Tracker IPC] 获取使用统计失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取时间序列数据（用于图表）
   * Channel: 'tracker:get-time-series'
   *
   * @param {Object} options - 查询选项
   * @param {number} [options.startDate] - 开始时间戳
   * @param {number} [options.endDate] - 结束时间戳
   * @param {string} [options.interval] - 时间间隔 (hour/day/week)
   * @returns {Object} 时间序列数据
   */
  ipcMain.handle("tracker:get-time-series", async (_event, options = {}) => {
    try {
      const result = getTrackerOrError();
      if (!result.success) {
        return result;
      }

      const data = await result.tracker.getTimeSeriesData(options);

      return {
        success: true,
        data,
        interval: options.interval || "day",
      };
    } catch (error) {
      logger.error("[Token Tracker IPC] 获取时间序列失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取成本分解
   * Channel: 'tracker:get-cost-breakdown'
   *
   * @param {Object} options - 查询选项
   * @param {number} [options.startDate] - 开始时间戳
   * @param {number} [options.endDate] - 结束时间戳
   * @returns {Object} 成本分解数据
   */
  ipcMain.handle("tracker:get-cost-breakdown", async (_event, options = {}) => {
    try {
      const result = getTrackerOrError();
      if (!result.success) {
        return result;
      }

      const breakdown = await result.tracker.getCostBreakdown(options);

      return {
        success: true,
        breakdown,
      };
    } catch (error) {
      logger.error("[Token Tracker IPC] 获取成本分解失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取定价数据
   * Channel: 'tracker:get-pricing'
   *
   * @returns {Object} 所有提供商的定价数据
   */
  ipcMain.handle("tracker:get-pricing", async () => {
    try {
      const { PRICING_DATA } = require("./token-tracker.js");

      return {
        success: true,
        pricing: PRICING_DATA,
      };
    } catch (error) {
      logger.error("[Token Tracker IPC] 获取定价数据失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 计算特定使用的成本
   * Channel: 'tracker:calculate-cost'
   *
   * @param {Object} params - 计算参数
   * @param {string} params.provider - 提供商
   * @param {string} params.model - 模型名称
   * @param {number} params.inputTokens - 输入 tokens
   * @param {number} params.outputTokens - 输出 tokens
   * @param {number} [params.cachedTokens] - 缓存 tokens
   * @returns {Object} 成本计算结果
   */
  ipcMain.handle("tracker:calculate-cost", async (_event, params = {}) => {
    try {
      const result = getTrackerOrError();
      if (!result.success) {
        return result;
      }

      const {
        provider,
        model,
        inputTokens = 0,
        outputTokens = 0,
        cachedTokens = 0,
      } = params;

      if (!provider || !model) {
        return {
          success: false,
          error: "provider and model are required",
        };
      }

      const costResult = result.tracker.calculateCost(
        provider,
        model,
        inputTokens,
        outputTokens,
        cachedTokens,
      );

      return {
        success: true,
        cost: costResult,
        params: {
          provider,
          model,
          inputTokens,
          outputTokens,
          cachedTokens,
        },
      };
    } catch (error) {
      logger.error("[Token Tracker IPC] 计算成本失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 预算管理 (Budget Management) - 3 handlers
  // ============================================================

  /**
   * 获取预算配置
   * Channel: 'tracker:get-budget'
   *
   * @param {string} [userId] - 用户 ID（默认: 'default'）
   * @returns {Object} 预算配置
   */
  ipcMain.handle("tracker:get-budget", async (_event, userId = "default") => {
    try {
      const result = getTrackerOrError();
      if (!result.success) {
        return result;
      }

      const config = await result.tracker.getBudgetConfig(userId);

      if (!config) {
        return {
          success: true,
          config: null,
          message: "No budget configuration found",
        };
      }

      // 计算使用百分比
      const dailyUsage =
        config.daily_limit_usd > 0
          ? ((config.current_daily_spend || 0) / config.daily_limit_usd) * 100
          : 0;
      const weeklyUsage =
        config.weekly_limit_usd > 0
          ? ((config.current_weekly_spend || 0) / config.weekly_limit_usd) * 100
          : 0;
      const monthlyUsage =
        config.monthly_limit_usd > 0
          ? ((config.current_monthly_spend || 0) / config.monthly_limit_usd) *
            100
          : 0;

      return {
        success: true,
        config: {
          userId: config.user_id,
          dailyLimit: config.daily_limit_usd,
          weeklyLimit: config.weekly_limit_usd,
          monthlyLimit: config.monthly_limit_usd,
          currentDailySpend: config.current_daily_spend || 0,
          currentWeeklySpend: config.current_weekly_spend || 0,
          currentMonthlySpend: config.current_monthly_spend || 0,
          dailyUsagePercent: dailyUsage.toFixed(2),
          weeklyUsagePercent: weeklyUsage.toFixed(2),
          monthlyUsagePercent: monthlyUsage.toFixed(2),
          warningThreshold: config.warning_threshold,
          criticalThreshold: config.critical_threshold,
          desktopAlerts: config.desktop_alerts === 1,
          autoPauseOnLimit: config.auto_pause_on_limit === 1,
          autoSwitchToCheaperModel: config.auto_switch_to_cheaper_model === 1,
          dailyResetAt: config.daily_reset_at,
          weeklyResetAt: config.weekly_reset_at,
          monthlyResetAt: config.monthly_reset_at,
        },
      };
    } catch (error) {
      logger.error("[Token Tracker IPC] 获取预算配置失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 设置预算配置
   * Channel: 'tracker:set-budget'
   *
   * @param {Object} params - 预算参数
   * @param {string} [params.userId] - 用户 ID
   * @param {number} [params.dailyLimit] - 日预算 (USD)
   * @param {number} [params.weeklyLimit] - 周预算 (USD)
   * @param {number} [params.monthlyLimit] - 月预算 (USD)
   * @param {number} [params.warningThreshold] - 警告阈值 (0-1)
   * @param {number} [params.criticalThreshold] - 严重阈值 (0-1)
   * @param {boolean} [params.desktopAlerts] - 启用桌面通知
   * @param {boolean} [params.autoPauseOnLimit] - 达到限额时暂停
   * @param {boolean} [params.autoSwitchToCheaperModel] - 自动切换到更便宜的模型
   * @returns {Object} 保存结果
   */
  ipcMain.handle("tracker:set-budget", async (_event, params = {}) => {
    try {
      const result = getTrackerOrError();
      if (!result.success) {
        return result;
      }

      const userId = params.userId || "default";

      await result.tracker.saveBudgetConfig(userId, {
        dailyLimit: params.dailyLimit,
        weeklyLimit: params.weeklyLimit,
        monthlyLimit: params.monthlyLimit,
        warningThreshold: params.warningThreshold,
        criticalThreshold: params.criticalThreshold,
        desktopAlerts: params.desktopAlerts,
        autoPauseOnLimit: params.autoPauseOnLimit,
        autoSwitchToCheaperModel: params.autoSwitchToCheaperModel,
      });

      logger.info("[Token Tracker IPC] 预算配置已保存:", userId);

      return {
        success: true,
        message: "Budget configuration saved",
      };
    } catch (error) {
      logger.error("[Token Tracker IPC] 设置预算配置失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 重置预算计数器
   * Channel: 'tracker:reset-budget-counters'
   *
   * @param {Object} params - 重置参数
   * @param {string} [params.userId] - 用户 ID
   * @param {string} [params.period] - 重置周期 (daily/weekly/monthly/all)
   * @returns {Object} 重置结果
   */
  ipcMain.handle(
    "tracker:reset-budget-counters",
    async (_event, params = {}) => {
      try {
        const result = getTrackerOrError();
        if (!result.success) {
          return result;
        }

        const userId = params.userId || "default";
        const period = params.period || "all";

        const config = await result.tracker.getBudgetConfig(userId);
        if (!config) {
          return {
            success: false,
            error: "No budget configuration found",
          };
        }

        // 根据 period 重置对应的计数器
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

        // 构建更新 SQL
        const db = result.tracker.db;
        const setClauses = Object.keys(updates)
          .map((key) => `${key} = ?`)
          .join(", ");
        const values = Object.values(updates);

        const stmt = db.prepare(`
        UPDATE llm_budget_config
        SET ${setClauses}, updated_at = ?
        WHERE user_id = ?
      `);

        stmt.run(...values, now, userId);

        logger.info("[Token Tracker IPC] 预算计数器已重置:", {
          userId,
          period,
        });

        return {
          success: true,
          message: `Budget counters reset for ${period}`,
          resetPeriods:
            period === "all" ? ["daily", "weekly", "monthly"] : [period],
        };
      } catch (error) {
        logger.error("[Token Tracker IPC] 重置预算计数器失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  // ============================================================
  // 操作 (Operations) - 3 handlers
  // ============================================================

  /**
   * 手动记录使用
   * Channel: 'tracker:record-usage'
   *
   * 注意：通常 LLM 调用会自动记录使用，此接口用于手动补录或测试
   *
   * @param {Object} params - 使用参数
   * @returns {Object} 记录结果
   */
  ipcMain.handle("tracker:record-usage", async (_event, params = {}) => {
    try {
      const result = getTrackerOrError();
      if (!result.success) {
        return result;
      }

      const { provider, model } = params;

      if (!provider || !model) {
        return {
          success: false,
          error: "provider and model are required",
        };
      }

      const recordResult = await result.tracker.recordUsage(params);

      return {
        success: true,
        record: recordResult,
      };
    } catch (error) {
      logger.error("[Token Tracker IPC] 记录使用失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 导出成本报告
   * Channel: 'tracker:export-report'
   *
   * @param {Object} options - 导出选项
   * @param {number} [options.startDate] - 开始时间戳
   * @param {number} [options.endDate] - 结束时间戳
   * @param {string} [options.format] - 导出格式 (csv)
   * @returns {Object} 导出结果（包含文件路径）
   */
  ipcMain.handle("tracker:export-report", async (_event, options = {}) => {
    try {
      const result = getTrackerOrError();
      if (!result.success) {
        return result;
      }

      const exportResult = await result.tracker.exportCostReport(options);

      logger.info("[Token Tracker IPC] 报告已导出:", exportResult.filePath);

      return {
        success: true,
        filePath: exportResult.filePath,
        message: "Report exported successfully",
      };
    } catch (error) {
      logger.error("[Token Tracker IPC] 导出报告失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取对话的使用统计
   * Channel: 'tracker:get-conversation-stats'
   *
   * @param {string} conversationId - 对话 ID
   * @returns {Object} 对话统计
   */
  ipcMain.handle(
    "tracker:get-conversation-stats",
    async (_event, conversationId) => {
      try {
        const result = getTrackerOrError();
        if (!result.success) {
          return result;
        }

        if (!conversationId) {
          return {
            success: false,
            error: "conversationId is required",
          };
        }

        const db = result.tracker.db;

        // 查询对话级别统计
        const convStmt = db.prepare(`
        SELECT
          total_input_tokens,
          total_output_tokens,
          total_cost_usd,
          total_cost_cny
        FROM conversations
        WHERE id = ?
      `);

        const convStats = convStmt.get(conversationId);

        // 查询该对话的详细使用记录
        const usageStmt = db.prepare(`
        SELECT
          COUNT(*) as call_count,
          provider,
          model,
          SUM(input_tokens) as input_tokens,
          SUM(output_tokens) as output_tokens,
          SUM(cost_usd) as cost_usd,
          AVG(response_time) as avg_response_time
        FROM llm_usage_log
        WHERE conversation_id = ?
        GROUP BY provider, model
        ORDER BY cost_usd DESC
      `);

        const usageByModel = usageStmt.all(conversationId);

        return {
          success: true,
          conversationId,
          summary: convStats
            ? {
                totalInputTokens: convStats.total_input_tokens || 0,
                totalOutputTokens: convStats.total_output_tokens || 0,
                totalCostUsd: convStats.total_cost_usd || 0,
                totalCostCny: convStats.total_cost_cny || 0,
              }
            : null,
          byModel: usageByModel.map((row) => ({
            provider: row.provider,
            model: row.model,
            callCount: row.call_count,
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            costUsd: row.cost_usd,
            avgResponseTime: Math.round(row.avg_response_time || 0),
          })),
        };
      } catch (error) {
        logger.error("[Token Tracker IPC] 获取对话统计失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  // ============================================================
  // 控制 (Control) - 1 handler
  // ============================================================

  /**
   * 设置汇率
   * Channel: 'tracker:set-exchange-rate'
   *
   * @param {number} rate - USD 到 CNY 的汇率
   * @returns {Object} 设置结果
   */
  ipcMain.handle("tracker:set-exchange-rate", async (_event, rate) => {
    try {
      const result = getTrackerOrError();
      if (!result.success) {
        return result;
      }

      if (typeof rate !== "number" || rate <= 0) {
        return {
          success: false,
          error: "Invalid exchange rate: must be a positive number",
        };
      }

      const oldRate = result.tracker.options.exchangeRate;
      result.tracker.options.exchangeRate = rate;

      logger.info("[Token Tracker IPC] 汇率已更新:", {
        oldRate,
        newRate: rate,
      });

      return {
        success: true,
        message: "Exchange rate updated",
        oldRate,
        newRate: rate,
      };
    } catch (error) {
      logger.error("[Token Tracker IPC] 设置汇率失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered("token-tracker-ipc");

  logger.info(
    "[Token Tracker IPC] ✓ All handlers registered (12 handlers: 5 stats + 3 budget + 3 operations + 1 control)",
  );
}

/**
 * 注销 Token Tracker IPC 处理器
 * @param {Object} [dependencies] - 依赖
 */
function unregisterTokenTrackerIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  if (!ipcGuard.isModuleRegistered("token-tracker-ipc")) {
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  // 所有 channel 名称
  const channels = [
    // Statistics
    "tracker:get-usage-stats",
    "tracker:get-time-series",
    "tracker:get-cost-breakdown",
    "tracker:get-pricing",
    "tracker:calculate-cost",
    // Budget Management
    "tracker:get-budget",
    "tracker:set-budget",
    "tracker:reset-budget-counters",
    // Operations
    "tracker:record-usage",
    "tracker:export-report",
    "tracker:get-conversation-stats",
    // Control
    "tracker:set-exchange-rate",
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  ipcGuard.unmarkModuleRegistered("token-tracker-ipc");
  logger.info("[Token Tracker IPC] Handlers unregistered");
}

module.exports = {
  registerTokenTrackerIPC,
  unregisterTokenTrackerIPC,
  setTokenTrackerInstance,
  getTokenTrackerInstance,
};
