/**
 * Resource Hints Utility
 * 资源提示工具
 *
 * Features:
 * - DNS Prefetch (DNS预解析)
 * - Preconnect (预连接)
 * - Prefetch (预加载)
 * - Preload (预加载关键资源)
 * - Prerender (预渲染)
 *
 * @see https://www.w3.org/TR/resource-hints/
 */

/**
 * Add DNS prefetch hint
 * 添加DNS预解析提示
 *
 * @param {string} domain - Domain to prefetch
 */
export function dnsPrefetch(domain) {
  if (!domain) {return}

  const link = document.createElement('link')
  link.rel = 'dns-prefetch'
  link.href = domain

  document.head.appendChild(link)

  console.log(`[ResourceHints] DNS prefetch added: ${domain}`)
}

/**
 * Add preconnect hint
 * 添加预连接提示
 *
 * @param {string} url - URL to preconnect
 * @param {boolean} crossOrigin - Whether cross-origin
 */
export function preconnect(url, crossOrigin = false) {
  if (!url) {return}

  const link = document.createElement('link')
  link.rel = 'preconnect'
  link.href = url

  if (crossOrigin) {
    link.crossOrigin = 'anonymous'
  }

  document.head.appendChild(link)

  console.log(`[ResourceHints] Preconnect added: ${url}`)
}

/**
 * Add prefetch hint
 * 添加预加载提示（低优先级）
 *
 * @param {string} url - URL to prefetch
 * @param {string} as - Resource type
 */
export function prefetch(url, as = '') {
  if (!url) {return}

  const link = document.createElement('link')
  link.rel = 'prefetch'
  link.href = url

  if (as) {
    link.as = as
  }

  document.head.appendChild(link)

  console.log(`[ResourceHints] Prefetch added: ${url} (as: ${as || 'auto'})`)
}

/**
 * Add preload hint
 * 添加预加载提示（高优先级）
 *
 * @param {string} url - URL to preload
 * @param {string} as - Resource type (required)
 * @param {Object} options - Additional options
 */
export function preload(url, as, options = {}) {
  if (!url || !as) {
    console.warn('[ResourceHints] Preload requires both url and as parameter')
    return
  }

  const link = document.createElement('link')
  link.rel = 'preload'
  link.href = url
  link.as = as

  // Cross-origin
  if (options.crossOrigin) {
    link.crossOrigin = options.crossOrigin
  }

  // Type (for <script> and <style>)
  if (options.type) {
    link.type = options.type
  }

  // Media query
  if (options.media) {
    link.media = options.media
  }

  // Integrity
  if (options.integrity) {
    link.integrity = options.integrity
  }

  document.head.appendChild(link)

  console.log(`[ResourceHints] Preload added: ${url} (as: ${as})`)
}

/**
 * Add prerender hint
 * 添加预渲染提示
 *
 * @param {string} url - URL to prerender
 */
export function prerender(url) {
  if (!url) {return}

  const link = document.createElement('link')
  link.rel = 'prerender'
  link.href = url

  document.head.appendChild(link)

  console.log(`[ResourceHints] Prerender added: ${url}`)
}

/**
 * Add modulepreload hint
 * 添加ES模块预加载提示
 *
 * @param {string} url - Module URL to preload
 */
export function modulePreload(url) {
  if (!url) {return}

  const link = document.createElement('link')
  link.rel = 'modulepreload'
  link.href = url

  document.head.appendChild(link)

  console.log(`[ResourceHints] Module preload added: ${url}`)
}

/**
 * Batch add resource hints
 * 批量添加资源提示
 *
 * @param {Array} hints - Array of hint configs
 */
export function batchAddHints(hints) {
  hints.forEach((hint) => {
    const { type, url, as, options } = hint

    switch (type) {
      case 'dns-prefetch':
        dnsPrefetch(url)
        break
      case 'preconnect':
        preconnect(url, options?.crossOrigin)
        break
      case 'prefetch':
        prefetch(url, as)
        break
      case 'preload':
        preload(url, as, options)
        break
      case 'prerender':
        prerender(url)
        break
      case 'modulepreload':
        modulePreload(url)
        break
      default:
        console.warn(`[ResourceHints] Unknown hint type: ${type}`)
    }
  })
}

/**
 * Remove resource hint
 * 移除资源提示
 *
 * @param {string} rel - Hint type
 * @param {string} href - URL
 */
export function removeHint(rel, href) {
  const links = document.querySelectorAll(`link[rel="${rel}"][href="${href}"]`)
  links.forEach((link) => link.remove())

  console.log(`[ResourceHints] Hint removed: ${rel} ${href}`)
}

/**
 * Clear all hints of a specific type
 * 清除特定类型的所有提示
 *
 * @param {string} rel - Hint type
 */
export function clearHintsByType(rel) {
  const links = document.querySelectorAll(`link[rel="${rel}"]`)
  links.forEach((link) => link.remove())

  console.log(`[ResourceHints] Cleared all hints of type: ${rel}`)
}

/**
 * Preload critical resources for route
 * 为路由预加载关键资源
 *
 * @param {string} route - Route path
 * @param {Object} resources - Resources to preload
 */
export function preloadRouteResources(route, resources = {}) {
  console.log(`[ResourceHints] Preloading resources for route: ${route}`)

  // Preload scripts
  if (resources.scripts) {
    resources.scripts.forEach((script) => {
      if (script.endsWith('.mjs') || script.includes('type=module')) {
        modulePreload(script)
      } else {
        preload(script, 'script')
      }
    })
  }

  // Preload styles
  if (resources.styles) {
    resources.styles.forEach((style) => {
      preload(style, 'style')
    })
  }

  // Preload fonts
  if (resources.fonts) {
    resources.fonts.forEach((font) => {
      preload(font, 'font', { crossOrigin: 'anonymous' })
    })
  }

  // Preload images
  if (resources.images) {
    resources.images.forEach((image) => {
      preload(image, 'image')
    })
  }

  // Prefetch next pages
  if (resources.nextPages) {
    resources.nextPages.forEach((page) => {
      prefetch(page, 'document')
    })
  }
}

/**
 * Setup common resource hints
 * 设置常用资源提示
 */
export function setupCommonHints() {
  console.log('[ResourceHints] Setting up common resource hints...')

  // DNS prefetch for common domains
  const commonDomains = [
    '//fonts.googleapis.com',
    '//fonts.gstatic.com',
    '//cdn.jsdelivr.net',
    '//unpkg.com',
  ]

  commonDomains.forEach((domain) => {
    dnsPrefetch(domain)
  })

  // Preconnect to API server (if configured)
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
  if (apiBaseUrl) {
    preconnect(apiBaseUrl, true)
  }

  console.log('[ResourceHints] Common hints setup complete')
}

/**
 * Intelligent prefetch based on user behavior
 * 基于用户行为的智能预取
 */
export class IntelligentPrefetcher {
  constructor(options = {}) {
    this.options = {
      hoverDelay: options.hoverDelay || 100, // ms
      viewportThreshold: options.viewportThreshold || 0.5,
      maxConcurrent: options.maxConcurrent || 3,
      debug: options.debug || false,
    }

    this.queue = []
    this.inFlight = new Set()
    this.observer = null

    this.init()
  }

  init() {
    // Setup viewport observer
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const url = entry.target.dataset.prefetchUrl
            const as = entry.target.dataset.prefetchAs || 'fetch'

            if (url) {
              this.addToQueue(url, as, 'low')
            }
          }
        })
      },
      {
        threshold: this.options.viewportThreshold,
      }
    )

    if (this.options.debug) {
      console.log('[IntelligentPrefetcher] Initialized')
    }
  }

  /**
   * Observe element for viewport prefetch
   */
  observe(element, url, as = 'fetch') {
    if (!element) {return}

    element.dataset.prefetchUrl = url
    element.dataset.prefetchAs = as

    this.observer.observe(element)
  }

  /**
   * Setup hover prefetch
   */
  onHover(element, url, as = 'fetch') {
    if (!element) {return}

    let timeoutId = null

    element.addEventListener('mouseenter', () => {
      timeoutId = setTimeout(() => {
        this.addToQueue(url, as, 'normal')
      }, this.options.hoverDelay)
    })

    element.addEventListener('mouseleave', () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    })
  }

  /**
   * Add to prefetch queue
   */
  addToQueue(url, as, priority = 'low') {
    // Skip if already in flight or queued
    if (this.inFlight.has(url) || this.queue.some((item) => item.url === url)) {
      return
    }

    this.queue.push({ url, as, priority })

    // Sort by priority
    this.queue.sort((a, b) => {
      const priorityMap = { high: 3, normal: 2, low: 1 }
      return priorityMap[b.priority] - priorityMap[a.priority]
    })

    this.processQueue()
  }

  /**
   * Process prefetch queue
   */
  async processQueue() {
    while (this.queue.length > 0 && this.inFlight.size < this.options.maxConcurrent) {
      const item = this.queue.shift()

      if (!item) {continue}

      this.inFlight.add(item.url)

      try {
        prefetch(item.url, item.as)

        if (this.options.debug) {
          console.log(`[IntelligentPrefetcher] Prefetched: ${item.url}`)
        }
      } catch (error) {
        console.error('[IntelligentPrefetcher] Prefetch failed:', error)
      } finally {
        this.inFlight.delete(item.url)
      }
    }
  }

  /**
   * Destroy
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }

    this.queue = []
    this.inFlight.clear()

    if (this.options.debug) {
      console.log('[IntelligentPrefetcher] Destroyed')
    }
  }
}

// Export default object
export default {
  dnsPrefetch,
  preconnect,
  prefetch,
  preload,
  prerender,
  modulePreload,
  batchAddHints,
  removeHint,
  clearHintsByType,
  preloadRouteResources,
  setupCommonHints,
  IntelligentPrefetcher,
}
