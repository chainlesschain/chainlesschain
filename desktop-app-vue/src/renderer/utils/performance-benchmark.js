import { logger, createLogger } from '@/utils/logger';

/**
 * Performance Benchmark Utility
 * 性能基准测试工具
 *
 * Features:
 * - Measure page load time
 * - FPS monitoring
 * - Memory usage tracking
 * - Network performance metrics
 * - Custom performance marks
 * - Generate performance reports
 */

class PerformanceBenchmark {
  constructor(options = {}) {
    // Configuration
    this.options = {
      enableAutoTracking: options.enableAutoTracking !== false,
      sampleInterval: options.sampleInterval || 1000, // ms
      debug: options.debug || false,
    }

    // Metrics
    this.metrics = {
      pageLoad: {},
      fps: [],
      memory: [],
      network: {},
      customMarks: [],
    }

    // State
    this.startTime = null
    this.lastFrameTime = null
    this.frameCount = 0
    this.sampleTimer = null

    // Initialize
    this.init()
  }

  /**
   * Initialize benchmark
   */
  init() {
    if (this.options.enableAutoTracking) {
      this.trackPageLoad()
      this.startFPSMonitoring()
      this.startMemoryMonitoring()
    }

    if (this.options.debug) {
      logger.info('[PerformanceBenchmark] Initialized')
    }
  }

  /**
   * Track page load metrics
   */
  trackPageLoad() {
    if (!performance.timing) {return}

    window.addEventListener('load', () => {
      const timing = performance.timing
      const navigation = performance.navigation

      this.metrics.pageLoad = {
        // DNS lookup
        dnsTime: timing.domainLookupEnd - timing.domainLookupStart,

        // TCP connection
        tcpTime: timing.connectEnd - timing.connectStart,

        // Request/Response
        requestTime: timing.responseStart - timing.requestStart,
        responseTime: timing.responseEnd - timing.responseStart,

        // DOM processing
        domParseTime: timing.domInteractive - timing.responseEnd,
        domReadyTime: timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart,

        // Resource loading
        resourceLoadTime: timing.loadEventStart - timing.domContentLoadedEventEnd,

        // Total time
        totalTime: timing.loadEventEnd - timing.navigationStart,

        // First Paint
        firstPaint: this.getFirstPaint(),

        // Navigation type
        navigationType: this.getNavigationType(navigation.type),
      }

      if (this.options.debug) {
        logger.info('[PerformanceBenchmark] Page load metrics:', this.metrics.pageLoad)
      }
    })
  }

  /**
   * Get First Paint time
   */
  getFirstPaint() {
    const paintEntries = performance.getEntriesByType('paint')
    const firstPaint = paintEntries.find((entry) => entry.name === 'first-paint')
    return firstPaint ? Math.round(firstPaint.startTime) : null
  }

  /**
   * Get navigation type
   */
  getNavigationType(type) {
    const types = {
      0: 'navigate',
      1: 'reload',
      2: 'back_forward',
      255: 'reserved',
    }
    return types[type] || 'unknown'
  }

  /**
   * Start FPS monitoring
   */
  startFPSMonitoring() {
    this.lastFrameTime = performance.now()
    this.frameCount = 0

    const measureFPS = (currentTime) => {
      this.frameCount++

      const elapsed = currentTime - this.lastFrameTime

      if (elapsed >= this.options.sampleInterval) {
        const fps = Math.round((this.frameCount * 1000) / elapsed)

        this.metrics.fps.push({
          timestamp: Date.now(),
          fps,
        })

        // Keep only last 100 samples
        if (this.metrics.fps.length > 100) {
          this.metrics.fps.shift()
        }

        this.frameCount = 0
        this.lastFrameTime = currentTime
      }

      requestAnimationFrame(measureFPS)
    }

    requestAnimationFrame(measureFPS)

    if (this.options.debug) {
      logger.info('[PerformanceBenchmark] FPS monitoring started')
    }
  }

  /**
   * Start memory monitoring
   */
  startMemoryMonitoring() {
    if (!performance.memory) {
      logger.warn('[PerformanceBenchmark] Memory API not available')
      return
    }

    this.sampleTimer = setInterval(() => {
      const memoryInfo = {
        timestamp: Date.now(),
        usedJSHeapSizeMB: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        totalJSHeapSizeMB: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
        heapSizeLimitMB: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024),
      }

      this.metrics.memory.push(memoryInfo)

      // Keep only last 100 samples
      if (this.metrics.memory.length > 100) {
        this.metrics.memory.shift()
      }
    }, this.options.sampleInterval)

    if (this.options.debug) {
      logger.info('[PerformanceBenchmark] Memory monitoring started')
    }
  }

  /**
   * Measure network performance
   */
  measureNetwork() {
    if (!performance.getEntriesByType) {return}

    const resources = performance.getEntriesByType('resource')

    const networkMetrics = {
      totalRequests: resources.length,
      totalTransferSize: 0,
      totalDuration: 0,
      byType: {},
    }

    resources.forEach((resource) => {
      // Total transfer size
      networkMetrics.totalTransferSize += resource.transferSize || 0

      // Total duration
      networkMetrics.totalDuration += resource.duration

      // Group by type
      const type = this.getResourceType(resource.name)

      if (!networkMetrics.byType[type]) {
        networkMetrics.byType[type] = {
          count: 0,
          transferSize: 0,
          duration: 0,
        }
      }

      networkMetrics.byType[type].count++
      networkMetrics.byType[type].transferSize += resource.transferSize || 0
      networkMetrics.byType[type].duration += resource.duration
    })

    this.metrics.network = networkMetrics

    return networkMetrics
  }

  /**
   * Get resource type from URL
   */
  getResourceType(url) {
    if (url.match(/\.(js|mjs)$/)) {return 'script'}
    if (url.match(/\.(css)$/)) {return 'stylesheet'}
    if (url.match(/\.(jpg|jpeg|png|gif|svg|webp)$/)) {return 'image'}
    if (url.match(/\.(woff|woff2|ttf|otf)$/)) {return 'font'}
    if (url.match(/\.(mp4|webm|ogg)$/)) {return 'video'}
    if (url.match(/\.(json)$/)) {return 'fetch'}
    return 'other'
  }

  /**
   * Create custom performance mark
   */
  mark(name) {
    if (performance.mark) {
      performance.mark(name)

      this.metrics.customMarks.push({
        name,
        timestamp: performance.now(),
      })

      if (this.options.debug) {
        logger.info(`[PerformanceBenchmark] Mark: ${name}`)
      }
    }
  }

  /**
   * Measure time between two marks
   */
  measure(name, startMark, endMark) {
    if (performance.measure) {
      try {
        performance.measure(name, startMark, endMark)

        const measure = performance.getEntriesByName(name, 'measure')[0]

        if (this.options.debug) {
          logger.info(`[PerformanceBenchmark] Measure: ${name} = ${Math.round(measure.duration)}ms`)
        }

        return measure.duration
      } catch (error) {
        logger.error('[PerformanceBenchmark] Measure error:', error)
        return null
      }
    }

    return null
  }

  /**
   * Get average FPS
   */
  getAverageFPS() {
    if (this.metrics.fps.length === 0) {return 0}

    const sum = this.metrics.fps.reduce((acc, sample) => acc + sample.fps, 0)
    return Math.round(sum / this.metrics.fps.length)
  }

  /**
   * Get current memory usage
   */
  getCurrentMemory() {
    if (this.metrics.memory.length === 0) {return null}

    return this.metrics.memory[this.metrics.memory.length - 1]
  }

  /**
   * Get performance score (0-100)
   */
  getPerformanceScore() {
    let score = 100

    // Page load time (< 3s = good)
    const loadTime = this.metrics.pageLoad.totalTime || 0
    if (loadTime > 5000) {score -= 30}
    else if (loadTime > 3000) {score -= 15}

    // FPS (>= 55 = good)
    const avgFPS = this.getAverageFPS()
    if (avgFPS < 30) {score -= 30}
    else if (avgFPS < 55) {score -= 15}

    // Memory usage (< 100MB = good)
    const memory = this.getCurrentMemory()
    if (memory && memory.usedJSHeapSizeMB > 200) {score -= 20}
    else if (memory && memory.usedJSHeapSizeMB > 100) {score -= 10}

    return Math.max(0, score)
  }

  /**
   * Generate performance report
   */
  generateReport() {
    this.measureNetwork()

    const report = {
      timestamp: new Date().toISOString(),
      score: this.getPerformanceScore(),
      pageLoad: this.metrics.pageLoad,
      fps: {
        average: this.getAverageFPS(),
        samples: this.metrics.fps.length,
        min: Math.min(...this.metrics.fps.map((s) => s.fps)),
        max: Math.max(...this.metrics.fps.map((s) => s.fps)),
      },
      memory: {
        current: this.getCurrentMemory(),
        samples: this.metrics.memory.length,
      },
      network: this.metrics.network,
      customMarks: this.metrics.customMarks,
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    }

    if (this.options.debug) {
      logger.info('[PerformanceBenchmark] Performance Report:', report)
    }

    return report
  }

  /**
   * Export report as JSON
   */
  exportReport(filename = `performance-report-${Date.now()}.json`) {
    const report = this.generateReport()
    const json = JSON.stringify(report, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()

    URL.revokeObjectURL(url)

    if (this.options.debug) {
      logger.info(`[PerformanceBenchmark] Report exported: ${filename}`)
    }
  }

  /**
   * Log report to console (formatted)
   */
  logReport() {
    const report = this.generateReport()

    console.group('📊 Performance Report')
    logger.info(`Score: ${report.score}/100`)
    logger.info(`Page Load Time: ${report.pageLoad.totalTime}ms`)
    logger.info(`Average FPS: ${report.fps.average}`)
    logger.info(`Memory Usage: ${report.memory.current?.usedJSHeapSizeMB}MB`)
    logger.info(`Network Requests: ${report.network.totalRequests}`)
    logger.info(`Transfer Size: ${Math.round(report.network.totalTransferSize / 1024)}KB`)
    console.groupEnd()

    return report
  }

  /**
   * Compare with baseline
   */
  compare(baseline) {
    const current = this.generateReport()

    const comparison = {
      score: {
        baseline: baseline.score,
        current: current.score,
        diff: current.score - baseline.score,
      },
      loadTime: {
        baseline: baseline.pageLoad.totalTime,
        current: current.pageLoad.totalTime,
        diff: current.pageLoad.totalTime - baseline.pageLoad.totalTime,
        improvement: ((1 - current.pageLoad.totalTime / baseline.pageLoad.totalTime) * 100).toFixed(2) + '%',
      },
      fps: {
        baseline: baseline.fps.average,
        current: current.fps.average,
        diff: current.fps.average - baseline.fps.average,
      },
      memory: {
        baseline: baseline.memory.current?.usedJSHeapSizeMB || 0,
        current: current.memory.current?.usedJSHeapSizeMB || 0,
        diff: (current.memory.current?.usedJSHeapSizeMB || 0) - (baseline.memory.current?.usedJSHeapSizeMB || 0),
      },
    }

    logger.info('📈 Performance Comparison:', comparison)

    return comparison
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer)
      this.sampleTimer = null
    }

    if (this.options.debug) {
      logger.info('[PerformanceBenchmark] Stopped')
    }
  }
}

// Singleton instance
let benchmarkInstance = null

/**
 * Get or create performance benchmark instance
 */
export function getPerformanceBenchmark(options) {
  if (!benchmarkInstance) {
    benchmarkInstance = new PerformanceBenchmark(options)
  }
  return benchmarkInstance
}

/**
 * Convenience functions
 */
export function mark(name) {
  const benchmark = getPerformanceBenchmark()
  return benchmark.mark(name)
}

export function measure(name, startMark, endMark) {
  const benchmark = getPerformanceBenchmark()
  return benchmark.measure(name, startMark, endMark)
}

export function generateReport() {
  const benchmark = getPerformanceBenchmark()
  return benchmark.generateReport()
}

export function exportReport(filename) {
  const benchmark = getPerformanceBenchmark()
  return benchmark.exportReport(filename)
}

export default PerformanceBenchmark
