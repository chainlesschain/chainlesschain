/**
 * Optimistic Update Manager
 * 乐观更新管理器 - 提供即时 UI 响应和自动回滚
 *
 * Features:
 * - Instant UI updates before server response
 * - Automatic rollback on failure
 * - Undo/Redo support
 * - Conflict detection and resolution
 * - Offline queue
 * - Batch operations
 */

class OptimisticUpdateManager {
  constructor(options = {}) {
    // Configuration
    this.options = {
      maxHistorySize: options.maxHistorySize || 50,
      enableUndoRedo: options.enableUndoRedo !== false,
      enableConflictDetection: options.enableConflictDetection !== false,
      enableOfflineQueue: options.enableOfflineQueue !== false,
      retryOnFailure: options.retryOnFailure !== false,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000, // ms
      debug: options.debug || false,
    }

    // State
    this.updates = new Map() // updateId -> update metadata
    this.snapshots = new Map() // entity -> state snapshot
    this.undoStack = []
    this.redoStack = []
    this.offlineQueue = []
    this.conflicts = new Map() // entity -> conflicts array

    // Statistics
    this.stats = {
      totalUpdates: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      rolledBackUpdates: 0,
      conflictedUpdates: 0,
      averageResponseTime: 0,
    }

    // Event handlers
    this.eventHandlers = {
      success: [],
      failure: [],
      rollback: [],
      conflict: [],
    }

    // Check online status
    this.isOnline = navigator.onLine
    this.setupOnlineListener()

    if (this.options.debug) {
      console.log('[OptimisticUpdateManager] Initialized')
    }
  }

  /**
   * Perform optimistic update
   * @param {Object} config - Update configuration
   * @returns {Promise} Update result
   */
  async update(config) {
    const {
      entity, // Entity identifier (e.g., 'user:123', 'post:456')
      mutation, // Function to mutate local state
      apiCall, // Function to call API
      rollback, // Optional custom rollback function
      onSuccess,
      onFailure,
      priority = 'normal', // 'high', 'normal', 'low'
    } = config

    const updateId = this.generateUpdateId()
    this.stats.totalUpdates++

    // Save snapshot for rollback
    const snapshot = this.createSnapshot(entity)

    // Create update metadata
    const updateMetadata = {
      id: updateId,
      entity,
      mutation,
      apiCall,
      rollback,
      snapshot,
      priority,
      timestamp: Date.now(),
      status: 'pending',
      retryCount: 0,
    }

    this.updates.set(updateId, updateMetadata)

    try {
      // Step 1: Apply optimistic update immediately
      if (this.options.debug) {
        console.log(`[OptimisticUpdateManager] Applying optimistic update: ${updateId}`)
      }

      await mutation()
      updateMetadata.status = 'applied'

      // Add to undo stack
      if (this.options.enableUndoRedo) {
        this.addToUndoStack(updateMetadata)
      }

      // Step 2: Call API in background
      if (!this.isOnline && this.options.enableOfflineQueue) {
        // Add to offline queue
        this.offlineQueue.push(updateMetadata)

        if (this.options.debug) {
          console.log(`[OptimisticUpdateManager] Added to offline queue: ${updateId}`)
        }

        return { updateId, status: 'queued', offline: true }
      }

      const startTime = performance.now()
      const result = await apiCall()
      const responseTime = performance.now() - startTime

      this.updateAverageResponseTime(responseTime)

      // Step 3: Success - commit update
      updateMetadata.status = 'committed'
      this.stats.successfulUpdates++

      this.emit('success', { updateId, entity, result })

      if (onSuccess) {
        await onSuccess(result)
      }

      if (this.options.debug) {
        console.log(`[OptimisticUpdateManager] Committed: ${updateId} (${Math.round(responseTime)}ms)`)
      }

      return { updateId, status: 'committed', result }
    } catch (error) {
      // Step 4: Failure - rollback update
      updateMetadata.status = 'failed'
      updateMetadata.error = error
      this.stats.failedUpdates++

      if (this.options.debug) {
        console.error(`[OptimisticUpdateManager] Failed: ${updateId}`, error)
      }

      // Retry logic
      if (this.options.retryOnFailure && updateMetadata.retryCount < this.options.maxRetries) {
        updateMetadata.retryCount++

        if (this.options.debug) {
          console.log(`[OptimisticUpdateManager] Retrying ${updateMetadata.retryCount}/${this.options.maxRetries}: ${updateId}`)
        }

        await this.delay(this.options.retryDelay * updateMetadata.retryCount)

        // Retry
        return this.update({
          ...config,
          _retryUpdate: updateMetadata,
        })
      }

      // Rollback
      await this.rollbackUpdate(updateId, rollback)

      this.emit('failure', { updateId, entity, error })

      if (onFailure) {
        await onFailure(error)
      }

      throw error
    } finally {
      // Cleanup
      setTimeout(() => {
        this.updates.delete(updateId)
      }, 5000)
    }
  }

  /**
   * Rollback an update
   */
  async rollbackUpdate(updateId, customRollback) {
    const updateMetadata = this.updates.get(updateId)
    if (!updateMetadata) return

    if (this.options.debug) {
      console.log(`[OptimisticUpdateManager] Rolling back: ${updateId}`)
    }

    try {
      if (customRollback) {
        // Use custom rollback function
        await customRollback(updateMetadata.snapshot)
      } else {
        // Restore from snapshot
        this.restoreSnapshot(updateMetadata.entity, updateMetadata.snapshot)
      }

      updateMetadata.status = 'rolled_back'
      this.stats.rolledBackUpdates++

      this.emit('rollback', { updateId, entity: updateMetadata.entity })
    } catch (error) {
      console.error(`[OptimisticUpdateManager] Rollback failed: ${updateId}`, error)
    }
  }

  /**
   * Undo last update
   */
  async undo() {
    if (!this.options.enableUndoRedo || this.undoStack.length === 0) {
      if (this.options.debug) {
        console.log('[OptimisticUpdateManager] Nothing to undo')
      }
      return null
    }

    const updateMetadata = this.undoStack.pop()

    await this.rollbackUpdate(updateMetadata.id)

    // Move to redo stack
    this.redoStack.push(updateMetadata)

    // Limit redo stack size
    if (this.redoStack.length > this.options.maxHistorySize) {
      this.redoStack.shift()
    }

    if (this.options.debug) {
      console.log(`[OptimisticUpdateManager] Undone: ${updateMetadata.id}`)
    }

    return updateMetadata
  }

  /**
   * Redo last undone update
   */
  async redo() {
    if (!this.options.enableUndoRedo || this.redoStack.length === 0) {
      if (this.options.debug) {
        console.log('[OptimisticUpdateManager] Nothing to redo')
      }
      return null
    }

    const updateMetadata = this.redoStack.pop()

    // Re-apply mutation
    await updateMetadata.mutation()

    // Move back to undo stack
    this.undoStack.push(updateMetadata)

    if (this.options.debug) {
      console.log(`[OptimisticUpdateManager] Redone: ${updateMetadata.id}`)
    }

    return updateMetadata
  }

  /**
   * Batch optimistic updates
   */
  async batchUpdate(updates) {
    if (this.options.debug) {
      console.log(`[OptimisticUpdateManager] Batch update: ${updates.length} operations`)
    }

    const results = await Promise.allSettled(
      updates.map(config => this.update(config))
    )

    const successful = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    if (this.options.debug) {
      console.log(`[OptimisticUpdateManager] Batch completed: ${successful} succeeded, ${failed} failed`)
    }

    return results
  }

  /**
   * Process offline queue when back online
   */
  async processOfflineQueue() {
    if (this.offlineQueue.length === 0) return

    if (this.options.debug) {
      console.log(`[OptimisticUpdateManager] Processing offline queue: ${this.offlineQueue.length} items`)
    }

    const queue = [...this.offlineQueue]
    this.offlineQueue = []

    for (const updateMetadata of queue) {
      try {
        const result = await updateMetadata.apiCall()

        updateMetadata.status = 'committed'
        this.stats.successfulUpdates++

        this.emit('success', {
          updateId: updateMetadata.id,
          entity: updateMetadata.entity,
          result,
          fromOfflineQueue: true,
        })
      } catch (error) {
        // Re-add to queue or rollback
        this.offlineQueue.push(updateMetadata)

        if (this.options.debug) {
          console.error(`[OptimisticUpdateManager] Offline queue item failed: ${updateMetadata.id}`, error)
        }
      }
    }
  }

  /**
   * Detect conflicts
   */
  detectConflict(entity, incomingData) {
    if (!this.options.enableConflictDetection) return null

    const pendingUpdates = Array.from(this.updates.values())
      .filter(u => u.entity === entity && u.status === 'pending')

    if (pendingUpdates.length > 0) {
      const conflict = {
        entity,
        pendingUpdates: pendingUpdates.map(u => u.id),
        incomingData,
        timestamp: Date.now(),
      }

      this.conflicts.set(entity, conflict)
      this.stats.conflictedUpdates++

      this.emit('conflict', conflict)

      if (this.options.debug) {
        console.warn(`[OptimisticUpdateManager] Conflict detected for entity: ${entity}`)
      }

      return conflict
    }

    return null
  }

  /**
   * Create snapshot
   */
  createSnapshot(entity) {
    // Override this method to implement custom snapshot logic
    // Default: return shallow copy of entity
    return { entity, timestamp: Date.now() }
  }

  /**
   * Restore snapshot
   */
  restoreSnapshot(entity, snapshot) {
    // Override this method to implement custom restore logic
    if (this.options.debug) {
      console.log(`[OptimisticUpdateManager] Restoring snapshot for: ${entity}`)
    }
  }

  /**
   * Add to undo stack
   */
  addToUndoStack(updateMetadata) {
    this.undoStack.push(updateMetadata)

    // Limit stack size
    if (this.undoStack.length > this.options.maxHistorySize) {
      this.undoStack.shift()
    }

    // Clear redo stack
    this.redoStack = []
  }

  /**
   * Setup online/offline listener
   */
  setupOnlineListener() {
    window.addEventListener('online', () => {
      this.isOnline = true

      if (this.options.debug) {
        console.log('[OptimisticUpdateManager] Back online')
      }

      this.processOfflineQueue()
    })

    window.addEventListener('offline', () => {
      this.isOnline = false

      if (this.options.debug) {
        console.log('[OptimisticUpdateManager] Went offline')
      }
    })
  }

  /**
   * Event system
   */
  on(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(handler)
    }
  }

  emit(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => handler(data))
    }
  }

  /**
   * Generate unique update ID
   */
  generateUpdateId() {
    return `update_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Update average response time
   */
  updateAverageResponseTime(newTime) {
    const count = this.stats.successfulUpdates
    this.stats.averageResponseTime =
      ((this.stats.averageResponseTime * (count - 1)) + newTime) / count
  }

  /**
   * Delay utility
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      pendingUpdates: this.updates.size,
      offlineQueueSize: this.offlineQueue.length,
      undoStackSize: this.undoStack.length,
      redoStackSize: this.redoStack.length,
      conflictsCount: this.conflicts.size,
      isOnline: this.isOnline,
    }
  }

  /**
   * Clear all updates
   */
  clear() {
    this.updates.clear()
    this.snapshots.clear()
    this.undoStack = []
    this.redoStack = []
    this.offlineQueue = []
    this.conflicts.clear()

    if (this.options.debug) {
      console.log('[OptimisticUpdateManager] Cleared all updates')
    }
  }

  /**
   * Destroy
   */
  destroy() {
    this.clear()

    if (this.options.debug) {
      console.log('[OptimisticUpdateManager] Destroyed')
    }
  }
}

// Singleton instance
let managerInstance = null

/**
 * Get or create optimistic update manager instance
 */
export function getOptimisticUpdateManager(options) {
  if (!managerInstance) {
    managerInstance = new OptimisticUpdateManager(options)
  }
  return managerInstance
}

/**
 * Convenience function: perform optimistic update
 */
export async function optimisticUpdate(config) {
  const manager = getOptimisticUpdateManager()
  return manager.update(config)
}

export default OptimisticUpdateManager
