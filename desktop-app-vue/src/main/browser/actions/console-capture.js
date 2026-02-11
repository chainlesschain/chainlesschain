/**
 * ConsoleCapture - 浏览器控制台捕获
 *
 * 捕获浏览器控制台输出：
 * - 日志/警告/错误
 * - 网络请求错误
 * - JavaScript 异常
 * - 性能警告
 *
 * @module browser/actions/console-capture
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require("events");

/**
 * 日志级别
 */
const LogLevel = {
  LOG: "log",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  DEBUG: "debug",
  TRACE: "trace",
};

/**
 * 日志来源
 */
const LogSource = {
  CONSOLE: "console",
  NETWORK: "network",
  JAVASCRIPT: "javascript",
  SECURITY: "security",
  PERFORMANCE: "performance",
  OTHER: "other",
};

class ConsoleCapture extends EventEmitter {
  /**
   * @param {Object} browserEngine - Browser engine instance
   * @param {Object} config - Configuration options
   */
  constructor(browserEngine = null, config = {}) {
    super();

    this.browserEngine = browserEngine;
    this.config = {
      maxLogs: config.maxLogs || 1000,
      captureConsole: config.captureConsole !== false,
      captureErrors: config.captureErrors !== false,
      captureNetwork: config.captureNetwork || false,
      filterLevels: config.filterLevels || null, // null = capture all
      includeTimestamp: config.includeTimestamp !== false,
      includeStackTrace: config.includeStackTrace !== false,
      ...config,
    };

    // 日志存储（按 targetId）
    this.logs = new Map();

    // 活动监听器
    this.listeners = new Map();

    // 错误计数
    this.errorCounts = new Map();

    // 统计
    this.stats = {
      totalLogs: 0,
      byLevel: {},
      bySource: {},
      errors: 0,
      warnings: 0,
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
   * 开始捕获
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>}
   */
  async startCapture(targetId) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    // 检查是否已在捕获
    if (this.listeners.has(targetId)) {
      return { success: true, message: "Already capturing" };
    }

    try {
      // 初始化日志存储
      this.logs.set(targetId, []);
      this.errorCounts.set(targetId, 0);

      const handlers = {};

      // 控制台消息监听
      if (this.config.captureConsole) {
        handlers.console = (msg) => {
          this._handleConsoleMessage(targetId, msg);
        };
        page.on("console", handlers.console);
      }

      // 页面错误监听
      if (this.config.captureErrors) {
        handlers.pageerror = (error) => {
          this._handlePageError(targetId, error);
        };
        page.on("pageerror", handlers.pageerror);
      }

      // 请求失败监听
      if (this.config.captureNetwork) {
        handlers.requestfailed = (request) => {
          this._handleRequestFailed(targetId, request);
        };
        page.on("requestfailed", handlers.requestfailed);
      }

      this.listeners.set(targetId, handlers);

      this.emit("captureStarted", { targetId });

      return { success: true };
    } catch (error) {
      this.emit("captureError", {
        action: "startCapture",
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * 停止捕获
   * @param {string} targetId - 标签页 ID
   * @returns {Object}
   */
  stopCapture(targetId) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    const handlers = this.listeners.get(targetId);

    if (!handlers) {
      return { success: true, message: "Not capturing" };
    }

    try {
      // 移除监听器
      if (page) {
        if (handlers.console) {
          page.off("console", handlers.console);
        }
        if (handlers.pageerror) {
          page.off("pageerror", handlers.pageerror);
        }
        if (handlers.requestfailed) {
          page.off("requestfailed", handlers.requestfailed);
        }
      }

      this.listeners.delete(targetId);

      this.emit("captureStopped", { targetId });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 处理控制台消息
   * @private
   */
  _handleConsoleMessage(targetId, msg) {
    const level = msg.type();

    // 检查级别过滤
    if (this.config.filterLevels && !this.config.filterLevels.includes(level)) {
      return;
    }

    const logEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      level,
      source: LogSource.CONSOLE,
      message: msg.text(),
      location: msg.location(),
      timestamp: this.config.includeTimestamp ? Date.now() : undefined,
      args: msg.args().map((arg) => arg.toString()),
    };

    this._addLog(targetId, logEntry);

    // 更新统计
    this._updateStats(logEntry);

    this.emit("log", { targetId, entry: logEntry });
  }

  /**
   * 处理页面错误
   * @private
   */
  _handlePageError(targetId, error) {
    const logEntry = {
      id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      level: LogLevel.ERROR,
      source: LogSource.JAVASCRIPT,
      message: error.message,
      stack: this.config.includeStackTrace ? error.stack : undefined,
      timestamp: this.config.includeTimestamp ? Date.now() : undefined,
    };

    this._addLog(targetId, logEntry);
    this._updateStats(logEntry);

    // 更新错误计数
    this.errorCounts.set(targetId, (this.errorCounts.get(targetId) || 0) + 1);

    this.emit("jsError", { targetId, entry: logEntry });
    this.emit("pageError", { targetId, error: logEntry });
  }

  /**
   * 处理请求失败
   * @private
   */
  _handleRequestFailed(targetId, request) {
    const failure = request.failure();

    const logEntry = {
      id: `net_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      level: LogLevel.ERROR,
      source: LogSource.NETWORK,
      message: `Request failed: ${request.url()}`,
      url: request.url(),
      method: request.method(),
      failureText: failure ? failure.errorText : "Unknown error",
      resourceType: request.resourceType(),
      timestamp: this.config.includeTimestamp ? Date.now() : undefined,
    };

    this._addLog(targetId, logEntry);
    this._updateStats(logEntry);

    this.emit("networkError", { targetId, entry: logEntry });
  }

  /**
   * 添加日志
   * @private
   */
  _addLog(targetId, entry) {
    const logs = this.logs.get(targetId) || [];
    logs.push(entry);

    // 限制日志数量
    if (logs.length > this.config.maxLogs) {
      logs.shift();
    }

    this.logs.set(targetId, logs);
  }

  /**
   * 更新统计
   * @private
   */
  _updateStats(entry) {
    this.stats.totalLogs++;

    if (!this.stats.byLevel[entry.level]) {
      this.stats.byLevel[entry.level] = 0;
    }
    this.stats.byLevel[entry.level]++;

    if (!this.stats.bySource[entry.source]) {
      this.stats.bySource[entry.source] = 0;
    }
    this.stats.bySource[entry.source]++;

    if (entry.level === LogLevel.ERROR) {
      this.stats.errors++;
    } else if (entry.level === LogLevel.WARN) {
      this.stats.warnings++;
    }
  }

  /**
   * 获取日志
   * @param {string} targetId - 标签页 ID
   * @param {Object} filter - 过滤条件
   * @returns {Array}
   */
  getLogs(targetId, filter = {}) {
    let logs = this.logs.get(targetId) || [];

    // 应用过滤
    if (filter.level) {
      logs = logs.filter((l) => l.level === filter.level);
    }

    if (filter.source) {
      logs = logs.filter((l) => l.source === filter.source);
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      logs = logs.filter((l) => l.message.toLowerCase().includes(searchLower));
    }

    if (filter.since) {
      logs = logs.filter((l) => l.timestamp >= filter.since);
    }

    if (filter.limit) {
      logs = logs.slice(-filter.limit);
    }

    return logs;
  }

  /**
   * 获取错误日志
   * @param {string} targetId - 标签页 ID
   * @param {number} limit - 限制数量
   * @returns {Array}
   */
  getErrors(targetId, limit = 50) {
    return this.getLogs(targetId, { level: LogLevel.ERROR, limit });
  }

  /**
   * 获取警告日志
   * @param {string} targetId - 标签页 ID
   * @param {number} limit - 限制数量
   * @returns {Array}
   */
  getWarnings(targetId, limit = 50) {
    return this.getLogs(targetId, { level: LogLevel.WARN, limit });
  }

  /**
   * 获取网络错误
   * @param {string} targetId - 标签页 ID
   * @param {number} limit - 限制数量
   * @returns {Array}
   */
  getNetworkErrors(targetId, limit = 50) {
    return this.getLogs(targetId, { source: LogSource.NETWORK, limit });
  }

  /**
   * 获取错误计数
   * @param {string} targetId - 标签页 ID
   * @returns {number}
   */
  getErrorCount(targetId) {
    return this.errorCounts.get(targetId) || 0;
  }

  /**
   * 清除日志
   * @param {string} targetId - 标签页 ID
   * @returns {Object}
   */
  clearLogs(targetId) {
    this.logs.set(targetId, []);
    this.errorCounts.set(targetId, 0);

    this.emit("logsCleared", { targetId });

    return { success: true };
  }

  /**
   * 清除所有日志
   * @returns {Object}
   */
  clearAllLogs() {
    this.logs.clear();
    this.errorCounts.clear();

    this.emit("allLogsCleared");

    return { success: true };
  }

  /**
   * 导出日志
   * @param {string} targetId - 标签页 ID
   * @param {string} format - 导出格式（json/text）
   * @returns {Object}
   */
  exportLogs(targetId, format = "json") {
    const logs = this.logs.get(targetId) || [];

    if (format === "json") {
      return {
        success: true,
        format: "json",
        data: JSON.stringify(logs, null, 2),
        count: logs.length,
      };
    }

    // Text format
    const text = logs
      .map((l) => {
        const time = l.timestamp ? new Date(l.timestamp).toISOString() : "";
        return `[${time}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`;
      })
      .join("\n");

    return {
      success: true,
      format: "text",
      data: text,
      count: logs.length,
    };
  }

  /**
   * 检查是否正在捕获
   * @param {string} targetId - 标签页 ID
   * @returns {boolean}
   */
  isCapturing(targetId) {
    return this.listeners.has(targetId);
  }

  /**
   * 获取统计
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      activeCaptures: this.listeners.size,
      totalStoredLogs: Array.from(this.logs.values()).reduce(
        (sum, arr) => sum + arr.length,
        0,
      ),
    };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalLogs: 0,
      byLevel: {},
      bySource: {},
      errors: 0,
      warnings: 0,
    };
    this.emit("statsReset");
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 停止所有捕获
    for (const targetId of this.listeners.keys()) {
      this.stopCapture(targetId);
    }

    this.logs.clear();
    this.errorCounts.clear();
  }
}

// 单例
let consoleCaptureInstance = null;

function getConsoleCapture(browserEngine, config) {
  if (!consoleCaptureInstance) {
    consoleCaptureInstance = new ConsoleCapture(browserEngine, config);
  } else if (browserEngine) {
    consoleCaptureInstance.setBrowserEngine(browserEngine);
  }
  return consoleCaptureInstance;
}

module.exports = {
  ConsoleCapture,
  LogLevel,
  LogSource,
  getConsoleCapture,
};
