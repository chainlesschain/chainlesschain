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

/**
 * Performance Budget Manager
 * 性能预算管理器
 */
export class PerformanceBudgetManager {
  constructor(budgets = {}) {
    this.budgets = {
      // Time budgets (ms)
      FCP: budgets.FCP || 1800, // First Contentful Paint
      LCP: budgets.LCP || 2500, // Largest Contentful Paint
      FID: budgets.FID || 100,  // First Input Delay
      TTI: budgets.TTI || 3800, // Time to Interactive
      TBT: budgets.TBT || 300,  // Total Blocking Time

      // Size budgets (KB)
      totalJS: budgets.totalJS || 200,
      totalCSS: budgets.totalCSS || 100,
      totalImages: budgets.totalImages || 500,
      totalFonts: budgets.totalFonts || 100,

      // Count budgets
      requests: budgets.requests || 50,
      domSize: budgets.domSize || 1500,

      // Other metrics
      CLS: budgets.CLS || 0.1, // Cumulative Layout Shift
      FPS: budgets.FPS || 55,   // Frames per second
      ...budgets,
    };

    this.violations = [];
    this.listeners = [];
  }

  /**
   * Check if metrics meet budget
   */
  check(metrics) {
    this.violations = [];

    Object.keys(this.budgets).forEach((key) => {
      const budget = this.budgets[key];
      const value = metrics[key];

      if (value !== undefined && value > budget) {
        const violation = {
          metric: key,
          budget,
          actual: value,
          exceeded: value - budget,
          percentage: ((value / budget - 1) * 100).toFixed(2),
        };

        this.violations.push(violation);

        console.warn(`[PerformanceBudget] ⚠️ Budget exceeded: ${key}`, violation);

        // Notify listeners
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
  onViolation(callback) {
    this.listeners.push(callback);
  }

  /**
   * Notify violation
   */
  notifyViolation(violation) {
    this.listeners.forEach((listener) => listener(violation));
  }

  /**
   * Get budget status
   */
  getStatus() {
    return {
      budgets: this.budgets,
      violations: this.violations,
      passed: this.violations.length === 0,
    };
  }

  /**
   * Update budget
   */
  updateBudget(key, value) {
    this.budgets[key] = value;
    console.log(`[PerformanceBudget] Updated ${key}: ${value}`);
  }
}

/**
 * Core Web Vitals Monitor
 * Core Web Vitals 监控器
 */
export class CoreWebVitalsMonitor {
  constructor(options = {}) {
    this.options = {
      reportInterval: options.reportInterval || 10000, // 10 seconds
      sampleRate: options.sampleRate || 1.0, // 100% sampling
      debug: options.debug || false,
    };

    this.metrics = {
      LCP: null,
      FID: null,
      CLS: null,
      FCP: null,
      TTFB: null,
    };

    this.listeners = [];
    this.observer = null;

    this.init();
  }

  /**
   * Initialize monitoring
   */
  init() {
    // Monitor LCP (Largest Contentful Paint)
    this.observeLCP();

    // Monitor FID (First Input Delay)
    this.observeFID();

    // Monitor CLS (Cumulative Layout Shift)
    this.observeCLS();

    // Monitor FCP (First Contentful Paint)
    this.observeFCP();

    // Monitor TTFB (Time to First Byte)
    this.observeTTFB();

    console.log('[WebVitals] Monitoring started');
  }

  /**
   * Observe LCP
   */
  observeLCP() {
    if (!window.PerformanceObserver) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];

        this.metrics.LCP = lastEntry.renderTime || lastEntry.loadTime;

        if (this.options.debug) {
          console.log('[WebVitals] LCP:', this.metrics.LCP);
        }

        this.notifyListeners('LCP', this.metrics.LCP);
      });

      observer.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (error) {
      console.warn('[WebVitals] LCP observation failed:', error);
    }
  }

  /**
   * Observe FID
   */
  observeFID() {
    if (!window.PerformanceObserver) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();

        entries.forEach((entry) => {
          if (entry.processingStart && entry.startTime) {
            this.metrics.FID = entry.processingStart - entry.startTime;

            if (this.options.debug) {
              console.log('[WebVitals] FID:', this.metrics.FID);
            }

            this.notifyListeners('FID', this.metrics.FID);
          }
        });
      });

      observer.observe({ type: 'first-input', buffered: true });
    } catch (error) {
      console.warn('[WebVitals] FID observation failed:', error);
    }
  }

  /**
   * Observe CLS
   */
  observeCLS() {
    if (!window.PerformanceObserver) return;

    let clsValue = 0;
    let sessionValue = 0;
    let sessionEntries = [];

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            const firstSessionEntry = sessionEntries[0];
            const lastSessionEntry = sessionEntries[sessionEntries.length - 1];

            if (
              sessionValue &&
              entry.startTime - lastSessionEntry.startTime < 1000 &&
              entry.startTime - firstSessionEntry.startTime < 5000
            ) {
              sessionValue += entry.value;
              sessionEntries.push(entry);
            } else {
              sessionValue = entry.value;
              sessionEntries = [entry];
            }

            if (sessionValue > clsValue) {
              clsValue = sessionValue;
              this.metrics.CLS = clsValue;

              if (this.options.debug) {
                console.log('[WebVitals] CLS:', this.metrics.CLS);
              }

              this.notifyListeners('CLS', this.metrics.CLS);
            }
          }
        }
      });

      observer.observe({ type: 'layout-shift', buffered: true });
    } catch (error) {
      console.warn('[WebVitals] CLS observation failed:', error);
    }
  }

  /**
   * Observe FCP
   */
  observeFCP() {
    if (!window.PerformanceObserver) return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();

        entries.forEach((entry) => {
          if (entry.name === 'first-contentful-paint') {
            this.metrics.FCP = entry.startTime;

            if (this.options.debug) {
              console.log('[WebVitals] FCP:', this.metrics.FCP);
            }

            this.notifyListeners('FCP', this.metrics.FCP);
          }
        });
      });

      observer.observe({ type: 'paint', buffered: true });
    } catch (error) {
      console.warn('[WebVitals] FCP observation failed:', error);
    }
  }

  /**
   * Observe TTFB
   */
  observeTTFB() {
    if (!window.performance || !window.performance.timing) return;

    window.addEventListener('load', () => {
      const timing = performance.timing;
      this.metrics.TTFB = timing.responseStart - timing.requestStart;

      if (this.options.debug) {
        console.log('[WebVitals] TTFB:', this.metrics.TTFB);
      }

      this.notifyListeners('TTFB', this.metrics.TTFB);
    });
  }

  /**
   * Add metric listener
   */
  onMetric(callback) {
    this.listeners.push(callback);
  }

  /**
   * Notify listeners
   */
  notifyListeners(name, value) {
    this.listeners.forEach((listener) => listener(name, value));
  }

  /**
   * Get all metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Get metric score
   */
  getScore(metric, value) {
    const thresholds = {
      LCP: { good: 2500, needsImprovement: 4000 },
      FID: { good: 100, needsImprovement: 300 },
      CLS: { good: 0.1, needsImprovement: 0.25 },
      FCP: { good: 1800, needsImprovement: 3000 },
      TTFB: { good: 800, needsImprovement: 1800 },
    };

    const threshold = thresholds[metric];
    if (!threshold) return 'unknown';

    if (value <= threshold.good) return 'good';
    if (value <= threshold.needsImprovement) return 'needs-improvement';
    return 'poor';
  }

  /**
   * Get overall score
   */
  getOverallScore() {
    const scores = Object.keys(this.metrics)
      .filter((key) => this.metrics[key] !== null)
      .map((key) => this.getScore(key, this.metrics[key]));

    const goodCount = scores.filter((s) => s === 'good').length;
    const totalCount = scores.length;

    if (totalCount === 0) return 'unknown';

    const percentage = (goodCount / totalCount) * 100;

    if (percentage >= 75) return 'good';
    if (percentage >= 50) return 'needs-improvement';
    return 'poor';
  }
}

/**
 * Real-time Performance Monitor
 * 实时性能监控器
 */
export class RealtimePerformanceMonitor {
  constructor(options = {}) {
    this.options = {
      interval: options.interval || 1000, // 1 second
      enableFPS: options.enableFPS !== false,
      enableMemory: options.enableMemory !== false,
      enableNetwork: options.enableNetwork !== false,
      debug: options.debug || false,
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
  start() {
    if (this.intervalId) {
      console.warn('[RealtimeMonitor] Already monitoring');
      return;
    }

    // Start FPS monitoring
    if (this.options.enableFPS) {
      this.startFPSMonitoring();
    }

    // Start periodic updates
    this.intervalId = setInterval(() => {
      this.update();
    }, this.options.interval);

    console.log('[RealtimeMonitor] Monitoring started');
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('[RealtimeMonitor] Monitoring stopped');
  }

  /**
   * Start FPS monitoring
   */
  startFPSMonitoring() {
    const measureFPS = () => {
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
  update() {
    this.metrics.timestamp = Date.now();

    // Update memory
    if (this.options.enableMemory && performance.memory) {
      this.metrics.memory = {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
        usedMB: (performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2),
      };
    }

    // Update network
    if (this.options.enableNetwork && navigator.connection) {
      this.metrics.network = {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt,
        saveData: navigator.connection.saveData,
      };
    }

    if (this.options.debug) {
      console.log('[RealtimeMonitor] Metrics:', this.metrics);
    }

    // Notify listeners
    this.notifyListeners(this.metrics);
  }

  /**
   * Add metrics listener
   */
  onUpdate(callback) {
    this.listeners.push(callback);
  }

  /**
   * Notify listeners
   */
  notifyListeners(metrics) {
    this.listeners.forEach((listener) => listener(metrics));
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }
}

/**
 * Performance Alert System
 * 性能告警系统
 */
export class PerformanceAlertSystem {
  constructor(options = {}) {
    this.options = {
      // Alert thresholds
      lowFPS: options.lowFPS || 30,
      highMemory: options.highMemory || 100, // MB
      slowNetwork: options.slowNetwork || 'slow-2g',

      // Alert cooldown (ms)
      cooldown: options.cooldown || 5000,

      // Enable notifications
      notifications: options.notifications || false,
    };

    this.lastAlerts = {};
  }

  /**
   * Check metrics and alert
   */
  check(metrics) {
    const alerts = [];

    // Check FPS
    if (metrics.fps && metrics.fps < this.options.lowFPS) {
      alerts.push(this.createAlert('low-fps', `FPS is low: ${metrics.fps}`));
    }

    // Check memory
    if (metrics.memory && parseFloat(metrics.memory.usedMB) > this.options.highMemory) {
      alerts.push(this.createAlert('high-memory', `Memory usage is high: ${metrics.memory.usedMB} MB`));
    }

    // Check network
    if (metrics.network && metrics.network.effectiveType === this.options.slowNetwork) {
      alerts.push(this.createAlert('slow-network', `Network is slow: ${metrics.network.effectiveType}`));
    }

    // Process alerts
    alerts.forEach((alert) => this.processAlert(alert));

    return alerts;
  }

  /**
   * Create alert
   */
  createAlert(type, message) {
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
  getSeverity(type) {
    const severityMap = {
      'low-fps': 'warning',
      'high-memory': 'error',
      'slow-network': 'info',
    };

    return severityMap[type] || 'info';
  }

  /**
   * Process alert
   */
  processAlert(alert) {
    // Check cooldown
    const lastAlert = this.lastAlerts[alert.type];
    if (lastAlert && Date.now() - lastAlert < this.options.cooldown) {
      return;
    }

    this.lastAlerts[alert.type] = Date.now();

    console.warn(`[PerformanceAlert] ${alert.severity.toUpperCase()}: ${alert.message}`);

    // Show browser notification if enabled
    if (this.options.notifications && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Performance Alert', {
        body: alert.message,
        icon: '/icon.png',
      });
    }
  }

  /**
   * Request notification permission
   */
  static async requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      return await Notification.requestPermission();
    }

    return Notification.permission;
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
