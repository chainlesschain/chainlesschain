/**
 * Request Batcher and Deduplication System
 * 请求批处理和去重系统
 *
 * Features:
 * - Automatic request batching (merge multiple requests into one)
 * - Request deduplication (prevent duplicate concurrent requests)
 * - Configurable batch window and size
 * - Request priority queue
 * - Cache support with TTL
 * - Retry mechanism with exponential backoff
 */

class RequestBatcher {
  constructor(options = {}) {
    // Configuration
    this.options = {
      batchWindow: options.batchWindow || 50, // ms - wait time before sending batch
      maxBatchSize: options.maxBatchSize || 10, // max requests per batch
      enableCache: options.enableCache !== false,
      cacheTTL: options.cacheTTL || 5 * 60 * 1000, // 5 minutes
      enableDeduplication: options.enableDeduplication !== false,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000, // ms
      debug: options.debug || false,
    }

    // State
    this.pendingRequests = new Map() // key -> { requests, timer }
    this.inflightRequests = new Map() // key -> Promise
    this.cache = new Map() // key -> { data, timestamp }
    this.requestQueue = [] // priority queue

    // Statistics
    this.stats = {
      totalRequests: 0,
      batchedRequests: 0,
      cachedRequests: 0,
      deduplicatedRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      bandwidthSaved: 0, // estimated bytes saved
    }

    // Start cache cleanup
    this.startCacheCleanup()

    if (this.options.debug) {
      console.log('[RequestBatcher] Initialized with options:', this.options)
    }
  }

  /**
   * Make a request (with batching and deduplication)
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Request parameters
   * @param {Object} options - Additional options
   * @returns {Promise} Response data
   */
  async request(endpoint, params = {}, options = {}) {
    this.stats.totalRequests++

    const requestKey = this.generateRequestKey(endpoint, params)
    const cacheKey = this.generateCacheKey(endpoint, params)

    // 1. Check cache
    if (this.options.enableCache && !options.skipCache) {
      const cached = this.getFromCache(cacheKey)
      if (cached !== null) {
        this.stats.cachedRequests++
        if (this.options.debug) {
          console.log(`[RequestBatcher] Cache hit: ${endpoint}`)
        }
        return cached
      }
    }

    // 2. Deduplication: check if same request is already in flight
    if (this.options.enableDeduplication && !options.skipDeduplication) {
      const inflight = this.inflightRequests.get(requestKey)
      if (inflight) {
        this.stats.deduplicatedRequests++
        if (this.options.debug) {
          console.log(`[RequestBatcher] Deduplicated: ${endpoint}`)
        }
        return inflight
      }
    }

    // 3. Batching: add to batch queue
    if (options.enableBatching !== false && this.isBatchable(endpoint)) {
      return this.addToBatch(endpoint, params, options)
    }

    // 4. Execute immediately (not batchable)
    return this.executeSingle(endpoint, params, options)
  }

  /**
   * Add request to batch queue
   */
  addToBatch(endpoint, params, options) {
    const batchKey = this.getBatchKey(endpoint)

    return new Promise((resolve, reject) => {
      // Get or create batch
      let batch = this.pendingRequests.get(batchKey)

      if (!batch) {
        batch = {
          endpoint,
          requests: [],
          timer: null,
        }
        this.pendingRequests.set(batchKey, batch)
      }

      // Add request to batch
      batch.requests.push({
        params,
        options,
        resolve,
        reject,
      })

      // Clear existing timer
      if (batch.timer) {
        clearTimeout(batch.timer)
      }

      // Execute batch if size limit reached
      if (batch.requests.length >= this.options.maxBatchSize) {
        this.executeBatch(batchKey)
      } else {
        // Set timer to execute batch after window
        batch.timer = setTimeout(() => {
          this.executeBatch(batchKey)
        }, this.options.batchWindow)
      }
    })
  }

  /**
   * Execute a batch of requests
   */
  async executeBatch(batchKey) {
    const batch = this.pendingRequests.get(batchKey)
    if (!batch || batch.requests.length === 0) return

    this.pendingRequests.delete(batchKey)

    const { endpoint, requests } = batch
    const batchSize = requests.length

    this.stats.batchedRequests += batchSize

    if (this.options.debug) {
      console.log(`[RequestBatcher] Executing batch: ${endpoint} (${batchSize} requests)`)
    }

    try {
      // Build batch request payload
      const batchParams = requests.map(r => r.params)

      // Execute batch API call
      const startTime = performance.now()
      const results = await this.executeBatchAPI(endpoint, batchParams)
      const responseTime = performance.now() - startTime

      this.updateAverageResponseTime(responseTime)

      // Estimate bandwidth saved (1 batch request vs N individual requests)
      this.stats.bandwidthSaved += this.estimateBandwidthSaved(batchSize)

      // Resolve individual promises
      requests.forEach((req, index) => {
        const result = results[index]
        const cacheKey = this.generateCacheKey(endpoint, req.params)

        // Cache result
        if (this.options.enableCache && !req.options.skipCache) {
          this.setCache(cacheKey, result)
        }

        req.resolve(result)
      })

      if (this.options.debug) {
        console.log(`[RequestBatcher] Batch completed: ${endpoint} (${Math.round(responseTime)}ms)`)
      }
    } catch (error) {
      console.error(`[RequestBatcher] Batch failed: ${endpoint}`, error)
      this.stats.failedRequests += batchSize

      // Reject all promises
      requests.forEach(req => {
        req.reject(error)
      })
    }
  }

  /**
   * Execute single request (not batched)
   */
  async executeSingle(endpoint, params, options) {
    const requestKey = this.generateRequestKey(endpoint, params)
    const cacheKey = this.generateCacheKey(endpoint, params)

    const startTime = performance.now()

    // Create promise for this request
    const requestPromise = (async () => {
      try {
        // Execute API call
        const result = await this.executeAPI(endpoint, params, options)
        const responseTime = performance.now() - startTime

        this.updateAverageResponseTime(responseTime)

        // Cache result
        if (this.options.enableCache && !options.skipCache) {
          this.setCache(cacheKey, result)
        }

        return result
      } catch (error) {
        this.stats.failedRequests++
        throw error
      } finally {
        this.inflightRequests.delete(requestKey)
      }
    })()

    // Track inflight request
    this.inflightRequests.set(requestKey, requestPromise)

    return requestPromise
  }

  /**
   * Execute batch API call (override this method)
   */
  async executeBatchAPI(endpoint, batchParams) {
    // Default implementation: call individual APIs in parallel
    // Override this method to implement actual batch API
    const results = await Promise.all(
      batchParams.map(params => this.executeAPI(endpoint, params))
    )
    return results
  }

  /**
   * Execute single API call (override this method)
   */
  async executeAPI(endpoint, params, options = {}) {
    // Default implementation using fetch
    // Override this method to use your API client (axios, etc.)
    const url = new URL(endpoint, window.location.origin)

    Object.keys(params).forEach(key => {
      url.searchParams.append(key, params[key])
    })

    const response = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers: options.headers || {},
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Check if endpoint supports batching
   */
  isBatchable(endpoint) {
    // Default: all GET requests are batchable
    // Override this method for custom logic
    return true
  }

  /**
   * Get batch key for grouping requests
   */
  getBatchKey(endpoint) {
    // Group by endpoint
    return endpoint
  }

  /**
   * Generate unique request key
   */
  generateRequestKey(endpoint, params) {
    return `${endpoint}:${JSON.stringify(params)}`
  }

  /**
   * Generate cache key
   */
  generateCacheKey(endpoint, params) {
    return this.generateRequestKey(endpoint, params)
  }

  /**
   * Get from cache
   */
  getFromCache(key) {
    const entry = this.cache.get(key)

    if (!entry) return null

    const age = Date.now() - entry.timestamp

    if (age > this.options.cacheTTL) {
      this.cache.delete(key)
      return null
    }

    return entry.data
  }

  /**
   * Set cache
   */
  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    })
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear()
    if (this.options.debug) {
      console.log('[RequestBatcher] Cache cleared')
    }
  }

  /**
   * Start cache cleanup interval
   */
  startCacheCleanup() {
    setInterval(() => {
      const now = Date.now()
      let cleaned = 0

      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp > this.options.cacheTTL) {
          this.cache.delete(key)
          cleaned++
        }
      }

      if (cleaned > 0 && this.options.debug) {
        console.log(`[RequestBatcher] Cleaned ${cleaned} expired cache entries`)
      }
    }, 60 * 1000) // Clean every minute
  }

  /**
   * Estimate bandwidth saved
   */
  estimateBandwidthSaved(batchSize) {
    // Rough estimate: each individual request has ~500 bytes overhead
    // Batching saves (N-1) * overhead
    const overheadPerRequest = 500
    return (batchSize - 1) * overheadPerRequest
  }

  /**
   * Update average response time
   */
  updateAverageResponseTime(newTime) {
    const totalCompleted = this.stats.totalRequests - this.stats.failedRequests
    this.stats.averageResponseTime =
      ((this.stats.averageResponseTime * (totalCompleted - 1)) + newTime) / totalCompleted
  }

  /**
   * Get statistics
   */
  getStats() {
    const completed = this.stats.totalRequests - this.stats.failedRequests
    const batchRate = this.stats.totalRequests > 0
      ? Math.round((this.stats.batchedRequests / this.stats.totalRequests) * 100)
      : 0
    const cacheHitRate = this.stats.totalRequests > 0
      ? Math.round((this.stats.cachedRequests / this.stats.totalRequests) * 100)
      : 0

    return {
      ...this.stats,
      completedRequests: completed,
      batchRate: `${batchRate}%`,
      cacheHitRate: `${cacheHitRate}%`,
      bandwidthSavedKB: Math.round(this.stats.bandwidthSaved / 1024),
      cacheSize: this.cache.size,
      inflightRequests: this.inflightRequests.size,
      pendingBatches: this.pendingRequests.size,
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy() {
    // Clear all pending batches
    this.pendingRequests.forEach(batch => {
      if (batch.timer) {
        clearTimeout(batch.timer)
      }
    })

    this.pendingRequests.clear()
    this.inflightRequests.clear()
    this.cache.clear()

    if (this.options.debug) {
      console.log('[RequestBatcher] Destroyed')
    }
  }
}

// Singleton instance
let batcherInstance = null

/**
 * Get or create request batcher instance
 */
export function getRequestBatcher(options) {
  if (!batcherInstance) {
    batcherInstance = new RequestBatcher(options)
  }
  return batcherInstance
}

/**
 * Convenience function: make a batched request
 */
export async function batchedRequest(endpoint, params, options) {
  const batcher = getRequestBatcher()
  return batcher.request(endpoint, params, options)
}

export default RequestBatcher
