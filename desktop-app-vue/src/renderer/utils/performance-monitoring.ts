/**
 * Performance Budget and Real-time Monitoring System
 * 性能预算和实时监控系统
 *
 * Features:
 * - Performance budget definition and checking
 * - Core Web Vitals monitoring (LCP, FID, CLS)
 * - Real-time performance tracking
 * - Performance alerts
 * - Automated reporting
 * - Regression detection
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 性能预算配置接口
 */
export interface PerformanceBudgets {
  // Time budgets (ms)
  FCP?: number;
  LCP?: number;
  FID?: number;
  TTI?: number;
  TBT?: number;
  // Size budgets (KB)
  totalJS?: number;
  totalCSS?: number;
  totalImages?: number;
  totalFonts?: number;
  // Count budgets
  requests?: number;
  domSize?: number;
  // Other metrics
  CLS?: number;
  FPS?: number;
  [key: string]: number | undefined;
}

/**
 * 预算违规信息
 */
export interface BudgetViolation {
  metric: string;
  budget: number;
  actual: number;
  exceeded: number;
  percentage: string;
}

/**
 * 预算检查结果
 */
export interface BudgetCheckResult {
  passed: boolean;
  violations: BudgetViolation[];
}

/**
 * 预算状态
 */
export interface BudgetStatus {
  budgets: PerformanceBudgets;
  violations: BudgetViolation[];
  passed: boolean;
}

/**
 * 违规监听器类型
 */
export type ViolationListener = (violation: BudgetViolation) => void;

/**
 * Core Web Vitals 监控选项
 */
export interface WebVitalsOptions {
  reportInterval?: number;
  sampleRate?: number;
  debug?: boolean;
}

/**
 * Web Vitals 指标
 */
export interface WebVitalsMetrics {
  LCP: number | null;
  FID: number | null;
  CLS: number | null;
  FCP: number | null;
  TTFB: number | null;
}

/**
 * Web Vitals 指标名称
 */
export type WebVitalMetricName = keyof WebVitalsMetrics;

/**
 * Web Vitals 监听器类型
 */
export type WebVitalsListener = (name: WebVitalMetricName, value: number) => void;

/**
 * 性能分数
 */
export type PerformanceScore = 'good' | 'needs-improvement' | 'poor' | 'unknown';

/**
 * 阈值配置
 */
export interface MetricThreshold {
  good: number;
  needsImprovement: number;
}

/**
 * 实时监控选项
 */
export interface RealtimeMonitorOptions {
  interval?: number;
  enableFPS?: boolean;
  enableMemory?: boolean;
  enableNetwork?: boolean;
  debug?: boolean;
}

/**
 * 内存信息
 */
export interface MemoryInfo {
  used: number;
  total: number;
  limit: number;
  usedMB: string;
}

/**
 * 网络信息
 */
export interface NetworkInfo {
  effectiveType: string;
  downlink: number;
  rtt: number;
  saveData: boolean;
}

/**
 * 实时监控指标
 */
export interface RealtimeMetrics {
  fps: number;
  memory: MemoryInfo | null;
  network: NetworkInfo | null;
  timestamp: number;
}

/**
 * 实时监控监听器类型
 */
export type RealtimeMetricsListener = (metrics: RealtimeMetrics) => void;

/**
 * 告警选项
 */
export interface AlertOptions {
  lowFPS?: number;
  highMemory?: number;
  slowNetwork?: string;
  cooldown?: number;
  notifications?: boolean;
}

/**
 * 告警严重程度
 */
export type AlertSeverity = 'info' | 'warning' | 'error';

/**
 * 告警信息
 */
export interface PerformanceAlert {
  type: string;
  message: string;
  timestamp: number;
  severity: AlertSeverity;
}

// ==================== 扩展全局接口 ====================

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }

  interface NavigatorConnection {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  }
}

// ==================== 类实现 ====================

/**
 * Performance Budget Manager
 * 性能预算管理器
 */
export class PerformanceBudgetManager {
  private budgets: Required<PerformanceBudgets>;
  private violations: BudgetViolation[];
  private listeners: ViolationListener[];

  constructor(budgets: PerformanceBudgets = {}) {
    this.budgets = {
      // Time budgets (ms)
      FCP: budgets.FCP ?? 1800,
      LCP: budgets.LCP ?? 2500,
      FID: budgets.FID ?? 100,
      TTI: budgets.TTI ?? 3800,
      TBT: budgets.TBT ?? 300,
      // Size budgets (KB)
      totalJS: budgets.totalJS ?? 200,
      totalCSS: budgets.totalCSS ?? 100,
      totalImages: budgets.totalImages ?? 500,
      totalFonts: budgets.totalFonts ?? 100,
      // Count budgets
      requests: budgets.requests ?? 50,
      domSize: budgets.domSize ?? 1500,
      // Other metrics
      CLS: budgets.CLS ?? 0.1,
      FPS: budgets.FPS ?? 55,
      ...budgets,
    };

    this.violations = [];
    this.listeners = [];
  }

  /**
   * Check if metrics meet budget
   */
  check(metrics: Record<string, number>): BudgetCheckResult {
    this.violations = [];

    Object.keys(this.budgets).forEach((key) => {
      const budget = this.budgets[key];
      const value = metrics[key];

      if (value !== undefined && budget !== undefined && value > budget) {
        const violation: BudgetViolation = {
          metric: key,
          budget,
          actual: value,
          exceeded: value - budget,
          percentage: ((value / budget - 1) * 100).toFixed(2),
        };

        this.violations.push(violation);

        logger.warn(
          `[PerformanceBudget] Budget exceeded: ${key}`,
          violation,
        );

        this.notifyViolation(violation);
      }
    });

    return {
      passed: this.violations.length === 0,
      violations: this.violations,
    };
  }

  /**
   * Add budget violation listener
   */
  onViolation(callback: ViolationListener): void {
    this.listeners.push(callback);
  }

  /**
   * Notify violation
   */
  private notifyViolation(violation: BudgetViolation): void {
    this.listeners.forEach((listener) => listener(violation));
  }

  /**
   * Get budget status
   */
  getStatus(): BudgetStatus {
    return {
      budgets: this.budgets,
      violations: this.violations,
      passed: this.violations.length === 0,
    };
  }

  /**
   * Update budget
   */
  updateBudget(key: string, value: number): void {
    this.budgets[key] = value;
    logger.info(`[PerformanceBudget] Updated ${key}: ${value}`);
  }
}

/**
 * Core Web Vitals Monitor
 * Core Web Vitals 监控器
 */
export class CoreWebVitalsMonitor {
  private options: Required<WebVitalsOptions>;
  private metrics: WebVitalsMetrics;
  private listeners: WebVitalsListener[];
  private observers: PerformanceObserver[];
  private _loadHandler: (() => void) | null;

  constructor(options: WebVitalsOptions = {}) {
    this.options = {
      reportInterval: options.reportInterval ?? 10000,
      sampleRate: options.sampleRate ?? 1.0,
      debug: options.debug ?? false,
    };

    this.metrics = {
      LCP: null,
      FID: null,
      CLS: null,
      FCP: null,
      TTFB: null,
    };

    this.listeners = [];
    this.observers = [];
    this._loadHandler = null;

    this.init();
  }

  /**
   * Initialize monitoring
   */
  private init(): void {
    this.observeLCP();
    this.observeFID();
    this.observeCLS();
    this.observeFCP();
    this.observeTTFB();

    logger.info('[WebVitals] Monitoring started');
  }

  /**
   * Observe LCP
   */
  private observeLCP(): void {
    if (typeof window === 'undefined' || !window.PerformanceObserver) {
      return;
    }

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1] as PerformanceEntry & {
          renderTime?: number;
          loadTime?: number;
        };

        this.metrics.LCP = lastEntry.renderTime || lastEntry.loadTime || null;

        if (this.options.debug) {
          logger.info('[WebVitals] LCP:', this.metrics.LCP);
        }

        if (this.metrics.LCP !== null) {
          this.notifyListeners('LCP', this.metrics.LCP);
        }
      });

      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      this.observers.push(observer);
    } catch (error) {
      logger.warn('[WebVitals] LCP observation failed:', error);
    }
  }

  /**
   * Observe FID
   */
  private observeFID(): void {
    if (typeof window === 'undefined' || !window.PerformanceObserver) {
      return;
    }

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();

        entries.forEach((entry) => {
          const fidEntry = entry as PerformanceEntry & {
            processingStart?: number;
          };
          if (fidEntry.processingStart && fidEntry.startTime) {
            this.metrics.FID = fidEntry.processingStart - fidEntry.startTime;

            if (this.options.debug) {
              logger.info('[WebVitals] FID:', this.metrics.FID);
            }

            this.notifyListeners('FID', this.metrics.FID);
          }
        });
      });

      observer.observe({ type: 'first-input', buffered: true });
      this.observers.push(observer);
    } catch (error) {
      logger.warn('[WebVitals] FID observation failed:', error);
    }
  }

  /**
   * Observe CLS
   */
  private observeCLS(): void {
    if (typeof window === 'undefined' || !window.PerformanceObserver) {
      return;
    }

    let clsValue = 0;
    let sessionValue = 0;
    let sessionEntries: PerformanceEntry[] = [];

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const layoutShiftEntry = entry as PerformanceEntry & {
            hadRecentInput?: boolean;
            value?: number;
          };

          if (!layoutShiftEntry.hadRecentInput) {
            const firstSessionEntry = sessionEntries[0];
            const lastSessionEntry = sessionEntries[sessionEntries.length - 1];

            if (
              sessionValue &&
              lastSessionEntry &&
              firstSessionEntry &&
              entry.startTime - lastSessionEntry.startTime < 1000 &&
              entry.startTime - firstSessionEntry.startTime < 5000
            ) {
              sessionValue += layoutShiftEntry.value || 0;
              sessionEntries.push(entry);
            } else {
              sessionValue = layoutShiftEntry.value || 0;
              sessionEntries = [entry];
            }

            if (sessionValue > clsValue) {
              clsValue = sessionValue;
              this.metrics.CLS = clsValue;

              if (this.options.debug) {
                logger.info('[WebVitals] CLS:', this.metrics.CLS);
              }

              this.notifyListeners('CLS', this.metrics.CLS);
            }
          }
        }
      });

      observer.observe({ type: 'layout-shift', buffered: true });
      this.observers.push(observer);
    } catch (error) {
      logger.warn('[WebVitals] CLS observation failed:', error);
    }
  }

  /**
   * Observe FCP
   */
  private observeFCP(): void {
    if (typeof window === 'undefined' || !window.PerformanceObserver) {
      return;
    }

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();

        entries.forEach((entry) => {
          if (entry.name === 'first-contentful-paint') {
            this.metrics.FCP = entry.startTime;

            if (this.options.debug) {
              logger.info('[WebVitals] FCP:', this.metrics.FCP);
            }

            this.notifyListeners('FCP', this.metrics.FCP);
          }
        });
      });

      observer.observe({ type: 'paint', buffered: true });
      this.observers.push(observer);
    } catch (error) {
      logger.warn('[WebVitals] FCP observation failed:', error);
    }
  }

  /**
   * Observe TTFB
   */
  private observeTTFB(): void {
    if (typeof window === 'undefined' || !window.performance || !window.performance.timing) {
      return;
    }

    this._loadHandler = () => {
      const timing = performance.timing;
      this.metrics.TTFB = timing.responseStart - timing.requestStart;

      if (this.options.debug) {
        logger.info('[WebVitals] TTFB:', this.metrics.TTFB);
      }

      this.notifyListeners('TTFB', this.metrics.TTFB);
    };
    window.addEventListener('load', this._loadHandler);
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    this.observers.forEach((observer) => {
      try {
        observer.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    });
    this.observers = [];

    if (this._loadHandler && typeof window !== 'undefined') {
      window.removeEventListener('load', this._loadHandler);
      this._loadHandler = null;
    }

    this.listeners = [];

    logger.info('[WebVitals] Monitoring stopped');
  }

  /**
   * Add metric listener
   */
  onMetric(callback: WebVitalsListener): void {
    this.listeners.push(callback);
  }

  /**
   * Notify listeners
   */
  private notifyListeners(name: WebVitalMetricName, value: number): void {
    this.listeners.forEach((listener) => listener(name, value));
  }

  /**
   * Get all metrics
   */
  getMetrics(): WebVitalsMetrics {
    return { ...this.metrics };
  }

  /**
   * Get metric score
   */
  getScore(metric: string, value: number): PerformanceScore {
    const thresholds: Record<string, MetricThreshold> = {
      LCP: { good: 2500, needsImprovement: 4000 },
      FID: { good: 100, needsImprovement: 300 },
      CLS: { good: 0.1, needsImprovement: 0.25 },
      FCP: { good: 1800, needsImprovement: 3000 },
      TTFB: { good: 800, needsImprovement: 1800 },
    };

    const threshold = thresholds[metric];
    if (!threshold) {
      return 'unknown';
    }

    if (value <= threshold.good) {
      return 'good';
    }
    if (value <= threshold.needsImprovement) {
      return 'needs-improvement';
    }
    return 'poor';
  }

  /**
   * Get overall score
   */
  getOverallScore(): PerformanceScore {
    const scores = (Object.keys(this.metrics) as WebVitalMetricName[])
      .filter((key) => this.metrics[key] !== null)
      .map((key) => this.getScore(key, this.metrics[key] as number));

    const goodCount = scores.filter((s) => s === 'good').length;
    const totalCount = scores.length;

    if (totalCount === 0) {
      return 'unknown';
    }

    const percentage = (goodCount / totalCount) * 100;

    if (percentage >= 75) {
      return 'good';
    }
    if (percentage >= 50) {
      return 'needs-improvement';
    }
    return 'poor';
  }
}

/**
 * Real-time Performance Monitor
 * 实时性能监控器
 */
export class RealtimePerformanceMonitor {
  private options: Required<RealtimeMonitorOptions>;
  private metrics: RealtimeMetrics;
  private listeners: RealtimeMetricsListener[];
  private intervalId: ReturnType<typeof setInterval> | null;
  private frameCount: number;
  private lastFrameTime: number;

  constructor(options: RealtimeMonitorOptions = {}) {
    this.options = {
      interval: options.interval ?? 1000,
      enableFPS: options.enableFPS !== false,
      enableMemory: options.enableMemory !== false,
      enableNetwork: options.enableNetwork !== false,
      debug: options.debug ?? false,
    };

    this.metrics = {
      fps: 0,
      memory: null,
      network: null,
      timestamp: Date.now(),
    };

    this.listeners = [];
    this.intervalId = null;
    this.frameCount = 0;
    this.lastFrameTime = performance.now();
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('[RealtimeMonitor] Already monitoring');
      return;
    }

    if (this.options.enableFPS) {
      this.startFPSMonitoring();
    }

    this.intervalId = setInterval(() => {
      this.update();
    }, this.options.interval);

    logger.info('[RealtimeMonitor] Monitoring started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    logger.info('[RealtimeMonitor] Monitoring stopped');
  }

  /**
   * Start FPS monitoring
   */
  private startFPSMonitoring(): void {
    const measureFPS = (): void => {
      const now = performance.now();
      const delta = now - this.lastFrameTime;

      this.frameCount++;

      if (delta >= 1000) {
        this.metrics.fps = Math.round((this.frameCount * 1000) / delta);
        this.frameCount = 0;
        this.lastFrameTime = now;
      }

      requestAnimationFrame(measureFPS);
    };

    measureFPS();
  }

  /**
   * Update metrics
   */
  private update(): void {
    this.metrics.timestamp = Date.now();

    if (this.options.enableMemory && performance.memory) {
      this.metrics.memory = {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
        usedMB: (performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2),
      };
    }

    const navConnection = (navigator as any).connection as NavigatorConnection | undefined;
    if (this.options.enableNetwork && navConnection) {
      this.metrics.network = {
        effectiveType: navConnection.effectiveType,
        downlink: navConnection.downlink,
        rtt: navConnection.rtt,
        saveData: navConnection.saveData,
      };
    }

    if (this.options.debug) {
      logger.info('[RealtimeMonitor] Metrics:', this.metrics);
    }

    this.notifyListeners(this.metrics);
  }

  /**
   * Add metrics listener
   */
  onUpdate(callback: RealtimeMetricsListener): void {
    this.listeners.push(callback);
  }

  /**
   * Notify listeners
   */
  private notifyListeners(metrics: RealtimeMetrics): void {
    this.listeners.forEach((listener) => listener(metrics));
  }

  /**
   * Get current metrics
   */
  getMetrics(): RealtimeMetrics {
    return { ...this.metrics };
  }
}

/**
 * Performance Alert System
 * 性能告警系统
 */
export class PerformanceAlertSystem {
  private options: Required<AlertOptions>;
  private lastAlerts: Record<string, number>;

  constructor(options: AlertOptions = {}) {
    this.options = {
      lowFPS: options.lowFPS ?? 30,
      highMemory: options.highMemory ?? 100,
      slowNetwork: options.slowNetwork ?? 'slow-2g',
      cooldown: options.cooldown ?? 5000,
      notifications: options.notifications ?? false,
    };

    this.lastAlerts = {};
  }

  /**
   * Check metrics and alert
   */
  check(metrics: RealtimeMetrics): PerformanceAlert[] {
    const alerts: PerformanceAlert[] = [];

    if (metrics.fps && metrics.fps < this.options.lowFPS) {
      alerts.push(this.createAlert('low-fps', `FPS is low: ${metrics.fps}`));
    }

    if (
      metrics.memory &&
      parseFloat(metrics.memory.usedMB) > this.options.highMemory
    ) {
      alerts.push(
        this.createAlert(
          'high-memory',
          `Memory usage is high: ${metrics.memory.usedMB} MB`,
        ),
      );
    }

    if (
      metrics.network &&
      metrics.network.effectiveType === this.options.slowNetwork
    ) {
      alerts.push(
        this.createAlert(
          'slow-network',
          `Network is slow: ${metrics.network.effectiveType}`,
        ),
      );
    }

    alerts.forEach((alert) => this.processAlert(alert));

    return alerts;
  }

  /**
   * Create alert
   */
  private createAlert(type: string, message: string): PerformanceAlert {
    return {
      type,
      message,
      timestamp: Date.now(),
      severity: this.getSeverity(type),
    };
  }

  /**
   * Get alert severity
   */
  private getSeverity(type: string): AlertSeverity {
    const severityMap: Record<string, AlertSeverity> = {
      'low-fps': 'warning',
      'high-memory': 'error',
      'slow-network': 'info',
    };

    return severityMap[type] || 'info';
  }

  /**
   * Process alert
   */
  private processAlert(alert: PerformanceAlert): void {
    const lastAlert = this.lastAlerts[alert.type];
    if (lastAlert && Date.now() - lastAlert < this.options.cooldown) {
      return;
    }

    this.lastAlerts[alert.type] = Date.now();

    logger.warn(
      `[PerformanceAlert] ${alert.severity.toUpperCase()}: ${alert.message}`,
    );

    if (
      this.options.notifications &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification('Performance Alert', {
        body: alert.message,
        icon: '/icon.png',
      });
    }
  }

  /**
   * Request notification permission
   */
  static async requestNotificationPermission(): Promise<NotificationPermission | undefined> {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      return await Notification.requestPermission();
    }

    return typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : undefined;
  }
}

// Global instances
export const performanceBudget = new PerformanceBudgetManager();
export const webVitalsMonitor = new CoreWebVitalsMonitor();
export const realtimeMonitor = new RealtimePerformanceMonitor();
export const alertSystem = new PerformanceAlertSystem();

/**
 * Export default object
 */
export default {
  PerformanceBudgetManager,
  CoreWebVitalsMonitor,
  RealtimePerformanceMonitor,
  PerformanceAlertSystem,
  performanceBudget,
  webVitalsMonitor,
  realtimeMonitor,
  alertSystem,
};
