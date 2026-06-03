/**
 * LLM IPC handlers — budgets group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-budgets
 */
const { logger } = require("../utils/logger.js");

function registerBudgetHandlers(ctx) {
  const { ipcMain, database } = ctx;

  // ============================================================
  // Model-specific Budgets (按模型预算)
  // ============================================================

  /**
   * 获取模型预算列表
   * Channel: 'llm:get-model-budgets'
   */
  ipcMain.handle(
    "llm:get-model-budgets",
    async (_event, userId = "default") => {
      try {
        if (!database) {
          return [];
        }

        const budgets = database
          .prepare(
            "SELECT * FROM llm_model_budgets WHERE user_id = ? ORDER BY total_cost_usd DESC",
          )
          .all(userId);

        return budgets.map((b) => ({
          ...b,
          enabled: b.enabled === 1,
          alertOnLimit: b.alert_on_limit === 1,
          blockOnLimit: b.block_on_limit === 1,
        }));
      } catch (error) {
        logger.error("[LLM IPC] 获取模型预算失败:", error);
        return [];
      }
    },
  );

  /**
   * 设置模型预算
   * Channel: 'llm:set-model-budget'
   */
  ipcMain.handle("llm:set-model-budget", async (_event, config) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const { v4: uuidv4 } = require("uuid");
      const now = Date.now();

      const upsert = database.prepare(`
        INSERT INTO llm_model_budgets (
          id, user_id, provider, model,
          daily_limit_usd, weekly_limit_usd, monthly_limit_usd,
          current_daily_spend, current_weekly_spend, current_monthly_spend,
          total_calls, total_tokens, total_cost_usd,
          enabled, alert_on_limit, block_on_limit,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, provider, model) DO UPDATE SET
          daily_limit_usd = excluded.daily_limit_usd,
          weekly_limit_usd = excluded.weekly_limit_usd,
          monthly_limit_usd = excluded.monthly_limit_usd,
          enabled = excluded.enabled,
          alert_on_limit = excluded.alert_on_limit,
          block_on_limit = excluded.block_on_limit,
          updated_at = excluded.updated_at
      `);

      upsert.run(
        uuidv4(),
        config.userId || "default",
        config.provider,
        config.model,
        config.dailyLimitUsd || 0,
        config.weeklyLimitUsd || 0,
        config.monthlyLimitUsd || 0,
        config.enabled !== false ? 1 : 0,
        config.alertOnLimit !== false ? 1 : 0,
        config.blockOnLimit === true ? 1 : 0,
        now,
        now,
      );

      return { success: true };
    } catch (error) {
      logger.error("[LLM IPC] 设置模型预算失败:", error);
      throw error;
    }
  });

  /**
   * 删除模型预算
   * Channel: 'llm:delete-model-budget'
   */
  ipcMain.handle(
    "llm:delete-model-budget",
    async (_event, { userId = "default", provider, model }) => {
      try {
        if (!database) {
          throw new Error("数据库未初始化");
        }

        database
          .prepare(
            "DELETE FROM llm_model_budgets WHERE user_id = ? AND provider = ? AND model = ?",
          )
          .run(userId, provider, model);

        return { success: true };
      } catch (error) {
        logger.error("[LLM IPC] 删除模型预算失败:", error);
        throw error;
      }
    },
  );
}

module.exports = { registerBudgetHandlers };
