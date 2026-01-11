/**
 * 性能预警系统
 * 监控应用性能指标并在超过阈值时发出警告
 */

import { ref, computed, watch } from 'vue';
import { message, notification } from 'ant-design-vue';

// 性能阈值配置
const THRESHOLDS = {
  // FPS阈值
  fps: {
    critical: 20,  // 严重
    warning: 40,   // 警告
    normal: 55,    // 正常
  },
  // 内存使用阈值 (MB)
  memory: {
    critical: 500,
    warning: 300,
    normal: 200,
  },
  // 加载时间阈值 (ms)
  loadTime: {
    critical: 5000,
    warning: 3000,
    normal: 1000,
  },
  // API响应时间阈值 (ms)
  apiResponseTime: {
    critical: 3000,
    warning: 2000,
    normal: 1000,
  },
  // 渲染时间阈值 (ms)
  renderTime: {
    critical: 500,
    warning: 300,
    normal: 100,
  },
  // 错误率阈值 (%)
  errorRate: {
    critical: 5,
    warning: 2,
    normal: 0.5,
  },
};

// 警告级别
export const WARNING_LEVELS = {
  NORMAL: 'normal',
  WARNING: 'warning',
  CRITICAL: 'critical',
};

// 警告类型
export const WARNING_TYPES = {
  FPS: 'fps',
  MEMORY: 'memory',
  LOAD_TIME: 'loadTime',
  API_RESPONSE: 'apiResponse',
  RENDER_TIME: 'renderTime',
  ERROR_RATE: 'errorRate',
};

class PerformanceWarningSystem {
  constructor() {
    this.warnings = ref([]);
    this.metrics = ref({});
    this.enabled = ref(true);
    this.notificationEnabled = ref(true);
    this.listeners = new Set();
    this.warningHistory = [];
    this.maxHistorySize = 100;

    // 性能监控定时器
    this.monitorInterval = null;
    this.monitorFrequency = 2000; // 2秒检查一次

    // 警告去重
    this.recentWarnings = new Map();
    this.warningCooldown = 30000; // 30秒内相同警告不重复提示
  }

  /**
   * 启动性能监控
   */
  start() {
    if (this.monitorInterval) return;

    this.enabled.value = true;
    this.monitorInterval = setInterval(() => {
      this.checkPerformance();
    }, this.monitorFrequency);

    console.log('[PerformanceWarning] 性能监控已启动');
  }

  /**
   * 停止性能监控
   */
  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.enabled.value = false;
    console.log('[PerformanceWarning] 性能监控已停止');
  }

  /**
   * 检查性能指标
   */
  checkPerformance() {
    if (!this.enabled.value) return;

    // 检查FPS
    this.checkFPS();

    // 检查内存
    this.checkMemory();

    // 检查渲染性能
    this.checkRenderPerformance();

    // 检查错误率
    this.checkErrorRate();
  }

  /**
   * 检查FPS
   */
  checkFPS() {
    const fps = this.getCurrentFPS();
    this.metrics.value.fps = fps;

    const level = this.getWarningLevel(fps, THRESHOLDS.fps, true);
    if (level !== WARNING_LEVELS.NORMAL) {
      this.addWarning({
        type: WARNING_TYPES.FPS,
        level,
        message: `帧率过低: ${fps} FPS`,
        value: fps,
        threshold: THRESHOLDS.fps[level],
        suggestion: '建议关闭一些动画效果或减少同时打开的组件',
      });
    }
  }

  /**
   * 检查内存使用
   */
  checkMemory() {
    if (!performance.memory) return;

    const memoryMB = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
    this.metrics.value.memory = memoryMB;

    const level = this.getWarningLevel(memoryMB, THRESHOLDS.memory);
    if (level !== WARNING_LEVELS.NORMAL) {
      this.addWarning({
        type: WARNING_TYPES.MEMORY,
        level,
        message: `内存使用过高: ${memoryMB} MB`,
        value: memoryMB,
        threshold: THRESHOLDS.memory[level],
        suggestion: '建议关闭一些不必要的标签页或刷新页面',
      });
    }
  }

  /**
   * 检查渲染性能
   */
  checkRenderPerformance() {
    if (!window.performance || !window.performance.getEntriesByType) return;

    const measures = window.performance.getEntriesByType('measure');
    if (measures.length === 0) return;

    const recentMeasures = measures.slice(-10);
    const avgRenderTime = recentMeasures.reduce((sum, m) => sum + m.duration, 0) / recentMeasures.length;

    this.metrics.value.renderTime = Math.round(avgRenderTime);

    const level = this.getWarningLevel(avgRenderTime, THRESHOLDS.renderTime);
    if (level !== WARNING_LEVELS.NORMAL) {
      this.addWarning({
        type: WARNING_TYPES.RENDER_TIME,
        level,
        message: `渲染时间过长: ${Math.round(avgRenderTime)} ms`,
        value: Math.round(avgRenderTime),
        threshold: THRESHOLDS.renderTime[level],
        suggestion: '建议优化组件渲染逻辑或启用虚拟滚动',
      });
    }
  }

  /**
   * 检查错误率
   */
  checkErrorRate() {
    // 这里需要从错误处理系统获取错误统计
    // 暂时使用模拟数据
    const errorRate = 0;
    this.metrics.value.errorRate = errorRate;

    const level = this.getWarningLevel(errorRate, THRESHOLDS.errorRate);
    if (level !== WARNING_LEVELS.NORMAL) {
      this.addWarning({
        type: WARNING_TYPES.ERROR_RATE,
        level,
        message: `错误率过高: ${errorRate.toFixed(2)}%`,
        value: errorRate,
        threshold: THRESHOLDS.errorRate[level],
        suggestion: '请检查控制台错误日志',
      });
    }
  }

  /**
   * 获取当前FPS
   */
  getCurrentFPS() {
    // 简化的FPS计算，实际应该使用requestAnimationFrame
    if (this.lastFrameTime) {
      const now = performance.now();
      const delta = now - this.lastFrameTime;
      this.lastFrameTime = now;
      return Math.round(1000 / delta);
    }
    this.lastFrameTime = performance.now();
    return 60;
  }

  /**
   * 获取警告级别
   */
  getWarningLevel(value, thresholds, inverse = false) {
    if (inverse) {
      // 值越小越严重（如FPS）
      if (value <= thresholds.critical) return WARNING_LEVELS.CRITICAL;
      if (value <= thresholds.warning) return WARNING_LEVELS.WARNING;
      return WARNING_LEVELS.NORMAL;
    } else {
      // 值越大越严重（如内存、时间）
      if (value >= thresholds.critical) return WARNING_LEVELS.CRITICAL;
      if (value >= thresholds.warning) return WARNING_LEVELS.WARNING;
      return WARNING_LEVELS.NORMAL;
    }
  }

  /**
   * 添加警告
   */
  addWarning(warning) {
    const warningKey = `${warning.type}-${warning.level}`;
    const now = Date.now();

    // 检查是否在冷却期内
    if (this.recentWarnings.has(warningKey)) {
      const lastTime = this.recentWarnings.get(warningKey);
      if (now - lastTime < this.warningCooldown) {
        return; // 跳过重复警告
      }
    }

    // 记录警告时间
    this.recentWarnings.set(warningKey, now);

    // 添加时间戳和ID
    const fullWarning = {
      ...warning,
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
    };

    // 添加到当前警告列表
    this.warnings.value.push(fullWarning);

    // 添加到历史记录
    this.warningHistory.push(fullWarning);
    if (this.warningHistory.length > this.maxHistorySize) {
      this.warningHistory.shift();
    }

    // 显示通知
    if (this.notificationEnabled.value) {
      this.showNotification(fullWarning);
    }

    // 触发监听器
    this.notifyListeners(fullWarning);

    // 记录到控制台
    const logMethod = warning.level === WARNING_LEVELS.CRITICAL ? 'error' : 'warn';
    console[logMethod]('[PerformanceWarning]', warning.message, warning);
  }

  /**
   * 显示通知
   */
  showNotification(warning) {
    const config = {
      message: this.getWarningTitle(warning.level),
      description: warning.message,
      duration: warning.level === WARNING_LEVELS.CRITICAL ? 0 : 4.5,
    };

    if (warning.level === WARNING_LEVELS.CRITICAL) {
      notification.error(config);
    } else {
      notification.warning(config);
    }
  }

  /**
   * 获取警告标题
   */
  getWarningTitle(level) {
    const titles = {
      [WARNING_LEVELS.CRITICAL]: '⚠️ 严重性能问题',
      [WARNING_LEVELS.WARNING]: '⚡ 性能警告',
      [WARNING_LEVELS.NORMAL]: 'ℹ️ 性能提示',
    };
    return titles[level] || '性能提示';
  }

  /**
   * 清除警告
   */
  clearWarning(id) {
    const index = this.warnings.value.findIndex(w => w.id === id);
    if (index !== -1) {
      this.warnings.value.splice(index, 1);
    }
  }

  /**
   * 清除所有警告
   */
  clearAllWarnings() {
    this.warnings.value = [];
  }

  /**
   * 添加监听器
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * 通知监听器
   */
  notifyListeners(warning) {
    this.listeners.forEach(callback => {
      try {
        callback(warning);
      } catch (error) {
        console.error('[PerformanceWarning] Listener error:', error);
      }
    });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalWarnings: this.warningHistory.length,
      criticalWarnings: this.warningHistory.filter(w => w.level === WARNING_LEVELS.CRITICAL).length,
      warningWarnings: this.warningHistory.filter(w => w.level === WARNING_LEVELS.WARNING).length,
      currentWarnings: this.warnings.value.length,
      metrics: this.metrics.value,
    };
  }

  /**
   * 导出警告历史
   */
  exportHistory() {
    return {
      timestamp: new Date().toISOString(),
      warnings: this.warningHistory,
      stats: this.getStats(),
    };
  }

  /**
   * 设置阈值
   */
  setThreshold(type, level, value) {
    if (THRESHOLDS[type] && THRESHOLDS[type][level] !== undefined) {
      THRESHOLDS[type][level] = value;
    }
  }

  /**
   * 启用/禁用通知
   */
  setNotificationEnabled(enabled) {
    this.notificationEnabled.value = enabled;
  }
}

// 单例实例
let instance = null;

/**
 * 获取性能预警系统实例
 */
export function getPerformanceWarningSystem() {
  if (!instance) {
    instance = new PerformanceWarningSystem();
  }
  return instance;
}

/**
 * 性能预警 Composable
 */
export function usePerformanceWarning() {
  const system = getPerformanceWarningSystem();

  return {
    warnings: computed(() => system.warnings.value),
    metrics: computed(() => system.metrics.value),
    enabled: computed(() => system.enabled.value),
    start: () => system.start(),
    stop: () => system.stop(),
    clearWarning: (id) => system.clearWarning(id),
    clearAllWarnings: () => system.clearAllWarnings(),
    addListener: (callback) => system.addListener(callback),
    getStats: () => system.getStats(),
    exportHistory: () => system.exportHistory(),
    setThreshold: (type, level, value) => system.setThreshold(type, level, value),
    setNotificationEnabled: (enabled) => system.setNotificationEnabled(enabled),
  };
}

export default {
  getPerformanceWarningSystem,
  usePerformanceWarning,
  WARNING_LEVELS,
  WARNING_TYPES,
  THRESHOLDS,
};
