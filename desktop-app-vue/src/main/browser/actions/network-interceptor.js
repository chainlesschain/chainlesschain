/**
 * NetworkInterceptor - 网络请求拦截和控制
 *
 * 支持：
 * - 请求拦截和修改
 * - 响应模拟
 * - 网络条件模拟（3G/4G/5G）
 * - 请求监听和日志
 * - WebSocket 拦截
 *
 * @module browser/actions/network-interceptor
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require("events");

/**
 * 网络条件预设
 */
const NetworkCondition = {
  OFFLINE: {
    offline: true,
    downloadThroughput: 0,
    uploadThroughput: 0,
    latency: 0,
  },
  SLOW_2G: {
    offline: false,
    downloadThroughput: 50 * 1024,
    uploadThroughput: 20 * 1024,
    latency: 2000,
  },
  GOOD_2G: {
    offline: false,
    downloadThroughput: 250 * 1024,
    uploadThroughput: 50 * 1024,
    latency: 1500,
  },
  SLOW_3G: {
    offline: false,
    downloadThroughput: 500 * 1024,
    uploadThroughput: 100 * 1024,
    latency: 400,
  },
  FAST_3G: {
    offline: false,
    downloadThroughput: 1.5 * 1024 * 1024,
    uploadThroughput: 750 * 1024,
    latency: 300,
  },
  SLOW_4G: {
    offline: false,
    downloadThroughput: 4 * 1024 * 1024,
    uploadThroughput: 1 * 1024 * 1024,
    latency: 150,
  },
  FAST_4G: {
    offline: false,
    downloadThroughput: 20 * 1024 * 1024,
    uploadThroughput: 5 * 1024 * 1024,
    latency: 50,
  },
  WIFI: {
    offline: false,
    downloadThroughput: 50 * 1024 * 1024,
    uploadThroughput: 20 * 1024 * 1024,
    latency: 10,
  },
  NO_THROTTLE: {
    offline: false,
    downloadThroughput: -1,
    uploadThroughput: -1,
    latency: 0,
  },
};

/**
 * 请求拦截类型
 */
const InterceptType = {
  ABORT: "abort", // 终止请求
  CONTINUE: "continue", // 继续请求（可能修改）
  FULFILL: "fulfill", // 直接返回响应
  MOCK: "mock", // 返回模拟数据
};

class NetworkInterceptor extends EventEmitter {
  constructor(browserEngine) {
    super();
    this.engine = browserEngine;

    // 拦截规则
    this.interceptRules = new Map(); // ruleId => rule

    // 请求日志
    this.requestLog = [];
    this.maxLogSize = 1000;

    // 活跃的拦截器
    this.activeInterceptors = new Map(); // targetId => Set<ruleId>

    // 网络条件
    this.currentCondition = NetworkCondition.NO_THROTTLE;
  }

  /**
   * 获取页面对象
   * @private
   */
  _getPage(targetId) {
    return this.engine.getPage(targetId);
  }

  /**
   * 生成规则 ID
   * @private
   */
  _generateRuleId() {
    return `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 添加拦截规则
   * @param {Object} rule - 拦截规则
   * @param {string|RegExp} rule.urlPattern - URL 匹配模式
   * @param {string} rule.method - HTTP 方法（可选）
   * @param {string} rule.type - 拦截类型
   * @param {Object} rule.response - 模拟响应（type=fulfill/mock 时）
   * @param {Function} rule.handler - 自定义处理函数
   * @returns {string} 规则 ID
   */
  addRule(rule) {
    const ruleId = this._generateRuleId();

    // 规范化 URL 模式
    let urlMatcher;
    if (typeof rule.urlPattern === "string") {
      // 支持通配符
      const regexPattern = rule.urlPattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
      urlMatcher = new RegExp(regexPattern);
    } else if (rule.urlPattern instanceof RegExp) {
      urlMatcher = rule.urlPattern;
    } else {
      urlMatcher = /.*/;
    }

    this.interceptRules.set(ruleId, {
      ...rule,
      id: ruleId,
      urlMatcher,
      createdAt: Date.now(),
    });

    this.emit("ruleAdded", { ruleId, rule });

    return ruleId;
  }

  /**
   * 删除拦截规则
   * @param {string} ruleId - 规则 ID
   * @returns {boolean}
   */
  removeRule(ruleId) {
    const removed = this.interceptRules.delete(ruleId);
    if (removed) {
      this.emit("ruleRemoved", { ruleId });
    }
    return removed;
  }

  /**
   * 清除所有规则
   */
  clearRules() {
    this.interceptRules.clear();
    this.emit("rulesCleared");
  }

  /**
   * 在页面上启用拦截
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<void>}
   */
  async enableInterception(targetId) {
    const page = this._getPage(targetId);

    // 检查是否已启用
    if (this.activeInterceptors.has(targetId)) {
      return;
    }

    // 设置路由处理器
    await page.route("**/*", async (route, request) => {
      const url = request.url();
      const method = request.method();
      const resourceType = request.resourceType();

      // 记录请求
      const logEntry = {
        id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        targetId,
        url,
        method,
        resourceType,
        headers: request.headers(),
        timestamp: Date.now(),
      };
      this._addToLog(logEntry);

      // 查找匹配的规则
      let matchedRule = null;
      for (const rule of this.interceptRules.values()) {
        if (rule.urlMatcher.test(url)) {
          if (!rule.method || rule.method.toUpperCase() === method) {
            if (!rule.resourceType || rule.resourceType === resourceType) {
              matchedRule = rule;
              break;
            }
          }
        }
      }

      // 如果没有匹配规则，继续请求
      if (!matchedRule) {
        await route.continue();
        return;
      }

      this.emit("requestIntercepted", { ...logEntry, rule: matchedRule.id });

      try {
        switch (matchedRule.type) {
          case InterceptType.ABORT:
            await route.abort(matchedRule.errorCode || "failed");
            logEntry.intercepted = true;
            logEntry.action = "aborted";
            break;

          case InterceptType.FULFILL:
          case InterceptType.MOCK:
            await route.fulfill({
              status: matchedRule.response?.status || 200,
              headers: matchedRule.response?.headers || {},
              body: matchedRule.response?.body || "",
              contentType:
                matchedRule.response?.contentType || "application/json",
            });
            logEntry.intercepted = true;
            logEntry.action = "fulfilled";
            logEntry.mockResponse = true;
            break;

          case InterceptType.CONTINUE:
            if (matchedRule.handler) {
              // 自定义处理
              const modification = await matchedRule.handler(request);
              await route.continue(modification || {});
            } else {
              // 使用规则中的修改
              await route.continue({
                headers: matchedRule.modifyHeaders,
                postData: matchedRule.modifyBody,
              });
            }
            logEntry.intercepted = true;
            logEntry.action = "modified";
            break;

          default:
            await route.continue();
        }
      } catch (error) {
        this.emit("interceptError", { ...logEntry, error: error.message });
        await route.continue().catch(() => {});
      }
    });

    this.activeInterceptors.set(targetId, new Set());

    this.emit("interceptionEnabled", { targetId });
  }

  /**
   * 禁用页面拦截
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<void>}
   */
  async disableInterception(targetId) {
    const page = this._getPage(targetId);

    await page.unroute("**/*").catch(() => {});
    this.activeInterceptors.delete(targetId);

    this.emit("interceptionDisabled", { targetId });
  }

  /**
   * 添加请求到日志
   * @private
   */
  _addToLog(entry) {
    this.requestLog.push(entry);

    // 限制日志大小
    if (this.requestLog.length > this.maxLogSize) {
      this.requestLog.shift();
    }
  }

  /**
   * 获取请求日志
   * @param {Object} filter - 过滤选项
   * @returns {Array}
   */
  getRequestLog(filter = {}) {
    let log = [...this.requestLog];

    if (filter.targetId) {
      log = log.filter((entry) => entry.targetId === filter.targetId);
    }
    if (filter.method) {
      log = log.filter((entry) => entry.method === filter.method);
    }
    if (filter.urlPattern) {
      const regex = new RegExp(filter.urlPattern);
      log = log.filter((entry) => regex.test(entry.url));
    }
    if (filter.interceptedOnly) {
      log = log.filter((entry) => entry.intercepted);
    }
    if (filter.since) {
      log = log.filter((entry) => entry.timestamp >= filter.since);
    }
    if (filter.limit) {
      log = log.slice(-filter.limit);
    }

    return log;
  }

  /**
   * 清除请求日志
   * @param {string} targetId - 标签页 ID（可选）
   */
  clearRequestLog(targetId = null) {
    if (targetId) {
      this.requestLog = this.requestLog.filter(
        (entry) => entry.targetId !== targetId,
      );
    } else {
      this.requestLog = [];
    }
  }

  /**
   * 设置网络条件
   * @param {string} targetId - 标签页 ID
   * @param {Object|string} condition - 网络条件或预设名称
   * @returns {Promise<void>}
   */
  async setNetworkCondition(targetId, condition) {
    const page = this._getPage(targetId);
    const context = page.context();

    // 解析条件
    let networkCondition;
    if (typeof condition === "string") {
      networkCondition = NetworkCondition[condition.toUpperCase()];
      if (!networkCondition) {
        throw new Error(`Unknown network condition: ${condition}`);
      }
    } else {
      networkCondition = condition;
    }

    // 获取 CDP 会话
    const cdpSession = await context.newCDPSession(page);

    try {
      await cdpSession.send("Network.emulateNetworkConditions", {
        offline: networkCondition.offline || false,
        downloadThroughput: networkCondition.downloadThroughput,
        uploadThroughput: networkCondition.uploadThroughput,
        latency: networkCondition.latency,
      });

      this.currentCondition = networkCondition;

      this.emit("networkConditionChanged", {
        targetId,
        condition: networkCondition,
      });
    } finally {
      await cdpSession.detach().catch(() => {});
    }
  }

  /**
   * 重置网络条件
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<void>}
   */
  async resetNetworkCondition(targetId) {
    return this.setNetworkCondition(targetId, NetworkCondition.NO_THROTTLE);
  }

  /**
   * 阻止特定资源类型
   * @param {string} targetId - 标签页 ID
   * @param {Array<string>} resourceTypes - 资源类型列表
   * @returns {string} 规则 ID
   */
  blockResourceTypes(targetId, resourceTypes) {
    const ruleId = this.addRule({
      urlPattern: "**/*",
      type: InterceptType.ABORT,
      resourceType: resourceTypes,
      handler: (request) => {
        return resourceTypes.includes(request.resourceType());
      },
    });

    this.enableInterception(targetId).catch(() => {});

    return ruleId;
  }

  /**
   * 模拟 API 响应
   * @param {string} urlPattern - URL 模式
   * @param {Object} response - 响应配置
   * @returns {string} 规则 ID
   */
  mockAPI(urlPattern, response) {
    return this.addRule({
      urlPattern,
      type: InterceptType.MOCK,
      response: {
        status: response.status || 200,
        headers: response.headers || { "Content-Type": "application/json" },
        body:
          typeof response.body === "string"
            ? response.body
            : JSON.stringify(response.body),
        contentType: response.contentType || "application/json",
      },
    });
  }

  /**
   * 等待特定请求
   * @param {string} targetId - 标签页 ID
   * @param {string|RegExp} urlPattern - URL 模式
   * @param {Object} options - 等待选项
   * @returns {Promise<Object>}
   */
  async waitForRequest(targetId, urlPattern, options = {}) {
    const page = this._getPage(targetId);
    const timeout = options.timeout || 30000;

    const urlMatcher =
      typeof urlPattern === "string"
        ? (url) => url.includes(urlPattern)
        : (url) => urlPattern.test(url);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        page.off("request", handler);
        reject(new Error(`Timeout waiting for request: ${urlPattern}`));
      }, timeout);

      const handler = (request) => {
        if (urlMatcher(request.url())) {
          clearTimeout(timer);
          page.off("request", handler);
          resolve({
            url: request.url(),
            method: request.method(),
            headers: request.headers(),
            postData: request.postData(),
          });
        }
      };

      page.on("request", handler);
    });
  }

  /**
   * 等待特定响应
   * @param {string} targetId - 标签页 ID
   * @param {string|RegExp} urlPattern - URL 模式
   * @param {Object} options - 等待选项
   * @returns {Promise<Object>}
   */
  async waitForResponse(targetId, urlPattern, options = {}) {
    const page = this._getPage(targetId);
    const timeout = options.timeout || 30000;

    const urlMatcher =
      typeof urlPattern === "string"
        ? (url) => url.includes(urlPattern)
        : (url) => urlPattern.test(url);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        page.off("response", handler);
        reject(new Error(`Timeout waiting for response: ${urlPattern}`));
      }, timeout);

      const handler = async (response) => {
        if (urlMatcher(response.url())) {
          clearTimeout(timer);
          page.off("response", handler);

          let body = null;
          try {
            body = await response.text();
          } catch (e) {
            // 某些响应可能没有 body
          }

          resolve({
            url: response.url(),
            status: response.status(),
            headers: response.headers(),
            body,
          });
        }
      };

      page.on("response", handler);
    });
  }

  /**
   * 获取当前拦截状态
   * @returns {Object}
   */
  getStatus() {
    return {
      rulesCount: this.interceptRules.size,
      activeInterceptors: Array.from(this.activeInterceptors.keys()),
      logSize: this.requestLog.length,
      currentCondition: this.currentCondition,
    };
  }

  /**
   * 统一执行入口
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 操作选项
   * @returns {Promise<Object>}
   */
  async execute(targetId, options = {}) {
    const { action } = options;

    switch (action) {
      case "enable":
        await this.enableInterception(targetId);
        return { success: true, action: "enabled" };

      case "disable":
        await this.disableInterception(targetId);
        return { success: true, action: "disabled" };

      case "addRule": {
        const ruleId = this.addRule(options.rule);
        return { success: true, ruleId };
      }

      case "removeRule": {
        const removed = this.removeRule(options.ruleId);
        return { success: removed };
      }

      case "setCondition": {
        await this.setNetworkCondition(targetId, options.condition);
        return { success: true };
      }

      case "mockAPI": {
        const mockRuleId = this.mockAPI(options.urlPattern, options.response);
        return { success: true, ruleId: mockRuleId };
      }

      case "waitForRequest": {
        const request = await this.waitForRequest(
          targetId,
          options.urlPattern,
          options,
        );
        return { success: true, request };
      }

      case "waitForResponse": {
        const response = await this.waitForResponse(
          targetId,
          options.urlPattern,
          options,
        );
        return { success: true, response };
      }

      case "getLog": {
        const log = this.getRequestLog(options.filter || {});
        return { success: true, log };
      }

      case "getStatus":
        return { success: true, ...this.getStatus() };

      default:
        throw new Error(`Unknown network action: ${action}`);
    }
  }
}

module.exports = {
  NetworkInterceptor,
  NetworkCondition,
  InterceptType,
};
