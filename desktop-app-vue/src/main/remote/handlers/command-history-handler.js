/**
 * 命令历史管理处理器
 *
 * 功能：
 * - 命令历史记录
 * - 审计日志查询
 * - 统计分析
 * - 历史导出
 *
 * @module remote/handlers/command-history-handler
 */

const { logger } = require("../../utils/logger");
const SqlSecurity = require("../../database/sql-security.js");

/**
 * Parse a JSON column tolerantly: a truncated/corrupted row must not throw out
 * of the row mapper and fail the entire history query (only the newer
 * getCommand/replayCommand guarded their parses; the list/search/export
 * methods did not).
 */
function safeJsonParse(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * 命令历史处理器类
 */
class CommandHistoryHandler {
  constructor(database, options = {}) {
    this.database = database;
    this.options = {
      maxHistoryDays: options.maxHistoryDays || 90, // 保留90天历史
      enableAutoCleanup: options.enableAutoCleanup !== false,
      cleanupInterval: options.cleanupInterval || 24 * 60 * 60 * 1000, // 24小时
      ...options,
    };

    // 初始化数据库表
    this.initializeDatabase();

    logger.info("[CommandHistoryHandler] 命令历史处理器已初始化");

    // 启动自动清理
    if (this.options.enableAutoCleanup) {
      this.startAutoCleanup();
    }
  }

  /**
   * 初始化数据库表
   */
  initializeDatabase() {
    try {
      // 创建命令历史表
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS command_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id TEXT NOT NULL,
          method TEXT NOT NULL,
          params TEXT,
          device_did TEXT,
          channel TEXT,
          result TEXT,
          error TEXT,
          duration INTEGER,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);

      // 创建索引
      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_command_history_method ON command_history(method);
        CREATE INDEX IF NOT EXISTS idx_command_history_device_did ON command_history(device_did);
        CREATE INDEX IF NOT EXISTS idx_command_history_status ON command_history(status);
        CREATE INDEX IF NOT EXISTS idx_command_history_created_at ON command_history(created_at);
      `);

      logger.info("[CommandHistoryHandler] 数据库表已初始化");
    } catch (error) {
      logger.error("[CommandHistoryHandler] 初始化数据库表失败:", error);
    }
  }

  /**
   * 处理命令
   */
  async handle(action, params, context) {
    logger.debug("[CommandHistoryHandler] 处理命令: " + action);

    switch (action) {
      case "getHistory":
        return await this.getHistory(params, context);

      case "getById":
        return await this.getById(params, context);

      case "search":
        return await this.searchHistory(params, context);

      case "getStats":
        return await this.getStats(params, context);

      case "export":
        return await this.exportHistory(params, context);

      case "clear":
        return await this.clearHistory(params, context);

      case "getByDevice":
        return await this.getByDevice(params, context);

      case "getByTimeRange":
        return await this.getByTimeRange(params, context);

      // ─── Phase 6.5 Android-aligned method names ──────────────────────
      // Mirror `HistoryCommands.kt`. The earlier desktop-only names
      // (getById / clear / etc.) stay wired for existing SPA callers;
      // these new methods are Android-shape wrappers that satisfy the
      // typed `Result<...Response>` decoders without breaking the SPA.

      case "getCommand":
        return await this.getCommand(params, context);

      case "clearHistory":
        return await this.clearHistoryMobile(params, context);

      case "replay":
        return await this.replayCommand(params, context);

      case "getFrequent":
        return await this.getFrequent(params, context);

      default:
        throw new Error("Unknown action: " + action);
    }
  }

  /**
   * 记录命令执行（由 Gateway 调用）
   */
  async recordCommand(commandData) {
    const {
      requestId,
      method,
      params,
      context,
      result,
      error,
      duration,
      timestamp,
    } = commandData;

    try {
      await this.database.run(
        `INSERT INTO command_history (
          request_id, method, params, device_did, channel,
          result, error, duration, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          requestId,
          method,
          JSON.stringify(params || {}),
          context.did || null,
          context.channel || "unknown",
          result ? JSON.stringify(result) : null,
          error ? JSON.stringify(error) : null,
          duration || 0,
          error ? "failed" : "success",
          timestamp || Date.now(),
        ],
      );

      logger.debug("[CommandHistoryHandler] 命令已记录: " + method);
    } catch (err) {
      logger.error("[CommandHistoryHandler] 记录命令失败:", err);
    }
  }

  /**
   * 获取命令历史
   */
  async getHistory(params, context) {
    const { limit = 50, offset = 0, status = null } = params;

    let query = "SELECT * FROM command_history";
    const args = [];

    if (status) {
      query += " WHERE status = ?";
      args.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    args.push(limit, offset);

    const rows = await this.database.all(query, args);

    // 解析 JSON 字段
    const history = rows.map((row) => ({
      ...row,
      params: safeJsonParse(row.params, {}),
      result: safeJsonParse(row.result, null),
      error: safeJsonParse(row.error, null),
    }));

    return {
      history,
      total: history.length,
      limit,
      offset,
    };
  }

  /**
   * 根据 ID 获取命令
   */
  async getById(params, context) {
    const { id } = params;
    if (!id) {
      throw new Error("Command ID is required");
    }

    const row = await this.database.get(
      "SELECT * FROM command_history WHERE id = ?",
      [id],
    );

    if (!row) {
      throw new Error("Command not found");
    }

    return {
      ...row,
      params: safeJsonParse(row.params, {}),
      result: safeJsonParse(row.result, null),
      error: safeJsonParse(row.error, null),
    };
  }

  /**
   * 搜索命令历史
   */
  async searchHistory(params, context) {
    const { query, limit = 50 } = params;
    if (!query) {
      throw new Error("Search query is required");
    }

    const rows = await this.database.all(
      `SELECT * FROM command_history
       WHERE method LIKE ? ESCAPE '\\' OR params LIKE ? ESCAPE '\\' OR device_did LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`,
      [
        SqlSecurity.likeContains(query),
        SqlSecurity.likeContains(query),
        SqlSecurity.likeContains(query),
        limit,
      ],
    );

    const results = rows.map((row) => ({
      ...row,
      params: safeJsonParse(row.params, {}),
      result: safeJsonParse(row.result, null),
      error: safeJsonParse(row.error, null),
    }));

    return { results, total: results.length };
  }

  /**
   * 获取统计信息
   */
  async getStats(params, context) {
    const { days = 7 } = params;
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    // 总命令数
    const totalRow = await this.database.get(
      "SELECT COUNT(*) as total FROM command_history WHERE created_at >= ?",
      [cutoffTime],
    );

    // 成功/失败数
    const successRow = await this.database.get(
      "SELECT COUNT(*) as count FROM command_history WHERE status = ? AND created_at >= ?",
      ["success", cutoffTime],
    );

    const failedRow = await this.database.get(
      "SELECT COUNT(*) as count FROM command_history WHERE status = ? AND created_at >= ?",
      ["failed", cutoffTime],
    );

    // 按方法统计
    const methodStats = await this.database.all(
      `SELECT method, COUNT(*) as count, AVG(duration) as avg_duration
       FROM command_history
       WHERE created_at >= ?
       GROUP BY method
       ORDER BY count DESC
       LIMIT 10`,
      [cutoffTime],
    );

    // 按设备统计
    const deviceStats = await this.database.all(
      `SELECT device_did, COUNT(*) as count
       FROM command_history
       WHERE created_at >= ? AND device_did IS NOT NULL
       GROUP BY device_did
       ORDER BY count DESC
       LIMIT 10`,
      [cutoffTime],
    );

    // 按时间统计（每小时）
    const timeStats = await this.database.all(
      `SELECT
         strftime('%Y-%m-%d %H:00', datetime(created_at/1000, 'unixepoch')) as hour,
         COUNT(*) as count
       FROM command_history
       WHERE created_at >= ?
       GROUP BY hour
       ORDER BY hour DESC
       LIMIT 24`,
      [cutoffTime],
    );

    return {
      period: {
        days,
        startTime: cutoffTime,
        endTime: Date.now(),
      },
      summary: {
        total: totalRow.total,
        success: successRow.count,
        failed: failedRow.count,
        successRate:
          totalRow.total > 0
            ? ((successRow.count / totalRow.total) * 100).toFixed(2) + "%"
            : "0%",
      },
      byMethod: methodStats,
      byDevice: deviceStats,
      byTime: timeStats,
    };
  }

  /**
   * 导出命令历史
   */
  async exportHistory(params, context) {
    const { format = "json", startTime, endTime, status } = params;

    let query = "SELECT * FROM command_history WHERE 1=1";
    const args = [];

    if (startTime) {
      query += " AND created_at >= ?";
      args.push(startTime);
    }

    if (endTime) {
      query += " AND created_at <= ?";
      args.push(endTime);
    }

    if (status) {
      query += " AND status = ?";
      args.push(status);
    }

    query += " ORDER BY created_at ASC";

    const rows = await this.database.all(query, args);

    const history = rows.map((row) => ({
      ...row,
      params: safeJsonParse(row.params, {}),
      result: safeJsonParse(row.result, null),
      error: safeJsonParse(row.error, null),
    }));

    if (format === "json") {
      return {
        format: "json",
        data: history,
        total: history.length,
      };
    } else if (format === "csv") {
      // 简单的 CSV 导出
      const csvLines = [
        "ID,Request ID,Method,Device DID,Channel,Status,Duration,Created At",
      ];

      for (const item of history) {
        csvLines.push(
          `${item.id},${item.request_id},${item.method},${item.device_did || ""},${item.channel},${item.status},${item.duration},${new Date(item.created_at).toISOString()}`,
        );
      }

      return {
        format: "csv",
        data: csvLines.join("\n"),
        total: history.length,
      };
    } else {
      throw new Error("Unsupported export format: " + format);
    }
  }

  /**
   * 清除命令历史
   */
  async clearHistory(params, context) {
    const { beforeTime, status } = params;

    let query = "DELETE FROM command_history WHERE 1=1";
    const args = [];

    if (beforeTime) {
      query += " AND created_at < ?";
      args.push(beforeTime);
    }

    if (status) {
      query += " AND status = ?";
      args.push(status);
    }

    const result = await this.database.run(query, args);

    logger.info(`[CommandHistoryHandler] 清除了 ${result.changes} 条命令历史`);

    return {
      deleted: result.changes,
      message: `Deleted ${result.changes} command history records`,
    };
  }

  /**
   * 按设备获取命令历史
   */
  async getByDevice(params, context) {
    const { deviceDid, limit = 50, offset = 0 } = params;
    if (!deviceDid) {
      throw new Error("Device DID is required");
    }

    const rows = await this.database.all(
      `SELECT * FROM command_history
       WHERE device_did = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [deviceDid, limit, offset],
    );

    const history = rows.map((row) => ({
      ...row,
      params: safeJsonParse(row.params, {}),
      result: safeJsonParse(row.result, null),
      error: safeJsonParse(row.error, null),
    }));

    return {
      deviceDid,
      history,
      total: history.length,
      limit,
      offset,
    };
  }

  /**
   * 按时间范围获取命令历史
   */
  async getByTimeRange(params, context) {
    const { startTime, endTime, limit = 100 } = params;
    if (!startTime || !endTime) {
      throw new Error("Start time and end time are required");
    }

    const rows = await this.database.all(
      `SELECT * FROM command_history
       WHERE created_at >= ? AND created_at <= ?
       ORDER BY created_at DESC LIMIT ?`,
      [startTime, endTime, limit],
    );

    const history = rows.map((row) => ({
      ...row,
      params: safeJsonParse(row.params, {}),
      result: safeJsonParse(row.result, null),
      error: safeJsonParse(row.error, null),
    }));

    return {
      startTime,
      endTime,
      history,
      total: history.length,
    };
  }

  /**
   * Phase 6.5 — `history.getCommand` (Android / iOS HistoryCommands.kt:66).
   *
   * Android-shape wrapper around getById:
   *   `{ success, command: CommandRecordDetail }` vs the desktop-internal
   *   raw row. Android decoder needs the `command` wrapper + bool success.
   *
   * Param: `commandId` (Android-side) maps to `id` (desktop column). We
   * accept both for forward compat.
   */
  async getCommand(params, _context) {
    const commandId = params && (params.commandId || params.id);
    if (!commandId) {
      return { success: false, error: "commandId required" };
    }

    try {
      const row = await this.database.get(
        "SELECT * FROM command_history WHERE id = ? OR request_id = ?",
        [commandId, commandId],
      );
      if (!row) {
        return { success: false, error: "NOT_FOUND" };
      }
      // CommandRecordDetail maps the SQLite snake_case to camelCase keys
      // matching the Kotlin data class. params/result decoded; error
      // surfaced as a string if present (vs JSON envelope).
      const detail = {
        id: String(row.id),
        method: row.method,
        params: row.params ? JSON.parse(row.params) : {},
        result: row.result ? JSON.parse(row.result) : null,
        success: row.status === "success",
        duration: row.duration || 0,
        timestamp: row.created_at,
        deviceDid: row.device_did || null,
        deviceName: null, // Not stored in command_history; left null for parity
        error: row.error ? _safeJsonMessage(row.error) : null,
      };
      return { success: true, command: detail };
    } catch (err) {
      logger.error("[CommandHistoryHandler] getCommand failed:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Phase 6.5 — `history.clearHistory` (Android / iOS HistoryCommands.kt:87).
   *
   * Android-shape wrapper around the desktop `clear` action. Returns the
   * `ClearHistoryResponse{success, deletedCount, message}` shape (vs the
   * desktop-internal `{deleted, message}`) — key rename + bool success.
   *
   * Param mapping: Android `before` → desktop `beforeTime`; Android
   * `method` filter is honored even though desktop's existing `clear`
   * accepts `status` not `method` (we add method support here).
   */
  async clearHistoryMobile(params, _context) {
    const { before, method } = params || {};

    let query = "DELETE FROM command_history WHERE 1=1";
    const args = [];
    if (typeof before === "number") {
      query += " AND created_at < ?";
      args.push(before);
    }
    if (typeof method === "string" && method) {
      query += " AND method = ?";
      args.push(method);
    }

    try {
      const result = await this.database.run(query, args);
      const deletedCount = (result && result.changes) || 0;
      logger.info(
        `[CommandHistoryHandler] (mobile) cleared ${deletedCount} history rows`,
      );
      return {
        success: true,
        deletedCount,
        message: `Deleted ${deletedCount} command history records`,
      };
    } catch (err) {
      logger.error(
        "[CommandHistoryHandler] clearHistory (mobile) failed:",
        err,
      );
      return {
        success: false,
        deletedCount: 0,
        message: err.message,
      };
    }
  }

  /**
   * Phase 6.5 — `history.replay` (Android HistoryCommands.kt:103).
   *
   * Returns the recorded result of the original command execution. We do
   * NOT actually re-issue the command — that would require a
   * `commandExecutor` injection (the way WorkflowHandler does) and
   * would have surprising side effects (writing files / sending
   * notifications during a passive replay). Instead we hand the original
   * result back to the caller, who can decide to re-invoke via the
   * regular RPC path if they want fresh execution.
   *
   * Android `ReplayResponse{success, commandId, result?, error?}` —
   * `result` is the previous run's output (or null if the command failed
   * originally). Future enhancement: inject commandExecutor for true
   * re-execution.
   */
  async replayCommand(params, _context) {
    const commandId = params && (params.commandId || params.id);
    if (!commandId) {
      return { success: false, commandId: "", error: "commandId required" };
    }

    try {
      const row = await this.database.get(
        "SELECT id, status, result, error FROM command_history WHERE id = ? OR request_id = ?",
        [commandId, commandId],
      );
      if (!row) {
        return {
          success: false,
          commandId: String(commandId),
          error: "NOT_FOUND",
        };
      }
      if (row.status !== "success") {
        return {
          success: false,
          commandId: String(row.id),
          error: row.error ? _safeJsonMessage(row.error) : "ORIGINAL_FAILED",
        };
      }
      return {
        success: true,
        commandId: String(row.id),
        result: row.result ? JSON.parse(row.result) : null,
      };
    } catch (err) {
      logger.error("[CommandHistoryHandler] replay failed:", err);
      return {
        success: false,
        commandId: String(commandId),
        error: err.message,
      };
    }
  }

  /**
   * Phase 6.5 — `history.getFrequent` (Android HistoryCommands.kt:113).
   *
   * Aggregates command_history by method to surface the user's most-used
   * commands. Returns `FrequentCommandsResponse{success, commands: [...]}`
   * where each row matches Kotlin `FrequentCommand{method, count,
   * lastUsed, avgDuration}`.
   *
   * Ordered by count desc; ties broken by recency.
   */
  async getFrequent(params, _context) {
    const { limit = 10 } = params || {};
    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));

    try {
      const rows = await this.database.all(
        `SELECT method,
                COUNT(*) as count,
                MAX(created_at) as last_used,
                AVG(duration) as avg_duration
         FROM command_history
         GROUP BY method
         ORDER BY count DESC, last_used DESC
         LIMIT ?`,
        [safeLimit],
      );
      const commands = (rows || []).map((r) => ({
        method: r.method,
        count: r.count || 0,
        lastUsed: r.last_used || 0,
        avgDuration: r.avg_duration ? Number(r.avg_duration) : 0,
      }));
      return { success: true, commands };
    } catch (err) {
      logger.error("[CommandHistoryHandler] getFrequent failed:", err);
      return { success: false, commands: [], error: err.message };
    }
  }

  /**
   * 启动自动清理
   */
  startAutoCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldHistory().catch((err) => {
        logger.error("[CommandHistoryHandler] 自动清理失败:", err);
      });
    }, this.options.cleanupInterval);

    logger.info("[CommandHistoryHandler] 自动清理已启动");
  }

  /**
   * 清理过期历史
   */
  async cleanupOldHistory() {
    const cutoffTime =
      Date.now() - this.options.maxHistoryDays * 24 * 60 * 60 * 1000;

    const result = await this.database.run(
      "DELETE FROM command_history WHERE created_at < ?",
      [cutoffTime],
    );

    if (result.changes > 0) {
      logger.info(
        `[CommandHistoryHandler] 清理了 ${result.changes} 条过期历史`,
      );
    }

    return result.changes;
  }

  /**
   * 停止自动清理
   */
  stopAutoCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info("[CommandHistoryHandler] 自动清理已停止");
    }
  }
}

/**
 * Phase 6.5 helper — extract a human-readable string from the error column.
 * Errors are stored as JSON (`{ code, message, ... }`) but may also be a
 * bare string from older rows. Returns the embedded `.message` field if
 * the JSON parses, else the raw text.
 */
function _safeJsonMessage(raw) {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.message === "string"
    ) {
      return parsed.message;
    }
    return JSON.stringify(parsed);
  } catch (_e) {
    return raw;
  }
}

module.exports = CommandHistoryHandler;
