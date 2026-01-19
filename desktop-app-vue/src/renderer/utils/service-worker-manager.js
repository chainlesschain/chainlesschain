import { logger, createLogger } from '@/utils/logger';

/**
 * Service Worker Manager
 * Handles service worker registration and communication
 */

class ServiceWorkerManager {
  constructor() {
    this.registration = null
    this.isOnline = navigator.onLine
    this.listeners = []

    // Listen for online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true
      this.emit('online')
    })

    window.addEventListener('offline', () => {
      this.isOnline = false
      this.emit('offline')
    })
  }

  /**
   * Register service worker
   */
  async register() {
    if (!('serviceWorker' in navigator)) {
      logger.warn('Service Worker not supported')
      return false
    }

    try {
      this.registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/'
      })

      logger.info('[SW Manager] Service Worker registered:', this.registration.scope)

      // Handle updates
      this.registration.addEventListener('updatefound', () => {
        const newWorker = this.registration.installing
        logger.info('[SW Manager] New service worker found')

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            logger.info('[SW Manager] New service worker installed')
            this.emit('update', newWorker)
          }
        })
      })

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        this.handleMessage(event.data)
      })

      return true
    } catch (error) {
      logger.error('[SW Manager] Registration failed:', error)
      return false
    }
  }

  /**
   * Unregister service worker
   */
  async unregister() {
    if (!this.registration) {
      return false
    }

    try {
      const success = await this.registration.unregister()
      logger.info('[SW Manager] Service Worker unregistered:', success)
      this.registration = null
      return success
    } catch (error) {
      logger.error('[SW Manager] Unregistration failed:', error)
      return false
    }
  }

  /**
   * Update service worker
   */
  async update() {
    if (!this.registration) {
      return false
    }

    try {
      await this.registration.update()
      logger.info('[SW Manager] Service Worker updated')
      return true
    } catch (error) {
      logger.error('[SW Manager] Update failed:', error)
      return false
    }
  }

  /**
   * Skip waiting and activate new service worker
   */
  async skipWaiting() {
    if (!this.registration || !this.registration.waiting) {
      return false
    }

    try {
      this.registration.waiting.postMessage({ type: 'SKIP_WAITING' })
      return true
    } catch (error) {
      logger.error('[SW Manager] Skip waiting failed:', error)
      return false
    }
  }

  /**
   * Cache specific URLs
   */
  async cacheUrls(urls) {
    if (!this.registration) {
      throw new Error('Service Worker not registered')
    }

    return this.sendMessage('CACHE_URLS', { urls })
  }

  /**
   * Clear all caches
   */
  async clearCache() {
    if (!this.registration) {
      throw new Error('Service Worker not registered')
    }

    return this.sendMessage('CLEAR_CACHE')
  }

  /**
   * Get cache size
   */
  async getCacheSize() {
    if (!this.registration) {
      throw new Error('Service Worker not registered')
    }

    return this.sendMessage('GET_CACHE_SIZE')
  }

  /**
   * Send message to service worker
   */
  async sendMessage(type, payload = {}) {
    if (!this.registration || !this.registration.active) {
      throw new Error('Service Worker not active')
    }

    return new Promise((resolve, reject) => {
      const messageChannel = new MessageChannel()

      messageChannel.port1.onmessage = (event) => {
        if (event.data.success) {
          resolve(event.data)
        } else {
          reject(new Error(event.data.error))
        }
      }

      this.registration.active.postMessage(
        { type, payload },
        [messageChannel.port2]
      )
    })
  }

  /**
   * Handle message from service worker
   */
  handleMessage(data) {
    logger.info('[SW Manager] Message from service worker:', data)
    this.emit('message', data)
  }

  /**
   * Add event listener
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
        logger.error('[SW Manager] Listener error:', error)
      }
    })
  }

  /**
   * Check if online
   */
  checkOnline() {
    return this.isOnline
  }

  /**
   * Get registration status
   */
  getStatus() {
    if (!this.registration) {
      return 'not-registered'
    }

    if (this.registration.installing) {
      return 'installing'
    }

    if (this.registration.waiting) {
      return 'waiting'
    }

    if (this.registration.active) {
      return 'active'
    }

    return 'unknown'
  }

  /**
   * Prefetch project data for offline access
   */
  async prefetchProject(projectId) {
    try {
      const urls = [
        `/api/projects/${projectId}`,
        `/api/projects/${projectId}/files`,
        `/api/projects/${projectId}/conversations`
      ]

      await this.cacheUrls(urls)
      logger.info('[SW Manager] Project data prefetched:', projectId)
      return true
    } catch (error) {
      logger.error('[SW Manager] Prefetch failed:', error)
      return false
    }
  }

  /**
   * Check if project is available offline
   */
  async isProjectCached(projectId) {
    try {
      const cache = await caches.open('chainlesschain-runtime-v1')
      const urls = [
        `/api/projects/${projectId}`,
        `/api/projects/${projectId}/files`
      ]

      const results = await Promise.all(
        urls.map(url => cache.match(url))
      )

      return results.every(response => response !== undefined)
    } catch (error) {
      logger.error('[SW Manager] Cache check failed:', error)
      return false
    }
  }
}

// Create singleton instance
const serviceWorkerManager = new ServiceWorkerManager()

export default serviceWorkerManager
