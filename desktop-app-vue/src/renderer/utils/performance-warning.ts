/**
 * 性能预警系统
 * 监控应用性能指标并在超过阈值时发出警告
 */

import { logger } from '@/utils/logger';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { notification } from 'ant-design-vue';

// ==================== 类型定义 ====================

/**
 * 阈值配置
 */
export interface ThresholdConfig {
  critical: number;
  warning: number;
  normal: number;
}

/**
 * 所有阈值配置
 */
export interface ThresholdsConfig {
  fps: ThresholdConfig;
  memory: ThresholdConfig;
  loadTime: ThresholdConfig;
  apiResponseTime: ThresholdConfig;
  renderTime: ThresholdConfig;
  errorRate: ThresholdConfig;
  [key: string]: ThresholdConfig;
}

/**
 * 警告级别
 */
export const WARNING_LEVELS = {
  NORMAL: 'normal',
  WARNING: 'warning',
  CRITICAL: 'critical',
} as const;

export type WarningLevel = typeof WARNING_LEVELS[keyof typeof WARNING_LEVELS];

/**
 * 警告类型
 */
export const WARNING_TYPES = {
  FPS: 'fps',
  MEMORY: 'memory',
  LOAD_TIME: 'loadTime',
  API_RESPONSE: 'apiResponse',
  RENDER_TIME: 'renderTime',
  ERROR_RATE: 'errorRate',
} as const;

export type WarningType = typeof WARNING_TYPES[keyof typeof WARNING_TYPES];

/**
 * 警告信息
 */
export interface Warning {
  id: string;
  type: WarningType;
  level: WarningLevel;
  message: string;
  value: number;
  threshold: number;
  suggestion: string;
  timestamp: string;
}

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  fps?: number;
  memory?: number;
  renderTime?: number;
  errorRate?: number;
  loadTime?: number;
  apiResponseTime?: number;
}

/**
 * 统计信息
 */
export interface WarningStats {
  totalWarnings: number;
  criticalWarnings: number;
  warningWarnings: number;
  currentWarnings: number;
  metrics: PerformanceMetrics;
}

/**
 * 导出数据
 */
export interface ExportedWarningHistory {
  timestamp: string;
  warnings: Warning[];
  stats: WarningStats;
}

/**
 * 警告监听器
 */
export type WarningListener = (warning: Warning) => void;

/**
 * usePerformanceWarning 返回类型
 */
export interface UsePerformanceWarningReturn {
  warnings: ComputedRef<Warning[]>;
  metrics: ComputedRef<PerformanceMetrics>;
  enabled: ComputedRef<boolean>;
  start: () => void;
  stop: () => void;
  clearWarning: (id: string) => void;
  clearAllWarnings: () => void;
  addListener: (callback: WarningListener) => () => void;
  getStats: () => WarningStats;
  exportHistory: () => ExportedWarningHistory;
  setThreshold: (type: string, level: WarningLevel, value: number) => void;
  setNotificationEnabled: (enabled: boolean) => void;
}

// ==================== 全局配置 ====================

// 性能阈值配置
const THRESHOLDS: ThresholdsConfig = {
  // FPS阈值
  fps: {
    critical: 20,
    warning: 40,
    normal: 55,
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

// ==================== 扩展全局接口 ====================

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }
}

// ==================== 类实现 ====================

/**
 * 性能预警系统
 */
class PerformanceWarningSystem {
  warnings: Ref<Warning[]>;
  metrics: Ref<PerformanceMetrics>;
  enabled: Ref<boolean>;
  notificationEnabled: Ref<boolean>;
  private listeners: Set<WarningListener>;
  private warningHistory: Warning[];
  private maxHistorySize: number;
  private monitorInterval: ReturnType<typeof setInterval> | null;
  private monitorFrequency: number;
  private recentWarnings: Map<string, number>;
  private warningCooldown: number;
  private lastFrameTime: number;

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

    // FPS 计算
    this.lastFrameTime = 0;
  }

  /**
   * 启动性能监控
   */
  start(): void {
    if (this.monitorInterval) {
      return;
    }

    this.enabled.value = true;
    this.monitorInterval = setInterval(() => {
      this.checkPerformance();
    }, this.monitorFrequency);

    logger.info('[PerformanceWarning] Performance monitoring started');
  }

  /**
   * 停止性能监控
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.enabled.value = false;
    logger.info('[PerformanceWarning] Performance monitoring stopped');
  }

  /**
   * 检查性能指标
   */
  private checkPerformance(): void {
    if (!this.enabled.value) {
      return;
    }

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
  private checkFPS(): void {
    const fps = this.getCurrentFPS();
    this.metrics.value.fps = fps;

    const level = this.getWarningLevel(fps, THRESHOLDS.fps, true);
    if (level !== WARNING_LEVELS.NORMAL) {
      this.addWarning({
        id: '',
        type: WARNING_TYPES.FPS,
        level,
        message: `Frame rate too low: ${fps} FPS`,
        value: fps,
        threshold: THRESHOLDS.fps[level],
        suggestion: 'Consider disabling some animations or reducing open components',
        timestamp: '',
      });
    }
  }

  /**
   * 检查内存使用
   */
  private checkMemory(): void {
    if (!performance.memory) {
      return;
    }

    const memoryMB = Math.round(
      performance.memory.usedJSHeapSize / 1024 / 1024
    );
    this.metrics.value.memory = memoryMB;

    const level = this.getWarningLevel(memoryMB, THRESHOLDS.memory);
    if (level !== WARNING_LEVELS.NORMAL) {
      this.addWarning({
        id: '',
        type: WARNING_TYPES.MEMORY,
        level,
        message: `Memory usage too high: ${memoryMB} MB`,
        value: memoryMB,
        threshold: THRESHOLDS.memory[level],
        suggestion: 'Consider closing unnecessary tabs or refreshing the page',
        timestamp: '',
      });
    }
  }

  /**
   * 检查渲染性能
   */
  private checkRenderPerformance(): void {
    if (
      typeof window === 'undefined' ||
      !window.performance ||
      !window.performance.getEntriesByType
    ) {
      return;
    }

    const measures = window.performance.getEntriesByType('measure');
    if (measures.length === 0) {
      return;
    }

    const recentMeasures = measures.slice(-10);
    const avgRenderTime =
      recentMeasures.reduce((sum, m) => sum + m.duration, 0) /
      recentMeasures.length;

    this.metrics.value.renderTime = Math.round(avgRenderTime);

    const level = this.getWarningLevel(avgRenderTime, THRESHOLDS.renderTime);
    if (level !== WARNING_LEVELS.NORMAL) {
      this.addWarning({
        id: '',
        type: WARNING_TYPES.RENDER_TIME,
        level,
        message: `Render time too long: ${Math.round(avgRenderTime)} ms`,
        value: Math.round(avgRenderTime),
        threshold: THRESHOLDS.renderTime[level],
        suggestion: 'Consider optimizing component rendering or enabling virtual scrolling',
        timestamp: '',
      });
    }
  }

  /**
   * 检查错误率
   */
  private checkErrorRate(): void {
    // 这里需要从错误处理系统获取错误统计
    // 暂时使用模拟数据
    const errorRate = 0;
    this.metrics.value.errorRate = errorRate;

    const level = this.getWarningLevel(errorRate, THRESHOLDS.errorRate);
    if (level !== WARNING_LEVELS.NORMAL) {
      this.addWarning({
        id: '',
        type: WARNING_TYPES.ERROR_RATE,
        level,
        message: `Error rate too high: ${errorRate.toFixed(2)}%`,
        value: errorRate,
        threshold: THRESHOLDS.errorRate[level],
        suggestion: 'Please check the console error logs',
        timestamp: '',
      });
    }
  }

  /**
   * 获取当前FPS
   */
  private getCurrentFPS(): number {
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
  private getWarningLevel(
    value: number,
    thresholds: ThresholdConfig,
    inverse: boolean = false
  ): WarningLevel {
    if (inverse) {
      // 值越小越严重（如FPS）
      if (value <= thresholds.critical) {
        return WARNING_LEVELS.CRITICAL;
      }
      if (value <= thresholds.warning) {
        return WARNING_LEVELS.WARNING;
      }
      return WARNING_LEVELS.NORMAL;
    } else {
      // 值越大越严重（如内存、时间）
      if (value >= thresholds.critical) {
        return WARNING_LEVELS.CRITICAL;
      }
      if (value >= thresholds.warning) {
        return WARNING_LEVELS.WARNING;
      }
      return WARNING_LEVELS.NORMAL;
    }
  }

  /**
   * 添加警告
   */
  private addWarning(warning: Warning): void {
    const warningKey = `${warning.type}-${warning.level}`;
    const now = Date.now();

    // 检查是否在冷却期内
    if (this.recentWarnings.has(warningKey)) {
      const lastTime = this.recentWarnings.get(warningKey);
      if (lastTime && now - lastTime < this.warningCooldown) {
        return; // 跳过重复警告
      }
    }

    // 记录警告时间
    this.recentWarnings.set(warningKey, now);

    // 添加时间戳和ID
    const fullWarning: Warning = {
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
    const logMethod =
      warning.level === WARNING_LEVELS.CRITICAL ? 'error' : 'warn';
    console[logMethod]('[PerformanceWarning]', warning.message, warning);
  }

  /**
   * 显示通知
   */
  private showNotification(warning: Warning): void {
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
  private getWarningTitle(level: WarningLevel): string {
    const titles: Record<WarningLevel, string> = {
      [WARNING_LEVELS.CRITICAL]: 'Critical Performance Issue',
      [WARNING_LEVELS.WARNING]: 'Performance Warning',
      [WARNING_LEVELS.NORMAL]: 'Performance Notice',
    };
    return titles[level] || 'Performance Notice';
  }

  /**
   * 清除警告
   */
  clearWarning(id: string): void {
    const index = this.warnings.value.findIndex((w) => w.id === id);
    if (index !== -1) {
      this.warnings.value.splice(index, 1);
    }
  }

  /**
   * 清除所有警告
   */
  clearAllWarnings(): void {
    this.warnings.value = [];
  }

  /**
   * 添加监听器
   */
  addListener(callback: WarningListener): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * 通知监听器
   */
  private notifyListeners(warning: Warning): void {
    this.listeners.forEach((callback) => {
      try {
        callback(warning);
      } catch (error) {
        logger.error('[PerformanceWarning] Listener error:', error);
      }
    });
  }

  /**
   * 获取统计信息
   */
  getStats(): WarningStats {
    return {
      totalWarnings: this.warningHistory.length,
      criticalWarnings: this.warningHistory.filter(
        (w) => w.level === WARNING_LEVELS.CRITICAL
      ).length,
      warningWarnings: this.warningHistory.filter(
        (w) => w.level === WARNING_LEVELS.WARNING
      ).length,
      currentWarnings: this.warnings.value.length,
      metrics: this.metrics.value,
    };
  }

  /**
   * 导出警告历史
   */
  exportHistory(): ExportedWarningHistory {
    return {
      timestamp: new Date().toISOString(),
      warnings: this.warningHistory,
      stats: this.getStats(),
    };
  }

  /**
   * 设置阈值
   */
  setThreshold(type: string, level: WarningLevel, value: number): void {
    if (THRESHOLDS[type] && THRESHOLDS[type][level] !== undefined) {
      THRESHOLDS[type][level] = value;
    }
  }

  /**
   * 启用/禁用通知
   */
  setNotificationEnabled(enabled: boolean): void {
    this.notificationEnabled.value = enabled;
  }
}

// 单例实例
let instance: PerformanceWarningSystem | null = null;

/**
 * 获取性能预警系统实例
 */
export function getPerformanceWarningSystem(): PerformanceWarningSystem {
  if (!instance) {
    instance = new PerformanceWarningSystem();
  }
  return instance;
}

/**
 * 性能预警 Composable
 */
export function usePerformanceWarning(): UsePerformanceWarningReturn {
  const system = getPerformanceWarningSystem();

  return {
    warnings: computed(() => system.warnings.value),
    metrics: computed(() => system.metrics.value),
    enabled: computed(() => system.enabled.value),
    start: () => system.start(),
    stop: () => system.stop(),
    clearWarning: (id: string) => system.clearWarning(id),
    clearAllWarnings: () => system.clearAllWarnings(),
    addListener: (callback: WarningListener) => system.addListener(callback),
    getStats: () => system.getStats(),
    exportHistory: () => system.exportHistory(),
    setThreshold: (type: string, level: WarningLevel, value: number) =>
      system.setThreshold(type, level, value),
    setNotificationEnabled: (enabled: boolean) =>
      system.setNotificationEnabled(enabled),
  };
}

export default {
  getPerformanceWarningSystem,
  usePerformanceWarning,
  WARNING_LEVELS,
  WARNING_TYPES,
  THRESHOLDS,
};
