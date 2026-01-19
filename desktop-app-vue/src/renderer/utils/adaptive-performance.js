/**
 * Adaptive Performance Tuner
 * Dynamically adjusts performance parameters based on device capabilities and runtime metrics
 */

import { logger, createLogger } from '@/utils/logger';
import performanceTracker from './performance-tracker'

class AdaptivePerformance {
  constructor() {
    // Device capabilities
    this.deviceProfile = {
      cores: navigator.hardwareConcurrency || 4,
      memory: this.getMemoryInfo(),
      connection: this.getConnectionInfo(),
      tier: 'unknown' // low, medium, high
    }

    // Performance targets (ms)
    this.targets = {
      fileLoad: 200,      // Target file load time
      renderFrame: 16,    // Target frame time (60 FPS)
      interaction: 100    // Target interaction response time
    }

    // Current settings
    this.settings = {
      workerPoolSize: 4,
      editorPoolSize: 10,
      fileTreeBatchSize: 50,
      virtualScrollBuffer: 5,
      debounceDelay: 300,
      cacheMaxSize: 100 * 1024 * 1024, // 100MB
      prefetchEnabled: true,
      prefetchMaxFiles: 5
    }

    // Performance metrics
    this.metrics = {
      avgFileLoadTime: 0,
      avgRenderTime: 0,
      avgInteractionTime: 0,
      memoryUsage: 0,
      frameDrops: 0,
      cacheHitRate: 0
    }

    // Tuning history
    this.tuningHistory = []
    this.lastTuning = Date.now()
    this.tuningInterval = 30000 // 30 seconds

    // Initialize
    this.detectDeviceTier()
    this.applyInitialSettings()
    this.startMonitoring()
  }

  /**
   * Get memory information
   */
  getMemoryInfo() {
    if (performance.memory) {
      return {
        total: performance.memory.jsHeapSizeLimit,
        totalMB: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
      }
    }

    // Estimate based on cores
    return {
      total: this.deviceProfile.cores * 512 * 1024 * 1024,
      totalMB: this.deviceProfile.cores * 512
    }
  }

  /**
   * Get connection information
   */
  getConnectionInfo() {
    if (navigator.connection) {
      return {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt,
        saveData: navigator.connection.saveData
      }
    }

    return { effectiveType: 'unknown' }
  }

  /**
   * Detect device performance tier
   */
  detectDeviceTier() {
    const { cores, memory } = this.deviceProfile
    let score = 0

    // CPU score
    if (cores >= 8) {score += 3}
    else if (cores >= 4) {score += 2}
    else {score += 1}

    // Memory score
    if (memory.totalMB >= 8192) {score += 3}
    else if (memory.totalMB >= 4096) {score += 2}
    else {score += 1}

    // Connection score
    const connection = this.deviceProfile.connection
    if (connection.effectiveType === '4g' || connection.downlink > 10) {score += 2}
    else if (connection.effectiveType === '3g') {score += 1}

    // Determine tier
    if (score >= 7) {
      this.deviceProfile.tier = 'high'
    } else if (score >= 4) {
      this.deviceProfile.tier = 'medium'
    } else {
      this.deviceProfile.tier = 'low'
    }

    logger.info('[AdaptivePerf] Device tier:', this.deviceProfile.tier, { score, cores, memoryMB: memory.totalMB })
  }

  /**
   * Apply initial settings based on device tier
   */
  applyInitialSettings() {
    const tier = this.deviceProfile.tier

    switch (tier) {
      case 'high':
        this.settings = {
          workerPoolSize: Math.min(this.deviceProfile.cores, 8),
          editorPoolSize: 15,
          fileTreeBatchSize: 100,
          virtualScrollBuffer: 10,
          debounceDelay: 200,
          cacheMaxSize: 200 * 1024 * 1024,
          prefetchEnabled: true,
          prefetchMaxFiles: 10
        }
        break

      case 'medium':
        this.settings = {
          workerPoolSize: Math.min(this.deviceProfile.cores, 4),
          editorPoolSize: 10,
          fileTreeBatchSize: 50,
          virtualScrollBuffer: 5,
          debounceDelay: 300,
          cacheMaxSize: 100 * 1024 * 1024,
          prefetchEnabled: true,
          prefetchMaxFiles: 5
        }
        break

      case 'low':
        this.settings = {
          workerPoolSize: 2,
          editorPoolSize: 5,
          fileTreeBatchSize: 25,
          virtualScrollBuffer: 3,
          debounceDelay: 500,
          cacheMaxSize: 50 * 1024 * 1024,
          prefetchEnabled: false,
          prefetchMaxFiles: 0
        }
        break
    }

    logger.info('[AdaptivePerf] Initial settings:', this.settings)
  }

  /**
   * Start performance monitoring
   */
  startMonitoring() {
    // Monitor every 5 seconds
    this.monitoringInterval = setInterval(() => {
      this.updateMetrics()
      this.checkAndTune()
    }, 5000)

    // Monitor FPS
    this.startFPSMonitoring()

    // Listen for visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.onPageHidden()
      } else {
        this.onPageVisible()
      }
    })
  }

  /**
   * Start FPS monitoring
   */
  startFPSMonitoring() {
    let lastTime = performance.now()
    let frames = 0
    let frameDrops = 0

    const measureFPS = (currentTime) => {
      const delta = currentTime - lastTime

      if (delta >= 1000) {
        const fps = Math.round((frames * 1000) / delta)

        if (fps < 55) { // Below 55 FPS is considered a drop
          frameDrops++
        }

        this.metrics.frameDrops = frameDrops

        frames = 0
        lastTime = currentTime
      }

      frames++
      this.fpsMonitoringId = requestAnimationFrame(measureFPS)
    }

    this.fpsMonitoringId = requestAnimationFrame(measureFPS)
  }

  /**
   * Update performance metrics
   */
  updateMetrics() {
    // Get metrics from performance tracker
    const trackerMetrics = performanceTracker.getAllMetrics()

    // File load time
    if (trackerMetrics.fileOperations.avgTime) {
      this.metrics.avgFileLoadTime = trackerMetrics.fileOperations.avgTime
    }

    // Cache hit rate
    if (trackerMetrics.cache.hitRate !== undefined) {
      this.metrics.cacheHitRate = trackerMetrics.cache.hitRate
    }

    // Memory usage
    if (performance.memory) {
      this.metrics.memoryUsage = Math.round(
        (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100
      )
    }
  }

  /**
   * Check if tuning is needed and apply adjustments
   */
  checkAndTune() {
    const now = Date.now()

    // Only tune every 30 seconds
    if (now - this.lastTuning < this.tuningInterval) {
      return
    }

    this.lastTuning = now

    const adjustments = []

    // 1. Adjust based on file load time
    if (this.metrics.avgFileLoadTime > this.targets.fileLoad * 1.5) {
      // Too slow, reduce batch sizes
      if (this.settings.fileTreeBatchSize > 25) {
        this.settings.fileTreeBatchSize = Math.max(25, this.settings.fileTreeBatchSize - 10)
        adjustments.push({ setting: 'fileTreeBatchSize', change: -10, reason: 'slow file loading' })
      }

      if (this.settings.prefetchMaxFiles > 3) {
        this.settings.prefetchMaxFiles = Math.max(3, this.settings.prefetchMaxFiles - 2)
        adjustments.push({ setting: 'prefetchMaxFiles', change: -2, reason: 'slow file loading' })
      }
    } else if (this.metrics.avgFileLoadTime < this.targets.fileLoad * 0.5) {
      // Very fast, can increase batch sizes
      if (this.settings.fileTreeBatchSize < 100) {
        this.settings.fileTreeBatchSize = Math.min(100, this.settings.fileTreeBatchSize + 10)
        adjustments.push({ setting: 'fileTreeBatchSize', change: 10, reason: 'fast file loading' })
      }
    }

    // 2. Adjust based on memory usage
    if (this.metrics.memoryUsage > 85) {
      // High memory usage, reduce caches
      if (this.settings.cacheMaxSize > 50 * 1024 * 1024) {
        this.settings.cacheMaxSize = Math.max(50 * 1024 * 1024, this.settings.cacheMaxSize * 0.8)
        adjustments.push({ setting: 'cacheMaxSize', change: -20, reason: 'high memory usage' })
      }

      if (this.settings.editorPoolSize > 5) {
        this.settings.editorPoolSize = Math.max(5, this.settings.editorPoolSize - 2)
        adjustments.push({ setting: 'editorPoolSize', change: -2, reason: 'high memory usage' })
      }

      if (this.settings.prefetchEnabled) {
        this.settings.prefetchEnabled = false
        adjustments.push({ setting: 'prefetchEnabled', change: false, reason: 'high memory usage' })
      }
    } else if (this.metrics.memoryUsage < 50) {
      // Low memory usage, can increase caches
      if (!this.settings.prefetchEnabled && this.deviceProfile.tier !== 'low') {
        this.settings.prefetchEnabled = true
        adjustments.push({ setting: 'prefetchEnabled', change: true, reason: 'low memory usage' })
      }

      if (this.settings.editorPoolSize < 15) {
        this.settings.editorPoolSize = Math.min(15, this.settings.editorPoolSize + 1)
        adjustments.push({ setting: 'editorPoolSize', change: 1, reason: 'low memory usage' })
      }
    }

    // 3. Adjust based on frame drops
    if (this.metrics.frameDrops > 10) {
      // Too many frame drops, reduce workload
      if (this.settings.virtualScrollBuffer > 3) {
        this.settings.virtualScrollBuffer = Math.max(3, this.settings.virtualScrollBuffer - 2)
        adjustments.push({ setting: 'virtualScrollBuffer', change: -2, reason: 'frame drops' })
      }

      if (this.settings.debounceDelay < 500) {
        this.settings.debounceDelay = Math.min(500, this.settings.debounceDelay + 50)
        adjustments.push({ setting: 'debounceDelay', change: 50, reason: 'frame drops' })
      }

      // Reset frame drop counter
      this.metrics.frameDrops = 0
    }

    // 4. Adjust based on cache hit rate
    if (this.metrics.cacheHitRate < 50 && this.metrics.memoryUsage < 70) {
      // Low cache hit rate but memory available
      if (this.settings.cacheMaxSize < 200 * 1024 * 1024) {
        this.settings.cacheMaxSize = Math.min(200 * 1024 * 1024, this.settings.cacheMaxSize * 1.2)
        adjustments.push({ setting: 'cacheMaxSize', change: 20, reason: 'low cache hit rate' })
      }
    }

    if (adjustments.length > 0) {
      logger.info('[AdaptivePerf] Adjustments:', adjustments)

      this.tuningHistory.push({
        timestamp: now,
        adjustments,
        metrics: { ...this.metrics }
      })

      // Keep only last 20 tuning events
      if (this.tuningHistory.length > 20) {
        this.tuningHistory.shift()
      }

      // Emit event for components to react
      this.emitSettingsChange()
    }
  }

  /**
   * Handle page hidden
   */
  onPageHidden() {
    // Reduce resource usage when page is hidden
    this.savedSettings = { ...this.settings }

    this.settings.prefetchEnabled = false
    this.settings.workerPoolSize = 1

    logger.info('[AdaptivePerf] Page hidden, reduced resource usage')
  }

  /**
   * Handle page visible
   */
  onPageVisible() {
    // Restore settings when page becomes visible
    if (this.savedSettings) {
      this.settings = { ...this.savedSettings }
      delete this.savedSettings

      logger.info('[AdaptivePerf] Page visible, restored settings')
    }
  }

  /**
   * Emit settings change event
   */
  emitSettingsChange() {
    window.dispatchEvent(new CustomEvent('adaptive-performance-update', {
      detail: { settings: this.settings }
    }))
  }

  /**
   * Get current settings
   */
  getSettings() {
    return { ...this.settings }
  }

  /**
   * Get device profile
   */
  getDeviceProfile() {
    return { ...this.deviceProfile }
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return { ...this.metrics }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      deviceProfile: this.getDeviceProfile(),
      settings: this.getSettings(),
      metrics: this.getMetrics(),
      tuningHistory: this.tuningHistory.slice(-10)
    }
  }

  /**
   * Manually adjust setting
   */
  setSetting(key, value) {
    if (Object.prototype.hasOwnProperty.call(this.settings, key)) {
      this.settings[key] = value

      logger.info('[AdaptivePerf] Manual setting change:', { [key]: value })
      this.emitSettingsChange()

      return true
    }

    return false
  }

  /**
   * Reset to defaults
   */
  reset() {
    this.applyInitialSettings()
    this.metrics.frameDrops = 0
    this.tuningHistory = []
    this.lastTuning = Date.now()

    logger.info('[AdaptivePerf] Reset to defaults')
    this.emitSettingsChange()
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = null
    }

    if (this.fpsMonitoringId) {
      cancelAnimationFrame(this.fpsMonitoringId)
      this.fpsMonitoringId = null
    }

    logger.info('[AdaptivePerf] Monitoring stopped')
  }
}

// Create singleton instance
const adaptivePerformance = new AdaptivePerformance()

export default adaptivePerformance

export { AdaptivePerformance }
