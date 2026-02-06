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

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 同步配置选项
 */
export interface IncrementalSyncOptions {
  /** 是否启用同步 (默认: false) */
  enabled?: boolean;
  /** 同步间隔 (毫秒, 默认: 30000) */
  syncInterval?: number;
  /** 是否启用自动同步 (默认: true) */
  enableAutoSync?: boolean;
  /** 是否启用实时同步 (默认: false) */
  enableRealtime?: boolean;
  /** 冲突解决策略 (默认: 'server-wins') */
  conflictResolution?: ConflictResolutionStrategy;
  /** 是否启用调试模式 (默认: false) */
  debug?: boolean;
}

/**
 * 冲突解决策略
 */
export type ConflictResolutionStrategy = 'server-wins' | 'client-wins' | 'manual';

/**
 * 操作类型
 */
export type OperationType = 'create' | 'update' | 'delete';

/**
 * 变更记录
 */
export interface Change {
  /** 实体标识符 (如: 'file:123', 'project:456') */
  entity: string;
  /** 操作类型 */
  operation: OperationType;
  /** 变更数据 */
  data: Record<string, unknown>;
  /** 时间戳 */
  timestamp: number;
  /** 是否已同步 */
  synced: boolean;
}

/**
 * 分组后的变更记录
 */
export interface GroupedChange {
  /** 记录ID */
  id: string;
  /** 操作类型 */
  operation: OperationType;
  /** 数据 */
  data: Record<string, unknown>;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 按表分组的变更
 */
export interface ChangesByTable {
  [tableName: string]: GroupedChange[];
}

/**
 * 冲突信息
 */
export interface Conflict {
  /** 实体标识符 */
  entity: string;
  /** 服务器版本 */
  serverVersion: Record<string, unknown>;
  /** 客户端版本 */
  clientVersion: Record<string, unknown>;
}

/**
 * 同步结果
 */
export interface SyncResult {
  /** 是否成功 */
  success: boolean;
  /** 冲突列表 */
  conflicts?: Conflict[];
  /** 远程变更 */
  remoteChanges?: Change[];
  /** 结果列表 */
  results?: Array<{ tableName: string; [key: string]: unknown }>;
  /** 消息 */
  message?: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 远程变更
 */
export interface RemoteChange {
  /** 实体标识符 */
  entity: string;
  /** 操作类型 */
  operation: OperationType;
  /** 数据 */
  data: Record<string, unknown>;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 同步选项
 */
export interface SyncNowOptions {
  /** 强制同步 (即使离线) */
  force?: boolean;
}

/**
 * 同步队列项
 */
export interface SyncQueueItem {
  /** 变更列表 */
  changes: Change[];
  /** 时间戳 */
  timestamp: number;
}

/**
 * 同步统计
 */
export interface SyncStats {
  /** 总同步次数 */
  totalSyncs: number;
  /** 成功同步次数 */
  successfulSyncs: number;
  /** 失败同步次数 */
  failedSyncs: number;
  /** 解决的冲突数 */
  conflictsResolved: number;
  /** 节省的数据量 (字节) */
  dataSaved: number;
}

/**
 * 扩展的同步统计
 */
export interface ExtendedSyncStats extends SyncStats {
  /** 待处理变更数 */
  pendingChanges: number;
  /** 队列中的同步数 */
  queuedSyncs: number;
  /** 是否正在同步 */
  isSyncing: boolean;
  /** 是否在线 */
  isOnline: boolean;
  /** 上次同步时间 */
  lastSyncTime: number | null;
  /** 节省的数据量 (MB) */
  dataSavedMB: number;
}

/**
 * WebSocket 消息
 */
export interface WebSocketMessage {
  /** 消息类型 */
  type: 'change' | string;
  /** 消息数据 */
  data: RemoteChange;
}

// ==================== 同步管理器类 ====================

/**
 * 增量数据同步管理器
 */
class IncrementalSyncManager {
  private options: Required<IncrementalSyncOptions>;
  private lastSyncTime: number | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private pendingChanges: Map<string, Change> = new Map();
  private syncQueue: SyncQueueItem[] = [];
  private isOnline: boolean = navigator.onLine;
  private isSyncing: boolean = false;
  private websocket: WebSocket | null = null;
  private isDestroyed: boolean = false;
  private isReconnecting: boolean = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private debouncedSyncTimeout: ReturnType<typeof setTimeout> | null = null;

  private stats: SyncStats = {
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    conflictsResolved: 0,
    dataSaved: 0,
  };

  constructor(options: IncrementalSyncOptions = {}) {
    this.options = {
      enabled: options.enabled ?? false,
      syncInterval: options.syncInterval ?? 30000,
      enableAutoSync: options.enableAutoSync !== false,
      enableRealtime: options.enableRealtime ?? false,
      conflictResolution: options.conflictResolution ?? 'server-wins',
      debug: options.debug ?? false,
    };

    this.init();

    if (this.options.debug) {
      logger.info('[IncrementalSyncManager] Initialized');
    }
  }

  /**
   * 初始化同步管理器
   */
  private init(): void {
    // 如果同步禁用，跳过初始化
    if (!this.options.enabled) {
      logger.info('[IncrementalSync] Sync is disabled, skipping initialization');
      return;
    }

    // 设置在线/离线监听器
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    // 如果启用自动同步，开始自动同步
    if (this.options.enableAutoSync) {
      this.startAutoSync();
    }

    // 如果启用实时同步，设置 WebSocket
    if (this.options.enableRealtime) {
      this.setupRealtimeSync();
    }
  }

  private handleOnline = (): void => {
    this.isOnline = true;
    this.syncNow();
  };

  private handleOffline = (): void => {
    this.isOnline = false;
  };

  /**
   * 追踪变更以进行同步
   * @param entity - 实体标识符 (如: 'file:123', 'project:456')
   * @param operation - 操作类型: 'create', 'update', 'delete'
   * @param data - 变更数据
   */
  trackChange(entity: string, operation: OperationType, data: Record<string, unknown>): void {
    const change: Change = {
      entity,
      operation,
      data,
      timestamp: Date.now(),
      synced: false,
    };

    this.pendingChanges.set(entity, change);

    if (this.options.debug) {
      logger.info(`[IncrementalSyncManager] Tracked change: ${entity} (${operation})`);
    }

    // 如果启用并在线，触发同步
    if (this.options.enableAutoSync && this.isOnline) {
      this.debouncedSync();
    }
  }

  /**
   * 立即同步 (手动触发)
   * @param options - 同步选项
   */
  async syncNow(options: SyncNowOptions = {}): Promise<void> {
    if (this.isSyncing) {
      if (this.options.debug) {
        logger.info('[IncrementalSyncManager] Sync already in progress');
      }
      return;
    }

    if (!this.isOnline && !options.force) {
      if (this.options.debug) {
        logger.info('[IncrementalSyncManager] Offline, skipping sync');
      }
      return;
    }

    this.isSyncing = true;
    this.stats.totalSyncs++;

    try {
      // 获取上次同步以来的变更
      const changes = Array.from(this.pendingChanges.values());

      if (changes.length === 0) {
        if (this.options.debug) {
          logger.info('[IncrementalSyncManager] No changes to sync');
        }
        return;
      }

      if (this.options.debug) {
        logger.info(`[IncrementalSyncManager] Syncing ${changes.length} changes`);
      }

      // 发送变更到服务器
      const result = await this.sendChanges(changes);

      // 从服务器获取远程变更
      const remoteChanges = await this.fetchRemoteChanges();

      // 处理服务器响应
      if (result.conflicts && result.conflicts.length > 0) {
        await this.resolveConflicts(result.conflicts);
      }

      // 应用远程变更 (从服务器响应或获取的)
      const changesToApply = result.remoteChanges || remoteChanges;
      if (changesToApply && changesToApply.length > 0) {
        await this.applyRemoteChanges(changesToApply);
      }

      // 清除已同步的变更
      changes.forEach((change) => {
        this.pendingChanges.delete(change.entity);
      });

      this.lastSyncTime = Date.now();
      this.stats.successfulSyncs++;

      // 估算节省的数据量
      const fullDataSize = this.estimateFullDataSize();
      const deltaSize = this.estimateDeltaSize(changes);
      this.stats.dataSaved += fullDataSize - deltaSize;

      if (this.options.debug) {
        logger.info('[IncrementalSyncManager] Sync completed successfully');
      }

      // 触发同步完成事件
      window.dispatchEvent(
        new CustomEvent('incremental-sync-complete', {
          detail: { changes, result },
        })
      );
    } catch (error) {
      logger.error('[IncrementalSyncManager] Sync failed:', error);
      this.stats.failedSyncs++;

      // 添加到离线队列
      if (!this.isOnline) {
        this.syncQueue.push({
          changes: Array.from(this.pendingChanges.values()),
          timestamp: Date.now(),
        });
      }

      // 触发错误事件
      window.dispatchEvent(
        new CustomEvent('incremental-sync-error', {
          detail: { error },
        })
      );

      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 发送变更到服务器
   * @param changes - 变更数组
   * @returns 服务器响应
   */
  private async sendChanges(changes: Change[]): Promise<SyncResult> {
    try {
      // 从环境获取后端 URL 或使用默认值
      const backendUrl =
        (import.meta as unknown as { env: Record<string, string> }).env?.VITE_BACKEND_URL ||
        'http://localhost:9090';

      // 获取设备 ID (如果不存在则生成)
      let deviceId: string | null = null;
      try {
        deviceId = localStorage.getItem('deviceId');
        if (!deviceId) {
          deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          localStorage.setItem('deviceId', deviceId);
        }
      } catch (error) {
        logger.warn('[Sync] localStorage 访问失败，使用临时设备ID:', (error as Error).message);
        deviceId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }

      // 按表/实体类型分组变更
      const changesByTable = this.groupChangesByTable(changes);

      // 上传每个表的变更
      const results: Array<{ tableName: string; [key: string]: unknown }> = [];
      for (const [tableName, tableChanges] of Object.entries(changesByTable)) {
        const response = await fetch(`${backendUrl}/api/sync/upload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tableName,
            deviceId,
            records: tableChanges,
            timestamp: Date.now(),
          }),
        });

        if (!response.ok) {
          logger.error(`[IncrementalSync] Upload failed for ${tableName}: HTTP ${response.status}`);
          continue;
        }

        const result = await response.json();
        results.push({ tableName, ...result });
      }

      logger.info('[IncrementalSync] Remote sync completed, changes:', changes.length);
      return { success: true, results };
    } catch (error) {
      logger.error('[IncrementalSync] Remote sync error:', error);
      // 错误时回退到仅本地模式
      logger.info('[IncrementalSync] Falling back to local-only mode');
      return {
        success: true,
        message: 'Local only (remote sync failed)',
        error: (error as Error).message,
      };
    }
  }

  /**
   * 按表名分组变更
   * @param changes - 变更数组
   * @returns 按表分组的变更
   */
  private groupChangesByTable(changes: Change[]): ChangesByTable {
    const grouped: ChangesByTable = {};

    for (const change of changes) {
      // 从实体中提取表名 (如: 'notes:123' -> 'notes')
      const tableName = change.entity.split(':')[0];

      if (!grouped[tableName]) {
        grouped[tableName] = [];
      }

      grouped[tableName].push({
        id: change.entity.split(':')[1] || change.entity,
        operation: change.operation,
        data: change.data,
        timestamp: change.timestamp,
      });
    }

    return grouped;
  }

  /**
   * 从服务器获取远程变更
   * @returns 远程变更数组
   */
  private async fetchRemoteChanges(): Promise<RemoteChange[]> {
    // 如果同步禁用，跳过
    if (!this.options.enabled) {
      return [];
    }

    try {
      const backendUrl =
        (import.meta as unknown as { env: Record<string, string> }).env?.VITE_BACKEND_URL ||
        'http://localhost:9090';

      let deviceId = localStorage.getItem('deviceId');
      if (!deviceId) {
        deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('deviceId', deviceId);
      }

      // 获取每个表的增量变更
      const tables = ['notes', 'chat_conversations', 'projects', 'social_posts', 'p2p_messages'];
      const allChanges: RemoteChange[] = [];

      for (const tableName of tables) {
        const response = await fetch(
          `${backendUrl}/api/sync/download/${tableName}?lastSyncedAt=${this.lastSyncTime || 0}&deviceId=${deviceId}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          logger.warn(
            `[IncrementalSync] Download failed for ${tableName}: HTTP ${response.status}`
          );
          continue;
        }

        const result = await response.json();
        if (result.code === 200 && result.data?.records) {
          // 将服务器记录转换为变更格式
          const changes: RemoteChange[] = result.data.records.map(
            (record: { id: string; operation?: OperationType; data?: Record<string, unknown>; timestamp?: number; updated_at?: number }) => ({
              entity: `${tableName}:${record.id}`,
              operation: record.operation || 'update',
              data: record.data || record,
              timestamp: record.timestamp || record.updated_at,
            })
          );
          allChanges.push(...changes);
        }
      }

      logger.info('[IncrementalSync] Fetched remote changes:', allChanges.length);
      return allChanges;
    } catch (error) {
      logger.error('[IncrementalSync] Fetch remote changes error:', error);
      return [];
    }
  }

  /**
   * 应用来自服务器的远程变更
   * @param remoteChanges - 来自服务器的变更
   */
  private async applyRemoteChanges(remoteChanges: RemoteChange[]): Promise<void> {
    for (const change of remoteChanges) {
      const { entity, operation, data } = change;

      // 为每个变更触发事件
      window.dispatchEvent(
        new CustomEvent('remote-change', {
          detail: { entity, operation, data },
        })
      );

      if (this.options.debug) {
        logger.info(
          `[IncrementalSyncManager] Applied remote change: ${entity} (${operation})`
        );
      }
    }
  }

  /**
   * 解决冲突
   * @param conflicts - 冲突数组
   */
  private async resolveConflicts(conflicts: Conflict[]): Promise<void> {
    if (this.options.debug) {
      logger.info(`[IncrementalSyncManager] Resolving ${conflicts.length} conflicts`);
    }

    for (const conflict of conflicts) {
      let resolution: Record<string, unknown>;

      switch (this.options.conflictResolution) {
        case 'server-wins':
          resolution = conflict.serverVersion;
          break;

        case 'client-wins':
          resolution = conflict.clientVersion;
          break;

        case 'manual':
          // 触发事件以进行手动解决
          resolution = await this.requestManualResolution(conflict);
          break;

        default:
          resolution = conflict.serverVersion;
      }

      // 应用解决方案
      window.dispatchEvent(
        new CustomEvent('conflict-resolved', {
          detail: { conflict, resolution },
        })
      );

      this.stats.conflictsResolved++;
    }
  }

  /**
   * 请求用户手动解决冲突
   * @param conflict - 冲突数据
   * @returns 解决方案
   */
  private requestManualResolution(conflict: Conflict): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      // 触发事件并等待用户决定
      const handler = (event: Event): void => {
        window.removeEventListener('conflict-resolution', handler);
        resolve((event as CustomEvent<{ resolution: Record<string, unknown> }>).detail.resolution);
      };

      window.addEventListener('conflict-resolution', handler);

      window.dispatchEvent(
        new CustomEvent('conflict-needs-resolution', {
          detail: { conflict },
        })
      );
    });
  }

  /**
   * 开始自动同步
   */
  startAutoSync(): void {
    // 如果同步禁用，跳过
    if (!this.options.enabled) {
      logger.info('[IncrementalSync] Sync disabled, skipping auto-sync setup');
      return;
    }

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    this.syncTimer = setInterval(() => {
      this.syncNow();
    }, this.options.syncInterval);

    // 初始同步
    this.syncNow();

    if (this.options.debug) {
      logger.info(
        `[IncrementalSyncManager] Auto-sync started (interval: ${this.options.syncInterval}ms)`
      );
    }
  }

  /**
   * 停止自动同步
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;

      if (this.options.debug) {
        logger.info('[IncrementalSyncManager] Auto-sync stopped');
      }
    }
  }

  /**
   * 防抖同步 (防止过于频繁的同步)
   */
  private debouncedSync(): void {
    if (this.debouncedSyncTimeout) {
      clearTimeout(this.debouncedSyncTimeout);
    }
    this.debouncedSyncTimeout = setTimeout(() => {
      this.syncNow();
    }, 1000); // 1 秒防抖
  }

  /**
   * 设置 WebSocket 连接以进行实时同步
   */
  private setupRealtimeSync(): void {
    // 如果已销毁或正在重连，不再创建新连接
    if (this.isDestroyed || this.isReconnecting) {
      return;
    }

    // 关闭旧的 WebSocket 连接
    if (this.websocket) {
      try {
        this.websocket.onclose = null; // 防止触发重连
        this.websocket.close();
      } catch {
        // 忽略关闭错误
      }
      this.websocket = null;
    }

    const wsUrl = this.getWebSocketURL();

    this.websocket = new WebSocket(wsUrl);

    this.websocket.onopen = (): void => {
      if (this.options.debug) {
        logger.info('[IncrementalSyncManager] WebSocket connected');
      }
    };

    this.websocket.onmessage = (event: MessageEvent): void => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);

        if (message.type === 'change') {
          this.applyRemoteChanges([message.data]);
        }
      } catch (error) {
        logger.error('[IncrementalSyncManager] WebSocket message error:', error);
      }
    };

    this.websocket.onerror = (error: Event): void => {
      logger.error('[IncrementalSyncManager] WebSocket error:', error);
    };

    this.websocket.onclose = (): void => {
      if (this.options.debug) {
        logger.info('[IncrementalSyncManager] WebSocket disconnected');
      }

      // 如果已销毁，不再重连
      if (this.isDestroyed) {
        return;
      }

      // 标记正在重连，延迟后重连
      this.isReconnecting = true;
      this.reconnectTimer = setTimeout(() => {
        this.isReconnecting = false;
        this.setupRealtimeSync();
      }, 5000);
    };
  }

  /**
   * 获取 WebSocket URL
   */
  private getWebSocketURL(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/sync`;
  }

  /**
   * 估算完整数据大小
   */
  private estimateFullDataSize(): number {
    // 粗略估计: 假设每个实体 10KB
    return this.pendingChanges.size * 10 * 1024;
  }

  /**
   * 估算增量数据大小
   */
  private estimateDeltaSize(changes: Change[]): number {
    // 根据实际变更数据估算
    const json = JSON.stringify(changes);
    return new Blob([json]).size;
  }

  /**
   * 获取统计信息
   */
  getStats(): ExtendedSyncStats {
    return {
      ...this.stats,
      pendingChanges: this.pendingChanges.size,
      queuedSyncs: this.syncQueue.length,
      isSyncing: this.isSyncing,
      isOnline: this.isOnline,
      lastSyncTime: this.lastSyncTime,
      dataSavedMB: Math.round(this.stats.dataSaved / 1024 / 1024),
    };
  }

  /**
   * 清除所有待处理变更
   */
  clear(): void {
    this.pendingChanges.clear();
    this.syncQueue = [];

    if (this.options.debug) {
      logger.info('[IncrementalSyncManager] Cleared all pending changes');
    }
  }

  /**
   * 销毁并清理
   */
  destroy(): void {
    this.isDestroyed = true;
    this.stopAutoSync();

    // 移除事件监听器
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);

    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 清除防抖定时器
    if (this.debouncedSyncTimeout) {
      clearTimeout(this.debouncedSyncTimeout);
      this.debouncedSyncTimeout = null;
    }

    if (this.websocket) {
      this.websocket.onclose = null; // 防止触发重连
      this.websocket.close();
      this.websocket = null;
    }

    this.clear();

    if (this.options.debug) {
      logger.info('[IncrementalSyncManager] Destroyed');
    }
  }
}

// ==================== 单例和便捷函数 ====================

// 单例实例
let managerInstance: IncrementalSyncManager | null = null;

/**
 * 获取或创建增量同步管理器实例
 */
export function getIncrementalSyncManager(
  options?: IncrementalSyncOptions
): IncrementalSyncManager {
  if (!managerInstance) {
    managerInstance = new IncrementalSyncManager(options);
  }
  return managerInstance;
}

/**
 * 便捷函数: 追踪变更
 */
export function trackChange(
  entity: string,
  operation: OperationType,
  data: Record<string, unknown>
): void {
  const manager = getIncrementalSyncManager();
  return manager.trackChange(entity, operation, data);
}

/**
 * 便捷函数: 立即同步
 */
export async function syncNow(options?: SyncNowOptions): Promise<void> {
  const manager = getIncrementalSyncManager();
  return manager.syncNow(options);
}

export default IncrementalSyncManager;
