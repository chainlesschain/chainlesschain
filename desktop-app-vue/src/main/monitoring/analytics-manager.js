/**
 * 应用统计分析器
 * 收集和分析应用使用数据
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs");
const path = require("path");

const KIB = 1024;
const MIB = 1024 * KIB;

const DEFAULT_ANALYTICS_LIMITS = Object.freeze({
  maxSessions: 100,
  maxSessionEvents: 500,
  maxSessionEventBytes: 512 * KIB,
  maxSessionHistoryBytes: 2 * MIB,
  maxFeatures: 256,
  maxErrors: 50,
  maxPerformanceEntries: 100,
  maxTextChars: 1024,
  maxContextBytes: 16 * KIB,
  maxPersistenceBytes: 4 * MIB,
});

const HARD_ANALYTICS_LIMITS = Object.freeze({
  maxSessions: 1000,
  maxSessionEvents: 5000,
  maxSessionEventBytes: 4 * MIB,
  maxSessionHistoryBytes: 16 * MIB,
  maxFeatures: 2048,
  maxErrors: 500,
  maxPerformanceEntries: 1000,
  maxTextChars: 8192,
  maxContextBytes: 256 * KIB,
  maxPersistenceBytes: 32 * MIB,
});

function normalizeLimit(value, fallback, hardLimit) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function createAnalyticsLimits(options = {}) {
  const limits = {};
  for (const [key, fallback] of Object.entries(DEFAULT_ANALYTICS_LIMITS)) {
    limits[key] = normalizeLimit(
      options[key],
      fallback,
      HARD_ANALYTICS_LIMITS[key],
    );
  }
  limits.maxSessionEventBytes = Math.min(
    limits.maxSessionEventBytes,
    limits.maxSessionHistoryBytes,
  );
  limits.maxSessionHistoryBytes = Math.min(
    limits.maxSessionHistoryBytes,
    limits.maxPersistenceBytes,
  );
  limits.maxContextBytes = Math.min(
    limits.maxContextBytes,
    limits.maxPersistenceBytes,
  );
  return Object.freeze(limits);
}

function createEmptyAnalyticsData() {
  return {
    sessions: [],
    features: {},
    errors: [],
    performance: [],
  };
}

function boundedText(value, maxChars) {
  return String(value ?? "").slice(0, maxChars);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function serializedBytes(value) {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string"
      ? Buffer.byteLength(serialized, "utf8")
      : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function cloneBoundedJson(value, maxBytes) {
  try {
    const serialized = JSON.stringify(value ?? {});
    if (
      typeof serialized !== "string" ||
      Buffer.byteLength(serialized, "utf8") > maxBytes
    ) {
      return { dropped: true, reason: "PAYLOAD_TOO_LARGE" };
    }
    const clone = JSON.parse(serialized);
    return clone && typeof clone === "object" ? clone : {};
  } catch {
    return { dropped: true, reason: "PAYLOAD_NOT_SERIALIZABLE" };
  }
}

function retainNewestByBytes(items, maxCount, maxBytes) {
  const retained = [];
  let retainedBytes = 0;
  for (
    let index = items.length - 1;
    index >= 0 && retained.length < maxCount;
    index -= 1
  ) {
    const item = items[index];
    const itemBytes = serializedBytes(item);
    if (!Number.isFinite(itemBytes) || itemBytes > maxBytes) {
      continue;
    }
    if (retainedBytes + itemBytes > maxBytes) {
      break;
    }
    retained.unshift(item);
    retainedBytes += itemBytes;
  }
  return retained;
}

function normalizeEvent(event, limits) {
  const source = event && typeof event === "object" ? event : {};
  return {
    category: boundedText(source.category, limits.maxTextChars),
    action: boundedText(source.action, limits.maxTextChars),
    label: boundedText(source.label, limits.maxTextChars),
    value: finiteNumber(source.value),
    timestamp: finiteNumber(source.timestamp, Date.now()),
  };
}

function normalizeSession(session, limits) {
  const source = session && typeof session === "object" ? session : {};
  const events = Array.isArray(source.events)
    ? source.events.map((event) => normalizeEvent(event, limits))
    : [];
  return {
    id: boundedText(source.id, limits.maxTextChars),
    startTime: finiteNumber(source.startTime),
    endTime:
      source.endTime === null ? null : finiteNumber(source.endTime, null),
    duration: finiteNumber(source.duration),
    platform: boundedText(source.platform, limits.maxTextChars),
    version: boundedText(source.version, limits.maxTextChars),
    events: retainNewestByBytes(
      events,
      limits.maxSessionEvents,
      limits.maxSessionEventBytes,
    ),
    droppedEvents: Math.max(0, finiteNumber(source.droppedEvents)),
  };
}

function normalizeAnalyticsData(value, limits) {
  const source = value && typeof value === "object" ? value : {};
  const sessions = Array.isArray(source.sessions)
    ? source.sessions.map((session) => normalizeSession(session, limits))
    : [];
  const features = {};
  if (source.features && typeof source.features === "object") {
    for (const [rawName, rawData] of Object.entries(source.features)) {
      if (Object.keys(features).length >= limits.maxFeatures) {
        break;
      }
      const name = boundedText(rawName, limits.maxTextChars);
      if (!name || name === "__proto__" || name === "constructor") {
        continue;
      }
      const feature = rawData && typeof rawData === "object" ? rawData : {};
      features[name] = {
        count: Math.max(0, finiteNumber(feature.count)),
        firstUsed: finiteNumber(feature.firstUsed),
        lastUsed: finiteNumber(feature.lastUsed),
      };
    }
  }
  const errors = Array.isArray(source.errors)
    ? source.errors.slice(-limits.maxErrors).map((error) => ({
        message: boundedText(error?.message, limits.maxTextChars),
        stack: boundedText(error?.stack, limits.maxTextChars),
        name: boundedText(error?.name, limits.maxTextChars),
        context: cloneBoundedJson(error?.context, limits.maxContextBytes),
        timestamp: finiteNumber(error?.timestamp, Date.now()),
      }))
    : [];
  const performance = Array.isArray(source.performance)
    ? source.performance.slice(-limits.maxPerformanceEntries).map((entry) => ({
        metric: boundedText(entry?.metric, limits.maxTextChars),
        value: finiteNumber(entry?.value),
        unit: boundedText(entry?.unit, limits.maxTextChars),
        timestamp: finiteNumber(entry?.timestamp, Date.now()),
      }))
    : [];
  return {
    sessions: retainNewestByBytes(
      sessions,
      limits.maxSessions,
      limits.maxSessionHistoryBytes,
    ),
    features,
    errors,
    performance,
  };
}

class AnalyticsManager {
  constructor(options = {}) {
    this.app = options.app || require("electron").app;
    this.limits = createAnalyticsLimits(options.limits);
    this.dataPath =
      options.dataPath ||
      path.join(this.app.getPath("userData"), "analytics.json");
    this.sessionStartTime = Date.now();
    this.data = createEmptyAnalyticsData();
    this.currentSessionEventBytes = 0;

    // 加载历史数据
    this.loadData();

    // 开始新会话
    this.startSession();

    // 监听应用退出
    this.app.on("before-quit", () => {
      this.endSession();
      this.saveData();
    });
  }

  /**
   * 开始会话
   */
  startSession() {
    this.currentSession = {
      id: `session-${Date.now()}`,
      startTime: Date.now(),
      endTime: null,
      duration: 0,
      platform: process.platform,
      version: this.app.getVersion(),
      events: [],
      droppedEvents: 0,
    };
    this.currentSessionEventBytes = 0;

    logger.info("[Analytics] Session started:", this.currentSession.id);
  }

  /**
   * 结束会话
   */
  endSession() {
    if (this.currentSession) {
      const session = this.currentSession;
      this.currentSession = null;
      session.endTime = Date.now();
      session.duration = session.endTime - session.startTime;

      this.data.sessions = retainNewestByBytes(
        [...this.data.sessions, session],
        this.limits.maxSessions,
        this.limits.maxSessionHistoryBytes,
      );

      logger.info("[Analytics] Session ended:", session.id);
      logger.info("[Analytics] Duration:", session.duration, "ms");
    }
  }

  /**
   * 跟踪事件
   */
  trackEvent(category, action, label = "", value = 0) {
    const event = normalizeEvent(
      {
        category,
        action,
        label,
        value,
        timestamp: Date.now(),
      },
      this.limits,
    );

    if (this.currentSession) {
      const eventBytes = serializedBytes(event);
      while (
        this.currentSession.events.length > 0 &&
        (this.currentSession.events.length >= this.limits.maxSessionEvents ||
          this.currentSessionEventBytes + eventBytes >
            this.limits.maxSessionEventBytes)
      ) {
        const removed = this.currentSession.events.shift();
        this.currentSessionEventBytes -= serializedBytes(removed);
        this.currentSession.droppedEvents += 1;
      }
      if (eventBytes > this.limits.maxSessionEventBytes) {
        this.currentSession.droppedEvents += 1;
        return {
          accepted: false,
          code: "OVERLOADED",
          scope: "analytics_session_events",
          limit: {
            maxSessionEventBytes: this.limits.maxSessionEventBytes,
          },
        };
      }
      this.currentSession.events.push(event);
      this.currentSessionEventBytes += eventBytes;
    }

    logger.info("[Analytics] Event tracked:", event.category, event.action);
    return { accepted: true, event };
  }

  /**
   * 跟踪功能使用
   */
  trackFeature(featureName) {
    const normalizedName = boundedText(featureName, this.limits.maxTextChars);
    if (
      !normalizedName ||
      normalizedName === "__proto__" ||
      normalizedName === "constructor"
    ) {
      return { accepted: false, code: "INVALID_ARGUMENT" };
    }
    if (!Object.hasOwn(this.data.features, normalizedName)) {
      if (Object.keys(this.data.features).length >= this.limits.maxFeatures) {
        return {
          accepted: false,
          code: "OVERLOADED",
          scope: "analytics_features",
          retryAfterMs: 1000,
          limit: { maxFeatures: this.limits.maxFeatures },
        };
      }
      this.data.features[normalizedName] = {
        count: 0,
        firstUsed: Date.now(),
        lastUsed: Date.now(),
      };
    }

    this.data.features[normalizedName].count++;
    this.data.features[normalizedName].lastUsed = Date.now();

    this.trackEvent("feature", "use", normalizedName);
    return { accepted: true };
  }

  /**
   * 跟踪错误
   */
  trackError(error, context = {}) {
    const errorData = {
      message: boundedText(error?.message, this.limits.maxTextChars),
      stack: boundedText(error?.stack, this.limits.maxTextChars),
      name: boundedText(error?.name, this.limits.maxTextChars),
      context: cloneBoundedJson(context, this.limits.maxContextBytes),
      timestamp: Date.now(),
    };

    this.data.errors.push(errorData);

    // 只保留最近50个错误
    if (this.data.errors.length > this.limits.maxErrors) {
      this.data.errors = this.data.errors.slice(-this.limits.maxErrors);
    }

    this.trackEvent("error", "occurred", errorData.message);
  }

  /**
   * 跟踪性能指标
   */
  trackPerformance(metric, value, unit = "ms") {
    const perfData = {
      metric: boundedText(metric, this.limits.maxTextChars),
      value: finiteNumber(value),
      unit: boundedText(unit, this.limits.maxTextChars),
      timestamp: Date.now(),
    };

    this.data.performance.push(perfData);

    // 只保留最近100个性能数据
    if (this.data.performance.length > this.limits.maxPerformanceEntries) {
      this.data.performance = this.data.performance.slice(
        -this.limits.maxPerformanceEntries,
      );
    }

    this.trackEvent("performance", metric, unit, value);
  }

  /**
   * 获取统计数据
   */
  getStatistics() {
    const stats = {
      totalSessions: this.data.sessions.length,
      totalDuration: this.data.sessions.reduce((sum, s) => sum + s.duration, 0),
      averageDuration: 0,
      totalEvents: 0,
      topFeatures: [],
      errorCount: this.data.errors.length,
      performanceMetrics: Object.create(null),
    };

    // 计算平均会话时长
    if (stats.totalSessions > 0) {
      stats.averageDuration = stats.totalDuration / stats.totalSessions;
    }

    // 计算总事件数
    stats.totalEvents = this.data.sessions.reduce(
      (sum, s) => sum + s.events.length,
      0,
    );

    // 获取最常用功能
    const features = Object.entries(this.data.features)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    stats.topFeatures = features;

    // 计算性能指标平均值
    const perfByMetric = new Map();
    for (const perf of this.data.performance) {
      if (!perfByMetric.has(perf.metric)) {
        perfByMetric.set(perf.metric, []);
      }
      perfByMetric.get(perf.metric).push(perf.value);
    }

    for (const [metric, values] of perfByMetric.entries()) {
      stats.performanceMetrics[metric] = {
        average: values.reduce((a, b) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length,
      };
    }

    return stats;
  }

  /**
   * 获取会话列表
   */
  getSessions(limit = 10) {
    const safeLimit = Math.min(
      Math.max(0, Math.floor(finiteNumber(limit, 10))),
      this.limits.maxSessions,
    );
    if (safeLimit === 0) {
      return [];
    }
    return structuredClone(this.data.sessions.slice(-safeLimit).reverse());
  }

  /**
   * 获取错误列表
   */
  getErrors(limit = 10) {
    const safeLimit = Math.min(
      Math.max(0, Math.floor(finiteNumber(limit, 10))),
      this.limits.maxErrors,
    );
    if (safeLimit === 0) {
      return [];
    }
    return structuredClone(this.data.errors.slice(-safeLimit).reverse());
  }

  /**
   * 获取功能使用情况
   */
  getFeatureUsage() {
    return structuredClone(
      Object.entries(this.data.features)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.count - a.count),
    );
  }

  /**
   * 加载数据
   */
  loadData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const fileSize = fs.statSync(this.dataPath).size;
        if (fileSize > this.limits.maxPersistenceBytes) {
          logger.warn("[Analytics] Ignoring oversized data file:", fileSize);
          return;
        }
        const content = fs.readFileSync(this.dataPath, "utf8");
        this.data = normalizeAnalyticsData(JSON.parse(content), this.limits);
        logger.info("[Analytics] Data loaded");
      }
    } catch (error) {
      logger.error("[Analytics] Load data error:", error);
    }
  }

  /**
   * 保存数据
   */
  saveData() {
    try {
      this.data = normalizeAnalyticsData(this.data, this.limits);
      let serialized = JSON.stringify(this.data, null, 2);
      while (
        Buffer.byteLength(serialized, "utf8") >
          this.limits.maxPersistenceBytes &&
        this.data.sessions.length > 0
      ) {
        this.data.sessions.shift();
        serialized = JSON.stringify(this.data, null, 2);
      }
      if (
        Buffer.byteLength(serialized, "utf8") > this.limits.maxPersistenceBytes
      ) {
        logger.warn("[Analytics] Persistence capacity exceeded");
        return false;
      }
      fs.writeFileSync(this.dataPath, serialized);
      logger.info("[Analytics] Data saved");
      return true;
    } catch (error) {
      logger.error("[Analytics] Save data error:", error);
      return false;
    }
  }

  /**
   * 清空数据
   */
  clearData() {
    this.data = createEmptyAnalyticsData();
    this.saveData();
    logger.info("[Analytics] Data cleared");
  }

  /**
   * 导出数据
   */
  exportData(outputPath) {
    try {
      const exportData = {
        ...this.data,
        statistics: this.getStatistics(),
        exportTime: new Date().toISOString(),
      };

      fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
      logger.info("[Analytics] Data exported to:", outputPath);
      return true;
    } catch (error) {
      logger.error("[Analytics] Export data error:", error);
      return false;
    }
  }
}

// 创建全局实例
let analyticsManager = null;

function getAnalyticsManager(options) {
  if (!analyticsManager) {
    analyticsManager = new AnalyticsManager(options);
  }
  return analyticsManager;
}

module.exports = {
  AnalyticsManager,
  DEFAULT_ANALYTICS_LIMITS,
  HARD_ANALYTICS_LIMITS,
  createAnalyticsLimits,
  getAnalyticsManager,
};
