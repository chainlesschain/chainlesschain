/**
 * 命令日志记录器
 *
 * 记录所有远程命令的执行日志，支持：
 * - 结构化日志存储（SQLite）
 * - 日志级别（info、warn、error）
 * - 日志查询（分页、过滤、搜索）
 * - 日志轮转（自动清理旧日志）
 *
 * @module remote/logging/command-logger
 */

const { logger } = require('../../utils/logger');
const EventEmitter = require('events');

/**
 * 日志级别
 */
const LogLevel = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  DEBUG: 'debug'
};

/**
 * 命令日志记录器类
 */
class CommandLogger extends EventEmitter {
  constructor(database, options = {}) {
    super();

    this.database = database;

    // 配置
    this.config = {
      maxLogAge: 30 * 24 * 60 * 60 * 1000, // 30 天
      maxLogCount: 100000, // 最多保留 10 万条日志
      autoCleanupInterval: 24 * 60 * 60 * 1000, // 每 24 小时清理一次
      enableAutoCleanup: true,
      ...options
    };

    // 自动清理定时器
    this.cleanupTimer = null;

    // 初始化数据库表
    this.initializeDatabase();

    // 启动自动清理
    if (this.config.enableAutoCleanup) {
      this.startAutoCleanup();
    }

    logger.info('[CommandLogger] 命令日志记录器已初始化');
  }

  /**
   * 初始化数据库表
   */
  initializeDatabase() {
    try {
      // 创建远程命令日志表
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS remote_command_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id TEXT NOT NULL,
          device_did TEXT NOT NULL,
          device_name TEXT,
          command_namespace TEXT NOT NULL,
          command_action TEXT NOT NULL,
          params TEXT,
          result TEXT,
          error TEXT,
          status TEXT NOT NULL,
          level TEXT NOT NULL,
          duration INTEGER,
          timestamp INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);

      // 创建索引
      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_remote_logs_did ON remote_command_logs(device_did);
        CREATE INDEX IF NOT EXISTS idx_remote_logs_timestamp ON remote_command_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_remote_logs_status ON remote_command_logs(status);
        CREATE INDEX IF NOT EXISTS idx_remote_logs_level ON remote_command_logs(level);
        CREATE INDEX IF NOT EXISTS idx_remote_logs_namespace ON remote_command_logs(command_namespace);
      `);

      logger.info('[CommandLogger] 数据库表已初始化');
    } catch (error) {
      logger.error('[CommandLogger] 初始化数据库表失败:', error);
      throw error;
    }
  }

  /**
   * 记录命令日志
   *
   * @param {Object} logEntry - 日志条目
   * @returns {number} 日志 ID
   */
  log(logEntry) {
    const {
      requestId,
      deviceDid,
      deviceName = null,
      namespace,
      action,
      params = {},
      result = null,
      error = null,
      status = 'success',
      level = LogLevel.INFO,
      duration = 0,
      timestamp = Date.now()
    } = logEntry;

    try {
      // 验证必填字段
      if (!requestId || !deviceDid || !namespace || !action) {
        throw new Error('Missing required fields: requestId, deviceDid, namespace, action');
      }

      // 插入日志
      const stmt = this.database.prepare(`
        INSERT INTO remote_command_logs (
          request_id, device_did, device_name, command_namespace, command_action,
          params, result, error, status, level, duration, timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const info = stmt.run(
        requestId,
        deviceDid,
        deviceName,
        namespace,
        action,
        JSON.stringify(params),
        result ? JSON.stringify(result) : null,
        error,
        status,
        level,
        duration,
        timestamp,
        Date.now()
      );

      logger.debug(`[CommandLogger] 日志已记录: ${namespace}.${action} (ID: ${info.lastInsertRowid})`);

      // 发出日志记录事件
      this.emit('log', {
        id: info.lastInsertRowid,
        ...logEntry
      });

      return info.lastInsertRowid;
    } catch (err) {
      logger.error('[CommandLogger] 记录日志失败:', err);
      throw err;
    }
  }

  /**
   * 记录成功的命令
   */
  logSuccess(logEntry) {
    return this.log({
      ...logEntry,
      status: 'success',
      level: LogLevel.INFO
    });
  }

  /**
   * 记录失败的命令
   */
  logFailure(logEntry) {
    return this.log({
      ...logEntry,
      status: 'failure',
      level: LogLevel.ERROR
    });
  }

  /**
   * 记录警告
   */
  logWarning(logEntry) {
    return this.log({
      ...logEntry,
      status: 'warning',
      level: LogLevel.WARN
    });
  }

  /**
   * 查询日志
   *
   * @param {Object} options - 查询选项
   * @returns {Object} 查询结果
   */
  query(options = {}) {
    const {
      deviceDid = null,
      namespace = null,
      status = null,
      level = null,
      startTime = null,
      endTime = null,
      search = null,
      limit = 50,
      offset = 0,
      sortBy = 'timestamp',
      sortOrder = 'DESC'
    } = options;

    try {
      // 构建查询
      let query = 'SELECT * FROM remote_command_logs WHERE 1=1';
      const params = [];

      // 设备过滤
      if (deviceDid) {
        query += ' AND device_did = ?';
        params.push(deviceDid);
      }

      // 命名空间过滤
      if (namespace) {
        query += ' AND command_namespace = ?';
        params.push(namespace);
      }

      // 状态过滤
      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      // 级别过滤
      if (level) {
        query += ' AND level = ?';
        params.push(level);
      }

      // 时间范围过滤
      if (startTime) {
        query += ' AND timestamp >= ?';
        params.push(startTime);
      }

      if (endTime) {
        query += ' AND timestamp <= ?';
        params.push(endTime);
      }

      // 搜索过滤（搜索命令 action 或设备名称）
      if (search) {
        query += ' AND (command_action LIKE ? OR device_name LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }

      // 排序
      query += ` ORDER BY ${sortBy} ${sortOrder}`;

      // 分页
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);

      // 执行查询
      const logs = this.database.prepare(query).all(...params);

      // 解析 JSON 字段
      const formattedLogs = logs.map(log => ({
        ...log,
        params: log.params ? JSON.parse(log.params) : null,
        result: log.result ? JSON.parse(log.result) : null
      }));

      // 获取总数
      let countQuery = 'SELECT COUNT(*) as total FROM remote_command_logs WHERE 1=1';
      const countParams = [];

      if (deviceDid) {
        countQuery += ' AND device_did = ?';
        countParams.push(deviceDid);
      }
      if (namespace) {
        countQuery += ' AND command_namespace = ?';
        countParams.push(namespace);
      }
      if (status) {
        countQuery += ' AND status = ?';
        countParams.push(status);
      }
      if (level) {
        countQuery += ' AND level = ?';
        countParams.push(level);
      }
      if (startTime) {
        countQuery += ' AND timestamp >= ?';
        countParams.push(startTime);
      }
      if (endTime) {
        countQuery += ' AND timestamp <= ?';
        countParams.push(endTime);
      }
      if (search) {
        countQuery += ' AND (command_action LIKE ? OR device_name LIKE ?)';
        countParams.push(`%${search}%`, `%${search}%`);
      }

      const { total } = this.database.prepare(countQuery).get(...countParams);

      return {
        logs: formattedLogs,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
    } catch (error) {
      logger.error('[CommandLogger] 查询日志失败:', error);
      throw error;
    }
  }

  /**
   * 获取日志详情
   */
  getLogById(id) {
    try {
      const log = this.database
        .prepare('SELECT * FROM remote_command_logs WHERE id = ?')
        .get(id);

      if (!log) {
        return null;
      }

      return {
        ...log,
        params: log.params ? JSON.parse(log.params) : null,
        result: log.result ? JSON.parse(log.result) : null
      };
    } catch (error) {
      logger.error('[CommandLogger] 获取日志详情失败:', error);
      throw error;
    }
  }

  /**
   * 获取最近的日志
   */
  getRecentLogs(limit = 20) {
    return this.query({
      limit,
      offset: 0,
      sortBy: 'timestamp',
      sortOrder: 'DESC'
    });
  }

  /**
   * 获取设备的日志
   */
  getLogsByDevice(deviceDid, limit = 50, offset = 0) {
    return this.query({
      deviceDid,
      limit,
      offset
    });
  }

  /**
   * 获取失败的日志
   */
  getFailureLogs(limit = 50, offset = 0) {
    return this.query({
      status: 'failure',
      limit,
      offset
    });
  }

  /**
   * 清理旧日志
   */
  cleanup() {
    try {
      const cutoffTime = Date.now() - this.config.maxLogAge;

      // 删除超过保留期的日志
      const stmt1 = this.database.prepare('DELETE FROM remote_command_logs WHERE timestamp < ?');
      const result1 = stmt1.run(cutoffTime);

      // 如果日志总数超过最大值，删除最旧的
      const { total } = this.database.prepare('SELECT COUNT(*) as total FROM remote_command_logs').get();

      if (total > this.config.maxLogCount) {
        const excessCount = total - this.config.maxLogCount;
        const stmt2 = this.database.prepare(`
          DELETE FROM remote_command_logs WHERE id IN (
            SELECT id FROM remote_command_logs ORDER BY timestamp ASC LIMIT ?
          )
        `);
        const result2 = stmt2.run(excessCount);

        logger.info(`[CommandLogger] 清理超量日志: ${result2.changes} 条`);
      }

      logger.info(`[CommandLogger] 清理旧日志: ${result1.changes} 条`);

      return result1.changes;
    } catch (error) {
      logger.error('[CommandLogger] 清理日志失败:', error);
      throw error;
    }
  }

  /**
   * 启动自动清理
   */
  startAutoCleanup() {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      logger.debug('[CommandLogger] 执行自动清理...');
      try {
        this.cleanup();
      } catch (error) {
        logger.error('[CommandLogger] 自动清理失败:', error);
      }
    }, this.config.autoCleanupInterval);

    logger.info('[CommandLogger] 自动清理已启动');
  }

  /**
   * 停止自动清理
   */
  stopAutoCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info('[CommandLogger] 自动清理已停止');
    }
  }

  /**
   * 导出日志
   */
  exportLogs(options = {}) {
    const { format = 'json' } = options;

    try {
      const { logs } = this.query({
        ...options,
        limit: options.limit || 10000 // 导出最多 1 万条
      });

      if (format === 'json') {
        return JSON.stringify(logs, null, 2);
      } else if (format === 'csv') {
        return this.convertToCSV(logs);
      } else {
        throw new Error(`Unsupported format: ${format}`);
      }
    } catch (error) {
      logger.error('[CommandLogger] 导出日志失败:', error);
      throw error;
    }
  }

  /**
   * 转换为 CSV 格式
   */
  convertToCSV(logs) {
    if (logs.length === 0) {
      return '';
    }

    // CSV 头部
    const headers = [
      'id', 'request_id', 'device_did', 'device_name', 'command_namespace',
      'command_action', 'status', 'level', 'duration', 'timestamp', 'created_at'
    ];

    const csvRows = [headers.join(',')];

    // CSV 数据行
    for (const log of logs) {
      const row = headers.map(header => {
        const value = log[header];
        // 转义包含逗号的值
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value || '';
      });
      csvRows.push(row.join(','));
    }

    return csvRows.join('\n');
  }

  /**
   * 清空所有日志（谨慎使用）
   */
  clearAll() {
    try {
      const result = this.database.prepare('DELETE FROM remote_command_logs').run();
      logger.warn(`[CommandLogger] 已清空所有日志: ${result.changes} 条`);
      return result.changes;
    } catch (error) {
      logger.error('[CommandLogger] 清空日志失败:', error);
      throw error;
    }
  }

  /**
   * 获取日志统计
   */
  getStats(options = {}) {
    const {
      deviceDid = null,
      startTime = null,
      endTime = null
    } = options;

    try {
      let whereClause = 'WHERE 1=1';
      const params = [];

      if (deviceDid) {
        whereClause += ' AND device_did = ?';
        params.push(deviceDid);
      }
      if (startTime) {
        whereClause += ' AND timestamp >= ?';
        params.push(startTime);
      }
      if (endTime) {
        whereClause += ' AND timestamp <= ?';
        params.push(endTime);
      }

      // 总数
      const { total } = this.database
        .prepare(`SELECT COUNT(*) as total FROM remote_command_logs ${whereClause}`)
        .get(...params);

      // 按状态统计
      const statusStats = this.database
        .prepare(`SELECT status, COUNT(*) as count FROM remote_command_logs ${whereClause} GROUP BY status`)
        .all(...params);

      // 按级别统计
      const levelStats = this.database
        .prepare(`SELECT level, COUNT(*) as count FROM remote_command_logs ${whereClause} GROUP BY level`)
        .all(...params);

      // 按命名空间统计
      const namespaceStats = this.database
        .prepare(`SELECT command_namespace, COUNT(*) as count FROM remote_command_logs ${whereClause} GROUP BY command_namespace`)
        .all(...params);

      // 平均执行时间
      const { avgDuration } = this.database
        .prepare(`SELECT AVG(duration) as avgDuration FROM remote_command_logs ${whereClause} AND duration IS NOT NULL`)
        .get(...params);

      return {
        total,
        byStatus: statusStats.reduce((acc, { status, count }) => {
          acc[status] = count;
          return acc;
        }, {}),
        byLevel: levelStats.reduce((acc, { level, count }) => {
          acc[level] = count;
          return acc;
        }, {}),
        byNamespace: namespaceStats.reduce((acc, { command_namespace, count }) => {
          acc[command_namespace] = count;
          return acc;
        }, {}),
        avgDuration: avgDuration || 0
      };
    } catch (error) {
      logger.error('[CommandLogger] 获取统计失败:', error);
      throw error;
    }
  }

  /**
   * 销毁
   */
  destroy() {
    this.stopAutoCleanup();
    this.removeAllListeners();
    logger.info('[CommandLogger] 命令日志记录器已销毁');
  }
}

// 导出
module.exports = {
  CommandLogger,
  LogLevel
};
