/**
 * 统计数据收集器
 *
 * 收集和统计远程命令执行数据，支持：
 * - 实时统计（内存中）
 * - 持久化统计（SQLite）
 * - 多维度统计（设备、命令、时间）
 * - 性能指标（响应时间、成功率）
 *
 * @module remote/logging/statistics-collector
 */

const { logger } = require("../../utils/logger");
const EventEmitter = require("events");

/**
 * 时间段类型
 */
const TimePeriod = {
  HOUR: "hour",
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
  YEAR: "year",
};

/**
 * 统计数据收集器类
 */
class StatisticsCollector extends EventEmitter {
  constructor(database, options = {}) {
    super();

    this.database = database;

    // 配置
    this.config = {
      enableRealTimeStats: true,
      enablePersistentStats: true,
      statsAggregationInterval: 60 * 1000, // 每分钟聚合一次
      maxStatsAge: 90 * 24 * 60 * 60 * 1000, // 90 天
      ...options,
    };

    // 实时统计数据（内存中）
    this.realTimeStats = {
      totalCommands: 0,
      successCount: 0,
      failureCount: 0,
      warningCount: 0,
      totalDuration: 0,
      byDevice: new Map(),
      byNamespace: new Map(),
      byAction: new Map(),
      recentCommands: [],
    };

    // 聚合定时器
    this.aggregationTimer = null;

    // 初始化数据库表
    this.initializeDatabase();

    // 启动统计聚合
    if (this.config.enablePersistentStats) {
      this.startAggregation();
    }

    logger.info("[StatisticsCollector] 统计数据收集器已初始化");
  }

  /**
   * 初始化数据库表
   */
  initializeDatabase() {
    try {
      // 创建统计表
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS remote_command_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          period_type TEXT NOT NULL,
          period_start INTEGER NOT NULL,
          period_end INTEGER NOT NULL,
          device_did TEXT,
          command_namespace TEXT,
          command_action TEXT,
          total_count INTEGER NOT NULL DEFAULT 0,
          success_count INTEGER NOT NULL DEFAULT 0,
          failure_count INTEGER NOT NULL DEFAULT 0,
          warning_count INTEGER NOT NULL DEFAULT 0,
          total_duration INTEGER NOT NULL DEFAULT 0,
          avg_duration REAL NOT NULL DEFAULT 0,
          min_duration INTEGER,
          max_duration INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // 创建索引
      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_stats_period ON remote_command_stats(period_type, period_start);
        CREATE INDEX IF NOT EXISTS idx_stats_device ON remote_command_stats(device_did);
        CREATE INDEX IF NOT EXISTS idx_stats_namespace ON remote_command_stats(command_namespace);
      `);

      logger.info("[StatisticsCollector] 统计表已初始化");
    } catch (error) {
      logger.error("[StatisticsCollector] 初始化数据库表失败:", error);
      throw error;
    }
  }

  /**
   * 记录命令执行
   */
  record(commandData) {
    const {
      deviceDid,
      namespace,
      action,
      status = "success",
      duration = 0,
      timestamp = Date.now(),
    } = commandData;

    try {
      if (!this.config.enableRealTimeStats) {
        return;
      }

      // 更新实时统计
      this.realTimeStats.totalCommands++;

      // 按状态统计
      if (status === "success") {
        this.realTimeStats.successCount++;
      } else if (status === "failure") {
        this.realTimeStats.failureCount++;
      } else if (status === "warning") {
        this.realTimeStats.warningCount++;
      }

      // 累加执行时间
      if (duration > 0) {
        this.realTimeStats.totalDuration += duration;
      }

      // 按设备统计
      if (deviceDid) {
        const deviceStats = this.realTimeStats.byDevice.get(deviceDid) || {
          totalCount: 0,
          successCount: 0,
          failureCount: 0,
          lastActivity: 0,
        };
        deviceStats.totalCount++;
        if (status === "success") {
          deviceStats.successCount++;
        }
        if (status === "failure") {
          deviceStats.failureCount++;
        }
        deviceStats.lastActivity = timestamp;
        this.realTimeStats.byDevice.set(deviceDid, deviceStats);
      }

      // 按命名空间统计
      if (namespace) {
        const nsStats = this.realTimeStats.byNamespace.get(namespace) || {
          totalCount: 0,
          successCount: 0,
          failureCount: 0,
        };
        nsStats.totalCount++;
        if (status === "success") {
          nsStats.successCount++;
        }
        if (status === "failure") {
          nsStats.failureCount++;
        }
        this.realTimeStats.byNamespace.set(namespace, nsStats);
      }

      // 按动作统计
      const fullAction = `${namespace}.${action}`;
      const actionStats = this.realTimeStats.byAction.get(fullAction) || {
        totalCount: 0,
        avgDuration: 0,
      };
      actionStats.totalCount++;
      if (duration > 0) {
        actionStats.avgDuration =
          (actionStats.avgDuration * (actionStats.totalCount - 1) + duration) /
          actionStats.totalCount;
      }
      this.realTimeStats.byAction.set(fullAction, actionStats);

      // 记录最近的命令
      this.realTimeStats.recentCommands.unshift({
        deviceDid,
        namespace,
        action,
        status,
        duration,
        timestamp,
      });

      // 只保留最近 100 条
      if (this.realTimeStats.recentCommands.length > 100) {
        this.realTimeStats.recentCommands =
          this.realTimeStats.recentCommands.slice(0, 100);
      }

      // 发出统计更新事件
      this.emit("stats-updated", this.getRealTimeStats());
    } catch (error) {
      logger.error("[StatisticsCollector] 记录统计失败:", error);
    }
  }

  /**
   * 获取实时统计
   */
  getRealTimeStats() {
    const avgDuration =
      this.realTimeStats.totalCommands > 0
        ? this.realTimeStats.totalDuration / this.realTimeStats.totalCommands
        : 0;

    const successRate =
      this.realTimeStats.totalCommands > 0
        ? (
            (this.realTimeStats.successCount /
              this.realTimeStats.totalCommands) *
            100
          ).toFixed(2)
        : 0;

    return {
      totalCommands: this.realTimeStats.totalCommands,
      successCount: this.realTimeStats.successCount,
      failureCount: this.realTimeStats.failureCount,
      warningCount: this.realTimeStats.warningCount,
      successRate: `${successRate}%`,
      avgDuration: Math.round(avgDuration),
      byDevice: Object.fromEntries(this.realTimeStats.byDevice),
      byNamespace: Object.fromEntries(this.realTimeStats.byNamespace),
      byAction: Object.fromEntries(this.realTimeStats.byAction),
      recentCommands: this.realTimeStats.recentCommands.slice(0, 10), // 返回最近 10 条
    };
  }

  /**
   * 聚合统计数据到数据库
   */
  async aggregate() {
    if (!this.config.enablePersistentStats) {
      return;
    }

    try {
      logger.debug("[StatisticsCollector] 开始聚合统计数据...");

      const now = Date.now();

      // 聚合小时级别统计
      await this.aggregateByPeriod(TimePeriod.HOUR, now);

      // 聚合天级别统计
      await this.aggregateByPeriod(TimePeriod.DAY, now);

      logger.debug("[StatisticsCollector] 统计数据聚合完成");
    } catch (error) {
      logger.error("[StatisticsCollector] 聚合统计失败:", error);
    }
  }

  /**
   * 按时间段聚合
   */
  async aggregateByPeriod(periodType, timestamp) {
    const { periodStart, periodEnd } = this.getPeriodRange(
      periodType,
      timestamp,
    );

    try {
      // 查询该时间段内的所有日志
      const logs = this.database
        .prepare(
          `
        SELECT
          device_did,
          command_namespace,
          command_action,
          status,
          duration
        FROM remote_command_logs
        WHERE timestamp >= ? AND timestamp < ?
      `,
        )
        .all(periodStart, periodEnd);

      if (logs.length === 0) {
        return;
      }

      // 按设备、命名空间、动作分组统计
      const statsMap = new Map();

      for (const log of logs) {
        const key = `${log.device_did || "all"}:${log.command_namespace}:${log.command_action}`;

        if (!statsMap.has(key)) {
          statsMap.set(key, {
            device_did: log.device_did,
            command_namespace: log.command_namespace,
            command_action: log.command_action,
            total_count: 0,
            success_count: 0,
            failure_count: 0,
            warning_count: 0,
            total_duration: 0,
            durations: [],
          });
        }

        const stats = statsMap.get(key);
        stats.total_count++;

        if (log.status === "success") {
          stats.success_count++;
        } else if (log.status === "failure") {
          stats.failure_count++;
        } else if (log.status === "warning") {
          stats.warning_count++;
        }

        if (log.duration) {
          stats.total_duration += log.duration;
          stats.durations.push(log.duration);
        }
      }

      // 保存或更新统计
      const upsertStmt = this.database.prepare(`
        INSERT INTO remote_command_stats (
          period_type, period_start, period_end, device_did, command_namespace, command_action,
          total_count, success_count, failure_count, warning_count,
          total_duration, avg_duration, min_duration, max_duration,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          total_count = excluded.total_count,
          success_count = excluded.success_count,
          failure_count = excluded.failure_count,
          warning_count = excluded.warning_count,
          total_duration = excluded.total_duration,
          avg_duration = excluded.avg_duration,
          min_duration = excluded.min_duration,
          max_duration = excluded.max_duration,
          updated_at = excluded.updated_at
      `);

      for (const [key, stats] of statsMap) {
        const avgDuration =
          stats.durations.length > 0
            ? stats.total_duration / stats.durations.length
            : 0;
        const minDuration =
          stats.durations.length > 0 ? Math.min(...stats.durations) : null;
        const maxDuration =
          stats.durations.length > 0 ? Math.max(...stats.durations) : null;

        upsertStmt.run(
          periodType,
          periodStart,
          periodEnd,
          stats.device_did,
          stats.command_namespace,
          stats.command_action,
          stats.total_count,
          stats.success_count,
          stats.failure_count,
          stats.warning_count,
          stats.total_duration,
          avgDuration,
          minDuration,
          maxDuration,
          Date.now(),
          Date.now(),
        );
      }

      logger.debug(
        `[StatisticsCollector] 聚合完成: ${periodType}, ${statsMap.size} 条记录`,
      );
    } catch (error) {
      logger.error(`[StatisticsCollector] 聚合失败 (${periodType}):`, error);
    }
  }

  /**
   * 获取时间段范围
   */
  getPeriodRange(periodType, timestamp) {
    const date = new Date(timestamp);

    switch (periodType) {
      case TimePeriod.HOUR:
        date.setMinutes(0, 0, 0);
        return {
          periodStart: date.getTime(),
          periodEnd: date.getTime() + 60 * 60 * 1000,
        };

      case TimePeriod.DAY:
        date.setHours(0, 0, 0, 0);
        return {
          periodStart: date.getTime(),
          periodEnd: date.getTime() + 24 * 60 * 60 * 1000,
        };

      case TimePeriod.WEEK: {
        const day = date.getDay();
        date.setDate(date.getDate() - day);
        date.setHours(0, 0, 0, 0);
        return {
          periodStart: date.getTime(),
          periodEnd: date.getTime() + 7 * 24 * 60 * 60 * 1000,
        };
      }

      case TimePeriod.MONTH: {
        date.setDate(1);
        date.setHours(0, 0, 0, 0);
        const nextMonth = new Date(date);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        return {
          periodStart: date.getTime(),
          periodEnd: nextMonth.getTime(),
        };
      }

      case TimePeriod.YEAR: {
        date.setMonth(0, 1);
        date.setHours(0, 0, 0, 0);
        const nextYear = new Date(date);
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        return {
          periodStart: date.getTime(),
          periodEnd: nextYear.getTime(),
        };
      }

      default:
        throw new Error(`Unknown period type: ${periodType}`);
    }
  }

  /**
   * 查询统计数据
   */
  queryStats(options = {}) {
    const {
      periodType = TimePeriod.DAY,
      startTime = null,
      endTime = null,
      deviceDid = null,
      namespace = null,
      limit = 100,
    } = options;

    try {
      let query = "SELECT * FROM remote_command_stats WHERE period_type = ?";
      const params = [periodType];

      if (startTime) {
        query += " AND period_start >= ?";
        params.push(startTime);
      }

      if (endTime) {
        query += " AND period_end <= ?";
        params.push(endTime);
      }

      if (deviceDid) {
        query += " AND device_did = ?";
        params.push(deviceDid);
      }

      if (namespace) {
        query += " AND command_namespace = ?";
        params.push(namespace);
      }

      query += " ORDER BY period_start DESC LIMIT ?";
      params.push(limit);

      const stats = this.database.prepare(query).all(...params);

      return stats;
    } catch (error) {
      logger.error("[StatisticsCollector] 查询统计失败:", error);
      throw error;
    }
  }

  /**
   * 获取设备活跃度
   */
  getDeviceActivity(days = 7) {
    try {
      const startTime = Date.now() - days * 24 * 60 * 60 * 1000;

      const activity = this.database
        .prepare(
          `
        SELECT
          device_did,
          COUNT(*) as total_commands,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
          MAX(timestamp) as last_activity
        FROM remote_command_logs
        WHERE timestamp >= ?
        GROUP BY device_did
        ORDER BY total_commands DESC
      `,
        )
        .all(startTime);

      return activity;
    } catch (error) {
      logger.error("[StatisticsCollector] 获取设备活跃度失败:", error);
      throw error;
    }
  }

  /**
   * 获取命令排行
   */
  getCommandRanking(limit = 10) {
    try {
      const ranking = this.database
        .prepare(
          `
        SELECT
          command_namespace || '.' || command_action as command,
          COUNT(*) as total_count,
          AVG(duration) as avg_duration
        FROM remote_command_logs
        GROUP BY command_namespace, command_action
        ORDER BY total_count DESC
        LIMIT ?
      `,
        )
        .all(limit);

      return ranking;
    } catch (error) {
      logger.error("[StatisticsCollector] 获取命令排行失败:", error);
      throw error;
    }
  }

  /**
   * 获取趋势数据
   */
  getTrend(periodType = TimePeriod.DAY, days = 7) {
    try {
      const startTime = Date.now() - days * 24 * 60 * 60 * 1000;

      const trend = this.database
        .prepare(
          `
        SELECT
          period_start,
          SUM(total_count) as total_count,
          SUM(success_count) as success_count,
          SUM(failure_count) as failure_count,
          AVG(avg_duration) as avg_duration
        FROM remote_command_stats
        WHERE period_type = ? AND period_start >= ?
        GROUP BY period_start
        ORDER BY period_start ASC
      `,
        )
        .all(periodType, startTime);

      return trend;
    } catch (error) {
      logger.error("[StatisticsCollector] 获取趋势数据失败:", error);
      throw error;
    }
  }

  /**
   * 启动聚合
   */
  startAggregation() {
    if (this.aggregationTimer) {
      return;
    }

    this.aggregationTimer = setInterval(() => {
      this.aggregate();
    }, this.config.statsAggregationInterval);

    logger.info("[StatisticsCollector] 统计聚合已启动");
  }

  /**
   * 停止聚合
   */
  stopAggregation() {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
      logger.info("[StatisticsCollector] 统计聚合已停止");
    }
  }

  /**
   * 清理旧统计数据
   */
  cleanup() {
    try {
      const cutoffTime = Date.now() - this.config.maxStatsAge;

      const result = this.database
        .prepare(
          `
        DELETE FROM remote_command_stats WHERE period_start < ?
      `,
        )
        .run(cutoffTime);

      logger.info(`[StatisticsCollector] 清理旧统计数据: ${result.changes} 条`);
      return result.changes;
    } catch (error) {
      logger.error("[StatisticsCollector] 清理统计数据失败:", error);
      throw error;
    }
  }

  /**
   * 重置实时统计
   */
  resetRealTimeStats() {
    this.realTimeStats = {
      totalCommands: 0,
      successCount: 0,
      failureCount: 0,
      warningCount: 0,
      totalDuration: 0,
      byDevice: new Map(),
      byNamespace: new Map(),
      byAction: new Map(),
      recentCommands: [],
    };

    logger.info("[StatisticsCollector] 实时统计已重置");
  }

  /**
   * 销毁
   */
  destroy() {
    this.stopAggregation();
    this.removeAllListeners();
    logger.info("[StatisticsCollector] 统计数据收集器已销毁");
  }
}

// 导出
module.exports = {
  StatisticsCollector,
  TimePeriod,
};
