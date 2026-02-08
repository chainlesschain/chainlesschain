const { logger } = require("../utils/logger.js");

/**
 * 指数退避重试策略
 * 用于处理网络请求失败的重试逻辑
 */
class RetryPolicy {
  /**
   * @param {number} maxRetries - 最大重试次数（默认6次）
   * @param {number} baseDelay - 基础延迟时间（毫秒，默认100ms）
   * @param {number} maxDelay - 最大延迟时间（毫秒，默认30000ms = 30秒）
   * @param {number} jitterFactor - 抖动因子（0-1，默认0.3 = 30%随机抖动）
   */
  constructor(
    maxRetries = 6,
    baseDelay = 100,
    maxDelay = 30000,
    jitterFactor = 0.3,
  ) {
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
    this.jitterFactor = jitterFactor;

    // 统计信息
    this.stats = {
      totalAttempts: 0,
      successOnFirstTry: 0,
      successAfterRetry: 0,
      finalFailures: 0,
    };
  }

  /**
   * 执行带重试的异步操作
   * @param {Function} fn - 要执行的异步函数
   * @param {string} context - 上下文描述（用于日志）
   * @param {Object} options - 可选配置
   * @returns {Promise<any>} 操作结果
   */
  async executeWithRetry(fn, context = "操作", options = {}) {
    const {
      shouldRetry = this._defaultShouldRetry.bind(this),
      onRetry = null,
      onSuccess = null,
      onFinalFailure = null,
    } = options;

    let lastError;
    this.stats.totalAttempts++;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // 执行操作
        const result = await fn();

        // 成功
        if (attempt === 0) {
          this.stats.successOnFirstTry++;
        } else {
          this.stats.successAfterRetry++;
        }

        if (onSuccess) {
          onSuccess(attempt, result);
        }

        return result;
      } catch (error) {
        lastError = error;

        // 判断是否应该重试
        if (!shouldRetry(error, attempt)) {
          logger.error(
            `[RetryPolicy] ${context} 失败（不可重试）:`,
            error.message,
          );
          break;
        }

        // 已达最大重试次数
        if (attempt === this.maxRetries) {
          logger.error(
            `[RetryPolicy] ${context} 达到最大重试次数 (${this.maxRetries})`,
            error.message,
          );
          break;
        }

        // 计算延迟时间
        const delay = this._calculateDelay(attempt);

        logger.warn(
          `[RetryPolicy] ${context} 第${attempt + 1}次失败，${delay}ms后重试 ` +
            `(剩余重试: ${this.maxRetries - attempt})`,
          error.message,
        );

        // 回调
        if (onRetry) {
          onRetry(attempt, error, delay);
        }

        // 等待后重试
        await this._sleep(delay);
      }
    }

    // 最终失败
    this.stats.finalFailures++;

    if (onFinalFailure) {
      onFinalFailure(lastError, this.maxRetries);
    }

    throw new Error(
      `${context} 失败，已重试${this.maxRetries}次: ${lastError.message}`,
    );
  }

  /**
   * 计算延迟时间（指数退避 + 随机抖动）
   * @param {number} attempt - 当前重试次数（从0开始）
   * @returns {number} 延迟时间（毫秒）
   */
  _calculateDelay(attempt) {
    // 指数退避: baseDelay * 2^attempt
    // 例: 100, 200, 400, 800, 1600, 3200 ms
    let delay = this.baseDelay * Math.pow(2, attempt);

    // 限制最大延迟
    delay = Math.min(delay, this.maxDelay);

    // 添加随机抖动（避免雷鸣羊群效应）
    // 例: 30%抖动意味着 ±30% 的随机变化
    if (this.jitterFactor > 0) {
      const jitter = delay * this.jitterFactor * (Math.random() * 2 - 1);
      delay = delay + jitter;
    }

    return Math.round(delay);
  }

  /**
   * 默认的重试判断逻辑
   * @param {Error} error - 错误对象
   * @param {number} attempt - 当前重试次数
   * @returns {boolean} 是否应该重试
   */
  _defaultShouldRetry(error, attempt) {
    // 不可重试的错误类型
    const nonRetryableErrors = [
      "权限不足",
      "未授权",
      "请求参数错误",
      "资源不存在",
      "数据冲突", // 冲突应该由用户解决，不应重试
    ];

    const errorMessage = error.message || "";

    // 检查是否包含不可重试的错误消息
    for (const nonRetryable of nonRetryableErrors) {
      if (errorMessage.includes(nonRetryable)) {
        return false;
      }
    }

    // 网络错误、超时、服务器错误都可以重试
    return true;
  }

  /**
   * 休眠指定毫秒数
   * @param {number} ms - 毫秒数
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计数据
   */
  getStats() {
    return {
      ...this.stats,
      successRate:
        this.stats.totalAttempts > 0
          ? (
              ((this.stats.successOnFirstTry + this.stats.successAfterRetry) /
                this.stats.totalAttempts) *
              100
            ).toFixed(2) + "%"
          : "0%",
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalAttempts: 0,
      successOnFirstTry: 0,
      successAfterRetry: 0,
      finalFailures: 0,
    };
  }

  /**
   * 创建一个简化的重试函数（快捷方式）
   * @param {Function} fn - 要执行的异步函数
   * @param {string} context - 上下文描述
   * @returns {Promise<any>}
   */
  async retry(fn, context) {
    return this.executeWithRetry(fn, context);
  }
}

module.exports = RetryPolicy;
