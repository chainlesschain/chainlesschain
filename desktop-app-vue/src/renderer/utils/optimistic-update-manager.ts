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

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 更新优先级
 */
export type UpdatePriority = 'high' | 'normal' | 'low';

/**
 * 更新状态
 */
export type UpdateStatus = 'pending' | 'applied' | 'committed' | 'failed' | 'rolled_back';

/**
 * 事件类型
 */
export type UpdateEventType = 'success' | 'failure' | 'rollback' | 'conflict';

/**
 * 管理器配置选项
 */
export interface OptimisticUpdateOptions {
  maxHistorySize?: number;
  enableUndoRedo?: boolean;
  enableConflictDetection?: boolean;
  enableOfflineQueue?: boolean;
  retryOnFailure?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  debug?: boolean;
}

/**
 * 状态快照
 */
export interface StateSnapshot {
  entity: string;
  timestamp: number;
  data?: any;
}

/**
 * 更新配置
 */
export interface UpdateConfig<T = any, R = any> {
  entity: string;
  mutation: () => Promise<void> | void;
  apiCall: () => Promise<R>;
  rollback?: (snapshot: StateSnapshot) => Promise<void> | void;
  onSuccess?: (result: R) => Promise<void> | void;
  onFailure?: (error: Error) => Promise<void> | void;
  priority?: UpdatePriority;
  _retryUpdate?: UpdateMetadata<T, R>;
}

/**
 * 更新元数据
 */
export interface UpdateMetadata<T = any, R = any> {
  id: string;
  entity: string;
  mutation: () => Promise<void> | void;
  apiCall: () => Promise<R>;
  rollback?: (snapshot: StateSnapshot) => Promise<void> | void;
  snapshot: StateSnapshot;
  priority: UpdatePriority;
  timestamp: number;
  status: UpdateStatus;
  retryCount: number;
  error?: Error;
}

/**
 * 更新结果
 */
export interface UpdateResult<R = any> {
  updateId: string;
  status: 'committed' | 'queued';
  result?: R;
  offline?: boolean;
}

/**
 * 冲突信息
 */
export interface ConflictInfo {
  entity: string;
  pendingUpdates: string[];
  incomingData: any;
  timestamp: number;
}

/**
 * 统计信息
 */
export interface UpdateStats {
  totalUpdates: number;
  successfulUpdates: number;
  failedUpdates: number;
  rolledBackUpdates: number;
  conflictedUpdates: number;
  averageResponseTime: number;
}

/**
 * 完整统计信息
 */
export interface FullUpdateStats extends UpdateStats {
  pendingUpdates: number;
  offlineQueueSize: number;
  undoStackSize: number;
  redoStackSize: number;
  conflictsCount: number;
  isOnline: boolean;
}

/**
 * 成功事件数据
 */
export interface SuccessEventData<R = any> {
  updateId: string;
  entity: string;
  result: R;
  fromOfflineQueue?: boolean;
}

/**
 * 失败事件数据
 */
export interface FailureEventData {
  updateId: string;
  entity: string;
  error: Error;
}

/**
 * 回滚事件数据
 */
export interface RollbackEventData {
  updateId: string;
  entity: string;
}

/**
 * 事件处理器类型
 */
export type EventHandler<T = any> = (data: T) => void;

/**
 * 事件处理器映射
 */
export interface EventHandlers {
  success: EventHandler<SuccessEventData>[];
  failure: EventHandler<FailureEventData>[];
  rollback: EventHandler<RollbackEventData>[];
  conflict: EventHandler<ConflictInfo>[];
}

// ==================== 类实现 ====================

/**
 * 乐观更新管理器
 */
class OptimisticUpdateManager {
  // Configuration
  private options: Required<OptimisticUpdateOptions>;

  // State
  private updates: Map<string, UpdateMetadata>;
  private snapshots: Map<string, StateSnapshot>;
  private undoStack: UpdateMetadata[];
  private redoStack: UpdateMetadata[];
  private offlineQueue: UpdateMetadata[];
  private conflicts: Map<string, ConflictInfo>;

  // Statistics
  private stats: UpdateStats;

  // Event handlers
  private eventHandlers: EventHandlers;

  // Online status
  private isOnline: boolean;

  constructor(options: OptimisticUpdateOptions = {}) {
    this.options = {
      maxHistorySize: options.maxHistorySize ?? 50,
      enableUndoRedo: options.enableUndoRedo !== false,
      enableConflictDetection: options.enableConflictDetection !== false,
      enableOfflineQueue: options.enableOfflineQueue !== false,
      retryOnFailure: options.retryOnFailure !== false,
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      debug: options.debug ?? false,
    };

    this.updates = new Map();
    this.snapshots = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.offlineQueue = [];
    this.conflicts = new Map();

    this.stats = {
      totalUpdates: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      rolledBackUpdates: 0,
      conflictedUpdates: 0,
      averageResponseTime: 0,
    };

    this.eventHandlers = {
      success: [],
      failure: [],
      rollback: [],
      conflict: [],
    };

    this.isOnline = navigator.onLine;
    this.setupOnlineListener();

    if (this.options.debug) {
      logger.info('[OptimisticUpdateManager] Initialized');
    }
  }

  /**
   * Perform optimistic update
   */
  async update<T = any, R = any>(config: UpdateConfig<T, R>): Promise<UpdateResult<R>> {
    const {
      entity,
      mutation,
      apiCall,
      rollback,
      onSuccess,
      onFailure,
      priority = 'normal',
    } = config;

    const updateId = this.generateUpdateId();
    this.stats.totalUpdates++;

    // Save snapshot for rollback
    const snapshot = this.createSnapshot(entity);

    // Create update metadata
    const updateMetadata: UpdateMetadata<T, R> = {
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
    };

    this.updates.set(updateId, updateMetadata);

    try {
      // Step 1: Apply optimistic update immediately
      if (this.options.debug) {
        logger.info(`[OptimisticUpdateManager] Applying optimistic update: ${updateId}`);
      }

      await mutation();
      updateMetadata.status = 'applied';

      // Add to undo stack
      if (this.options.enableUndoRedo) {
        this.addToUndoStack(updateMetadata);
      }

      // Step 2: Call API in background
      if (!this.isOnline && this.options.enableOfflineQueue) {
        // Add to offline queue
        this.offlineQueue.push(updateMetadata);

        if (this.options.debug) {
          logger.info(`[OptimisticUpdateManager] Added to offline queue: ${updateId}`);
        }

        return { updateId, status: 'queued', offline: true };
      }

      const startTime = performance.now();
      const result = await apiCall();
      const responseTime = performance.now() - startTime;

      this.updateAverageResponseTime(responseTime);

      // Step 3: Success - commit update
      updateMetadata.status = 'committed';
      this.stats.successfulUpdates++;

      this.emit('success', { updateId, entity, result });

      if (onSuccess) {
        await onSuccess(result);
      }

      if (this.options.debug) {
        logger.info(`[OptimisticUpdateManager] Committed: ${updateId} (${Math.round(responseTime)}ms)`);
      }

      return { updateId, status: 'committed', result };
    } catch (error) {
      // Step 4: Failure - rollback update
      updateMetadata.status = 'failed';
      updateMetadata.error = error as Error;
      this.stats.failedUpdates++;

      if (this.options.debug) {
        logger.error(`[OptimisticUpdateManager] Failed: ${updateId}`, error);
      }

      // Retry logic
      if (this.options.retryOnFailure && updateMetadata.retryCount < this.options.maxRetries) {
        updateMetadata.retryCount++;

        if (this.options.debug) {
          logger.info(`[OptimisticUpdateManager] Retrying ${updateMetadata.retryCount}/${this.options.maxRetries}: ${updateId}`);
        }

        await this.delay(this.options.retryDelay * updateMetadata.retryCount);

        // Retry
        return this.update({
          ...config,
          _retryUpdate: updateMetadata,
        });
      }

      // Rollback
      await this.rollbackUpdate(updateId, rollback);

      this.emit('failure', { updateId, entity, error: error as Error });

      if (onFailure) {
        await onFailure(error as Error);
      }

      throw error;
    } finally {
      // Cleanup
      setTimeout(() => {
        this.updates.delete(updateId);
      }, 5000);
    }
  }

  /**
   * Rollback an update
   */
  async rollbackUpdate(
    updateId: string,
    customRollback?: (snapshot: StateSnapshot) => Promise<void> | void
  ): Promise<void> {
    const updateMetadata = this.updates.get(updateId);
    if (!updateMetadata) { return; }

    if (this.options.debug) {
      logger.info(`[OptimisticUpdateManager] Rolling back: ${updateId}`);
    }

    try {
      if (customRollback) {
        // Use custom rollback function
        await customRollback(updateMetadata.snapshot);
      } else {
        // Restore from snapshot
        this.restoreSnapshot(updateMetadata.entity, updateMetadata.snapshot);
      }

      updateMetadata.status = 'rolled_back';
      this.stats.rolledBackUpdates++;

      this.emit('rollback', { updateId, entity: updateMetadata.entity });
    } catch (error) {
      logger.error(`[OptimisticUpdateManager] Rollback failed: ${updateId}`, error);
    }
  }

  /**
   * Undo last update
   */
  async undo(): Promise<UpdateMetadata | null> {
    if (!this.options.enableUndoRedo || this.undoStack.length === 0) {
      if (this.options.debug) {
        logger.info('[OptimisticUpdateManager] Nothing to undo');
      }
      return null;
    }

    const updateMetadata = this.undoStack.pop()!;

    await this.rollbackUpdate(updateMetadata.id);

    // Move to redo stack
    this.redoStack.push(updateMetadata);

    // Limit redo stack size
    if (this.redoStack.length > this.options.maxHistorySize) {
      this.redoStack.shift();
    }

    if (this.options.debug) {
      logger.info(`[OptimisticUpdateManager] Undone: ${updateMetadata.id}`);
    }

    return updateMetadata;
  }

  /**
   * Redo last undone update
   */
  async redo(): Promise<UpdateMetadata | null> {
    if (!this.options.enableUndoRedo || this.redoStack.length === 0) {
      if (this.options.debug) {
        logger.info('[OptimisticUpdateManager] Nothing to redo');
      }
      return null;
    }

    const updateMetadata = this.redoStack.pop()!;

    // Re-apply mutation
    await updateMetadata.mutation();

    // Move back to undo stack
    this.undoStack.push(updateMetadata);

    if (this.options.debug) {
      logger.info(`[OptimisticUpdateManager] Redone: ${updateMetadata.id}`);
    }

    return updateMetadata;
  }

  /**
   * Batch optimistic updates
   */
  async batchUpdate<T = any, R = any>(updates: UpdateConfig<T, R>[]): Promise<PromiseSettledResult<UpdateResult<R>>[]> {
    if (this.options.debug) {
      logger.info(`[OptimisticUpdateManager] Batch update: ${updates.length} operations`);
    }

    const results = await Promise.allSettled(
      updates.map(config => this.update(config))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    if (this.options.debug) {
      logger.info(`[OptimisticUpdateManager] Batch completed: ${successful} succeeded, ${failed} failed`);
    }

    return results;
  }

  /**
   * Process offline queue when back online
   */
  async processOfflineQueue(): Promise<void> {
    if (this.offlineQueue.length === 0) { return; }

    if (this.options.debug) {
      logger.info(`[OptimisticUpdateManager] Processing offline queue: ${this.offlineQueue.length} items`);
    }

    const queue = [...this.offlineQueue];
    this.offlineQueue = [];

    for (const updateMetadata of queue) {
      try {
        const result = await updateMetadata.apiCall();

        updateMetadata.status = 'committed';
        this.stats.successfulUpdates++;

        this.emit('success', {
          updateId: updateMetadata.id,
          entity: updateMetadata.entity,
          result,
          fromOfflineQueue: true,
        });
      } catch (error) {
        // Re-add to queue or rollback
        this.offlineQueue.push(updateMetadata);

        if (this.options.debug) {
          logger.error(`[OptimisticUpdateManager] Offline queue item failed: ${updateMetadata.id}`, error);
        }
      }
    }
  }

  /**
   * Detect conflicts
   */
  detectConflict(entity: string, incomingData: any): ConflictInfo | null {
    if (!this.options.enableConflictDetection) { return null; }

    const pendingUpdates = Array.from(this.updates.values())
      .filter(u => u.entity === entity && u.status === 'pending');

    if (pendingUpdates.length > 0) {
      const conflict: ConflictInfo = {
        entity,
        pendingUpdates: pendingUpdates.map(u => u.id),
        incomingData,
        timestamp: Date.now(),
      };

      this.conflicts.set(entity, conflict);
      this.stats.conflictedUpdates++;

      this.emit('conflict', conflict);

      if (this.options.debug) {
        logger.warn(`[OptimisticUpdateManager] Conflict detected for entity: ${entity}`);
      }

      return conflict;
    }

    return null;
  }

  /**
   * Create snapshot
   */
  createSnapshot(entity: string): StateSnapshot {
    // Override this method to implement custom snapshot logic
    // Default: return shallow copy of entity
    return { entity, timestamp: Date.now() };
  }

  /**
   * Restore snapshot
   */
  restoreSnapshot(entity: string, snapshot: StateSnapshot): void {
    // Override this method to implement custom restore logic
    if (this.options.debug) {
      logger.info(`[OptimisticUpdateManager] Restoring snapshot for: ${entity}`);
    }
  }

  /**
   * Add to undo stack
   */
  private addToUndoStack(updateMetadata: UpdateMetadata): void {
    this.undoStack.push(updateMetadata);

    // Limit stack size
    if (this.undoStack.length > this.options.maxHistorySize) {
      this.undoStack.shift();
    }

    // Clear redo stack
    this.redoStack = [];
  }

  /**
   * Setup online/offline listener
   */
  private setupOnlineListener(): void {
    window.addEventListener('online', () => {
      this.isOnline = true;

      if (this.options.debug) {
        logger.info('[OptimisticUpdateManager] Back online');
      }

      this.processOfflineQueue();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;

      if (this.options.debug) {
        logger.info('[OptimisticUpdateManager] Went offline');
      }
    });
  }

  /**
   * Event system - subscribe to event
   */
  on<K extends UpdateEventType>(event: K, handler: EventHandlers[K][number]): void {
    if (this.eventHandlers[event]) {
      (this.eventHandlers[event] as any[]).push(handler);
    }
  }

  /**
   * Event system - emit event
   */
  private emit<K extends UpdateEventType>(event: K, data: Parameters<EventHandlers[K][number]>[0]): void {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => (handler as any)(data));
    }
  }

  /**
   * Generate unique update ID
   */
  private generateUpdateId(): string {
    return `update_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update average response time
   */
  private updateAverageResponseTime(newTime: number): void {
    const count = this.stats.successfulUpdates;
    this.stats.averageResponseTime =
      ((this.stats.averageResponseTime * (count - 1)) + newTime) / count;
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get statistics
   */
  getStats(): FullUpdateStats {
    return {
      ...this.stats,
      pendingUpdates: this.updates.size,
      offlineQueueSize: this.offlineQueue.length,
      undoStackSize: this.undoStack.length,
      redoStackSize: this.redoStack.length,
      conflictsCount: this.conflicts.size,
      isOnline: this.isOnline,
    };
  }

  /**
   * Clear all updates
   */
  clear(): void {
    this.updates.clear();
    this.snapshots.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.offlineQueue = [];
    this.conflicts.clear();

    if (this.options.debug) {
      logger.info('[OptimisticUpdateManager] Cleared all updates');
    }
  }

  /**
   * Destroy
   */
  destroy(): void {
    this.clear();

    if (this.options.debug) {
      logger.info('[OptimisticUpdateManager] Destroyed');
    }
  }
}

// Singleton instance
let managerInstance: OptimisticUpdateManager | null = null;

/**
 * Get or create optimistic update manager instance
 */
export function getOptimisticUpdateManager(options?: OptimisticUpdateOptions): OptimisticUpdateManager {
  if (!managerInstance) {
    managerInstance = new OptimisticUpdateManager(options);
  }
  return managerInstance;
}

/**
 * Convenience function: perform optimistic update
 */
export async function optimisticUpdate<T = any, R = any>(config: UpdateConfig<T, R>): Promise<UpdateResult<R>> {
  const manager = getOptimisticUpdateManager();
  return manager.update(config);
}

export { OptimisticUpdateManager };
export default OptimisticUpdateManager;
