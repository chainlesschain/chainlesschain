/**
 * LLM IPC handlers — retention group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-retention
 */
const { logger } = require("../utils/logger.js");

function registerRetentionHandlers(ctx) {
  const { ipcMain, database } = ctx;

  // ============================================================
  // Data Retention (数据保留设置)
  // ============================================================

  /**
   * 获取数据保留配置
   * Channel: 'llm:get-retention-config'
   */
  ipcMain.handle(
    "llm:get-retention-config",
    async (_event, userId = "default") => {
      try {
        if (!database) {
          return null;
        }

        const config = database
          .prepare("SELECT * FROM llm_data_retention_config WHERE user_id = ?")
          .get(userId);

        if (config) {
          return {
            ...config,
            autoCleanupEnabled: config.auto_cleanup_enabled === 1,
            usageLogRetentionDays: config.usage_log_retention_days,
            cacheRetentionDays: config.cache_retention_days,
            alertHistoryRetentionDays: config.alert_history_retention_days,
          };
        }

        return null;
      } catch (error) {
        logger.error("[LLM IPC] 获取数据保留配置失败:", error);
        return null;
      }
    },
  );

  /**
   * 设置数据保留配置
   * Channel: 'llm:set-retention-config'
   */
  ipcMain.handle("llm:set-retention-config", async (_event, config) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const now = Date.now();

      database
        .prepare(
          `
        UPDATE llm_data_retention_config SET
          usage_log_retention_days = ?,
          cache_retention_days = ?,
          alert_history_retention_days = ?,
          auto_cleanup_enabled = ?,
          updated_at = ?
        WHERE user_id = ?
      `,
        )
        .run(
          config.usageLogRetentionDays || 90,
          config.cacheRetentionDays || 7,
          config.alertHistoryRetentionDays || 30,
          config.autoCleanupEnabled !== false ? 1 : 0,
          now,
          config.userId || "default",
        );

      return { success: true };
    } catch (error) {
      logger.error("[LLM IPC] 设置数据保留配置失败:", error);
      throw error;
    }
  });

  /**
   * 手动清理旧数据
   * Channel: 'llm:cleanup-old-data'
   */
  ipcMain.handle("llm:cleanup-old-data", async (_event, userId = "default") => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      // 获取保留配置
      const config = database
        .prepare("SELECT * FROM llm_data_retention_config WHERE user_id = ?")
        .get(userId);

      if (!config) {
        return { success: false, error: "配置不存在" };
      }

      const now = Date.now();
      const deletedCounts = {
        usageLogs: 0,
        cache: 0,
        alerts: 0,
      };

      // 清理使用日志
      if (config.usage_log_retention_days > 0) {
        const usageCutoff =
          now - config.usage_log_retention_days * 24 * 60 * 60 * 1000;
        const usageResult = database
          .prepare(
            "DELETE FROM llm_usage_log WHERE created_at < ? AND user_id = ?",
          )
          .run(usageCutoff, userId);
        deletedCounts.usageLogs = usageResult.changes;
      }

      // 清理缓存
      if (config.cache_retention_days > 0) {
        const cacheCutoff =
          now - config.cache_retention_days * 24 * 60 * 60 * 1000;
        const cacheResult = database
          .prepare("DELETE FROM llm_cache WHERE created_at < ?")
          .run(cacheCutoff);
        deletedCounts.cache = cacheResult.changes;
      }

      // 清理告警历史
      if (config.alert_history_retention_days > 0) {
        const alertCutoff =
          now - config.alert_history_retention_days * 24 * 60 * 60 * 1000;
        const alertResult = database
          .prepare(
            "DELETE FROM llm_alert_history WHERE created_at < ? AND user_id = ?",
          )
          .run(alertCutoff, userId);
        deletedCounts.alerts = alertResult.changes;
      }

      // 更新最后清理时间
      database
        .prepare(
          `
        UPDATE llm_data_retention_config SET last_cleanup_at = ?, updated_at = ?
        WHERE user_id = ?
      `,
        )
        .run(now, now, userId);

      logger.info("[LLM IPC] 数据清理完成:", deletedCounts);

      return { success: true, deletedCounts };
    } catch (error) {
      logger.error("[LLM IPC] 清理旧数据失败:", error);
      throw error;
    }
  });
}

module.exports = { registerRetentionHandlers };
