/**
 * 网络请求拦截器
 * 拦截和管理应用的网络请求
 */

const { logger } = require("../utils/logger.js");
const { session } = require("electron");

class NetworkInterceptor {
  constructor(options = {}) {
    this.session = options.session || session.defaultSession;
    this.rules = [];
    this.requestLog = [];
    this.maxLogSize = options.maxLogSize || 1000;
    this.enableLogging = options.enableLogging !== false;
    this.enableCache = options.enableCache !== false;

    // 初始化
    this.init();
  }

  /**
   * 初始化拦截器
   */
  init() {
    // 设置请求拦截
    this.session.webRequest.onBeforeRequest((details, callback) => {
      this.handleBeforeRequest(details, callback);
    });

    // 设置响应头拦截
    this.session.webRequest.onHeadersReceived((details, callback) => {
      this.handleHeadersReceived(details, callback);
    });

    // 设置完成拦截
    this.session.webRequest.onCompleted((details) => {
      this.handleCompleted(details);
    });

    // 设置错误拦截
    this.session.webRequest.onErrorOccurred((details) => {
      this.handleError(details);
    });

    logger.info("[NetworkInterceptor] Initialized");
  }

  /**
   * 处理请求前
   */
  handleBeforeRequest(details, callback) {
    const { url, method, resourceType } = details;

    // 检查拦截规则
    for (const rule of this.rules) {
      if (this.matchRule(rule, details)) {
        if (rule.action === "block") {
          logger.info("[NetworkInterceptor] Blocked:", url);
          callback({ cancel: true });
          return;
        } else if (rule.action === "redirect" && rule.redirectURL) {
          logger.info(
            "[NetworkInterceptor] Redirected:",
            url,
            "->",
            rule.redirectURL,
          );
          callback({ redirectURL: rule.redirectURL });
          return;
        } else if (rule.action === "modify" && rule.modifier) {
          const modified = rule.modifier(details);
          callback(modified);
          return;
        }
      }
    }

    // 记录请求
    if (this.enableLogging) {
      this.logRequest({
        id: details.id,
        url,
        method,
        resourceType,
        timestamp: Date.now(),
        status: "pending",
      });
    }

    callback({});
  }

  /**
   * 处理响应头
   */
  handleHeadersReceived(details, callback) {
    const { url, responseHeaders, statusCode } = details;

    // 修改响应头
    const modifiedHeaders = { ...responseHeaders };

    // 添加CORS头（如果需要）
    if (this.enableCache) {
      modifiedHeaders["Access-Control-Allow-Origin"] = ["*"];
      modifiedHeaders["Access-Control-Allow-Methods"] = [
        "GET, POST, PUT, DELETE, OPTIONS",
      ];
      modifiedHeaders["Access-Control-Allow-Headers"] = ["*"];
    }

    callback({ responseHeaders: modifiedHeaders });
  }

  /**
   * 处理请求完成
   */
  handleCompleted(details) {
    const { id, url, statusCode, fromCache } = details;

    if (this.enableLogging) {
      this.updateRequestLog(id, {
        status: "completed",
        statusCode,
        fromCache,
        completedAt: Date.now(),
      });
    }

    logger.info("[NetworkInterceptor] Completed:", url, statusCode);
  }

  /**
   * 处理请求错误
   */
  handleError(details) {
    const { id, url, error } = details;

    if (this.enableLogging) {
      this.updateRequestLog(id, {
        status: "error",
        error,
        errorAt: Date.now(),
      });
    }

    logger.error("[NetworkInterceptor] Error:", url, error);
  }

  /**
   * 匹配规则
   */
  matchRule(rule, details) {
    const { url, method, resourceType } = details;

    // URL匹配
    if (rule.urlPattern) {
      const pattern = new RegExp(rule.urlPattern);
      if (!pattern.test(url)) {
        return false;
      }
    }

    // 方法匹配
    if (rule.methods && !rule.methods.includes(method)) {
      return false;
    }

    // 资源类型匹配
    if (rule.resourceTypes && !rule.resourceTypes.includes(resourceType)) {
      return false;
    }

    return true;
  }

  /**
   * 添加拦截规则
   */
  addRule(rule) {
    this.rules.push({
      id: rule.id || `rule-${Date.now()}`,
      urlPattern: rule.urlPattern,
      methods: rule.methods,
      resourceTypes: rule.resourceTypes,
      action: rule.action, // block, redirect, modify
      redirectURL: rule.redirectURL,
      modifier: rule.modifier,
      enabled: rule.enabled !== false,
    });

    logger.info("[NetworkInterceptor] Rule added:", rule.id);
  }

  /**
   * 移除拦截规则
   */
  removeRule(ruleId) {
    const index = this.rules.findIndex((r) => r.id === ruleId);
    if (index > -1) {
      this.rules.splice(index, 1);
      logger.info("[NetworkInterceptor] Rule removed:", ruleId);
      return true;
    }
    return false;
  }

  /**
   * 清空所有规则
   */
  clearRules() {
    this.rules = [];
    logger.info("[NetworkInterceptor] All rules cleared");
  }

  /**
   * 获取所有规则
   */
  getRules() {
    return this.rules;
  }

  /**
   * 记录请求
   */
  logRequest(request) {
    this.requestLog.unshift(request);

    // 限制日志大小
    if (this.requestLog.length > this.maxLogSize) {
      this.requestLog = this.requestLog.slice(0, this.maxLogSize);
    }
  }

  /**
   * 更新请求日志
   */
  updateRequestLog(id, updates) {
    const request = this.requestLog.find((r) => r.id === id);
    if (request) {
      Object.assign(request, updates);
    }
  }

  /**
   * 获取请求日志
   */
  getRequestLog(filter = {}) {
    let log = this.requestLog;

    if (filter.status) {
      log = log.filter((r) => r.status === filter.status);
    }

    if (filter.method) {
      log = log.filter((r) => r.method === filter.method);
    }

    if (filter.resourceType) {
      log = log.filter((r) => r.resourceType === filter.resourceType);
    }

    if (filter.limit) {
      log = log.slice(0, filter.limit);
    }

    return log;
  }

  /**
   * 清空请求日志
   */
  clearRequestLog() {
    this.requestLog = [];
    logger.info("[NetworkInterceptor] Request log cleared");
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    const stats = {
      total: this.requestLog.length,
      byStatus: {},
      byMethod: {},
      byResourceType: {},
    };

    for (const request of this.requestLog) {
      // 按状态统计
      stats.byStatus[request.status] =
        (stats.byStatus[request.status] || 0) + 1;

      // 按方法统计
      stats.byMethod[request.method] =
        (stats.byMethod[request.method] || 0) + 1;

      // 按资源类型统计
      stats.byResourceType[request.resourceType] =
        (stats.byResourceType[request.resourceType] || 0) + 1;
    }

    return stats;
  }

  /**
   * 设置缓存
   */
  setCache(enabled) {
    this.enableCache = enabled;
    logger.info(
      "[NetworkInterceptor] Cache:",
      enabled ? "enabled" : "disabled",
    );
  }

  /**
   * 清除缓存
   */
  async clearCache() {
    try {
      await this.session.clearCache();
      logger.info("[NetworkInterceptor] Cache cleared");
      return true;
    } catch (error) {
      logger.error("[NetworkInterceptor] Clear cache error:", error);
      return false;
    }
  }

  /**
   * 设置用户代理
   */
  setUserAgent(userAgent) {
    this.session.setUserAgent(userAgent);
    logger.info("[NetworkInterceptor] User agent set:", userAgent);
  }
}

// 创建全局实例
let networkInterceptor = null;

function getNetworkInterceptor(options) {
  if (!networkInterceptor) {
    networkInterceptor = new NetworkInterceptor(options);
  }
  return networkInterceptor;
}

module.exports = { NetworkInterceptor, getNetworkInterceptor };
