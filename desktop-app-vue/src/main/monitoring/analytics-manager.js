/**
 * 应用统计分析器
 * 收集和分析应用使用数据
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

class AnalyticsManager {
  constructor(options = {}) {
    this.dataPath =
      options.dataPath || path.join(app.getPath("userData"), "analytics.json");
    this.sessionStartTime = Date.now();
    this.data = {
      sessions: [],
      features: {},
      errors: [],
      performance: [],
    };

    // 加载历史数据
    this.loadData();

    // 开始新会话
    this.startSession();

    // 监听应用退出
    app.on("before-quit", () => {
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
      version: app.getVersion(),
      events: [],
    };

    console.log("[Analytics] Session started:", this.currentSession.id);
  }

  /**
   * 结束会话
   */
  endSession() {
    if (this.currentSession) {
      this.currentSession.endTime = Date.now();
      this.currentSession.duration =
        this.currentSession.endTime - this.currentSession.startTime;

      this.data.sessions.push(this.currentSession);

      // 只保留最近100个会话
      if (this.data.sessions.length > 100) {
        this.data.sessions = this.data.sessions.slice(-100);
      }

      console.log("[Analytics] Session ended:", this.currentSession.id);
      console.log("[Analytics] Duration:", this.currentSession.duration, "ms");
    }
  }

  /**
   * 跟踪事件
   */
  trackEvent(category, action, label = "", value = 0) {
    const event = {
      category,
      action,
      label,
      value,
      timestamp: Date.now(),
    };

    if (this.currentSession) {
      this.currentSession.events.push(event);
    }

    console.log("[Analytics] Event tracked:", category, action);
  }

  /**
   * 跟踪功能使用
   */
  trackFeature(featureName) {
    if (!this.data.features[featureName]) {
      this.data.features[featureName] = {
        count: 0,
        firstUsed: Date.now(),
        lastUsed: Date.now(),
      };
    }

    this.data.features[featureName].count++;
    this.data.features[featureName].lastUsed = Date.now();

    this.trackEvent("feature", "use", featureName);
  }

  /**
   * 跟踪错误
   */
  trackError(error, context = {}) {
    const errorData = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      context,
      timestamp: Date.now(),
    };

    this.data.errors.push(errorData);

    // 只保留最近50个错误
    if (this.data.errors.length > 50) {
      this.data.errors = this.data.errors.slice(-50);
    }

    this.trackEvent("error", "occurred", error.message);
  }

  /**
   * 跟踪性能指标
   */
  trackPerformance(metric, value, unit = "ms") {
    const perfData = {
      metric,
      value,
      unit,
      timestamp: Date.now(),
    };

    this.data.performance.push(perfData);

    // 只保留最近100个性能数据
    if (this.data.performance.length > 100) {
      this.data.performance = this.data.performance.slice(-100);
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
      performanceMetrics: {},
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
    const perfByMetric = {};
    for (const perf of this.data.performance) {
      if (!perfByMetric[perf.metric]) {
        perfByMetric[perf.metric] = [];
      }
      perfByMetric[perf.metric].push(perf.value);
    }

    for (const [metric, values] of Object.entries(perfByMetric)) {
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
    return this.data.sessions.slice(-limit).reverse();
  }

  /**
   * 获取错误列表
   */
  getErrors(limit = 10) {
    return this.data.errors.slice(-limit).reverse();
  }

  /**
   * 获取功能使用情况
   */
  getFeatureUsage() {
    return Object.entries(this.data.features)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * 加载数据
   */
  loadData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const content = fs.readFileSync(this.dataPath, "utf8");
        this.data = JSON.parse(content);
        console.log("[Analytics] Data loaded");
      }
    } catch (error) {
      console.error("[Analytics] Load data error:", error);
    }
  }

  /**
   * 保存数据
   */
  saveData() {
    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2));
      console.log("[Analytics] Data saved");
    } catch (error) {
      console.error("[Analytics] Save data error:", error);
    }
  }

  /**
   * 清空数据
   */
  clearData() {
    this.data = {
      sessions: [],
      features: {},
      errors: [],
      performance: [],
    };
    this.saveData();
    console.log("[Analytics] Data cleared");
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
      console.log("[Analytics] Data exported to:", outputPath);
      return true;
    } catch (error) {
      console.error("[Analytics] Export data error:", error);
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

module.exports = { AnalyticsManager, getAnalyticsManager };
