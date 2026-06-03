/**
 * Service Worker for Offline Functionality
 * Provides read-only access to cached project data when offline
 */

const CACHE_NAME = 'chainlesschain-v1'
const RUNTIME_CACHE = 'chainlesschain-runtime-v1'

// Assets to cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
]

// Cache strategies
const CACHE_STRATEGIES = {
  CACHE_FIRST: 'cache-first',
  NETWORK_FIRST: 'network-first',
  CACHE_ONLY: 'cache-only',
  NETWORK_ONLY: 'network-only',
  STALE_WHILE_REVALIDATE: 'stale-while-revalidate'
}

// Route patterns and their strategies
const ROUTE_STRATEGIES = [
  {
    pattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
    strategy: CACHE_STRATEGIES.CACHE_FIRST
  },
  {
    pattern: /\.(?:js|css)$/,
    strategy: CACHE_STRATEGIES.STALE_WHILE_REVALIDATE
  },
  {
    pattern: /\/api\/projects\/\d+$/,
    strategy: CACHE_STRATEGIES.NETWORK_FIRST
  },
  {
    pattern: /\/api\/files\//,
    strategy: CACHE_STRATEGIES.NETWORK_FIRST
  }
]

/**
 * Install event - cache precache assets
 */
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...')

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Precaching assets')
        return cache.addAll(PRECACHE_ASSETS)
      })
      .then(() => {
        console.log('[Service Worker] Installed successfully')
        return self.skipWaiting()
      })
      .catch((error) => {
        console.error('[Service Worker] Installation failed:', error)
      })
  )
})

/**
 * Activate event - clean up old caches
 */
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...')

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              return cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE
            })
            .map((cacheName) => {
              console.log('[Service Worker] Deleting old cache:', cacheName)
              return caches.delete(cacheName)
            })
        )
      })
      .then(() => {
        console.log('[Service Worker] Activated successfully')
        return self.clients.claim()
      })
  )
})

/**
 * Fetch event - handle requests with appropriate strategy
 */
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return
  }

  // Find matching strategy
  const matchedRoute = ROUTE_STRATEGIES.find(route => route.pattern.test(url.pathname))
  const strategy = matchedRoute ? matchedRoute.strategy : CACHE_STRATEGIES.NETWORK_FIRST

  event.respondWith(
    handleRequest(request, strategy)
  )
})

/**
 * Handle request with specified strategy
 */
async function handleRequest(request, strategy) {
  switch (strategy) {
    case CACHE_STRATEGIES.CACHE_FIRST:
      return cacheFirst(request)

    case CACHE_STRATEGIES.NETWORK_FIRST:
      return networkFirst(request)

    case CACHE_STRATEGIES.CACHE_ONLY:
      return cacheOnly(request)

    case CACHE_STRATEGIES.NETWORK_ONLY:
      return networkOnly(request)

    case CACHE_STRATEGIES.STALE_WHILE_REVALIDATE:
      return staleWhileRevalidate(request)

    default:
      return networkFirst(request)
  }
}

/**
 * Cache First strategy
 * Try cache first, fallback to network
 */
async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE)
  const cached = await cache.match(request)

  if (cached) {
    console.log('[Service Worker] Cache hit:', request.url)
    return cached
  }

  console.log('[Service Worker] Cache miss, fetching:', request.url)
  try {
    const response = await fetch(request)

    // Cache successful responses
    if (response.ok) {
      cache.put(request, response.clone())
    }

    return response
  } catch (error) {
    console.error('[Service Worker] Fetch failed:', error)
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
  }
}

/**
 * Network First strategy
 * Try network first, fallback to cache
 */
async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE)

  try {
    const response = await fetch(request)

    // Cache successful responses
    if (response.ok) {
      cache.put(request, response.clone())
    }

    return response
  } catch (error) {
    console.log('[Service Worker] Network failed, trying cache:', request.url)
    const cached = await cache.match(request)

    if (cached) {
      return cached
    }

    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
  }
}

/**
 * Cache Only strategy
 * Only serve from cache
 */
async function cacheOnly(request) {
  const cache = await caches.open(RUNTIME_CACHE)
  const cached = await cache.match(request)

  if (cached) {
    return cached
  }

  return new Response('Not in cache', { status: 404, statusText: 'Not Found' })
}

/**
 * Network Only strategy
 * Only fetch from network
 */
async function networkOnly(request) {
  try {
    return await fetch(request)
  } catch (error) {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
  }
}

/**
 * Stale While Revalidate strategy
 * Serve from cache immediately, update cache in background
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE)
  const cached = await cache.match(request)

  // Fetch in background
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch((error) => {
      console.error('[Service Worker] Background fetch failed:', error)
    })

  // Return cached version immediately if available
  if (cached) {
    return cached
  }

  // Otherwise wait for network
  return fetchPromise
}

/**
 * Message event - handle commands from clients
 */
self.addEventListener('message', (event) => {
  const { type, payload } = event.data

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting()
      break

    case 'CACHE_URLS':
      cacheUrls(payload.urls)
        .then(() => {
          event.ports[0].postMessage({ success: true })
        })
        .catch((error) => {
          event.ports[0].postMessage({ success: false, error: error.message })
        })
      break

    case 'CLEAR_CACHE':
      clearCache()
        .then(() => {
          event.ports[0].postMessage({ success: true })
        })
        .catch((error) => {
          event.ports[0].postMessage({ success: false, error: error.message })
        })
      break

    case 'GET_CACHE_SIZE':
      getCacheSize()
        .then((size) => {
          event.ports[0].postMessage({ success: true, size })
        })
        .catch((error) => {
          event.ports[0].postMessage({ success: false, error: error.message })
        })
      break

    default:
      console.warn('[Service Worker] Unknown message type:', type)
  }
})

/**
 * Cache specific URLs
 */
async function cacheUrls(urls) {
  const cache = await caches.open(RUNTIME_CACHE)
  return cache.addAll(urls)
}

/**
 * Clear all caches
 */
async function clearCache() {
  const cacheNames = await caches.keys()
  return Promise.all(
    cacheNames.map(cacheName => caches.delete(cacheName))
  )
}

/**
 * Get total cache size
 */
async function getCacheSize() {
  if (!('storage' in navigator && 'estimate' in navigator.storage)) {
    return { usage: 0, quota: 0 }
  }

  const estimate = await navigator.storage.estimate()
  return {
    usage: estimate.usage,
    quota: estimate.quota,
    usageInMB: (estimate.usage / 1024 / 1024).toFixed(2),
    quotaInMB: (estimate.quota / 1024 / 1024).toFixed(2),
    percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(2)
  }
}

/**
 * Sync event - background sync for offline actions
 */
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Sync event:', event.tag)

  if (event.tag === 'sync-offline-actions') {
    event.waitUntil(syncOfflineActions())
  }
})

/**
 * Sync offline actions when back online
 */
async function syncOfflineActions() {
  // This would sync any offline actions stored in IndexedDB
  console.log('[Service Worker] Syncing offline actions...')

  // Implementation would depend on your offline action storage
  // For now, just log
  return Promise.resolve()
}

console.log('[Service Worker] Loaded')
