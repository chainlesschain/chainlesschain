/**
 * 自动重试管理器
 *
 * 职责：
 * - 提供通用的重试机制
 * - 实现指数退避策略
 * - 支持自定义重试条件
 * - 记录重试历史和统计
 */

const { logger } = require('../utils/logger.js');

/**
 * 重试配置
 */
const DEFAULT_RETRY_CONFIG = {
  // 最大重试次数
  maxRetries: 3,

  // 初始延迟（毫秒）
  initialDelay: 1000,

  // 最大延迟（毫秒）
  maxDelay: 30000,

  // 退避倍数（指数退避）
  backoffMultiplier: 2,

  // 是否添加随机抖动（避免雷鸣群集）
  jitter: true,

  // 可重试的错误类型
  retryableErrors: [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'timeout',
    'network',
    'NetworkError',
  ],

  // 自定义重试条件函数
  shouldRetry: null,
};

/**
 * 重试管理器类
 */
class RetryManager {
  constructor(config = {}) {
    this.config = {
      ...DEFAULT_RETRY_CONFIG,
      ...config,
    };

    // 重试统计
    this.stats = {
      totalRetries: 0,
      successAfterRetry: 0,
      failedAfterRetry: 0,
      retriesByType: {},
    };

    logger.info('[RetryManager] 初始化完成', {
      maxRetries: this.config.maxRetries,
      initialDelay: this.config.initialDelay,
    });
  }

  /**
   * 执行带重试的异步操作
   *
   * @param {Function} fn - 要执行的异步函数
   * @param {Object} [options={}] - 重试选项（会覆盖默认配置）
   * @param {string} [options.operationName] - 操作名称（用于日志）
   * @param {number} [options.maxRetries] - 最大重试次数
   * @param {number} [options.initialDelay] - 初始延迟
   * @param {Function} [options.onRetry] - 重试回调函数
   *
   * @returns {Promise<*>} 操作结果
   *
   * @example
   * const result = await retryManager.execute(
   *   async () => await fetchData(),
   *   {
   *     operationName: 'fetchData',
   *     maxRetries: 5,
   *     onRetry: (attempt, error) => console.log(`重试第${attempt}次: ${error.message}`)
   *   }
   * );
   */
  async execute(fn, options = {}) {
    const operationName = options.operationName || 'unknown';
    const maxRetries = options.maxRetries ?? this.config.maxRetries;
    const onRetry = options.onRetry;

    let lastError;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        // 第一次尝试不延迟
        if (attempt > 0) {
          const delay = this.calculateDelay(attempt, options);
          logger.info(`[RetryManager] 等待 ${delay}ms 后重试`, {
            operation: operationName,
            attempt,
            maxRetries,
          });
          await this.sleep(delay);
        }

        // 执行操作
        const result = await fn();

        // 成功
        if (attempt > 0) {
          this.stats.successAfterRetry++;
          logger.info(`[RetryManager] 重试成功`, {
            operation: operationName,
            attempt,
          });
        }

        return result;
      } catch (error) {
        lastError = error;
        attempt++;

        // 检查是否应该重试
        const shouldRetry = this.shouldRetryError(error, attempt, maxRetries, options);

        if (!shouldRetry) {
          logger.warn(`[RetryManager] 不可重试的错误或达到最大重试次数`, {
            operation: operationName,
            attempt,
            error: error.message,
          });
          break;
        }

        // 记录重试
        this.stats.totalRetries++;
        this.recordRetryByType(operationName);

        logger.warn(`[RetryManager] 操作失败，准备重试`, {
          operation: operationName,
          attempt,
          maxRetries,
          error: error.message,
        });

        // 调用重试回调
        if (onRetry) {
          try {
            await onRetry(attempt, error);
          } catch (callbackError) {
            logger.error('[RetryManager] 重试回调失败:', callbackError);
          }
        }
      }
    }

    // 所有重试都失败
    this.stats.failedAfterRetry++;

    logger.error(`[RetryManager] 操作最终失败`, {
      operation: operationName,
      attempts: attempt,
      error: lastError.message,
    });

    throw lastError;
  }

  /**
   * 计算重试延迟（指数退避 + 可选抖动）
   *
   * @param {number} attempt - 当前重试次数
   * @param {Object} options - 选项
   * @returns {number} 延迟时间（毫秒）
   */
  calculateDelay(attempt, options = {}) {
    const initialDelay = options.initialDelay ?? this.config.initialDelay;
    const backoffMultiplier = options.backoffMultiplier ?? this.config.backoffMultiplier;
    const maxDelay = options.maxDelay ?? this.config.maxDelay;
    const jitter = options.jitter ?? this.config.jitter;

    // 指数退避: delay = initialDelay * (backoffMultiplier ^ (attempt - 1))
    let delay = initialDelay * Math.pow(backoffMultiplier, attempt - 1);

    // 限制最大延迟
    delay = Math.min(delay, maxDelay);

    // 添加随机抖动（±25%）
    if (jitter) {
      const jitterAmount = delay * 0.25;
      delay = delay + (Math.random() * 2 - 1) * jitterAmount;
    }

    return Math.floor(delay);
  }

  /**
   * 判断错误是否应该重试
   *
   * @param {Error} error - 错误对象
   * @param {number} attempt - 当前重试次数
   * @param {number} maxRetries - 最大重试次数
   * @param {Object} options - 选项
   * @returns {boolean} 是否应该重试
   */
  shouldRetryError(error, attempt, maxRetries, options = {}) {
    // 达到最大重试次数
    if (attempt > maxRetries) {
      return false;
    }

    // 自定义重试条件
    const customShouldRetry = options.shouldRetry ?? this.config.shouldRetry;
    if (customShouldRetry) {
      return customShouldRetry(error, attempt, maxRetries);
    }

    // 检查错误类型
    const retryableErrors = options.retryableErrors ?? this.config.retryableErrors;

    // 检查错误码
    if (error.code && retryableErrors.includes(error.code)) {
      return true;
    }

    // 检查错误消息
    const errorMessage = error.message.toLowerCase();
    return retryableErrors.some((keyword) =>
      errorMessage.includes(keyword.toLowerCase())
    );
  }

  /**
   * 记录按类型分类的重试次数
   *
   * @param {string} type - 操作类型
   */
  recordRetryByType(type) {
    if (!this.stats.retriesByType[type]) {
      this.stats.retriesByType[type] = 0;
    }
    this.stats.retriesByType[type]++;
  }

  /**
   * 睡眠指定时间
   *
   * @param {number} ms - 毫秒数
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 获取重试统计信息
   *
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      successRate:
        this.stats.successAfterRetry + this.stats.failedAfterRetry > 0
          ? (this.stats.successAfterRetry /
              (this.stats.successAfterRetry + this.stats.failedAfterRetry)) *
            100
          : 0,
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalRetries: 0,
      successAfterRetry: 0,
      failedAfterRetry: 0,
      retriesByType: {},
    };
    logger.info('[RetryManager] 统计信息已重置');
  }

  /**
   * 创建带重试的函数包装器
   *
   * @param {Function} fn - 要包装的函数
   * @param {Object} defaultOptions - 默认重试选项
   * @returns {Function} 包装后的函数
   *
   * @example
   * const fetchWithRetry = retryManager.wrap(
   *   async (url) => await fetch(url),
   *   { operationName: 'fetch', maxRetries: 5 }
   * );
   * const data = await fetchWithRetry('https://api.example.com/data');
   */
  wrap(fn, defaultOptions = {}) {
    return async (...args) => {
      return this.execute(() => fn(...args), defaultOptions);
    };
  }
}

/**
 * 重试策略预设
 */
const RETRY_STRATEGIES = {
  // 快速重试（短延迟，少次数）
  FAST: {
    maxRetries: 2,
    initialDelay: 500,
    maxDelay: 5000,
    backoffMultiplier: 2,
  },

  // 标准重试（中等延迟，中等次数）
  STANDARD: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
  },

  // 持久重试（长延迟，多次数）
  PERSISTENT: {
    maxRetries: 5,
    initialDelay: 2000,
    maxDelay: 60000,
    backoffMultiplier: 2,
  },

  // 激进重试（短延迟，多次数）
  AGGRESSIVE: {
    maxRetries: 10,
    initialDelay: 500,
    maxDelay: 10000,
    backoffMultiplier: 1.5,
  },
};

module.exports = {
  RetryManager,
  RETRY_STRATEGIES,
  DEFAULT_RETRY_CONFIG,
};
