/**
 * Project Detail Page Optimizations Integration
 *
 * This file provides integration utilities for the advanced optimizations:
 * - Performance monitoring
 * - Service worker for offline functionality
 * - Progressive file tree loading
 * - Editor instance pooling
 */

import performanceTracker from '@/utils/performance-tracker'
import serviceWorkerManager from '@/utils/service-worker-manager'
import { createEditorPoolManager, createMonacoEditorFactory } from '@/utils/editor-pool'

/**
 * Initialize all optimizations
 */
export async function initializeOptimizations(options = {}) {
  const results = {
    performanceTracker: false,
    serviceWorker: false,
    editorPool: false
  }

  try {
    // Initialize performance tracker
    console.log('[Optimizations] Initializing performance tracker...')
    results.performanceTracker = true

    // Register service worker for offline functionality
    if (options.enableOffline !== false) {
      console.log('[Optimizations] Registering service worker...')
      results.serviceWorker = await serviceWorkerManager.register()

      if (results.serviceWorker) {
        console.log('[Optimizations] Service worker registered successfully')
      } else {
        console.warn('[Optimizations] Service worker registration failed')
      }
    }

    // Initialize editor pool
    if (options.enableEditorPool !== false) {
      console.log('[Optimizations] Initializing editor pool...')
      results.editorPool = true
    }

    console.log('[Optimizations] Initialization complete:', results)
    return results
  } catch (error) {
    console.error('[Optimizations] Initialization failed:', error)
    return results
  }
}

/**
 * Create editor pool manager with Monaco factory
 */
export function createEditorPool(monaco) {
  return createEditorPoolManager({
    maxPoolSize: 10,
    editorFactory: createMonacoEditorFactory(monaco)
  })
}

/**
 * Setup performance monitoring for file operations
 */
export function setupFileOperationTracking() {
  // Track file reads
  const originalReadFile = window.electron?.invoke

  if (originalReadFile) {
    window.electron.invoke = async function(channel, ...args) {
      if (channel === 'read-file' || channel === 'get-file-content') {
        const startTime = performance.now()
        try {
          const result = await originalReadFile.call(this, channel, ...args)
          performanceTracker.trackFileOperation(
            'read-file',
            args[0]?.path || 'unknown',
            startTime
          )
          return result
        } catch (error) {
          performanceTracker.trackFileOperation(
            'read-file-error',
            args[0]?.path || 'unknown',
            startTime
          )
          throw error
        }
      }

      return originalReadFile.call(this, channel, ...args)
    }
  }

  return () => {
    // Cleanup function
    if (originalReadFile) {
      window.electron.invoke = originalReadFile
    }
  }
}

/**
 * Setup performance monitoring for AI responses
 */
export function setupAiResponseTracking(conversationStore) {
  const unsubscribe = performanceTracker.addListener((event, data) => {
    if (event === 'aiResponse') {
      console.log('[AI Response]', data)
    }
  })

  return unsubscribe
}

/**
 * Prefetch project data for offline access
 */
export async function prefetchProjectForOffline(projectId) {
  try {
    const success = await serviceWorkerManager.prefetchProject(projectId)

    if (success) {
      console.log(`[Offline] Project ${projectId} prefetched successfully`)
      return true
    } else {
      console.warn(`[Offline] Failed to prefetch project ${projectId}`)
      return false
    }
  } catch (error) {
    console.error('[Offline] Prefetch error:', error)
    return false
  }
}

/**
 * Check if project is available offline
 */
export async function isProjectAvailableOffline(projectId) {
  try {
    return await serviceWorkerManager.isProjectCached(projectId)
  } catch (error) {
    console.error('[Offline] Cache check error:', error)
    return false
  }
}

/**
 * Get performance metrics
 */
export function getPerformanceMetrics() {
  return performanceTracker.getAllMetrics()
}

/**
 * Get cache statistics
 */
export async function getCacheStatistics() {
  try {
    const cacheSize = await serviceWorkerManager.getCacheSize()
    return cacheSize
  } catch (error) {
    console.error('[Cache] Failed to get statistics:', error)
    return null
  }
}

/**
 * Clear all caches
 */
export async function clearAllCaches() {
  try {
    await serviceWorkerManager.clearCache()
    console.log('[Cache] All caches cleared')
    return true
  } catch (error) {
    console.error('[Cache] Failed to clear caches:', error)
    return false
  }
}

/**
 * Monitor online/offline status
 */
export function setupOnlineStatusMonitoring(callback) {
  const unsubscribe = serviceWorkerManager.addListener((event, data) => {
    if (event === 'online' || event === 'offline') {
      callback(event === 'online', data)
    }
  })

  // Initial status
  callback(serviceWorkerManager.checkOnline())

  return unsubscribe
}

/**
 * Optimize file tree loading
 */
export function optimizeFileTreeLoading(files, options = {}) {
  const {
    batchSize = 50,
    priorityPaths = []
  } = options

  // Sort files: priority paths first, then by depth, then alphabetically
  const sortedFiles = [...files].sort((a, b) => {
    // Check priority
    const aPriority = priorityPaths.some(path => a.path.startsWith(path))
    const bPriority = priorityPaths.some(path => b.path.startsWith(path))

    if (aPriority && !bPriority) {return -1}
    if (!aPriority && bPriority) {return 1}

    // Sort by depth (shallower first)
    const aDepth = a.path.split('/').length
    const bDepth = b.path.split('/').length

    if (aDepth !== bDepth) {return aDepth - bDepth}

    // Sort alphabetically
    return a.path.localeCompare(b.path)
  })

  // Split into batches
  const batches = []
  for (let i = 0; i < sortedFiles.length; i += batchSize) {
    batches.push(sortedFiles.slice(i, i + batchSize))
  }

  return batches
}

/**
 * Debounce function for performance
 */
export function debounce(fn, delay) {
  let timeoutId
  return function(...args) {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn.apply(this, args), delay)
  }
}

/**
 * Throttle function for performance
 */
export function throttle(fn, limit) {
  let inThrottle
  return function(...args) {
    if (!inThrottle) {
      fn.apply(this, args)
      inThrottle = true
      setTimeout(() => inThrottle = false, limit)
    }
  }
}

/**
 * Measure component render time
 */
export function measureRenderTime(componentName) {
  const startMark = `${componentName}-render-start`
  const endMark = `${componentName}-render-end`
  const measureName = `${componentName}-render`

  performance.mark(startMark)

  return () => {
    performance.mark(endMark)
    try {
      performance.measure(measureName, startMark, endMark)
      const measure = performance.getEntriesByName(measureName)[0]
      console.log(`[Render] ${componentName}: ${Math.round(measure.duration)}ms`)

      // Clean up
      performance.clearMarks(startMark)
      performance.clearMarks(endMark)
      performance.clearMeasures(measureName)
    } catch (error) {
      console.error('[Render] Measurement failed:', error)
    }
  }
}

/**
 * Create lazy loader for heavy components
 */
export function createLazyLoader(loader, options = {}) {
  const {
    delay = 200,
    timeout = 10000,
    errorComponent = null,
    loadingComponent = null
  } = options

  return {
    loader,
    delay,
    timeout,
    errorComponent,
    loadingComponent
  }
}

/**
 * Optimize image loading
 */
export function optimizeImageLoading(images) {
  // Use Intersection Observer for lazy loading
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target
          const src = img.dataset.src

          if (src) {
            img.src = src
            img.removeAttribute('data-src')
            observer.unobserve(img)
          }
        }
      })
    },
    {
      rootMargin: '50px'
    }
  )

  images.forEach(img => observer.observe(img))

  return () => observer.disconnect()
}

/**
 * Batch DOM updates
 */
export function batchDOMUpdates(updates) {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      updates.forEach(update => update())
      resolve()
    })
  })
}

/**
 * Memory usage monitor
 */
export function monitorMemoryUsage(callback, interval = 5000) {
  if (!performance.memory) {
    console.warn('[Memory] Performance.memory not available')
    return () => {}
  }

  const intervalId = setInterval(() => {
    const memory = {
      used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
      total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
    }

    callback(memory)
  }, interval)

  return () => clearInterval(intervalId)
}

export default {
  initializeOptimizations,
  createEditorPool,
  setupFileOperationTracking,
  setupAiResponseTracking,
  prefetchProjectForOffline,
  isProjectAvailableOffline,
  getPerformanceMetrics,
  getCacheStatistics,
  clearAllCaches,
  setupOnlineStatusMonitoring,
  optimizeFileTreeLoading,
  debounce,
  throttle,
  measureRenderTime,
  createLazyLoader,
  optimizeImageLoading,
  batchDOMUpdates,
  monitorMemoryUsage
}
