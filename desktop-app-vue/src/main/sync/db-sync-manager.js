const { EventEmitter } = require('events');
const SyncHTTPClient = require('./sync-http-client');
const FieldMapper = require('./field-mapper');
const SyncQueue = require('./sync-queue');
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
    console.log('[DBSyncManager] 初始化，设备ID:', deviceId);

    // 启动定期同步（5分钟）
    this.startPeriodicSync();

    // 监听网络状态
    this.setupNetworkListeners();

    this.emit('initialized', { deviceId });
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
   * 上传本地变更
   */
  async uploadLocalChanges(tableName) {
    // 查询所有待同步的记录
    const pendingRecords = this.database.db
      .prepare(`SELECT * FROM ${tableName} WHERE sync_status = ? OR sync_status IS NULL`)
      .all('pending');

    if (pendingRecords.length === 0) {
      console.log(`[DBSyncManager] 表 ${tableName} 无待上传数据`);
      return;
    }

    console.log(`[DBSyncManager] 上传 ${pendingRecords.length} 条记录到表 ${tableName}`);

    // 转换为后端格式
    const backendRecords = pendingRecords.map(record =>
      this.fieldMapper.toBackend(record, tableName)
    );

    try {
      // 批量上传
      await this.httpClient.uploadBatch(tableName, backendRecords, this.deviceId);

      // 标记为已同步
      for (const record of pendingRecords) {
        this.database.db.run(
          `UPDATE ${tableName} SET sync_status = ?, synced_at = ? WHERE id = ?`,
          ['synced', Date.now(), record.id]
        );
      }

      console.log(`[DBSyncManager] 上传完成: ${pendingRecords.length} 条记录`);
    } catch (error) {
      console.error(`[DBSyncManager] 上传失败:`, error);
      throw error;
    }
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

      // 处理删除记录
      for (const deletedId of deletedIds || []) {
        this.database.db.run(
          `UPDATE ${tableName} SET deleted = 1 WHERE id = ?`,
          [deletedId]
        );
      }

      console.log(`[DBSyncManager] 下载完成: 新增${newRecords?.length || 0}, 更新${updatedRecords?.length || 0}, 删除${deletedIds?.length || 0}`);

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
      const converted = this.fieldMapper.toLocal(backendRecord, tableName);
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
