import { logger, createLogger } from '@/utils/logger';

/**
 * Performance Tracker
 * Tracks file operations, AI responses, and system metrics
 */

class PerformanceTracker {
  constructor() {
    this.listeners = []
    this.metrics = {
      fileOperations: [],
      aiResponses: [],
      networkRequests: [],
      cacheHits: 0,
      cacheMisses: 0
    }

    // Intercept fetch for network tracking
    this.interceptFetch()
  }

  /**
   * Add listener for performance events
   */
  addListener(callback) {
    this.listeners.push(callback)
    return () => {
      const index = this.listeners.indexOf(callback)
      if (index > -1) {
        this.listeners.splice(index, 1)
      }
    }
  }

  /**
   * Emit event to all listeners
   */
  emit(event, data) {
    this.listeners.forEach(listener => {
      try {
        listener(event, data)
      } catch (error) {
        logger.error('Performance tracker listener error:', error)
      }
    })
  }

  /**
   * Track file operation
   */
  trackFileOperation(operation, file, startTime) {
    const duration = performance.now() - startTime
    const data = {
      operation,
      file,
      duration: Math.round(duration),
      timestamp: Date.now()
    }

    this.metrics.fileOperations.push(data)

    // Keep only last 1000 operations
    if (this.metrics.fileOperations.length > 1000) {
      this.metrics.fileOperations.shift()
    }

    this.emit('fileOperation', data)
    return duration
  }

  /**
   * Track AI response
   */
  trackAiResponse(model, tokens, startTime) {
    const duration = performance.now() - startTime
    const data = {
      model,
      tokens,
      duration: Math.round(duration),
      timestamp: Date.now()
    }

    this.metrics.aiResponses.push(data)

    // Keep only last 1000 responses
    if (this.metrics.aiResponses.length > 1000) {
      this.metrics.aiResponses.shift()
    }

    this.emit('aiResponse', data)
    return duration
  }

  /**
   * Track network request
   */
  trackNetworkRequest(url, method, startTime, success = true) {
    const duration = performance.now() - startTime
    const data = {
      url,
      method,
      duration: Math.round(duration),
      success,
      timestamp: Date.now()
    }

    this.metrics.networkRequests.push(data)

    // Keep only last 1000 requests
    if (this.metrics.networkRequests.length > 1000) {
      this.metrics.networkRequests.shift()
    }

    this.emit('networkRequest', data)
    return duration
  }

  /**
   * Track cache hit
   */
  trackCacheHit() {
    this.metrics.cacheHits++
    this.emit('cacheHit', {
      hits: this.metrics.cacheHits,
      misses: this.metrics.cacheMisses,
      hitRate: this.getCacheHitRate()
    })
  }

  /**
   * Track cache miss
   */
  trackCacheMiss() {
    this.metrics.cacheMisses++
    this.emit('cacheMiss', {
      hits: this.metrics.cacheHits,
      misses: this.metrics.cacheMisses,
      hitRate: this.getCacheHitRate()
    })
  }

  /**
   * Get cache hit rate
   */
  getCacheHitRate() {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses
    if (total === 0) {return 0}
    return Math.round((this.metrics.cacheHits / total) * 100)
  }

  /**
   * Get file operation statistics
   */
  getFileOperationStats() {
    if (this.metrics.fileOperations.length === 0) {
      return {
        total: 0,
        avgTime: 0,
        minTime: 0,
        maxTime: 0,
        p50: 0,
        p95: 0,
        p99: 0
      }
    }

    const times = this.metrics.fileOperations.map(op => op.duration).sort((a, b) => a - b)
    const sum = times.reduce((a, b) => a + b, 0)

    return {
      total: this.metrics.fileOperations.length,
      avgTime: Math.round(sum / times.length),
      minTime: times[0],
      maxTime: times[times.length - 1],
      p50: times[Math.floor(times.length * 0.5)],
      p95: times[Math.floor(times.length * 0.95)],
      p99: times[Math.floor(times.length * 0.99)]
    }
  }

  /**
   * Get AI response statistics
   */
  getAiResponseStats() {
    if (this.metrics.aiResponses.length === 0) {
      return {
        total: 0,
        avgTime: 0,
        minTime: 0,
        maxTime: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        totalTokens: 0
      }
    }

    const times = this.metrics.aiResponses.map(res => res.duration).sort((a, b) => a - b)
    const sum = times.reduce((a, b) => a + b, 0)
    const totalTokens = this.metrics.aiResponses.reduce((sum, res) => sum + res.tokens, 0)

    return {
      total: this.metrics.aiResponses.length,
      avgTime: Math.round(sum / times.length),
      minTime: times[0],
      maxTime: times[times.length - 1],
      p50: times[Math.floor(times.length * 0.5)],
      p95: times[Math.floor(times.length * 0.95)],
      p99: times[Math.floor(times.length * 0.99)],
      totalTokens
    }
  }

  /**
   * Get network request statistics
   */
  getNetworkStats() {
    if (this.metrics.networkRequests.length === 0) {
      return {
        total: 0,
        successful: 0,
        failed: 0,
        avgTime: 0
      }
    }

    const successful = this.metrics.networkRequests.filter(req => req.success).length
    const times = this.metrics.networkRequests.map(req => req.duration)
    const sum = times.reduce((a, b) => a + b, 0)

    return {
      total: this.metrics.networkRequests.length,
      successful,
      failed: this.metrics.networkRequests.length - successful,
      avgTime: Math.round(sum / times.length)
    }
  }

  /**
   * Intercept fetch for network tracking
   */
  interceptFetch() {
    const originalFetch = window.fetch
    const tracker = this

    window.fetch = function(...args) {
      const startTime = performance.now()
      const url = typeof args[0] === 'string' ? args[0] : args[0].url
      const method = args[1]?.method || 'GET'

      return originalFetch.apply(this, args)
        .then(response => {
          tracker.trackNetworkRequest(url, method, startTime, response.ok)
          return response
        })
        .catch(error => {
          tracker.trackNetworkRequest(url, method, startTime, false)
          throw error
        })
    }
  }

  /**
   * Measure function execution time
   */
  async measure(name, fn) {
    const startTime = performance.now()
    try {
      const result = await fn()
      const duration = performance.now() - startTime
      logger.info(`[Performance] ${name}: ${Math.round(duration)}ms`)
      return result
    } catch (error) {
      const duration = performance.now() - startTime
      logger.error(`[Performance] ${name} failed after ${Math.round(duration)}ms:`, error)
      throw error
    }
  }

  /**
   * Create a performance mark
   */
  mark(name) {
    performance.mark(name)
  }

  /**
   * Measure between two marks
   */
  measureBetween(name, startMark, endMark) {
    try {
      performance.measure(name, startMark, endMark)
      const measure = performance.getEntriesByName(name)[0]
      return measure.duration
    } catch (error) {
      logger.error('Performance measure error:', error)
      return 0
    }
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics.fileOperations = []
    this.metrics.aiResponses = []
    this.metrics.networkRequests = []
    this.metrics.cacheHits = 0
    this.metrics.cacheMisses = 0
    this.emit('clear', {})
  }

  /**
   * Get all metrics
   */
  getAllMetrics() {
    return {
      fileOperations: this.getFileOperationStats(),
      aiResponses: this.getAiResponseStats(),
      network: this.getNetworkStats(),
      cache: {
        hits: this.metrics.cacheHits,
        misses: this.metrics.cacheMisses,
        hitRate: this.getCacheHitRate()
      }
    }
  }
}

// Create singleton instance
const performanceTracker = new PerformanceTracker()

export default performanceTracker
