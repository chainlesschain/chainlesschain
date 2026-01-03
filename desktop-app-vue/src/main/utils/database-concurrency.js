/**
 * 数据库并发控制工具
 * 处理并发写入冲突、死锁和重试逻辑
 */

const { EventEmitter } = require('events');

/**
 * 并发控制配置
 */
const DEFAULT_CONFIG = {
  // 重试配置
  maxRetries: 5,
  baseDelay: 100, // 基础延迟（毫秒）
  maxDelay: 5000, // 最大延迟
  exponentialBackoff: true, // 指数退避
  jitter: true, // 添加随机抖动

  // 锁超时配置
  lockTimeout: 30000, // 30秒锁超时

  // 并发队列配置
  maxConcurrentWrites: 1, // SQLite WAL模式下可以适当增加
};

/**
 * 错误类型
 */
const ERROR_TYPES = {
  BUSY: 'SQLITE_BUSY',
  LOCKED: 'SQLITE_LOCKED',
  CONSTRAINT: 'SQLITE_CONSTRAINT',
  CORRUPT: 'SQLITE_CORRUPT',
  NOSPC: 'ENOSPC'
};

/**
 * 并发控制器
 */
class DatabaseConcurrencyController extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.writeQueue = [];
    this.activeWrites = 0;
    this.statistics = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      retriedOperations: 0,
      totalRetries: 0,
      lockTimeouts: 0,
      busyErrors: 0,
      constraintViolations: 0
    };
  }

  /**
   * 执行数据库操作（带重试）
   * @param {Function} operation - 数据库操作函数
   * @param {Object} options - 选项
   * @returns {Promise<any>} 操作结果
   */
  async executeWithRetry(operation, options = {}) {
    const {
      maxRetries = this.config.maxRetries,
      onRetry = null,
      operationName = 'database operation'
    } = options;

    this.statistics.totalOperations++;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        this.statistics.successfulOperations++;

        if (attempt > 0) {
          this.statistics.retriedOperations++;
          console.log(`[Concurrency] ${operationName} 成功（第 ${attempt + 1} 次尝试）`);
        }

        return result;
      } catch (error) {
        lastError = error;

        // 分析错误类型
        const errorType = this._identifyErrorType(error);

        // 记录统计
        this._recordErrorStatistics(errorType);

        // 检查是否应该重试
        if (!this._shouldRetry(errorType, attempt, maxRetries)) {
          console.error(`[Concurrency] ${operationName} 失败，不再重试:`, error);
          this.statistics.failedOperations++;
          throw error;
        }

        // 计算延迟时间
        const delay = this._calculateRetryDelay(attempt);

        console.warn(
          `[Concurrency] ${operationName} 遇到 ${errorType} 错误，` +
          `${delay}ms 后重试 (${attempt + 1}/${maxRetries})`
        );

        // 触发重试事件
        this.emit('retry', {
          operationName,
          attempt,
          maxRetries,
          errorType,
          delay
        });

        // 调用重试回调
        if (onRetry) {
          await onRetry(attempt, errorType, delay);
        }

        this.statistics.totalRetries++;

        // 等待后重试
        await this._sleep(delay);
      }
    }

    this.statistics.failedOperations++;
    throw lastError;
  }

  /**
   * 执行事务（带重试和冲突处理）
   * @param {Object} db - 数据库实例
   * @param {Function} callback - 事务回调
   * @param {Object} options - 选项
   */
  async executeTransaction(db, callback, options = {}) {
    return this.executeWithRetry(
      async () => {
        return new Promise((resolve, reject) => {
          try {
            db.transaction(() => {
              try {
                const result = callback();
                resolve(result);
              } catch (error) {
                reject(error);
              }
            });
          } catch (error) {
            reject(error);
          }
        });
      },
      {
        ...options,
        operationName: options.operationName || 'transaction'
      }
    );
  }

  /**
   * 队列化写入操作
   * @param {Function} writeOperation - 写入操作
   * @param {Object} options - 选项
   */
  async queueWrite(writeOperation, options = {}) {
    return new Promise((resolve, reject) => {
      this.writeQueue.push({
        operation: writeOperation,
        options,
        resolve,
        reject
      });

      this._processQueue();
    });
  }

  /**
   * 处理写入队列
   */
  async _processQueue() {
    if (this.activeWrites >= this.config.maxConcurrentWrites || this.writeQueue.length === 0) {
      return;
    }

    this.activeWrites++;
    const { operation, options, resolve, reject } = this.writeQueue.shift();

    try {
      const result = await this.executeWithRetry(operation, options);
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.activeWrites--;
      this._processQueue(); // 处理下一个
    }
  }

  /**
   * 识别错误类型
   * @param {Error} error - 错误对象
   * @returns {string} 错误类型
   */
  _identifyErrorType(error) {
    const message = error.message || '';
    const code = error.code || '';

    if (message.includes('BUSY') || message.includes('database is locked') || code === 'SQLITE_BUSY') {
      return ERROR_TYPES.BUSY;
    }

    if (message.includes('LOCKED') || code === 'SQLITE_LOCKED') {
      return ERROR_TYPES.LOCKED;
    }

    if (message.includes('CONSTRAINT') || code === 'SQLITE_CONSTRAINT') {
      return ERROR_TYPES.CONSTRAINT;
    }

    if (message.includes('CORRUPT') || code === 'SQLITE_CORRUPT') {
      return ERROR_TYPES.CORRUPT;
    }

    if (code === 'ENOSPC') {
      return ERROR_TYPES.NOSPC;
    }

    return 'UNKNOWN';
  }

  /**
   * 记录错误统计
   */
  _recordErrorStatistics(errorType) {
    switch (errorType) {
      case ERROR_TYPES.BUSY:
      case ERROR_TYPES.LOCKED:
        this.statistics.busyErrors++;
        break;
      case ERROR_TYPES.CONSTRAINT:
        this.statistics.constraintViolations++;
        break;
    }
  }

  /**
   * 判断是否应该重试
   * @param {string} errorType - 错误类型
   * @param {number} attempt - 当前尝试次数
   * @param {number} maxRetries - 最大重试次数
   * @returns {boolean}
   */
  _shouldRetry(errorType, attempt, maxRetries) {
    if (attempt >= maxRetries) {
      return false;
    }

    // 可重试的错误类型
    const retryableErrors = [
      ERROR_TYPES.BUSY,
      ERROR_TYPES.LOCKED
    ];

    return retryableErrors.includes(errorType);
  }

  /**
   * 计算重试延迟
   * @param {number} attempt - 尝试次数
   * @returns {number} 延迟时间（毫秒）
   */
  _calculateRetryDelay(attempt) {
    let delay;

    if (this.config.exponentialBackoff) {
      // 指数退避：baseDelay * 2^attempt
      delay = Math.min(
        this.config.baseDelay * Math.pow(2, attempt),
        this.config.maxDelay
      );
    } else {
      // 线性延迟
      delay = Math.min(
        this.config.baseDelay * (attempt + 1),
        this.config.maxDelay
      );
    }

    // 添加随机抖动（0-25%）
    if (this.config.jitter) {
      const jitter = delay * 0.25 * Math.random();
      delay += jitter;
    }

    return Math.floor(delay);
  }

  /**
   * 睡眠函数
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return {
      ...this.statistics,
      queueLength: this.writeQueue.length,
      activeWrites: this.activeWrites,
      successRate: this.statistics.totalOperations > 0
        ? (this.statistics.successfulOperations / this.statistics.totalOperations * 100).toFixed(2) + '%'
        : 'N/A',
      averageRetries: this.statistics.retriedOperations > 0
        ? (this.statistics.totalRetries / this.statistics.retriedOperations).toFixed(2)
        : 0
    };
  }

  /**
   * 重置统计信息
   */
  resetStatistics() {
    this.statistics = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      retriedOperations: 0,
      totalRetries: 0,
      lockTimeouts: 0,
      busyErrors: 0,
      constraintViolations: 0
    };
  }
}

/**
 * 全局实例
 */
let globalController = null;

/**
 * 获取全局并发控制器
 */
function getConcurrencyController(config) {
  if (!globalController) {
    globalController = new DatabaseConcurrencyController(config);
  }
  return globalController;
}

/**
 * 便捷函数：执行带重试的操作
 */
async function withRetry(operation, options = {}) {
  const controller = getConcurrencyController();
  return controller.executeWithRetry(operation, options);
}

/**
 * 便捷函数：队列化写入
 */
async function queueWrite(operation, options = {}) {
  const controller = getConcurrencyController();
  return controller.queueWrite(operation, options);
}

module.exports = {
  DatabaseConcurrencyController,
  getConcurrencyController,
  withRetry,
  queueWrite,
  ERROR_TYPES
};
