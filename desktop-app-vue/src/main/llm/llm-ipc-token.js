/**
 * LLM IPC handlers — token group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-token
 */
const { logger } = require("../utils/logger.js");

function registerTokenHandlers(ctx) {
  const { ipcMain, managerRef, database, tokenTracker, responseCache } = ctx;

  // ============================================================
  // Token 追踪与成本管理 (Token Tracking & Cost Management) - 8 handlers
  // ============================================================

  /**
   * 获取 Token 使用统计
   * Channel: 'llm:get-usage-stats'
   */
  ipcMain.handle("llm:get-usage-stats", async (_event, options = {}) => {
    try {
      if (tokenTracker) {
        return await tokenTracker.getUsageStats(options);
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
        WHERE created_at >= ? AND created_at <= ?
      `;

      const stmt = database.prepare(sql);
      const stats = stmt.get([startDate, endDate]);

      const cacheHitRate =
        stats.total_calls > 0
          ? (((stats.cached_calls || 0) / stats.total_calls) * 100).toFixed(2)
          : 0;

      return {
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
      };
    } catch (error) {
      logger.error("[LLM IPC] 获取使用统计失败:", error);
      throw error;
    }
  });

  /**
   * 获取时间序列数据
   * Channel: 'llm:get-time-series'
   */
  ipcMain.handle("llm:get-time-series", async (_event, options = {}) => {
    try {
      if (tokenTracker) {
        return await tokenTracker.getTimeSeriesData(options);
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
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
      `;

      const stmt = database.prepare(sql);
      const rows = stmt.all([startDate, endDate]);

      return rows.map((row) => ({
        timestamp: row.time_bucket,
        date: new Date(row.time_bucket).toISOString(),
        calls: row.calls || 0,
        inputTokens: row.input_tokens || 0,
        outputTokens: row.output_tokens || 0,
        totalTokens: row.total_tokens || 0,
        costUsd: row.cost_usd || 0,
        costCny: row.cost_cny || 0,
      }));
    } catch (error) {
      logger.error("[LLM IPC] 获取时间序列数据失败:", error);
      throw error;
    }
  });

  /**
   * 获取成本分解
   * Channel: 'llm:get-cost-breakdown'
   */
  ipcMain.handle("llm:get-cost-breakdown", async (_event, options = {}) => {
    try {
      if (tokenTracker) {
        return await tokenTracker.getCostBreakdown(options);
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
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY provider
        ORDER BY cost_usd DESC
      `;

      const providerStmt = database.prepare(providerSql);
      const byProvider = providerStmt.all([startDate, endDate]);

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
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY provider, model
        ORDER BY cost_usd DESC
        LIMIT 10
      `;

      const modelStmt = database.prepare(modelSql);
      const byModel = modelStmt.all([startDate, endDate]);

      return {
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
      };
    } catch (error) {
      logger.error("[LLM IPC] 获取成本分解失败:", error);
      throw error;
    }
  });

  /**
   * 获取预算配置
   * Channel: 'llm:get-budget'
   */
  ipcMain.handle("llm:get-budget", async (_event, userId = "default") => {
    try {
      if (!tokenTracker) {
        throw new Error("Token 追踪器未初始化");
      }

      return await tokenTracker.getBudgetConfig(userId);
    } catch (error) {
      logger.error("[LLM IPC] 获取预算配置失败:", error);
      throw error;
    }
  });

  /**
   * 设置预算配置
   * Channel: 'llm:set-budget'
   */
  ipcMain.handle("llm:set-budget", async (_event, userId, config) => {
    try {
      if (!tokenTracker) {
        throw new Error("Token 追踪器未初始化");
      }

      return await tokenTracker.saveBudgetConfig(userId, config);
    } catch (error) {
      logger.error("[LLM IPC] 设置预算配置失败:", error);
      throw error;
    }
  });

  /**
   * 导出成本报告
   * Channel: 'llm:export-cost-report'
   */
  ipcMain.handle("llm:export-cost-report", async (_event, options = {}) => {
    try {
      if (!tokenTracker) {
        throw new Error("Token 追踪器未初始化");
      }

      return await tokenTracker.exportCostReport(options);
    } catch (error) {
      logger.error("[LLM IPC] 导出成本报告失败:", error);
      throw error;
    }
  });

  /**
   * 清除响应缓存
   * Channel: 'llm:clear-cache'
   */
  ipcMain.handle("llm:clear-cache", async (_event) => {
    try {
      if (!responseCache) {
        throw new Error("响应缓存未初始化");
      }

      const deletedCount = await responseCache.clear();
      return { success: true, deletedCount };
    } catch (error) {
      logger.error("[LLM IPC] 清除缓存失败:", error);
      throw error;
    }
  });

  /**
   * 获取缓存统计信息
   * Channel: 'llm:get-cache-stats'
   */
  ipcMain.handle("llm:get-cache-stats", async (_event) => {
    try {
      if (!responseCache) {
        throw new Error("响应缓存未初始化");
      }

      return await responseCache.getStats();
    } catch (error) {
      logger.error("[LLM IPC] 获取缓存统计失败:", error);
      throw error;
    }
  });

  /**
   * 恢复 LLM 服务（预算超限暂停后）
   * Channel: 'llm:resume-service'
   */
  ipcMain.handle("llm:resume-service", async (_event, userId = "default") => {
    try {
      if (!managerRef.current) {
        throw new Error("LLM 服务未初始化");
      }

      const result = await managerRef.current.resumeService(userId);

      logger.info("[LLM IPC] ✓ LLM 服务已恢复");

      return result;
    } catch (error) {
      logger.error("[LLM IPC] 恢复 LLM 服务失败:", error);
      throw error;
    }
  });

  /**
   * 暂停 LLM 服务（手动暂停）
   * Channel: 'llm:pause-service'
   */
  ipcMain.handle("llm:pause-service", async (_event) => {
    try {
      if (!managerRef.current) {
        throw new Error("LLM 服务未初始化");
      }

      const result = await managerRef.current.pauseService();

      logger.info("[LLM IPC] ✓ LLM 服务已暂停");

      return result;
    } catch (error) {
      logger.error("[LLM IPC] 暂停 LLM 服务失败:", error);
      throw error;
    }
  });

  /**
   * 计算成本估算
   * Channel: 'llm:calculate-cost-estimate'
   */
  ipcMain.handle(
    "llm:calculate-cost-estimate",
    async (
      _event,
      { provider, model, inputTokens, outputTokens, cachedTokens = 0 },
    ) => {
      try {
        if (!managerRef.current) {
          throw new Error("LLM 服务未初始化");
        }

        return managerRef.current.calculateCostEstimate(
          provider,
          model,
          inputTokens,
          outputTokens,
          cachedTokens,
        );
      } catch (error) {
        logger.error("[LLM IPC] 计算成本估算失败:", error);
        throw error;
      }
    },
  );

  /**
   * 检查是否可以执行操作（预算检查）
   * Channel: 'llm:can-perform-operation'
   */
  ipcMain.handle(
    "llm:can-perform-operation",
    async (_event, estimatedTokens = 0) => {
      try {
        if (!managerRef.current) {
          throw new Error("LLM 服务未初始化");
        }

        return await managerRef.current.canPerformOperation(estimatedTokens);
      } catch (error) {
        logger.error("[LLM IPC] 检查操作权限失败:", error);
        throw error;
      }
    },
  );
}

module.exports = { registerTokenHandlers };
