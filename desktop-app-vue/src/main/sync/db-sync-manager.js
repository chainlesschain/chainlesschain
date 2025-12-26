const { EventEmitter } = require('events');
const SyncHTTPClient = require('./sync-http-client');
const FieldMapper = require('./field-mapper');
const SyncQueue = require('./sync-queue');
const RetryPolicy = require('./retry-policy');
const config = require('./sync-config');
const crypto = require('crypto');

/**
 * 数据库同步管理器
 * 核心功能：本地 SQLite 与后端 PostgreSQL 的双向同步
 */
class DBSyncManager extends EventEmitter {
  constructor(database, mainWindow) {
    super();
    this.database = database;
    this.mainWindow = mainWindow;
    this.httpClient = new SyncHTTPClient();
    this.fieldMapper = new FieldMapper();
    this.syncQueue = new SyncQueue(config.maxConcurrency);
    this.retryPolicy = new RetryPolicy(6, 100);  // 最大6次重试，初始延迟100ms
    this.deviceId = null;
    this.syncLocks = new Map();
    this.isOnline = true;
    this.periodicSyncTimer = null;

    // 需要同步的表（按优先级排序）
    this.syncTables = config.syncTables;
  }

  /**
   * 初始化同步管理器
   */
  async initialize(deviceId) {
    this.deviceId = deviceId;
    this.timeOffset = 0;  // 客户端与服务器的时间偏移（毫秒）
    console.log('[DBSyncManager] 初始化，设备ID:', deviceId);

    // 同步服务器时间
    await this.syncServerTime();

    // 启动定期同步（5分钟）
    this.startPeriodicSync();

    // 启动定期清理软删除记录（每24小时，清理30天前的）
    this.startPeriodicCleanup();

    // 监听网络状态
    this.setupNetworkListeners();

    this.emit('initialized', { deviceId });
  }

  /**
   * 启动定期清理任务
   * 每24小时清理一次30天前的软删除记录
   */
  startPeriodicCleanup() {
    if (this.database && this.database.startPeriodicCleanup) {
      this.cleanupTimer = this.database.startPeriodicCleanup(24, 30);
      console.log('[DBSyncManager] 定期清理任务已启动');
    }
  }

  /**
   * 同步服务器时间，计算时间偏移
   * 解决时间戳不一致问题
   */
  async syncServerTime() {
    try {
      const clientTime1 = Date.now();
      const serverTimeInfo = await this.httpClient.getServerTime();
      const clientTime2 = Date.now();

      // 计算RTT（往返时间）并调整
      const rtt = clientTime2 - clientTime1;
      const adjustedServerTime = serverTimeInfo.timestamp + (rtt / 2);

      // 计算时间偏移: 本地时间 - 服务器时间
      this.timeOffset = clientTime2 - adjustedServerTime;

      console.log('[DBSyncManager] 时间同步完成:', {
        serverTime: new Date(serverTimeInfo.timestamp).toISOString(),
        clientTime: new Date(clientTime2).toISOString(),
        offset: this.timeOffset,
        offsetMinutes: (this.timeOffset / 60000).toFixed(2),
        rtt: rtt
      });

      // 如果偏移超过5分钟，发出警告
      if (Math.abs(this.timeOffset) > 5 * 60 * 1000) {
        console.warn('[DBSyncManager] 警告: 客户端与服务器时间偏差超过5分钟!');
        this.emit('time-offset-warning', {
          offset: this.timeOffset,
          offsetMinutes: (this.timeOffset / 60000).toFixed(2)
        });
      }

    } catch (error) {
      console.error('[DBSyncManager] 时间同步失败:', error);
      // 失败时使用0偏移，继续执行
      this.timeOffset = 0;
    }
  }

  /**
   * 将本地时间戳调整为服务器时间
   * @param {number} localTimestamp - 本地时间戳（毫秒）
   * @returns {number} 调整后的时间戳
   */
  adjustToServerTime(localTimestamp) {
    return localTimestamp - this.timeOffset;
  }

  /**
   * 将服务器时间戳调整为本地时间
   * @param {number} serverTimestamp - 服务器时间戳（毫秒）
   * @returns {number} 调整后的时间戳
   */
  adjustToLocalTime(serverTimestamp) {
    return serverTimestamp + this.timeOffset;
  }

  /**
   * 登录后的完整同步流程
   */
  async syncAfterLogin() {
    console.log('[DBSyncManager] 开始登录后同步');

    this.emit('sync:started', {
      totalTables: this.syncTables.length
    });

    let completedTables = 0;
    const conflicts = [];

    for (const tableName of this.syncTables) {
      try {
        console.log(`[DBSyncManager] 同步表: ${tableName}`);

        this.emit('sync:table-started', {
          table: tableName,
          progress: (completedTables / this.syncTables.length) * 100
        });

        // 1. 上传本地新数据
        await this.uploadLocalChanges(tableName);

        // 2. 下载远程新数据
        const result = await this.downloadRemoteChanges(tableName);

        // 3. 检测冲突
        if (result.conflicts && result.conflicts.length > 0) {
          conflicts.push(...result.conflicts.map(c => ({ ...c, table: tableName })));
        }

        completedTables++;

        this.emit('sync:table-completed', {
          table: tableName,
          progress: (completedTables / this.syncTables.length) * 100
        });

      } catch (error) {
        console.error(`[DBSyncManager] 同步表 ${tableName} 失败:`, error);
        this.emit('sync:error', { table: tableName, error: error.message });
      }
    }

    // 如果有冲突，通知前端
    if (conflicts.length > 0) {
      this.emit('sync:conflicts-detected', { conflicts });
      // 发送IPC到渲染进程显示冲突对话框
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('sync:show-conflicts', conflicts);
      }
    }

    this.emit('sync:completed', {
      totalTables: completedTables,
      conflicts: conflicts.length
    });

    console.log('[DBSyncManager] 登录后同步完成');
  }

  /**
   * 上传本地变更（逐条处理版本）
   * 每条记录独立处理，与后端的独立事务保持一致
   */
  async uploadLocalChanges(tableName) {
    // 查询所有待同步的记录
    const pendingRecords = this.database.db
      .prepare(`SELECT * FROM ${tableName} WHERE sync_status = ? OR sync_status IS NULL`)
      .all('pending');

    if (pendingRecords.length === 0) {
      console.log(`[DBSyncManager] 表 ${tableName} 无待上传数据`);
      return { success: 0, failed: 0, conflicts: 0 };
    }

    console.log(`[DBSyncManager] 上传 ${pendingRecords.length} 条记录到表 ${tableName}`);

    const results = {
      success: [],
      failed: [],
      conflicts: []
    };

    // 逐条上传
    for (const record of pendingRecords) {
      try {
        // 转换为后端格式，并调整时间戳
        const backendRecord = this.fieldMapper.toBackend(record, tableName);

        // 调整时间戳到服务器时间
        if (backendRecord.createdAt) {
          backendRecord.createdAt = this.adjustToServerTime(backendRecord.createdAt);
        }
        if (backendRecord.updatedAt) {
          backendRecord.updatedAt = this.adjustToServerTime(backendRecord.updatedAt);
        }
        if (backendRecord.syncedAt) {
          backendRecord.syncedAt = this.adjustToServerTime(backendRecord.syncedAt);
        }

        // 使用重试策略上传
        const response = await this.retryPolicy.executeWithRetry(
          async () => {
            return await this.httpClient.uploadBatch(
              tableName,
              [backendRecord],
              this.deviceId
            );
          },
          `上传${tableName}记录[${record.id}]`,
          {
            shouldRetry: (error, attempt) => {
              // 冲突不重试（需要用户解决）
              if (error.message && error.message.includes('冲突')) {
                return false;
              }
              // 其他错误可以重试
              return true;
            },
            onRetry: (attempt, error, delay) => {
              console.log(`[DBSyncManager] 重试上传: table=${tableName}, id=${record.id}, attempt=${attempt + 1}, delay=${delay}ms`);

              // 发送重试事件到前端
              if (this.mainWindow && this.mainWindow.webContents) {
                this.mainWindow.webContents.send('sync:retry', {
                  tableName,
                  recordId: record.id,
                  attempt: attempt + 1,
                  delay
                });
              }
            }
          }
        );

        // 处理上传结果
        if (response.conflictCount > 0) {
          // 检测到冲突
          results.conflicts.push({
            record,
            conflicts: response.conflicts
          });

          // 标记为冲突状态
          this.database.updateSyncStatus(tableName, record.id, 'conflict', null);

          console.warn(`[DBSyncManager] 冲突: table=${tableName}, id=${record.id}`);
        } else if (response.successCount > 0) {
          // 上传成功
          results.success.push(record);

          // 标记为已同步（使用服务器时间）
          const syncedAt = this.adjustToServerTime(Date.now());
          this.database.updateSyncStatus(tableName, record.id, 'synced', syncedAt);
        } else {
          // 上传失败但没有抛出异常
          results.failed.push({
            record,
            error: 'Unknown error'
          });

          this.database.updateSyncStatus(tableName, record.id, 'error', null);
        }

      } catch (error) {
        // 捕获异常（重试失败后）
        console.error(`[DBSyncManager] 上传最终失败: table=${tableName}, id=${record.id}`, error);

        results.failed.push({
          record,
          error: error.message
        });

        // 标记为错误状态
        this.database.updateSyncStatus(tableName, record.id, 'error', null);
      }
    }

    console.log(`[DBSyncManager] 上传完成: 成功${results.success.length}, 失败${results.failed.length}, 冲突${results.conflicts.length}`);

    return {
      success: results.success.length,
      failed: results.failed.length,
      conflicts: results.conflicts.length,
      details: results
    };
  }

  /**
   * 下载远程变更
   */
  async downloadRemoteChanges(tableName) {
    // 获取本地最后同步时间
    const lastSyncResult = this.database.db
      .prepare(`SELECT MAX(synced_at) as last_synced FROM ${tableName}`)
      .get();

    const lastSyncedAt = lastSyncResult?.last_synced || 0;

    console.log(`[DBSyncManager] 下载表 ${tableName} 的增量数据，上次同步: ${new Date(lastSyncedAt).toLocaleString()}`);

    try {
      // 请求增量数据
      const response = await this.httpClient.downloadIncremental(
        tableName,
        lastSyncedAt,
        this.deviceId
      );

      const { newRecords, updatedRecords, deletedIds } = response;
      const conflicts = [];

      // 处理新增记录
      for (const backendRecord of newRecords || []) {
        const localRecord = this.fieldMapper.toLocal(backendRecord, tableName);
        this.insertOrUpdateLocal(tableName, localRecord);
      }

      // 处理更新记录（可能产生冲突）
      for (const backendRecord of updatedRecords || []) {
        const conflict = await this.handleUpdate(tableName, backendRecord);
        if (conflict) {
          conflicts.push(conflict);
        }
      }

      // 处理删除记录（使用软删除）
      let deletedCount = 0;
      for (const deletedId of deletedIds || []) {
        // 使用softDelete方法，会自动设置deleted=1并标记sync_status为pending
        if (this.database.softDelete && typeof this.database.softDelete === 'function') {
          if (this.database.softDelete(tableName, deletedId)) {
            deletedCount++;
          }
        } else {
          // 降级处理（兼容旧版本）
          this.database.db.run(
            `UPDATE ${tableName}
             SET deleted = 1,
                 updated_at = ?,
                 sync_status = 'pending'
             WHERE id = ?`,
            [Date.now(), deletedId]
          );
          deletedCount++;
        }
      }

      console.log(`[DBSyncManager] 下载完成: 新增${newRecords?.length || 0}, 更新${updatedRecords?.length || 0}, 删除${deletedCount}`);

      return { conflicts };
    } catch (error) {
      console.error(`[DBSyncManager] 下载失败:`, error);
      throw error;
    }
  }

  /**
   * 处理更新（冲突检测）
   */
  async handleUpdate(tableName, backendRecord) {
    const localRecord = this.database.db
      .prepare(`SELECT * FROM ${tableName} WHERE id = ?`)
      .get(backendRecord.id);

    if (!localRecord) {
      // 本地不存在，直接插入
      const converted = this.fieldMapper.toLocal(backendRecord, tableName);
      this.insertOrUpdateLocal(tableName, converted);
      return null;
    }

    // 检测冲突
    const backendUpdatedAt = this.fieldMapper.toMillis(backendRecord.updatedAt);
    const localUpdatedAt = localRecord.updated_at;
    const localSyncedAt = localRecord.synced_at || 0;

    // 冲突条件：本地在上次同步后被修改过 && 远程也被修改过
    if (localUpdatedAt > localSyncedAt && backendUpdatedAt > localSyncedAt) {
      console.warn('[DBSyncManager] 检测到冲突:', tableName, backendRecord.id);

      return {
        id: backendRecord.id,
        table: tableName,
        localRecord,
        remoteRecord: this.fieldMapper.toLocal(backendRecord, tableName),
        localUpdatedAt,
        remoteUpdatedAt: backendUpdatedAt
      };
    }

    // 无冲突，远程较新，直接更新
    if (backendUpdatedAt > localUpdatedAt) {
      // 保留本地的同步状态，避免覆盖pending/error/conflict等状态
      const converted = this.fieldMapper.toLocal(backendRecord, tableName, {
        existingRecord: localRecord,
        preserveLocalStatus: true
      });
      this.insertOrUpdateLocal(tableName, converted);
    }

    return null;
  }

  /**
   * 插入或更新本地记录
   */
  insertOrUpdateLocal(tableName, record) {
    const columns = Object.keys(record);
    const placeholders = columns.map(() => '?').join(', ');
    const updateSet = columns.map(col => `${col} = excluded.${col}`).join(', ');

    this.database.db.run(
      `INSERT INTO ${tableName} (${columns.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updateSet}`,
      Object.values(record)
    );
  }

  /**
   * 解决冲突
   */
  async resolveConflict(conflictId, resolution) {
    console.log('[DBSyncManager] 解决冲突:', conflictId, resolution);

    // TODO: 根据解决策略更新本地或远程数据
    // 这里需要根据实际情况实现具体逻辑

    try {
      await this.httpClient.resolveConflict(conflictId, resolution, null);
      this.emit('conflict-resolved', { conflictId, resolution });
    } catch (error) {
      console.error('[DBSyncManager] 解决冲突失败:', error);
      throw error;
    }
  }

  /**
   * 定期增量同步
   */
  startPeriodicSync() {
    if (this.periodicSyncTimer) {
      clearInterval(this.periodicSyncTimer);
    }

    this.periodicSyncTimer = setInterval(() => {
      if (this.isOnline) {
        console.log('[DBSyncManager] 执行定期增量同步');
        this.syncIncremental().catch(error => {
          console.error('[DBSyncManager] 定期同步失败:', error);
        });
      }
    }, config.syncInterval);
  }

  /**
   * 增量同步（只同步有变更的表）
   */
  async syncIncremental() {
    for (const tableName of this.syncTables) {
      try {
        const hasPending = this.database.db
          .prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE sync_status = 'pending'`)
          .get();

        if (hasPending.count > 0) {
          await this.uploadLocalChanges(tableName);
          await this.downloadRemoteChanges(tableName);
        }
      } catch (error) {
        console.error(`[DBSyncManager] 增量同步表 ${tableName} 失败:`, error);
      }
    }
  }

  /**
   * 设置网络监听
   */
  setupNetworkListeners() {
    // 简化实现：假设一直在线
    // 实际可以使用 Node.js 的网络模块检测在线状态
    this.isOnline = true;
  }

  /**
   * 销毁管理器
   */
  destroy() {
    if (this.periodicSyncTimer) {
      clearInterval(this.periodicSyncTimer);
      this.periodicSyncTimer = null;
    }

    this.syncQueue.clear();
    this.removeAllListeners();

    console.log('[DBSyncManager] 已销毁');
  }
}

module.exports = DBSyncManager;
