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

import { logger } from "@/utils/logger";

// ==================== 类型定义 ====================

/**
 * 更新优先级
 */
export type UpdatePriority = "high" | "normal" | "low";

/**
 * 更新状态
 */
export type UpdateStatus =
  "pending" | "applied" | "committed" | "failed" | "rolled_back";

/**
 * 事件类型
 */
export type UpdateEventType = "success" | "failure" | "rollback" | "conflict";

export const DEFAULT_OPTIMISTIC_UPDATE_LIMITS = Object.freeze({
  maxHistorySize: 50,
  maxPendingUpdates: 128,
  maxOfflineQueueSize: 128,
  maxConflicts: 128,
  maxEventHandlersPerType: 64,
  maxBatchSize: 100,
  maxEntityChars: 256,
  maxSnapshotBytes: 64 * 1024,
  maxConflictPayloadBytes: 128 * 1024,
  maxRetries: 3,
  retryDelayMs: 1000,
  cleanupDelayMs: 5000,
});

export const HARD_OPTIMISTIC_UPDATE_LIMITS = Object.freeze({
  maxHistorySize: 500,
  maxPendingUpdates: 1024,
  maxOfflineQueueSize: 1024,
  maxConflicts: 1024,
  maxEventHandlersPerType: 256,
  maxBatchSize: 1000,
  maxEntityChars: 2048,
  maxSnapshotBytes: 1024 * 1024,
  maxConflictPayloadBytes: 1024 * 1024,
  maxRetries: 10,
  retryDelayMs: 60 * 1000,
  maxRetryBackoffMs: 5 * 60 * 1000,
  cleanupDelayMs: 60 * 1000,
});

export class OptimisticUpdateError extends Error {
  code: "OVERLOADED" | "INVALID_ARGUMENT" | "CANCELED";
  scope: string;
  retryAfterMs?: number;
  limit?: Record<string, number>;

  constructor(
    message: string,
    options: {
      code: "OVERLOADED" | "INVALID_ARGUMENT" | "CANCELED";
      scope: string;
      retryAfterMs?: number;
      limit?: Record<string, number>;
    },
  ) {
    super(message);
    this.name = "OptimisticUpdateError";
    this.code = options.code;
    this.scope = options.scope;
    this.retryAfterMs = options.retryAfterMs;
    this.limit = options.limit;
  }
}

function boundedPositiveInteger(
  value: unknown,
  fallback: number,
  hardLimit: number,
): number {
  let numericValue: number;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function boundedNonNegativeInteger(
  value: unknown,
  fallback: number,
  hardLimit: number,
): number {
  let numericValue: number;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function estimateRetainedBytes(value: unknown, stopAfterBytes: number): number {
  const stack: unknown[] = [value];
  const seen = new WeakSet<object>();
  let bytes = 0;

  while (stack.length > 0 && bytes <= stopAfterBytes) {
    const current = stack.pop();
    if (current === null || current === undefined) {
      bytes += 4;
      continue;
    }
    if (typeof current === "string") {
      bytes += current.length * 2;
      continue;
    }
    if (typeof current === "number" || typeof current === "bigint") {
      bytes += 8;
      continue;
    }
    if (typeof current === "boolean") {
      bytes += 4;
      continue;
    }
    if (typeof current !== "object") {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (current instanceof ArrayBuffer) {
      bytes += current.byteLength;
      continue;
    }
    if (ArrayBuffer.isView(current)) {
      bytes += current.byteLength;
      continue;
    }
    if (
      typeof SharedArrayBuffer !== "undefined" &&
      current instanceof SharedArrayBuffer
    ) {
      bytes += current.byteLength;
      continue;
    }
    if (typeof Blob !== "undefined" && current instanceof Blob) {
      bytes += current.size;
      continue;
    }
    if (Array.isArray(current)) {
      bytes += current.length * 8;
      if (bytes <= stopAfterBytes) {
        for (const entryValue of current) {
          stack.push(entryValue);
        }
      }
      continue;
    }
    if (current instanceof Map) {
      for (const [key, entryValue] of current) {
        bytes += 16;
        if (bytes > stopAfterBytes) {
          break;
        }
        stack.push(key, entryValue);
      }
      continue;
    }
    if (current instanceof Set) {
      for (const entryValue of current) {
        bytes += 8;
        if (bytes > stopAfterBytes) {
          break;
        }
        stack.push(entryValue);
      }
      continue;
    }

    for (const key of Reflect.ownKeys(current)) {
      bytes += typeof key === "string" ? key.length * 2 : 16;
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor && "value" in descriptor) {
        stack.push(descriptor.value);
      }
    }
  }

  return bytes;
}

function detachRetainedValue<T>(value: T): T {
  if (typeof globalThis.structuredClone !== "function") {
    throw new Error("structuredClone is unavailable");
  }
  return globalThis.structuredClone(value);
}

/**
 * 管理器配置选项
 */
export interface OptimisticUpdateOptions {
  maxHistorySize?: number;
  maxPendingUpdates?: number;
  maxOfflineQueueSize?: number;
  maxConflicts?: number;
  maxEventHandlersPerType?: number;
  maxBatchSize?: number;
  maxEntityChars?: number;
  maxSnapshotBytes?: number;
  maxConflictPayloadBytes?: number;
  cleanupDelayMs?: number;
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
  status: "committed" | "queued";
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

export interface UpdateEventSubscriptionResult {
  accepted: boolean;
  unsubscribe?: () => void;
  code?: "OVERLOADED" | "INVALID_ARGUMENT" | "CANCELED";
  scope?: string;
  retryAfterMs?: number;
  limit?: Record<string, number>;
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

  // Lifecycle state
  private cleanupTimers: Map<string, ReturnType<typeof setTimeout>>;
  private retryWaits: Map<
    number,
    { timer: ReturnType<typeof setTimeout>; resolve: () => void }
  >;
  private retryWaitSequence: number;
  private offlineProcessingPromise: Promise<void> | null;
  private lifecycleGeneration: number;
  private destroyed: boolean;

  private readonly handleOnline = (): void => {
    if (this.destroyed) {
      return;
    }
    this.isOnline = true;

    if (this.options.debug) {
      logger.info("[OptimisticUpdateManager] Back online");
    }

    void this.processOfflineQueue().catch((error) => {
      logger.error(
        "[OptimisticUpdateManager] Offline queue processing failed",
        error,
      );
    });
  };

  private readonly handleOffline = (): void => {
    if (this.destroyed) {
      return;
    }
    this.isOnline = false;

    if (this.options.debug) {
      logger.info("[OptimisticUpdateManager] Went offline");
    }
  };

  constructor(options: OptimisticUpdateOptions = {}) {
    this.options = {
      maxHistorySize: boundedPositiveInteger(
        options.maxHistorySize,
        DEFAULT_OPTIMISTIC_UPDATE_LIMITS.maxHistorySize,
        HARD_OPTIMISTIC_UPDATE_LIMITS.maxHistorySize,
      ),
      maxPendingUpdates: boundedPositiveInteger(
        options.maxPendingUpdates,
        DEFAULT_OPTIMISTIC_UPDATE_LIMITS.maxPendingUpdates,
        HARD_OPTIMISTIC_UPDATE_LIMITS.maxPendingUpdates,
      ),
      maxOfflineQueueSize: boundedPositiveInteger(
        options.maxOfflineQueueSize,
        DEFAULT_OPTIMISTIC_UPDATE_LIMITS.maxOfflineQueueSize,
        HARD_OPTIMISTIC_UPDATE_LIMITS.maxOfflineQueueSize,
      ),
      maxConflicts: boundedPositiveInteger(
        options.maxConflicts,
        DEFAULT_OPTIMISTIC_UPDATE_LIMITS.maxConflicts,
        HARD_OPTIMISTIC_UPDATE_LIMITS.maxConflicts,
      ),
      maxEventHandlersPerType: boundedPositiveInteger(
        options.maxEventHandlersPerType,
        DEFAULT_OPTIMISTIC_UPDATE_LIMITS.maxEventHandlersPerType,
        HARD_OPTIMISTIC_UPDATE_LIMITS.maxEventHandlersPerType,
      ),
      maxBatchSize: boundedPositiveInteger(
        options.maxBatchSize,
        DEFAULT_OPTIMISTIC_UPDATE_LIMITS.maxBatchSize,
        HARD_OPTIMISTIC_UPDATE_LIMITS.maxBatchSize,
      ),
      maxEntityChars: boundedPositiveInteger(
        options.maxEntityChars,
        DEFAULT_OPTIMISTIC_UPDATE_LIMITS.maxEntityChars,
        HARD_OPTIMISTIC_UPDATE_LIMITS.maxEntityChars,
      ),
      maxSnapshotBytes: boundedPositiveInteger(
        options.maxSnapshotBytes,
        DEFAULT_OPTIMISTIC_UPDATE_LIMITS.maxSnapshotBytes,
        HARD_OPTIMISTIC_UPDATE_LIMITS.maxSnapshotBytes,
      ),
      maxConflictPayloadBytes: boundedPositiveInteger(
        options.maxConflictPayloadBytes,
        DEFAULT_OPTIMISTIC_UPDATE_LIMITS.maxConflictPayloadBytes,
        HARD_OPTIMISTIC_UPDATE_LIMITS.maxConflictPayloadBytes,
      ),
      cleanupDelayMs: boundedNonNegativeInteger(
        options.cleanupDelayMs,
        DEFAULT_OPTIMISTIC_UPDATE_LIMITS.cleanupDelayMs,
        HARD_OPTIMISTIC_UPDATE_LIMITS.cleanupDelayMs,
      ),
      enableUndoRedo: options.enableUndoRedo !== false,
      enableConflictDetection: options.enableConflictDetection !== false,
      enableOfflineQueue: options.enableOfflineQueue !== false,
      retryOnFailure: options.retryOnFailure !== false,
      maxRetries: boundedNonNegativeInteger(
        options.maxRetries,
        DEFAULT_OPTIMISTIC_UPDATE_LIMITS.maxRetries,
        HARD_OPTIMISTIC_UPDATE_LIMITS.maxRetries,
      ),
      retryDelay: boundedNonNegativeInteger(
        options.retryDelay,
        DEFAULT_OPTIMISTIC_UPDATE_LIMITS.retryDelayMs,
        HARD_OPTIMISTIC_UPDATE_LIMITS.retryDelayMs,
      ),
      debug: options.debug === true,
    };

    this.updates = new Map();
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

    this.cleanupTimers = new Map();
    this.retryWaits = new Map();
    this.retryWaitSequence = 0;
    this.offlineProcessingPromise = null;
    this.lifecycleGeneration = 0;
    this.destroyed = false;

    this.isOnline =
      typeof navigator === "undefined" ? true : navigator.onLine !== false;
    this.setupOnlineListener();

    if (this.options.debug) {
      logger.info("[OptimisticUpdateManager] Initialized");
    }
  }

  /**
   * Perform optimistic update
   */
  async update<T = any, R = any>(
    config: UpdateConfig<T, R>,
  ): Promise<UpdateResult<R>> {
    const {
      entity,
      mutation,
      apiCall,
      rollback,
      onSuccess,
      onFailure,
      priority: requestedPriority = "normal",
    } = config;

    this.assertCanStartUpdate(entity);
    const generation = this.lifecycleGeneration;
    const priority: UpdatePriority = ["high", "normal", "low"].includes(
      requestedPriority,
    )
      ? requestedPriority
      : "normal";

    const updateId = this.generateUpdateId();
    this.stats.totalUpdates++;

    // Save snapshot for rollback
    let snapshot: StateSnapshot;
    try {
      snapshot = detachRetainedValue(this.createSnapshot(entity));
    } catch {
      throw new OptimisticUpdateError("Update snapshot is not cloneable", {
        code: "INVALID_ARGUMENT",
        scope: "optimistic_update_snapshot",
      });
    }
    const snapshotBytes = estimateRetainedBytes(
      snapshot,
      this.options.maxSnapshotBytes,
    );
    if (snapshotBytes > this.options.maxSnapshotBytes) {
      throw new OptimisticUpdateError("Update snapshot is too large", {
        code: "INVALID_ARGUMENT",
        scope: "optimistic_update_snapshot",
        limit: { maxSnapshotBytes: this.options.maxSnapshotBytes },
      });
    }

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
      status: "pending",
      retryCount: 0,
    };

    this.updates.set(updateId, updateMetadata);

    try {
      // Step 1: Apply optimistic update immediately
      if (this.options.debug) {
        logger.info(
          `[OptimisticUpdateManager] Applying optimistic update: ${updateId}`,
        );
      }

      await mutation();
      this.assertLifecycle(generation);
      updateMetadata.status = "applied";

      // Add to undo stack
      if (this.options.enableUndoRedo) {
        this.addToUndoStack(updateMetadata);
      }

      // Step 2: Call API in background
      if (!this.isOnline && this.options.enableOfflineQueue) {
        if (this.offlineQueue.length >= this.options.maxOfflineQueueSize) {
          throw new OptimisticUpdateError("Offline update queue is full", {
            code: "OVERLOADED",
            scope: "optimistic_offline_queue",
            retryAfterMs: this.options.retryDelay,
            limit: { maxOfflineQueueSize: this.options.maxOfflineQueueSize },
          });
        }
        // Add to offline queue
        this.offlineQueue.push(updateMetadata);

        if (this.options.debug) {
          logger.info(
            `[OptimisticUpdateManager] Added to offline queue: ${updateId}`,
          );
        }

        return { updateId, status: "queued", offline: true };
      }

      let result: R;
      let responseTime = 0;
      for (
        let attempt = 0;
        attempt <= this.options.maxRetries;
        attempt++
      ) {
        const startTime = performance.now();
        try {
          result = await apiCall();
          responseTime = performance.now() - startTime;
          break;
        } catch (error) {
          this.assertLifecycle(generation);
          if (
            !this.options.retryOnFailure ||
            updateMetadata.retryCount >= this.options.maxRetries
          ) {
            throw error;
          }

          updateMetadata.retryCount++;
          if (this.options.debug) {
            logger.info(
              `[OptimisticUpdateManager] Retrying ${updateMetadata.retryCount}/${this.options.maxRetries}: ${updateId}`,
            );
          }

          await this.delay(
            Math.min(
              this.options.retryDelay * updateMetadata.retryCount,
              HARD_OPTIMISTIC_UPDATE_LIMITS.maxRetryBackoffMs,
            ),
          );
          this.assertLifecycle(generation);
        }
      }

      this.assertLifecycle(generation);

      this.updateAverageResponseTime(responseTime);

      // Step 3: Success - commit update
      updateMetadata.status = "committed";
      this.stats.successfulUpdates++;

      this.emit("success", { updateId, entity, result });

      if (onSuccess) {
        await onSuccess(result);
      }

      if (this.options.debug) {
        logger.info(
          `[OptimisticUpdateManager] Committed: ${updateId} (${Math.round(responseTime)}ms)`,
        );
      }

      return { updateId, status: "committed", result };
    } catch (error) {
      if (!this.isLifecycleActive(generation)) {
        throw this.createCancellationError();
      }
      // Step 4: Failure - rollback update
      updateMetadata.status = "failed";
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      updateMetadata.error = normalizedError;
      this.stats.failedUpdates++;

      if (this.options.debug) {
        logger.error(`[OptimisticUpdateManager] Failed: ${updateId}`, error);
      }

      // Rollback
      await this.rollbackUpdate(updateId, rollback);

      this.emit("failure", { updateId, entity, error: normalizedError });

      if (onFailure) {
        await onFailure(normalizedError);
      }

      throw normalizedError;
    } finally {
      this.scheduleUpdateCleanup(updateId);
    }
  }

  /**
   * Rollback an update
   */
  async rollbackUpdate(
    updateId: string,
    customRollback?: (snapshot: StateSnapshot) => Promise<void> | void,
  ): Promise<void> {
    const updateMetadata =
      this.updates.get(updateId) ||
      this.offlineQueue.find((update) => update.id === updateId) ||
      this.undoStack.find((update) => update.id === updateId) ||
      this.redoStack.find((update) => update.id === updateId);
    if (!updateMetadata) {
      return;
    }

    await this.rollbackMetadata(updateMetadata, customRollback);
  }

  private async rollbackMetadata(
    updateMetadata: UpdateMetadata,
    customRollback?: (snapshot: StateSnapshot) => Promise<void> | void,
  ): Promise<void> {
    const updateId = updateMetadata.id;

    if (this.options.debug) {
      logger.info(`[OptimisticUpdateManager] Rolling back: ${updateId}`);
    }

    try {
      if (customRollback) {
        // Use custom rollback function
        await customRollback(updateMetadata.snapshot);
      } else if (updateMetadata.rollback) {
        await updateMetadata.rollback(updateMetadata.snapshot);
      } else {
        // Restore from snapshot
        this.restoreSnapshot(updateMetadata.entity, updateMetadata.snapshot);
      }

      updateMetadata.status = "rolled_back";
      this.stats.rolledBackUpdates++;

      this.emit("rollback", { updateId, entity: updateMetadata.entity });
    } catch (error) {
      logger.error(
        `[OptimisticUpdateManager] Rollback failed: ${updateId}`,
        error,
      );
    }
  }

  /**
   * Undo last update
   */
  async undo(): Promise<UpdateMetadata | null> {
    if (!this.options.enableUndoRedo || this.undoStack.length === 0) {
      if (this.options.debug) {
        logger.info("[OptimisticUpdateManager] Nothing to undo");
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
        logger.info("[OptimisticUpdateManager] Nothing to redo");
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
  async batchUpdate<T = any, R = any>(
    updates: UpdateConfig<T, R>[],
  ): Promise<PromiseSettledResult<UpdateResult<R>>[]> {
    if (!Array.isArray(updates)) {
      throw new OptimisticUpdateError("Batch updates must be an array", {
        code: "INVALID_ARGUMENT",
        scope: "optimistic_update_batch",
      });
    }
    if (updates.length > this.options.maxBatchSize) {
      throw new OptimisticUpdateError("Optimistic update batch is too large", {
        code: "OVERLOADED",
        scope: "optimistic_update_batch",
        retryAfterMs: this.options.retryDelay,
        limit: { maxBatchSize: this.options.maxBatchSize },
      });
    }
    if (this.options.debug) {
      logger.info(
        `[OptimisticUpdateManager] Batch update: ${updates.length} operations`,
      );
    }

    const results = await Promise.allSettled(
      updates.map((config) => this.update(config)),
    );

    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    if (this.options.debug) {
      logger.info(
        `[OptimisticUpdateManager] Batch completed: ${successful} succeeded, ${failed} failed`,
      );
    }

    return results;
  }

  /**
   * Process offline queue when back online
   */
  async processOfflineQueue(): Promise<void> {
    if (this.destroyed || !this.isOnline) {
      return;
    }
    if (this.offlineProcessingPromise) {
      return this.offlineProcessingPromise;
    }
    if (this.offlineQueue.length === 0) {
      return;
    }

    const generation = this.lifecycleGeneration;
    const processingPromise = this.drainOfflineQueue(generation);
    this.offlineProcessingPromise = processingPromise;
    try {
      await processingPromise;
    } finally {
      if (this.offlineProcessingPromise === processingPromise) {
        this.offlineProcessingPromise = null;
      }
    }
  }

  private async drainOfflineQueue(generation: number): Promise<void> {
    if (!this.isLifecycleActive(generation)) {
      return;
    }

    if (this.options.debug) {
      logger.info(
        `[OptimisticUpdateManager] Processing offline queue: ${this.offlineQueue.length} items`,
      );
    }

    const queue = [...this.offlineQueue];
    this.offlineQueue = [];

    for (const updateMetadata of queue) {
      if (!this.isLifecycleActive(generation)) {
        return;
      }
      try {
        const result = await updateMetadata.apiCall();
        if (!this.isLifecycleActive(generation)) {
          return;
        }

        updateMetadata.status = "committed";
        this.stats.successfulUpdates++;

        this.emit("success", {
          updateId: updateMetadata.id,
          entity: updateMetadata.entity,
          result,
          fromOfflineQueue: true,
        });
      } catch (error) {
        if (!this.isLifecycleActive(generation)) {
          return;
        }
        // Re-add to queue or rollback
        if (this.offlineQueue.length < this.options.maxOfflineQueueSize) {
          this.offlineQueue.push(updateMetadata);
        } else {
          const normalizedError =
            error instanceof Error ? error : new Error(String(error));
          updateMetadata.status = "failed";
          updateMetadata.error = normalizedError;
          this.stats.failedUpdates++;
          await this.rollbackMetadata(updateMetadata);
          this.emit("failure", {
            updateId: updateMetadata.id,
            entity: updateMetadata.entity,
            error: normalizedError,
          });
        }

        if (this.options.debug) {
          logger.error(
            `[OptimisticUpdateManager] Offline queue item failed: ${updateMetadata.id}`,
            error,
          );
        }
      }
    }
  }

  /**
   * Detect conflicts
   */
  detectConflict(entity: string, incomingData: any): ConflictInfo | null {
    if (!this.options.enableConflictDetection) {
      return null;
    }

    this.assertValidEntity(entity);
    let detachedIncomingData: any;
    try {
      detachedIncomingData = detachRetainedValue(incomingData);
    } catch {
      throw new OptimisticUpdateError("Conflict payload is not cloneable", {
        code: "INVALID_ARGUMENT",
        scope: "optimistic_conflict_payload",
      });
    }
    const payloadBytes = estimateRetainedBytes(
      detachedIncomingData,
      this.options.maxConflictPayloadBytes,
    );
    if (payloadBytes > this.options.maxConflictPayloadBytes) {
      throw new OptimisticUpdateError("Conflict payload is too large", {
        code: "INVALID_ARGUMENT",
        scope: "optimistic_conflict_payload",
        limit: {
          maxConflictPayloadBytes: this.options.maxConflictPayloadBytes,
        },
      });
    }

    const candidates = new Map<string, UpdateMetadata>();
    for (const update of [...this.updates.values(), ...this.offlineQueue]) {
      if (
        update.entity === entity &&
        (update.status === "pending" || update.status === "applied")
      ) {
        candidates.set(update.id, update);
      }
    }
    const pendingUpdates = [...candidates.values()];

    if (pendingUpdates.length > 0) {
      const conflict: ConflictInfo = {
        entity,
        pendingUpdates: pendingUpdates.map((u) => u.id),
        incomingData: detachedIncomingData,
        timestamp: Date.now(),
      };

      if (!this.conflicts.has(entity)) {
        while (this.conflicts.size >= this.options.maxConflicts) {
          const oldestEntity = this.conflicts.keys().next().value;
          if (oldestEntity === undefined) {
            break;
          }
          this.conflicts.delete(oldestEntity);
        }
      } else {
        this.conflicts.delete(entity);
      }
      this.conflicts.set(entity, conflict);
      this.stats.conflictedUpdates++;

      this.emit("conflict", conflict);

      if (this.options.debug) {
        logger.warn(
          `[OptimisticUpdateManager] Conflict detected for entity: ${entity}`,
        );
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
      logger.info(
        `[OptimisticUpdateManager] Restoring snapshot for: ${entity}`,
      );
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
    if (typeof window === "undefined") {
      return;
    }
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
  }

  /**
   * Event system - subscribe to event
   */
  on<K extends UpdateEventType>(
    event: K,
    handler: EventHandlers[K][number],
  ): UpdateEventSubscriptionResult {
    if (this.destroyed) {
      return {
        accepted: false,
        code: "CANCELED",
        scope: "optimistic_update_events",
      };
    }
    const handlers = this.eventHandlers[event] as EventHandler[] | undefined;
    if (!handlers || typeof handler !== "function") {
      return {
        accepted: false,
        code: "INVALID_ARGUMENT",
        scope: "optimistic_update_events",
      };
    }
    if (handlers.length >= this.options.maxEventHandlersPerType) {
      return {
        accepted: false,
        code: "OVERLOADED",
        scope: "optimistic_update_events",
        retryAfterMs: this.options.cleanupDelayMs,
        limit: {
          maxEventHandlersPerType: this.options.maxEventHandlersPerType,
        },
      };
    }

    handlers.push(handler as EventHandler);
    let subscribed = true;
    return {
      accepted: true,
      unsubscribe: () => {
        if (!subscribed) {
          return;
        }
        subscribed = false;
        const index = handlers.indexOf(handler as EventHandler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      },
    };
  }

  /**
   * Event system - emit event
   */
  private emit<K extends UpdateEventType>(
    event: K,
    data: Parameters<EventHandlers[K][number]>[0],
  ): void {
    if (this.eventHandlers[event]) {
      [...this.eventHandlers[event]].forEach((handler) => {
        try {
          (handler as any)(data);
        } catch (error) {
          logger.error(
            `[OptimisticUpdateManager] ${event} event handler failed`,
            error,
          );
        }
      });
    }
  }

  /**
   * Generate unique update ID
   */
  private generateUpdateId(): string {
    return `update_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private assertValidEntity(entity: unknown): asserts entity is string {
    if (
      typeof entity !== "string" ||
      !entity.trim() ||
      entity.length > this.options.maxEntityChars
    ) {
      throw new OptimisticUpdateError("Invalid optimistic update entity", {
        code: "INVALID_ARGUMENT",
        scope: "optimistic_update_entity",
        limit: { maxEntityChars: this.options.maxEntityChars },
      });
    }
  }

  private assertCanStartUpdate(entity: unknown): asserts entity is string {
    if (this.destroyed) {
      throw this.createCancellationError();
    }
    this.assertValidEntity(entity);
    if (this.updates.size >= this.options.maxPendingUpdates) {
      throw new OptimisticUpdateError("Too many retained optimistic updates", {
        code: "OVERLOADED",
        scope: "optimistic_updates",
        retryAfterMs: this.options.cleanupDelayMs,
        limit: { maxPendingUpdates: this.options.maxPendingUpdates },
      });
    }
    if (
      !this.isOnline &&
      this.options.enableOfflineQueue &&
      this.offlineQueue.length >= this.options.maxOfflineQueueSize
    ) {
      throw new OptimisticUpdateError("Offline update queue is full", {
        code: "OVERLOADED",
        scope: "optimistic_offline_queue",
        retryAfterMs: this.options.retryDelay,
        limit: { maxOfflineQueueSize: this.options.maxOfflineQueueSize },
      });
    }
  }

  private isLifecycleActive(generation: number): boolean {
    return !this.destroyed && generation === this.lifecycleGeneration;
  }

  private assertLifecycle(generation: number): void {
    if (!this.isLifecycleActive(generation)) {
      throw this.createCancellationError();
    }
  }

  private createCancellationError(): OptimisticUpdateError {
    return new OptimisticUpdateError("Optimistic update was canceled", {
      code: "CANCELED",
      scope: "optimistic_updates",
    });
  }

  private scheduleUpdateCleanup(updateId: string): void {
    if (this.destroyed || !this.updates.has(updateId)) {
      return;
    }
    const existingTimer = this.cleanupTimers.get(updateId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    if (this.options.cleanupDelayMs === 0) {
      this.updates.delete(updateId);
      this.cleanupTimers.delete(updateId);
      return;
    }
    const timer = setTimeout(() => {
      this.updates.delete(updateId);
      this.cleanupTimers.delete(updateId);
    }, this.options.cleanupDelayMs);
    this.cleanupTimers.set(updateId, timer);
  }

  /**
   * Update average response time
   */
  private updateAverageResponseTime(newTime: number): void {
    const count = this.stats.successfulUpdates + 1;
    this.stats.averageResponseTime =
      (this.stats.averageResponseTime * (count - 1) + newTime) / count;
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waitId = ++this.retryWaitSequence;
      const timer = setTimeout(() => {
        this.retryWaits.delete(waitId);
        resolve();
      }, ms);
      this.retryWaits.set(waitId, { timer, resolve });
    });
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
    this.lifecycleGeneration++;
    this.cleanupTimers.forEach((timer) => clearTimeout(timer));
    this.cleanupTimers.clear();
    this.retryWaits.forEach(({ timer, resolve }) => {
      clearTimeout(timer);
      resolve();
    });
    this.retryWaits.clear();
    this.updates.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.offlineQueue = [];
    this.conflicts.clear();

    if (this.options.debug) {
      logger.info("[OptimisticUpdateManager] Cleared all updates");
    }
  }

  /**
   * Destroy
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.clear();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
    this.eventHandlers = {
      success: [],
      failure: [],
      rollback: [],
      conflict: [],
    };
    this.offlineProcessingPromise = null;
    if (managerInstance === this) {
      managerInstance = null;
    }

    if (this.options.debug) {
      logger.info("[OptimisticUpdateManager] Destroyed");
    }
  }
}

// Singleton instance
let managerInstance: OptimisticUpdateManager | null = null;

/**
 * Get or create optimistic update manager instance
 */
export function getOptimisticUpdateManager(
  options?: OptimisticUpdateOptions,
): OptimisticUpdateManager {
  if (!managerInstance) {
    managerInstance = new OptimisticUpdateManager(options);
  }
  return managerInstance;
}

/**
 * Convenience function: perform optimistic update
 */
export async function optimisticUpdate<T = any, R = any>(
  config: UpdateConfig<T, R>,
): Promise<UpdateResult<R>> {
  const manager = getOptimisticUpdateManager();
  return manager.update(config);
}

export { OptimisticUpdateManager };
export default OptimisticUpdateManager;
