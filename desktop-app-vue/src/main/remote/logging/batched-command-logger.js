/**
 * 批处理命令日志记录器（性能优化版）
 *
 * 性能优化：
 * - 批量写入日志（减少数据库 I/O）
 * - 异步处理（不阻塞主线程）
 * - 内存缓冲（临时存储待写入日志）
 *
 * @module remote/logging/batched-command-logger
 */

const { logger } = require('../../utils/logger');
const EventEmitter = require('events');
const { getConfig } = require('./performance-config');

/**
 * 批处理命令日志记录器类
 */
class BatchedCommandLogger extends EventEmitter {
  constructor(database, options = {}) {
    super();

    this.database = database;

    // 配置
    this.config = {
      batchSize: getConfig('logging.batchSize', 50),
      batchInterval: getConfig('logging.batchInterval', 1000),
      maxBatchWait: getConfig('logging.maxBatchWait', 5000),
      maxLogAge: getConfig('logging.maxLogAge', 30 * 24 * 60 * 60 * 1000),
      maxLogCount: getConfig('logging.maxLogCount', 100000),
      autoCleanupInterval: getConfig('logging.autoCleanupInterval', 24 * 60 * 60 * 1000),
      enableAutoCleanup: getConfig('logging.enableAutoCleanup', true),
      ...options
    };

    // 批处理缓冲区
    this.logBuffer = [];
    this.bufferLock = false;

    // 批处理定时器
    this.batchTimer = null;

    // 性能统计
    this.stats = {
      totalLogs: 0,
      batchedWrites: 0,
      singleWrites: 0,
      avgBatchSize: 0,
      maxBufferSize: 0
    };

    // 准备语句（预编译 SQL，提升性能）
    this.insertStmt = null;

    // 初始化
    this.initializeDatabase();
    this.prepareStatements();
    this.startBatchProcessing();

    // 启动自动清理
    if (this.config.enableAutoCleanup) {
      this.startAutoCleanup();
    }

    logger.info('[BatchedCommandLogger] 批处理日志记录器已初始化', {
      batchSize: this.config.batchSize,
      batchInterval: this.config.batchInterval
    });
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

      logger.info('[BatchedCommandLogger] 数据库表已初始化');
    } catch (error) {
      logger.error('[BatchedCommandLogger] 初始化数据库表失败:', error);
      throw error;
    }
  }

  /**
   * 预编译 SQL 语句（性能优化）
   */
  prepareStatements() {
    try {
      this.insertStmt = this.database.prepare(`
        INSERT INTO remote_command_logs (
          request_id, device_did, device_name,
          command_namespace, command_action,
          params, result, error,
          status, level, duration,
          timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      logger.info('[BatchedCommandLogger] SQL 语句已预编译');
    } catch (error) {
      logger.error('[BatchedCommandLogger] 预编译 SQL 失败:', error);
      throw error;
    }
  }

  /**
   * 记录命令日志（添加到缓冲区）
   * @param {Object} logEntry - 日志条目
   */
  log(logEntry) {
    // 验证必要字段
    if (!logEntry.requestId || !logEntry.deviceDid || !logEntry.namespace || !logEntry.action) {
      throw new Error('Missing required fields in log entry');
    }

    // 标准化日志条目
    const normalizedEntry = {
      requestId: logEntry.requestId,
      deviceDid: logEntry.deviceDid,
      deviceName: logEntry.deviceName || null,
      namespace: logEntry.namespace,
      action: logEntry.action,
      params: typeof logEntry.params === 'object' ? JSON.stringify(logEntry.params) : logEntry.params,
      result: typeof logEntry.result === 'object' ? JSON.stringify(logEntry.result) : logEntry.result,
      error: logEntry.error || null,
      status: logEntry.status || 'success',
      level: logEntry.level || 'info',
      duration: logEntry.duration || 0,
      timestamp: logEntry.timestamp || Date.now(),
      createdAt: Date.now()
    };

    // 添加到缓冲区
    this.logBuffer.push(normalizedEntry);
    this.stats.totalLogs++;

    // 更新最大缓冲区大小统计
    if (this.logBuffer.length > this.stats.maxBufferSize) {
      this.stats.maxBufferSize = this.logBuffer.length;
    }

    // 触发事件
    this.emit('log', normalizedEntry);

    // 如果缓冲区已满，立即刷新
    if (this.logBuffer.length >= this.config.batchSize) {
      this.flushBuffer();
    }

    return normalizedEntry;
  }

  /**
   * 启动批处理定时器
   */
  startBatchProcessing() {
    this.batchTimer = setInterval(() => {
      if (this.logBuffer.length > 0) {
        this.flushBuffer();
      }
    }, this.config.batchInterval);

    logger.info('[BatchedCommandLogger] 批处理定时器已启动');
  }

  /**
   * 刷新缓冲区（批量写入数据库）
   */
  async flushBuffer() {
    // 防止并发刷新
    if (this.bufferLock || this.logBuffer.length === 0) {
      return;
    }

    this.bufferLock = true;

    try {
      // 取出待写入的日志
      const logsToWrite = this.logBuffer.splice(0, this.config.batchSize);
      const batchSize = logsToWrite.length;

      // 使用事务批量写入
      const insertMany = this.database.transaction((logs) => {
        for (const log of logs) {
          this.insertStmt.run(
            log.requestId,
            log.deviceDid,
            log.deviceName,
            log.namespace,
            log.action,
            log.params,
            log.result,
            log.error,
            log.status,
            log.level,
            log.duration,
            log.timestamp,
            log.createdAt
          );
        }
      });

      insertMany(logsToWrite);

      // 更新统计
      this.stats.batchedWrites++;
      this.stats.avgBatchSize = (
        (this.stats.avgBatchSize * (this.stats.batchedWrites - 1) + batchSize) /
        this.stats.batchedWrites
      );

      // 触发刷新事件
      this.emit('flush', {
        count: batchSize,
        remaining: this.logBuffer.length
      });

      logger.debug('[BatchedCommandLogger] 批量写入日志成功', {
        batchSize,
        remaining: this.logBuffer.length
      });
    } catch (error) {
      logger.error('[BatchedCommandLogger] 批量写入日志失败:', error);
      this.emit('error', error);
    } finally {
      this.bufferLock = false;
    }
  }

  /**
   * 强制刷新所有缓冲日志
   */
  async forceFlush() {
    while (this.logBuffer.length > 0) {
      await this.flushBuffer();
      // 等待缓冲区解锁
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * 查询命令日志
   * @param {Object} options - 查询选项
   * @returns {Object} 查询结果
   */
  query(options = {}) {
    const {
      page = 1,
      pageSize = 20,
      namespace,
      status,
      level,
      deviceDid,
      search,
      startTime,
      endTime,
      sortBy = 'timestamp',
      sortOrder = 'DESC'
    } = options;

    try {
      // 构建 WHERE 子句
      const conditions = [];
      const params = [];

      if (namespace) {
        conditions.push('command_namespace = ?');
        params.push(namespace);
      }

      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }

      if (level) {
        conditions.push('level = ?');
        params.push(level);
      }

      if (deviceDid) {
        conditions.push('device_did = ?');
        params.push(deviceDid);
      }

      if (search) {
        conditions.push('(command_action LIKE ? OR device_did LIKE ? OR error LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (startTime) {
        conditions.push('timestamp >= ?');
        params.push(startTime);
      }

      if (endTime) {
        conditions.push('timestamp <= ?');
        params.push(endTime);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // 查询总数
      const countSql = `SELECT COUNT(*) as total FROM remote_command_logs ${whereClause}`;
      const countStmt = this.database.prepare(countSql);
      const { total } = countStmt.get(...params);

      // 查询数据
      const offset = (page - 1) * pageSize;
      const dataSql = `
        SELECT * FROM remote_command_logs
        ${whereClause}
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT ? OFFSET ?
      `;
      const dataStmt = this.database.prepare(dataSql);
      const logs = dataStmt.all(...params, pageSize, offset);

      // 解析 JSON 字段
      const parsedLogs = logs.map((log) => ({
        ...log,
        params: log.params ? JSON.parse(log.params) : null,
        result: log.result ? JSON.parse(log.result) : null
      }));

      return {
        logs: parsedLogs,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      };
    } catch (error) {
      logger.error('[BatchedCommandLogger] 查询日志失败:', error);
      throw error;
    }
  }

  /**
   * 获取性能统计
   * @returns {Object} 性能统计
   */
  getPerformanceStats() {
    return {
      ...this.stats,
      bufferSize: this.logBuffer.length,
      isBufferLocked: this.bufferLock
    };
  }

  /**
   * 启动自动清理
   */
  startAutoCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.autoCleanupInterval);

    logger.info('[BatchedCommandLogger] 自动清理已启动');
  }

  /**
   * 清理旧日志
   */
  cleanup() {
    try {
      const cutoffTime = Date.now() - this.config.maxLogAge;

      // 删除过期日志
      const deleteStmt = this.database.prepare('DELETE FROM remote_command_logs WHERE timestamp < ?');
      const result1 = deleteStmt.run(cutoffTime);

      // 如果超过最大数量，删除最旧的
      const countStmt = this.database.prepare('SELECT COUNT(*) as total FROM remote_command_logs');
      const { total } = countStmt.get();

      if (total > this.config.maxLogCount) {
        const deleteOldestStmt = this.database.prepare(`
          DELETE FROM remote_command_logs
          WHERE id IN (
            SELECT id FROM remote_command_logs
            ORDER BY timestamp ASC
            LIMIT ?
          )
        `);
        const result2 = deleteOldestStmt.run(total - this.config.maxLogCount);

        logger.info('[BatchedCommandLogger] 清理完成', {
          deletedByAge: result1.changes,
          deletedByCount: result2.changes
        });
      } else {
        logger.info('[BatchedCommandLogger] 清理完成', {
          deletedByAge: result1.changes
        });
      }

      this.emit('cleanup', {
        deletedByAge: result1.changes,
        currentTotal: total
      });
    } catch (error) {
      logger.error('[BatchedCommandLogger] 清理失败:', error);
    }
  }

  /**
   * 关闭日志记录器
   */
  async close() {
    // 停止定时器
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // 刷新剩余日志
    await this.forceFlush();

    logger.info('[BatchedCommandLogger] 日志记录器已关闭', {
      stats: this.stats
    });
  }
}

module.exports = BatchedCommandLogger;
