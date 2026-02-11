/**
 * ErrorRecoveryManager - 错误恢复管理器
 *
 * 自动处理操作失败并尝试恢复：
 * - 重试策略（指数退避、固定间隔）
 * - 替代方案执行
 * - 页面刷新恢复
 * - 元素重新定位
 *
 * @module browser/actions/error-recovery-manager
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require("events");

/**
 * 错误类型
 */
const ErrorType = {
  ELEMENT_NOT_FOUND: "element_not_found",
  ELEMENT_NOT_VISIBLE: "element_not_visible",
  ELEMENT_NOT_CLICKABLE: "element_not_clickable",
  TIMEOUT: "timeout",
  NAVIGATION_FAILED: "navigation_failed",
  NETWORK_ERROR: "network_error",
  STALE_ELEMENT: "stale_element",
  FRAME_DETACHED: "frame_detached",
  PAGE_CRASHED: "page_crashed",
  PERMISSION_DENIED: "permission_denied",
  UNKNOWN: "unknown",
};

/**
 * 恢复策略
 */
const RecoveryStrategy = {
  RETRY: "retry", // 简单重试
  RETRY_WITH_DELAY: "retry_delay", // 延迟重试
  EXPONENTIAL_BACKOFF: "exponential", // 指数退避
  REFRESH_AND_RETRY: "refresh", // 刷新页面后重试
  RELOCATE_AND_RETRY: "relocate", // 重新定位元素后重试
  SCROLL_AND_RETRY: "scroll", // 滚动后重试
  WAIT_AND_RETRY: "wait", // 等待后重试
  ALTERNATIVE_ACTION: "alternative", // 尝试替代操作
  SKIP: "skip", // 跳过
  ABORT: "abort", // 中止
};

/**
 * 默认恢复策略配置
 */
const DEFAULT_STRATEGIES = {
  [ErrorType.ELEMENT_NOT_FOUND]: [
    RecoveryStrategy.WAIT_AND_RETRY,
    RecoveryStrategy.SCROLL_AND_RETRY,
    RecoveryStrategy.RELOCATE_AND_RETRY,
    RecoveryStrategy.REFRESH_AND_RETRY,
  ],
  [ErrorType.ELEMENT_NOT_VISIBLE]: [
    RecoveryStrategy.SCROLL_AND_RETRY,
    RecoveryStrategy.WAIT_AND_RETRY,
    RecoveryStrategy.RETRY_WITH_DELAY,
  ],
  [ErrorType.ELEMENT_NOT_CLICKABLE]: [
    RecoveryStrategy.WAIT_AND_RETRY,
    RecoveryStrategy.SCROLL_AND_RETRY,
    RecoveryStrategy.RETRY_WITH_DELAY,
  ],
  [ErrorType.TIMEOUT]: [
    RecoveryStrategy.RETRY_WITH_DELAY,
    RecoveryStrategy.EXPONENTIAL_BACKOFF,
    RecoveryStrategy.REFRESH_AND_RETRY,
  ],
  [ErrorType.NAVIGATION_FAILED]: [
    RecoveryStrategy.RETRY_WITH_DELAY,
    RecoveryStrategy.EXPONENTIAL_BACKOFF,
  ],
  [ErrorType.NETWORK_ERROR]: [
    RecoveryStrategy.EXPONENTIAL_BACKOFF,
    RecoveryStrategy.RETRY_WITH_DELAY,
  ],
  [ErrorType.STALE_ELEMENT]: [
    RecoveryStrategy.RELOCATE_AND_RETRY,
    RecoveryStrategy.REFRESH_AND_RETRY,
  ],
  [ErrorType.FRAME_DETACHED]: [RecoveryStrategy.REFRESH_AND_RETRY],
  [ErrorType.PAGE_CRASHED]: [RecoveryStrategy.REFRESH_AND_RETRY],
  [ErrorType.PERMISSION_DENIED]: [RecoveryStrategy.ABORT],
  [ErrorType.UNKNOWN]: [
    RecoveryStrategy.RETRY_WITH_DELAY,
    RecoveryStrategy.ABORT,
  ],
};

class ErrorRecoveryManager extends EventEmitter {
  constructor(browserEngine = null, config = {}) {
    super();

    this.browserEngine = browserEngine;
    this.config = {
      maxRetries: config.maxRetries || 3,
      baseDelay: config.baseDelay || 1000,
      maxDelay: config.maxDelay || 30000,
      exponentialBase: config.exponentialBase || 2,
      strategies: { ...DEFAULT_STRATEGIES, ...config.strategies },
      enableAutoRecovery: config.enableAutoRecovery !== false,
      screenshotOnError: config.screenshotOnError || false,
      logErrors: config.logErrors !== false,
      ...config,
    };

    // 恢复历史记录
    this.recoveryHistory = [];
    this.maxHistorySize = 100;

    // 统计
    this.stats = {
      totalErrors: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      byErrorType: {},
      byStrategy: {},
    };
  }

  /**
   * 设置浏览器引擎
   * @param {Object} browserEngine
   */
  setBrowserEngine(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * 包装操作，添加自动恢复
   * @param {Function} operation - 要执行的操作
   * @param {Object} context - 操作上下文
   * @returns {Function}
   */
  wrap(operation, context = {}) {
    const self = this;

    return async function (...args) {
      return self.executeWithRecovery(operation, args, context);
    };
  }

  /**
   * 执行操作并处理错误恢复
   * @param {Function} operation - 操作函数
   * @param {Array} args - 操作参数
   * @param {Object} context - 上下文
   * @returns {Promise<Object>}
   */
  async executeWithRecovery(operation, args = [], context = {}) {
    const startTime = Date.now();
    let lastError = null;
    let attempt = 0;
    const maxAttempts = context.maxRetries || this.config.maxRetries;

    while (attempt <= maxAttempts) {
      try {
        const result = await operation(...args);

        // 如果之前有错误但现在成功了，记录恢复成功
        if (attempt > 0) {
          this.stats.successfulRecoveries++;
          this.emit("recovered", {
            attempt,
            duration: Date.now() - startTime,
            context,
          });
        }

        return {
          success: true,
          result,
          attempts: attempt + 1,
          recovered: attempt > 0,
          duration: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error;
        this.stats.totalErrors++;

        const errorType = this._classifyError(error);
        this._updateErrorStats(errorType);

        this.emit("error", {
          type: errorType,
          error: error.message,
          attempt,
          context,
        });

        // 如果不启用自动恢复，直接抛出
        if (!this.config.enableAutoRecovery) {
          throw error;
        }

        // 获取恢复策略
        const strategies = this.config.strategies[errorType] || [
          RecoveryStrategy.RETRY,
        ];
        const strategyIndex = Math.min(attempt, strategies.length - 1);
        const strategy = strategies[strategyIndex];

        // 如果策略是中止，停止重试
        if (strategy === RecoveryStrategy.ABORT) {
          break;
        }

        // 如果策略是跳过，返回跳过结果
        if (strategy === RecoveryStrategy.SKIP) {
          return {
            success: false,
            skipped: true,
            error: error.message,
            errorType,
            attempts: attempt + 1,
          };
        }

        // 执行恢复策略
        try {
          await this._executeRecoveryStrategy(strategy, context, attempt);
          this._updateStrategyStats(strategy);
        } catch (recoveryError) {
          this.emit("recoveryFailed", {
            strategy,
            error: recoveryError.message,
          });
        }

        attempt++;
      }
    }

    // 所有恢复尝试都失败
    this.stats.failedRecoveries++;

    this._recordHistory({
      error: lastError?.message,
      errorType: this._classifyError(lastError),
      attempts: attempt,
      success: false,
      context,
      timestamp: Date.now(),
    });

    return {
      success: false,
      error: lastError?.message,
      errorType: this._classifyError(lastError),
      attempts: attempt,
      duration: Date.now() - startTime,
    };
  }

  /**
   * 分类错误
   * @private
   */
  _classifyError(error) {
    if (!error) {
      return ErrorType.UNKNOWN;
    }

    const message = error.message?.toLowerCase() || "";

    if (message.includes("not found") || message.includes("no element")) {
      return ErrorType.ELEMENT_NOT_FOUND;
    }
    if (message.includes("not visible") || message.includes("hidden")) {
      return ErrorType.ELEMENT_NOT_VISIBLE;
    }
    if (message.includes("not clickable") || message.includes("intercepted")) {
      return ErrorType.ELEMENT_NOT_CLICKABLE;
    }
    if (message.includes("timeout") || message.includes("timed out")) {
      return ErrorType.TIMEOUT;
    }
    if (message.includes("navigation") || message.includes("navigate")) {
      return ErrorType.NAVIGATION_FAILED;
    }
    if (
      message.includes("network") ||
      message.includes("connection") ||
      message.includes("fetch")
    ) {
      return ErrorType.NETWORK_ERROR;
    }
    if (message.includes("stale") || message.includes("detached")) {
      return ErrorType.STALE_ELEMENT;
    }
    if (message.includes("frame") && message.includes("detached")) {
      return ErrorType.FRAME_DETACHED;
    }
    if (message.includes("crash") || message.includes("target closed")) {
      return ErrorType.PAGE_CRASHED;
    }
    if (
      message.includes("permission") ||
      message.includes("denied") ||
      message.includes("forbidden")
    ) {
      return ErrorType.PERMISSION_DENIED;
    }

    return ErrorType.UNKNOWN;
  }

  /**
   * 执行恢复策略
   * @private
   */
  async _executeRecoveryStrategy(strategy, context, attempt) {
    const delay = this._calculateDelay(strategy, attempt);

    this.emit("recovering", {
      strategy,
      delay,
      attempt,
      context,
    });

    switch (strategy) {
      case RecoveryStrategy.RETRY:
        // 立即重试，无需特殊处理
        break;

      case RecoveryStrategy.RETRY_WITH_DELAY:
        await this._delay(delay);
        break;

      case RecoveryStrategy.EXPONENTIAL_BACKOFF: {
        const backoffDelay = Math.min(
          this.config.baseDelay *
            Math.pow(this.config.exponentialBase, attempt),
          this.config.maxDelay,
        );
        await this._delay(backoffDelay);
        break;
      }

      case RecoveryStrategy.WAIT_AND_RETRY:
        await this._delay(delay);
        // 可选：等待特定条件
        if (context.waitSelector && this.browserEngine) {
          const page = this.browserEngine.getPage(context.targetId);
          if (page) {
            await page
              .waitForSelector(context.waitSelector, {
                timeout: delay,
              })
              .catch(() => {});
          }
        }
        break;

      case RecoveryStrategy.SCROLL_AND_RETRY:
        if (this.browserEngine && context.targetId) {
          await this._scrollToElement(context);
        }
        await this._delay(500);
        break;

      case RecoveryStrategy.RELOCATE_AND_RETRY:
        // 清除元素缓存，强制重新定位
        if (context.clearCache) {
          context.clearCache();
        }
        await this._delay(500);
        break;

      case RecoveryStrategy.REFRESH_AND_RETRY:
        if (this.browserEngine && context.targetId) {
          const page = this.browserEngine.getPage(context.targetId);
          if (page) {
            await page.reload({ waitUntil: "networkidle" }).catch(() => {});
            await this._delay(1000);
          }
        }
        break;

      case RecoveryStrategy.ALTERNATIVE_ACTION:
        if (context.alternative) {
          await context.alternative();
        }
        break;

      default:
        await this._delay(delay);
    }
  }

  /**
   * 计算延迟时间
   * @private
   */
  _calculateDelay(strategy, attempt) {
    switch (strategy) {
      case RecoveryStrategy.EXPONENTIAL_BACKOFF:
        return Math.min(
          this.config.baseDelay *
            Math.pow(this.config.exponentialBase, attempt),
          this.config.maxDelay,
        );
      case RecoveryStrategy.RETRY_WITH_DELAY:
      case RecoveryStrategy.WAIT_AND_RETRY:
        return this.config.baseDelay * (attempt + 1);
      default:
        return this.config.baseDelay;
    }
  }

  /**
   * 延迟
   * @private
   */
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 滚动到元素
   * @private
   */
  async _scrollToElement(context) {
    const page = this.browserEngine.getPage(context.targetId);
    if (!page) {
      return;
    }

    if (context.selector) {
      await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, context.selector);
    } else if (context.y !== undefined) {
      await page.evaluate((y) => {
        window.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
      }, context.y);
    }
  }

  /**
   * 更新错误统计
   * @private
   */
  _updateErrorStats(errorType) {
    if (!this.stats.byErrorType[errorType]) {
      this.stats.byErrorType[errorType] = 0;
    }
    this.stats.byErrorType[errorType]++;
  }

  /**
   * 更新策略统计
   * @private
   */
  _updateStrategyStats(strategy) {
    if (!this.stats.byStrategy[strategy]) {
      this.stats.byStrategy[strategy] = 0;
    }
    this.stats.byStrategy[strategy]++;
  }

  /**
   * 记录历史
   * @private
   */
  _recordHistory(entry) {
    this.recoveryHistory.push(entry);

    if (this.recoveryHistory.length > this.maxHistorySize) {
      this.recoveryHistory = this.recoveryHistory.slice(
        -this.maxHistorySize / 2,
      );
    }
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      recoveryRate:
        this.stats.totalErrors > 0
          ? (
              (this.stats.successfulRecoveries / this.stats.totalErrors) *
              100
            ).toFixed(2) + "%"
          : "0%",
    };
  }

  /**
   * 获取恢复历史
   * @param {number} limit - 返回数量
   * @returns {Array}
   */
  getHistory(limit = 50) {
    return this.recoveryHistory.slice(-limit).reverse();
  }

  /**
   * 设置错误类型的恢复策略
   * @param {string} errorType - 错误类型
   * @param {Array} strategies - 策略列表
   */
  setStrategies(errorType, strategies) {
    this.config.strategies[errorType] = strategies;
  }

  /**
   * 重置统计和历史
   */
  reset() {
    this.stats = {
      totalErrors: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      byErrorType: {},
      byStrategy: {},
    };
    this.recoveryHistory = [];

    this.emit("reset");
  }

  /**
   * 手动触发恢复
   * @param {string} targetId - 标签页 ID
   * @param {string} strategy - 恢复策略
   * @param {Object} context - 上下文
   * @returns {Promise<Object>}
   */
  async manualRecover(targetId, strategy, context = {}) {
    try {
      await this._executeRecoveryStrategy(
        strategy,
        {
          ...context,
          targetId,
        },
        0,
      );

      return { success: true, strategy };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// 单例
let recoveryInstance = null;

function getErrorRecoveryManager(browserEngine, config) {
  if (!recoveryInstance) {
    recoveryInstance = new ErrorRecoveryManager(browserEngine, config);
  } else if (browserEngine) {
    recoveryInstance.setBrowserEngine(browserEngine);
  }
  return recoveryInstance;
}

module.exports = {
  ErrorRecoveryManager,
  ErrorType,
  RecoveryStrategy,
  getErrorRecoveryManager,
};
