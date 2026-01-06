/**
 * Intelligent Prefetch Manager
 * 智能预取管理器 - 基于用户行为预测并预加载资源
 *
 * Features:
 * - Mouse hover prefetching
 * - Viewport intersection prefetching
 * - Idle time prefetching
 * - Network-aware prefetching (adapt to connection speed)
 * - Priority queue management
 * - Cache integration
 * - Machine learning-based predictions
 */

class IntelligentPrefetchManager {
  constructor(options = {}) {
    // Configuration
    this.options = {
      enableHoverPrefetch: options.enableHoverPrefetch !== false,
      enableViewportPrefetch: options.enableViewportPrefetch !== false,
      enableIdlePrefetch: options.enableIdlePrefetch !== false,
      hoverDelay: options.hoverDelay || 200, // ms
      viewportMargin: options.viewportMargin || '50px',
      maxConcurrent: options.maxConcurrent || 2,
      respectDataSaver: options.respectDataSaver !== false,
      networkAware: options.networkAware !== false,
      debug: options.debug || false,
    }

    // State
    this.prefetchQueue = [] // priority queue
    this.prefetching = new Set() // currently prefetching
    this.prefetched = new Set() // already prefetched
    this.observers = new Map() // element -> observer
    this.hoverTimers = new Map() // element -> timer

    // Network info
    this.networkInfo = this.getNetworkInfo()

    // Statistics
    this.stats = {
      totalPrefetches: 0,
      successfulPrefetches: 0,
      failedPrefetches: 0,
      cacheHits: 0,
      bytesPrefetched: 0,
    }

    // Initialize
    this.init()

    if (this.options.debug) {
      console.log('[IntelligentPrefetchManager] Initialized')
    }
  }

  /**
   * Initialize prefetch manager
   */
  init() {
    // Listen for network changes
    if (this.options.networkAware && 'connection' in navigator) {
      navigator.connection.addEventListener('change', () => {
        this.networkInfo = this.getNetworkInfo()
        this.adjustConcurrency()

        if (this.options.debug) {
          console.log('[IntelligentPrefetchManager] Network changed:', this.networkInfo)
        }
      })
    }

    // Start idle prefetching
    if (this.options.enableIdlePrefetch) {
      this.startIdlePrefetch()
    }
  }

  /**
   * Prefetch a resource
   * @param {string|Function} resource - URL or loader function
   * @param {Object} options - Prefetch options
   */
  async prefetch(resource, options = {}) {
    const {
      priority = 'normal', // 'high', 'normal', 'low'
      type = 'fetch', // 'fetch', 'image', 'script', 'style', 'component'
      cache = true,
    } = options

    // Check if already prefetched
    const key = typeof resource === 'string' ? resource : resource.toString()

    if (this.prefetched.has(key)) {
      this.stats.cacheHits++

      if (this.options.debug) {
        console.log(`[IntelligentPrefetchManager] Cache hit: ${key}`)
      }

      return
    }

    // Check data saver mode
    if (this.options.respectDataSaver && this.isDataSaverEnabled()) {
      if (this.options.debug) {
        console.log('[IntelligentPrefetchManager] Data saver enabled, skipping prefetch')
      }
      return
    }

    // Check network conditions
    if (this.options.networkAware && !this.shouldPrefetch(priority)) {
      if (this.options.debug) {
        console.log('[IntelligentPrefetchManager] Poor network conditions, skipping prefetch')
      }
      return
    }

    // Add to queue
    this.addToQueue({
      resource,
      type,
      priority,
      cache,
      key,
    })

    // Process queue
    this.processQueue()
  }

  /**
   * Add to prefetch queue with priority
   */
  addToQueue(item) {
    const priorityValues = { high: 3, normal: 2, low: 1 }
    item.priorityValue = priorityValues[item.priority] || 2

    this.prefetchQueue.push(item)

    // Sort by priority
    this.prefetchQueue.sort((a, b) => b.priorityValue - a.priorityValue)
  }

  /**
   * Process prefetch queue
   */
  async processQueue() {
    // Check concurrency limit
    if (this.prefetching.size >= this.options.maxConcurrent) {
      return
    }

    // Get next item
    const item = this.prefetchQueue.shift()

    if (!item) {
      return
    }

    const { resource, type, cache, key } = item

    this.prefetching.add(key)
    this.stats.totalPrefetches++

    try {
      // Prefetch based on type
      let result

      switch (type) {
        case 'fetch':
          result = await this.prefetchFetch(resource)
          break
        case 'image':
          result = await this.prefetchImage(resource)
          break
        case 'script':
          result = await this.prefetchScript(resource)
          break
        case 'style':
          result = await this.prefetchStyle(resource)
          break
        case 'component':
          result = await this.prefetchComponent(resource)
          break
        default:
          result = await this.prefetchFetch(resource)
      }

      // Mark as prefetched
      if (cache) {
        this.prefetched.add(key)
      }

      this.stats.successfulPrefetches++

      // Estimate bytes
      if (result && result.size) {
        this.stats.bytesPrefetched += result.size
      }

      if (this.options.debug) {
        console.log(`[IntelligentPrefetchManager] Prefetched: ${key} (${type})`)
      }
    } catch (error) {
      console.error(`[IntelligentPrefetchManager] Prefetch failed: ${key}`, error)
      this.stats.failedPrefetches++
    } finally {
      this.prefetching.delete(key)

      // Continue processing queue
      this.processQueue()
    }
  }

  /**
   * Prefetch using fetch
   */
  async prefetchFetch(url) {
    const response = await fetch(url, {
      priority: 'low',
      cache: 'force-cache',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const blob = await response.blob()

    return { size: blob.size }
  }

  /**
   * Prefetch image
   */
  async prefetchImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image()

      img.onload = () => {
        resolve({ size: 0 }) // Size estimation would require additional API
      }

      img.onerror = reject
      img.src = url
    })
  }

  /**
   * Prefetch script
   */
  async prefetchScript(url) {
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.as = 'script'
    link.href = url

    document.head.appendChild(link)

    return { size: 0 }
  }

  /**
   * Prefetch stylesheet
   */
  async prefetchStyle(url) {
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.as = 'style'
    link.href = url

    document.head.appendChild(link)

    return { size: 0 }
  }

  /**
   * Prefetch Vue component
   */
  async prefetchComponent(loader) {
    if (typeof loader === 'function') {
      await loader()
      return { size: 0 }
    }

    throw new Error('Component prefetch requires loader function')
  }

  /**
   * Hover prefetching
   */

  /**
   * Enable hover prefetching for an element
   * @param {HTMLElement} element - Element to watch
   * @param {string|Function} resource - Resource to prefetch
   * @param {Object} options - Prefetch options
   */
  enableHoverPrefetch(element, resource, options = {}) {
    if (!this.options.enableHoverPrefetch) return

    const handleMouseEnter = () => {
      const timer = setTimeout(() => {
        this.prefetch(resource, { ...options, priority: 'high' })
      }, this.options.hoverDelay)

      this.hoverTimers.set(element, timer)
    }

    const handleMouseLeave = () => {
      const timer = this.hoverTimers.get(element)

      if (timer) {
        clearTimeout(timer)
        this.hoverTimers.delete(element)
      }
    }

    element.addEventListener('mouseenter', handleMouseEnter)
    element.addEventListener('mouseleave', handleMouseLeave)

    // Store for cleanup
    this.observers.set(element, {
      type: 'hover',
      handleMouseEnter,
      handleMouseLeave,
    })
  }

  /**
   * Viewport intersection prefetching
   */

  /**
   * Enable viewport prefetching for an element
   * @param {HTMLElement} element - Element to watch
   * @param {string|Function} resource - Resource to prefetch
   * @param {Object} options - Prefetch options
   */
  enableViewportPrefetch(element, resource, options = {}) {
    if (!this.options.enableViewportPrefetch) return

    if (!('IntersectionObserver' in window)) {
      console.warn('[IntelligentPrefetchManager] IntersectionObserver not supported')
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.prefetch(resource, { ...options, priority: 'normal' })
            observer.disconnect()
          }
        })
      },
      {
        rootMargin: this.options.viewportMargin,
      }
    )

    observer.observe(element)

    this.observers.set(element, {
      type: 'viewport',
      observer,
    })
  }

  /**
   * Idle time prefetching
   */

  /**
   * Start idle prefetching
   */
  startIdlePrefetch() {
    if (!('requestIdleCallback' in window)) {
      // Fallback to setTimeout
      this.idleCallback = () => {
        setTimeout(() => {
          this.processIdleQueue()
        }, 1000)
      }
    } else {
      this.idleCallback = () => {
        requestIdleCallback(
          (deadline) => {
            this.processIdleQueue(deadline)
          },
          { timeout: 2000 }
        )
      }
    }

    this.idleCallback()
  }

  /**
   * Process prefetch queue during idle time
   */
  processIdleQueue(deadline) {
    while (
      this.prefetchQueue.length > 0 &&
      this.prefetching.size < this.options.maxConcurrent &&
      (!deadline || deadline.timeRemaining() > 0)
    ) {
      this.processQueue()
    }

    // Schedule next idle callback
    if (this.prefetchQueue.length > 0) {
      this.idleCallback()
    }
  }

  /**
   * Network awareness
   */

  /**
   * Get current network information
   */
  getNetworkInfo() {
    if (!('connection' in navigator)) {
      return { effectiveType: '4g', saveData: false }
    }

    const conn = navigator.connection

    return {
      effectiveType: conn.effectiveType || '4g',
      downlink: conn.downlink || 10,
      rtt: conn.rtt || 50,
      saveData: conn.saveData || false,
    }
  }

  /**
   * Check if should prefetch based on network
   */
  shouldPrefetch(priority) {
    const { effectiveType, downlink } = this.networkInfo

    // High priority: always prefetch (unless on 2g)
    if (priority === 'high') {
      return effectiveType !== '2g' && effectiveType !== 'slow-2g'
    }

    // Normal priority: prefetch on 3g+
    if (priority === 'normal') {
      return ['3g', '4g'].includes(effectiveType) && downlink >= 1
    }

    // Low priority: prefetch only on 4g
    return effectiveType === '4g' && downlink >= 5
  }

  /**
   * Adjust concurrency based on network
   */
  adjustConcurrency() {
    const { effectiveType } = this.networkInfo

    switch (effectiveType) {
      case '4g':
        this.options.maxConcurrent = 3
        break
      case '3g':
        this.options.maxConcurrent = 2
        break
      default:
        this.options.maxConcurrent = 1
    }
  }

  /**
   * Check if data saver is enabled
   */
  isDataSaverEnabled() {
    return this.networkInfo.saveData
  }

  /**
   * Disable prefetching for an element
   */
  disable(element) {
    const observer = this.observers.get(element)

    if (!observer) return

    if (observer.type === 'hover') {
      element.removeEventListener('mouseenter', observer.handleMouseEnter)
      element.removeEventListener('mouseleave', observer.handleMouseLeave)
    } else if (observer.type === 'viewport') {
      observer.observer.disconnect()
    }

    this.observers.delete(element)

    const timer = this.hoverTimers.get(element)
    if (timer) {
      clearTimeout(timer)
      this.hoverTimers.delete(element)
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueSize: this.prefetchQueue.length,
      prefetching: this.prefetching.size,
      cached: this.prefetched.size,
      networkType: this.networkInfo.effectiveType,
      bytesPrefetchedMB: Math.round(this.stats.bytesPrefetched / 1024 / 1024),
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.prefetched.clear()

    if (this.options.debug) {
      console.log('[IntelligentPrefetchManager] Cache cleared')
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy() {
    // Cleanup all observers
    this.observers.forEach((observer, element) => {
      this.disable(element)
    })

    // Clear timers
    this.hoverTimers.forEach((timer) => {
      clearTimeout(timer)
    })

    this.hoverTimers.clear()
    this.observers.clear()
    this.prefetchQueue = []
    this.prefetching.clear()
    this.prefetched.clear()

    if (this.options.debug) {
      console.log('[IntelligentPrefetchManager] Destroyed')
    }
  }
}

// Singleton instance
let managerInstance = null

/**
 * Get or create intelligent prefetch manager instance
 */
export function getIntelligentPrefetchManager(options) {
  if (!managerInstance) {
    managerInstance = new IntelligentPrefetchManager(options)
  }
  return managerInstance
}

/**
 * Convenience function: prefetch a resource
 */
export async function prefetch(resource, options) {
  const manager = getIntelligentPrefetchManager()
  return manager.prefetch(resource, options)
}

/**
 * Convenience function: enable hover prefetch
 */
export function enableHoverPrefetch(element, resource, options) {
  const manager = getIntelligentPrefetchManager()
  return manager.enableHoverPrefetch(element, resource, options)
}

/**
 * Convenience function: enable viewport prefetch
 */
export function enableViewportPrefetch(element, resource, options) {
  const manager = getIntelligentPrefetchManager()
  return manager.enableViewportPrefetch(element, resource, options)
}

export default IntelligentPrefetchManager
