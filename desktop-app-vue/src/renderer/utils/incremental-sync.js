/**
 * Incremental Data Sync Manager
 * 增量数据同步管理器 - 只同步变更的数据
 *
 * Features:
 * - Delta synchronization (only changed data)
 * - Conflict detection and resolution
 * - Automatic sync intervals
 * - Offline support with queue
 * - Optimistic updates integration
 * - Real-time sync with WebSocket support
 */

class IncrementalSyncManager {
  constructor(options = {}) {
    // Configuration
    this.options = {
      syncInterval: options.syncInterval || 30000, // 30 seconds
      enableAutoSync: options.enableAutoSync !== false,
      enableRealtime: options.enableRealtime || false,
      conflictResolution: options.conflictResolution || 'server-wins', // 'server-wins', 'client-wins', 'manual'
      debug: options.debug || false,
    }

    // State
    this.lastSyncTime = null
    this.syncTimer = null
    this.pendingChanges = new Map() // entity -> changes
    this.syncQueue = []
    this.isOnline = navigator.onLine
    this.isSyncing = false
    this.websocket = null

    // Statistics
    this.stats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      conflictsResolved: 0,
      dataSaved: 0, // bytes saved by incremental sync
    }

    // Initialize
    this.init()

    if (this.options.debug) {
      console.log('[IncrementalSyncManager] Initialized')
    }
  }

  /**
   * Initialize sync manager
   */
  init() {
    // Setup online/offline listeners
    window.addEventListener('online', () => {
      this.isOnline = true
      this.syncNow()
    })

    window.addEventListener('offline', () => {
      this.isOnline = false
    })

    // Start auto-sync if enabled
    if (this.options.enableAutoSync) {
      this.startAutoSync()
    }

    // Setup real-time sync if enabled
    if (this.options.enableRealtime) {
      this.setupRealtimeSync()
    }
  }

  /**
   * Track a change for synchronization
   * @param {string} entity - Entity identifier (e.g., 'file:123', 'project:456')
   * @param {string} operation - 'create', 'update', 'delete'
   * @param {Object} data - Changed data
   */
  trackChange(entity, operation, data) {
    const change = {
      entity,
      operation,
      data,
      timestamp: Date.now(),
      synced: false,
    }

    this.pendingChanges.set(entity, change)

    if (this.options.debug) {
      console.log(`[IncrementalSyncManager] Tracked change: ${entity} (${operation})`)
    }

    // Trigger sync if enabled
    if (this.options.enableAutoSync && this.isOnline) {
      this.debouncedSync()
    }
  }

  /**
   * Sync now (manual trigger)
   * @param {Object} options - Sync options
   */
  async syncNow(options = {}) {
    if (this.isSyncing) {
      if (this.options.debug) {
        console.log('[IncrementalSyncManager] Sync already in progress')
      }
      return
    }

    if (!this.isOnline && !options.force) {
      if (this.options.debug) {
        console.log('[IncrementalSyncManager] Offline, skipping sync')
      }
      return
    }

    this.isSyncing = true
    this.stats.totalSyncs++

    try {
      // Get changes since last sync
      const changes = Array.from(this.pendingChanges.values())

      if (changes.length === 0) {
        if (this.options.debug) {
          console.log('[IncrementalSyncManager] No changes to sync')
        }
        return
      }

      if (this.options.debug) {
        console.log(`[IncrementalSyncManager] Syncing ${changes.length} changes`)
      }

      // Send changes to server
      const result = await this.sendChanges(changes)

      // Handle server response
      if (result.conflicts && result.conflicts.length > 0) {
        await this.resolveConflicts(result.conflicts)
      }

      // Apply remote changes
      if (result.remoteChanges && result.remoteChanges.length > 0) {
        await this.applyRemoteChanges(result.remoteChanges)
      }

      // Clear synced changes
      changes.forEach((change) => {
        this.pendingChanges.delete(change.entity)
      })

      this.lastSyncTime = Date.now()
      this.stats.successfulSyncs++

      // Estimate data saved
      const fullDataSize = this.estimateFullDataSize()
      const deltaSize = this.estimateDeltaSize(changes)
      this.stats.dataSaved += fullDataSize - deltaSize

      if (this.options.debug) {
        console.log('[IncrementalSyncManager] Sync completed successfully')
      }

      // Dispatch sync event
      window.dispatchEvent(
        new CustomEvent('incremental-sync-complete', {
          detail: { changes, result },
        })
      )
    } catch (error) {
      console.error('[IncrementalSyncManager] Sync failed:', error)
      this.stats.failedSyncs++

      // Add to offline queue
      if (!this.isOnline) {
        this.syncQueue.push({
          changes: Array.from(this.pendingChanges.values()),
          timestamp: Date.now(),
        })
      }

      // Dispatch error event
      window.dispatchEvent(
        new CustomEvent('incremental-sync-error', {
          detail: { error },
        })
      )

      throw error
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * Send changes to server
   * @param {Array} changes - Array of changes
   * @returns {Promise<Object>} Server response
   */
  async sendChanges(changes) {
    // Default implementation using fetch
    // Override this method to use your API client
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changes,
        lastSyncTime: this.lastSyncTime,
      }),
    })

    if (!response.ok) {
      throw new Error(`Sync failed: HTTP ${response.status}`)
    }

    return response.json()
  }

  /**
   * Apply remote changes from server
   * @param {Array} remoteChanges - Changes from server
   */
  async applyRemoteChanges(remoteChanges) {
    for (const change of remoteChanges) {
      const { entity, operation, data } = change

      // Dispatch event for each change
      window.dispatchEvent(
        new CustomEvent('remote-change', {
          detail: { entity, operation, data },
        })
      )

      if (this.options.debug) {
        console.log(`[IncrementalSyncManager] Applied remote change: ${entity} (${operation})`)
      }
    }
  }

  /**
   * Resolve conflicts
   * @param {Array} conflicts - Array of conflicts
   */
  async resolveConflicts(conflicts) {
    if (this.options.debug) {
      console.log(`[IncrementalSyncManager] Resolving ${conflicts.length} conflicts`)
    }

    for (const conflict of conflicts) {
      let resolution

      switch (this.options.conflictResolution) {
        case 'server-wins':
          resolution = conflict.serverVersion
          break

        case 'client-wins':
          resolution = conflict.clientVersion
          break

        case 'manual':
          // Dispatch event for manual resolution
          resolution = await this.requestManualResolution(conflict)
          break

        default:
          resolution = conflict.serverVersion
      }

      // Apply resolution
      window.dispatchEvent(
        new CustomEvent('conflict-resolved', {
          detail: { conflict, resolution },
        })
      )

      this.stats.conflictsResolved++
    }
  }

  /**
   * Request manual conflict resolution from user
   * @param {Object} conflict - Conflict data
   * @returns {Promise<Object>} Resolution
   */
  requestManualResolution(conflict) {
    return new Promise((resolve) => {
      // Dispatch event and wait for user decision
      const handler = (event) => {
        window.removeEventListener('conflict-resolution', handler)
        resolve(event.detail.resolution)
      }

      window.addEventListener('conflict-resolution', handler)

      window.dispatchEvent(
        new CustomEvent('conflict-needs-resolution', {
          detail: { conflict },
        })
      )
    })
  }

  /**
   * Auto-sync management
   */

  /**
   * Start automatic synchronization
   */
  startAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
    }

    this.syncTimer = setInterval(() => {
      this.syncNow()
    }, this.options.syncInterval)

    // Initial sync
    this.syncNow()

    if (this.options.debug) {
      console.log(`[IncrementalSyncManager] Auto-sync started (interval: ${this.options.syncInterval}ms)`)
    }
  }

  /**
   * Stop automatic synchronization
   */
  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null

      if (this.options.debug) {
        console.log('[IncrementalSyncManager] Auto-sync stopped')
      }
    }
  }

  /**
   * Debounced sync (prevents too frequent syncs)
   */
  debouncedSync = (() => {
    let timeout
    return () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        this.syncNow()
      }, 1000) // 1 second debounce
    }
  })()

  /**
   * Real-time sync with WebSocket
   */

  /**
   * Setup WebSocket connection for real-time sync
   */
  setupRealtimeSync() {
    const wsUrl = this.getWebSocketURL()

    this.websocket = new WebSocket(wsUrl)

    this.websocket.onopen = () => {
      if (this.options.debug) {
        console.log('[IncrementalSyncManager] WebSocket connected')
      }
    }

    this.websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)

        if (message.type === 'change') {
          this.applyRemoteChanges([message.data])
        }
      } catch (error) {
        console.error('[IncrementalSyncManager] WebSocket message error:', error)
      }
    }

    this.websocket.onerror = (error) => {
      console.error('[IncrementalSyncManager] WebSocket error:', error)
    }

    this.websocket.onclose = () => {
      if (this.options.debug) {
        console.log('[IncrementalSyncManager] WebSocket disconnected')
      }

      // Attempt reconnect after delay
      setTimeout(() => {
        this.setupRealtimeSync()
      }, 5000)
    }
  }

  /**
   * Get WebSocket URL
   */
  getWebSocketURL() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    return `${protocol}//${host}/ws/sync`
  }

  /**
   * Estimate data size (for statistics)
   */

  /**
   * Estimate full data size
   */
  estimateFullDataSize() {
    // Rough estimate: assume 10KB per entity
    return this.pendingChanges.size * 10 * 1024
  }

  /**
   * Estimate delta size
   */
  estimateDeltaSize(changes) {
    // Estimate based on actual change data
    const json = JSON.stringify(changes)
    return new Blob([json]).size
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      pendingChanges: this.pendingChanges.size,
      queuedSyncs: this.syncQueue.length,
      isSyncing: this.isSyncing,
      isOnline: this.isOnline,
      lastSyncTime: this.lastSyncTime,
      dataSavedMB: Math.round(this.stats.dataSaved / 1024 / 1024),
    }
  }

  /**
   * Clear all pending changes
   */
  clear() {
    this.pendingChanges.clear()
    this.syncQueue = []

    if (this.options.debug) {
      console.log('[IncrementalSyncManager] Cleared all pending changes')
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy() {
    this.stopAutoSync()

    if (this.websocket) {
      this.websocket.close()
      this.websocket = null
    }

    this.clear()

    if (this.options.debug) {
      console.log('[IncrementalSyncManager] Destroyed')
    }
  }
}

// Singleton instance
let managerInstance = null

/**
 * Get or create incremental sync manager instance
 */
export function getIncrementalSyncManager(options) {
  if (!managerInstance) {
    managerInstance = new IncrementalSyncManager(options)
  }
  return managerInstance
}

/**
 * Convenience function: track a change
 */
export function trackChange(entity, operation, data) {
  const manager = getIncrementalSyncManager()
  return manager.trackChange(entity, operation, data)
}

/**
 * Convenience function: sync now
 */
export async function syncNow(options) {
  const manager = getIncrementalSyncManager()
  return manager.syncNow(options)
}

export default IncrementalSyncManager
