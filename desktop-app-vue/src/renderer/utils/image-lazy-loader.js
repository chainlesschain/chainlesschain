import { logger, createLogger } from '@/utils/logger';

/**
 * Image Lazy Loading Utility
 * 基于 Intersection Observer API 的图片懒加载工具
 *
 * Features:
 * - Automatic lazy loading with configurable threshold
 * - Progressive image loading (placeholder -> low-res -> full-res)
 * - Preload support for critical images
 * - Error handling and retry mechanism
 * - Memory-efficient with automatic cleanup
 */

class ImageLazyLoader {
  constructor(options = {}) {
    // Configuration
    this.options = {
      rootMargin: options.rootMargin || '50px', // Load images 50px before entering viewport
      threshold: options.threshold || 0.01,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000, // ms
      placeholder: options.placeholder || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2YwZjBmMCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5Mb2FkaW5nLi4uPC90ZXh0Pjwvc3ZnPg==',
      errorPlaceholder: options.errorPlaceholder || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2ZmZTZlNiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiNjYzAwMDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5GYWlsZWQgdG8gbG9hZDwvdGV4dD48L3N2Zz4=',
      enableProgressiveLoading: options.enableProgressiveLoading !== false,
      lowResQuality: options.lowResQuality || 0.1, // 10% quality for blur-up effect
    }

    // State
    this.observer = null
    this.observedImages = new Map() // img element -> metadata
    this.loadingQueue = new Set()
    this.loadedImages = new Set()
    this.failedImages = new Map() // src -> retry count

    // Statistics
    this.stats = {
      totalImages: 0,
      loadedImages: 0,
      failedImages: 0,
      averageLoadTime: 0,
      bandwidthSaved: 0, // bytes
    }

    this.init()
  }

  /**
   * Initialize Intersection Observer
   */
  init() {
    if (!('IntersectionObserver' in window)) {
      logger.warn('[ImageLazyLoader] IntersectionObserver not supported, falling back to immediate loading')
      return
    }

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target
          this.loadImage(img)
          this.observer.unobserve(img)
        }
      })
    }, {
      rootMargin: this.options.rootMargin,
      threshold: this.options.threshold
    })

    logger.info('[ImageLazyLoader] Initialized')
  }

  /**
   * Observe an image element
   * @param {HTMLImageElement} img - Image element
   * @param {Object} options - Additional options
   */
  observe(img, options = {}) {
    if (!img || !(img instanceof HTMLImageElement)) {
      logger.warn('[ImageLazyLoader] Invalid image element')
      return
    }

    const src = img.dataset.src || img.getAttribute('data-src')
    if (!src) {
      logger.warn('[ImageLazyLoader] No data-src attribute found')
      return
    }

    // Store metadata
    this.observedImages.set(img, {
      src,
      lowResSrc: img.dataset.lowResSrc || options.lowResSrc,
      priority: options.priority || 'normal', // 'high', 'normal', 'low'
      retryCount: 0,
      startTime: null,
    })

    this.stats.totalImages++

    // Set placeholder
    if (!img.src || img.src === '') {
      img.src = this.options.placeholder
    }

    // High priority images: load immediately
    if (options.priority === 'high') {
      this.loadImage(img)
      return
    }

    // Start observing
    if (this.observer) {
      this.observer.observe(img)
    } else {
      // Fallback: load immediately
      this.loadImage(img)
    }
  }

  /**
   * Load image with progressive enhancement
   * @param {HTMLImageElement} img - Image element
   */
  async loadImage(img) {
    const metadata = this.observedImages.get(img)
    if (!metadata) {return}

    // Already loading or loaded
    if (this.loadingQueue.has(img) || this.loadedImages.has(img)) {
      return
    }

    this.loadingQueue.add(img)
    metadata.startTime = performance.now()

    try {
      // Progressive loading: low-res -> full-res
      if (this.options.enableProgressiveLoading && metadata.lowResSrc) {
        await this.loadProgressively(img, metadata)
      } else {
        await this.loadFullRes(img, metadata)
      }

      // Success
      this.loadedImages.add(img)
      this.stats.loadedImages++

      const loadTime = performance.now() - metadata.startTime
      this.updateAverageLoadTime(loadTime)

      img.classList.add('lazy-loaded')
      img.dispatchEvent(new CustomEvent('lazyloaded', { detail: { loadTime } }))

      logger.info(`[ImageLazyLoader] Loaded: ${metadata.src} (${Math.round(loadTime)}ms)`)
    } catch (error) {
      // Error handling
      await this.handleLoadError(img, metadata, error)
    } finally {
      this.loadingQueue.delete(img)
    }
  }

  /**
   * Progressive loading: blur-up effect
   */
  async loadProgressively(img, metadata) {
    // Step 1: Load low-res version
    img.classList.add('lazy-loading-blur')

    await this.preloadImage(metadata.lowResSrc)
    img.src = metadata.lowResSrc

    // Step 2: Load full-res version in background
    await this.preloadImage(metadata.src)

    // Step 3: Swap to full-res with fade transition
    await this.fadeTransition(img, metadata.src)
    img.classList.remove('lazy-loading-blur')
  }

  /**
   * Load full resolution image directly
   */
  async loadFullRes(img, metadata) {
    await this.preloadImage(metadata.src)
    img.src = metadata.src
  }

  /**
   * Preload image (returns Promise)
   */
  preloadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image()

      img.onload = () => {
        // Estimate bandwidth saved (placeholder size vs actual size)
        if (this.options.placeholder) {
          const placeholderSize = this.options.placeholder.length
          // Rough estimate: assume image is 10x larger than placeholder
          this.stats.bandwidthSaved += placeholderSize * 10
        }
        resolve()
      }

      img.onerror = reject
      img.src = src
    })
  }

  /**
   * Fade transition between images
   */
  fadeTransition(img, newSrc) {
    return new Promise((resolve) => {
      img.style.transition = 'opacity 0.3s ease-in-out'
      img.style.opacity = '0'

      setTimeout(() => {
        img.src = newSrc
        img.style.opacity = '1'

        setTimeout(() => {
          img.style.transition = ''
          resolve()
        }, 300)
      }, 150)
    })
  }

  /**
   * Handle load errors with retry mechanism
   */
  async handleLoadError(img, metadata, error) {
    logger.error(`[ImageLazyLoader] Failed to load: ${metadata.src}`, error)

    const currentRetries = this.failedImages.get(metadata.src) || 0

    if (currentRetries < this.options.maxRetries) {
      // Retry after delay
      this.failedImages.set(metadata.src, currentRetries + 1)

      logger.info(`[ImageLazyLoader] Retrying (${currentRetries + 1}/${this.options.maxRetries}): ${metadata.src}`)

      await this.delay(this.options.retryDelay * (currentRetries + 1)) // Exponential backoff

      this.loadingQueue.delete(img)
      this.loadImage(img)
    } else {
      // Max retries reached: show error placeholder
      img.src = this.options.errorPlaceholder
      img.classList.add('lazy-load-error')
      this.stats.failedImages++

      img.dispatchEvent(new CustomEvent('lazyloaderror', { detail: { error } }))
    }
  }

  /**
   * Unobserve an image
   */
  unobserve(img) {
    if (this.observer) {
      this.observer.unobserve(img)
    }
    this.observedImages.delete(img)
    this.loadingQueue.delete(img)
  }

  /**
   * Preload critical images (above the fold)
   */
  preloadCritical(imageSrcs) {
    if (!Array.isArray(imageSrcs)) {
      imageSrcs = [imageSrcs]
    }

    imageSrcs.forEach(src => {
      const link = document.createElement('link')
      link.rel = 'preload'
      link.as = 'image'
      link.href = src
      document.head.appendChild(link)
    })

    logger.info(`[ImageLazyLoader] Preloading ${imageSrcs.length} critical images`)
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalImages > 0
        ? Math.round((this.stats.loadedImages / this.stats.totalImages) * 100)
        : 0,
      bandwidthSavedKB: Math.round(this.stats.bandwidthSaved / 1024),
    }
  }

  /**
   * Update average load time
   */
  updateAverageLoadTime(newTime) {
    const count = this.stats.loadedImages
    this.stats.averageLoadTime = ((this.stats.averageLoadTime * (count - 1)) + newTime) / count
  }

  /**
   * Utility: delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Cleanup and disconnect
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }

    this.observedImages.clear()
    this.loadingQueue.clear()
    this.loadedImages.clear()
    this.failedImages.clear()

    logger.info('[ImageLazyLoader] Destroyed')
  }
}

// Singleton instance
let lazyLoaderInstance = null

/**
 * Get or create lazy loader instance
 */
export function getLazyLoader(options) {
  if (!lazyLoaderInstance) {
    lazyLoaderInstance = new ImageLazyLoader(options)
  }
  return lazyLoaderInstance
}

export default ImageLazyLoader
