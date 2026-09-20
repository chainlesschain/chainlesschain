/**
 * LLM IPC handlers — alert group.
 * Split verbatim from llm-ipc.js registerLLMIPC(); shared symbols arrive via ctx.
 *
 * @module llm/llm-ipc-alert
 */
const { createLlmIpcPrivacy } = require("./llm-ipc-privacy");

/**
 * Tolerant JSON column parse — a single alert with a corrupt details string must
 * not throw out of the .map and drop the whole alert list. The
 * `x ? JSON.parse(x) : d` form it replaces only guarded NULL, not corrupt.
 */
function safeParse(raw, fallback, privacy) {
  if (raw == null || raw === "") {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    privacy.event("malformed-storage-json");
    return fallback;
  }
}

function registerAlertHandlers(ctx) {
  const { ipcMain, database } = ctx;
  const privacy = ctx.alertPrivacy || createLlmIpcPrivacy("alert");

  // ============================================================
  // Alert History (告警历史)
  // ============================================================

  /**
   * 获取告警历史
   * Channel: 'llm:get-alert-history'
   */
  ipcMain.handle("llm:get-alert-history", async (_event, options = {}) => {
    try {
      if (!database) {
        return [];
      }

      const {
        limit = 100,
        userId = "default",
        level,
        includesDismissed = true,
      } = options;

      let sql = `
        SELECT * FROM llm_alert_history
        WHERE user_id = ?
      `;
      const params = [userId];

      if (level) {
        sql += " AND level = ?";
        params.push(level);
      }

      if (!includesDismissed) {
        sql += " AND dismissed = 0";
      }

      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);

      const alerts = database.prepare(sql).all(...params);

      return alerts.map((alert) => ({
        ...alert,
        details: safeParse(alert.details, null, privacy),
        dismissed: alert.dismissed === 1,
      }));
    } catch {
      privacy.failure("get-alert-history");
      return [];
    }
  });

  /**
   * 添加告警到历史记录
   * Channel: 'llm:add-alert'
   */
  ipcMain.handle("llm:add-alert", async (_event, alert) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const { v4: uuidv4 } = require("uuid");
      const now = Date.now();

      const id = uuidv4();
      const insert = database.prepare(`
        INSERT INTO llm_alert_history (
          id, user_id, type, level, title, message, details,
          dismissed, dismissed_at, dismissed_by,
          related_provider, related_model,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?)
      `);

      insert.run(
        id,
        alert.userId || "default",
        alert.type,
        alert.level,
        alert.title,
        alert.message,
        alert.details ? JSON.stringify(alert.details) : null,
        alert.provider || null,
        alert.model || null,
        now,
        now,
      );

      return { success: true, id };
    } catch {
      throw privacy.failure("add-alert");
    }
  });

  /**
   * 忽略/处理告警
   * Channel: 'llm:dismiss-alert'
   */
  ipcMain.handle(
    "llm:dismiss-alert",
    async (_event, alertId, dismissedBy = "user") => {
      try {
        if (!database) {
          throw new Error("数据库未初始化");
        }

        const now = Date.now();
        const update = database.prepare(`
        UPDATE llm_alert_history
        SET dismissed = 1, dismissed_at = ?, dismissed_by = ?, updated_at = ?
        WHERE id = ?
      `);

        update.run(now, dismissedBy, now, alertId);

        return { success: true };
      } catch {
        throw privacy.failure("dismiss-alert");
      }
    },
  );

  /**
   * 清除告警历史
   * Channel: 'llm:clear-alert-history'
   */
  ipcMain.handle("llm:clear-alert-history", async (_event, options = {}) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const { userId = "default", olderThanDays } = options;

      if (olderThanDays) {
        const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
        database
          .prepare(
            "DELETE FROM llm_alert_history WHERE user_id = ? AND created_at < ?",
          )
          .run(userId, cutoff);
      } else {
        database
          .prepare("DELETE FROM llm_alert_history WHERE user_id = ?")
          .run(userId);
      }

      return { success: true };
    } catch {
      throw privacy.failure("clear-alert-history");
    }
  });
}

module.exports = { registerAlertHandlers };
