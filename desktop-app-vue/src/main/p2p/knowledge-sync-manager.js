/**
 * 知识库增量同步管理器
 *
 * 功能：
 * - 变更检测（基于时间戳和版本号）
 * - 增量数据传输
 * - 冲突检测和解决
 * - 同步状态管理
 * - 双向同步支持
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');
const crypto = require('crypto');

class KnowledgeSyncManager extends EventEmitter {
  constructor(database, messageManager, options = {}) {
    super();

    this.database = database;
    this.messageManager = messageManager;

    this.options = {
      // 同步配置
      syncInterval: options.syncInterval || 60000,      // 自动同步间隔（1分钟）
      batchSize: options.batchSize || 50,               // 批量同步大小
      enableAutoSync: options.enableAutoSync !== false,

      // 冲突解决策略
      conflictStrategy: options.conflictStrategy || 'latest-wins', // 'latest-wins' | 'manual' | 'merge'

      // 变更检测
      changeDetectionMethod: options.changeDetectionMethod || 'timestamp', // 'timestamp' | 'version' | 'hash'

      ...options
    };

    // 同步状态
    this.isSyncing = false;
    this.lastSyncTime = new Map(); // peerId -> timestamp
    this.syncProgress = new Map();  // peerId -> { total, synced }

    // 冲突队列
    this.conflicts = [];

    // 变更追踪
    this.localChanges = new Map(); // noteId -> { type, timestamp, data }

    // 统计信息
    this.stats = {
      totalSyncs: 0,
      notesUploaded: 0,
      notesDownloaded: 0,
      conflictsDetected: 0,
      conflictsResolved: 0
    };

    // 启动自动同步
    if (this.options.enableAutoSync) {
      this.startAutoSync();
    }

    // 监听本地变更
    this.setupChangeTracking();
  }

  /**
   * 开始同步
   * @param {string} peerId - 目标设备ID
   * @param {Object} options - 同步选项
   */
  async startSync(peerId, options = {}) {
    if (this.isSyncing) {
      throw new Error('同步正在进行中');
    }

    logger.info('[KnowledgeSync] 开始同步:', peerId);

    this.isSyncing = true;
    this.emit('sync:started', { peerId });

    try {
      // 1. 获取上次同步时间
      const lastSync = this.lastSyncTime.get(peerId) || 0;

      // 2. 检测本地变更
      const localChanges = await this.detectLocalChanges(lastSync);
      logger.info(`[KnowledgeSync] 检测到 ${localChanges.length} 个本地变更`);

      // 3. 请求远程变更
      const remoteChanges = await this.requestRemoteChanges(peerId, lastSync);
      logger.info(`[KnowledgeSync] 收到 ${remoteChanges.length} 个远程变更`);

      // 4. 检测冲突
      const conflicts = this.detectConflicts(localChanges, remoteChanges);
      if (conflicts.length > 0) {
        logger.info(`[KnowledgeSync] 检测到 ${conflicts.length} 个冲突`);
        this.stats.conflictsDetected += conflicts.length;
      }

      // 5. 解决冲突
      const resolved = await this.resolveConflicts(conflicts);

      // 6. 应用远程变更
      await this.applyRemoteChanges(remoteChanges, resolved);

      // 7. 上传本地变更
      await this.uploadLocalChanges(peerId, localChanges);

      // 8. 更新同步时间
      this.lastSyncTime.set(peerId, Date.now());

      logger.info('[KnowledgeSync] ✅ 同步完成');

      this.emit('sync:completed', {
        peerId,
        localChanges: localChanges.length,
        remoteChanges: remoteChanges.length,
        conflicts: conflicts.length
      });

      this.stats.totalSyncs++;

    } catch (error) {
      logger.error('[KnowledgeSync] ❌ 同步失败:', error);

      this.emit('sync:failed', {
        peerId,
        error
      });

      throw error;

    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 检测本地变更
   */
  async detectLocalChanges(since) {
    logger.info('[KnowledgeSync] 检测本地变更，since:', new Date(since));

    const changes = [];

    // 查询变更的笔记
    const modifiedNotes = await this.database.query(`
      SELECT id, title, content, updated_at, version, deleted
      FROM notes
      WHERE updated_at > ?
      ORDER BY updated_at ASC
    `, [since]);

    for (const note of modifiedNotes) {
      changes.push({
        type: note.deleted ? 'delete' : 'update',
        noteId: note.id,
        timestamp: note.updated_at,
        version: note.version,
        data: note.deleted ? null : {
          title: note.title,
          content: note.content,
          updated_at: note.updated_at
        },
        hash: this.calculateHash(note)
      });
    }

    return changes;
  }

  /**
   * 请求远程变更
   */
  async requestRemoteChanges(peerId, since) {
    logger.info('[KnowledgeSync] 请求远程变更');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('请求远程变更超时'));
      }, 30000);

      // 发送请求
      this.messageManager.sendMessage(peerId, {
        type: 'knowledge:sync-request',
        since: since
      }, {
        priority: 'high',
        requireAck: true
      });

      // 监听响应
      const handler = ({ peerId: responsePeerId, payload }) => {
        if (responsePeerId === peerId && payload.type === 'knowledge:sync-response') {
          clearTimeout(timeout);
          this.messageManager.off('message', handler);
          resolve(payload.changes || []);
        }
      };

      this.messageManager.on('message', handler);
    });
  }

  /**
   * 检测冲突
   */
  detectConflicts(localChanges, remoteChanges) {
    logger.info('[KnowledgeSync] 检测冲突...');

    const conflicts = [];
    const localMap = new Map(localChanges.map(c => [c.noteId, c]));

    for (const remoteChange of remoteChanges) {
      const localChange = localMap.get(remoteChange.noteId);

      if (localChange) {
        // 同一笔记有本地和远程变更
        const conflict = this.analyzeConflict(localChange, remoteChange);

        if (conflict.hasConflict) {
          conflicts.push({
            noteId: remoteChange.noteId,
            local: localChange,
            remote: remoteChange,
            conflictType: conflict.type
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * 分析冲突
   */
  analyzeConflict(localChange, remoteChange) {
    // 1. 检查时间戳
    const timeDiff = Math.abs(localChange.timestamp - remoteChange.timestamp);

    // 如果时间差小于1秒，认为是并发修改
    if (timeDiff < 1000) {
      return {
        hasConflict: true,
        type: 'concurrent'
      };
    }

    // 2. 检查内容哈希
    if (localChange.hash !== remoteChange.hash) {
      return {
        hasConflict: true,
        type: 'content'
      };
    }

    // 3. 检查版本号
    if (localChange.version && remoteChange.version) {
      if (localChange.version !== remoteChange.version) {
        return {
          hasConflict: true,
          type: 'version'
        };
      }
    }

    return {
      hasConflict: false
    };
  }

  /**
   * 解决冲突
   */
  async resolveConflicts(conflicts) {
    logger.info(`[KnowledgeSync] 解决 ${conflicts.length} 个冲突`);

    const resolved = [];

    for (const conflict of conflicts) {
      let resolution;

      switch (this.options.conflictStrategy) {
        case 'latest-wins':
          // 最新的获胜
          resolution = conflict.local.timestamp > conflict.remote.timestamp
            ? conflict.local
            : conflict.remote;
          break;

        case 'manual':
          // 手动解决（添加到冲突队列）
          this.conflicts.push(conflict);
          this.emit('conflict:detected', conflict);
          continue;

        case 'merge':
          // 尝试合并
          resolution = await this.mergeChanges(conflict.local, conflict.remote);
          break;

        default:
          resolution = conflict.remote;
      }

      resolved.push({
        noteId: conflict.noteId,
        resolution
      });

      this.stats.conflictsResolved++;
    }

    return resolved;
  }

  /**
   * 合并变更
   */
  async mergeChanges(local, remote) {
    logger.info('[KnowledgeSync] 合并变更:', local.noteId);

    // 简单的合并策略：
    // 1. 标题使用最新的
    // 2. 内容尝试三路合并
    // 3. 其他字段使用最新的

    const merged = {
      ...remote,
      timestamp: Math.max(local.timestamp, remote.timestamp),
      version: Math.max(local.version || 0, remote.version || 0) + 1
    };

    // 如果内容不同，尝试合并
    if (local.data && remote.data && local.data.content !== remote.data.content) {
      // 这里简化处理，实际应该使用diff算法
      merged.data.content = `${local.data.content}\n\n---\n\n${remote.data.content}`;
      merged.data.title = `${local.data.title} (合并)`;
    }

    return merged;
  }

  /**
   * 应用远程变更
   */
  async applyRemoteChanges(remoteChanges, resolved) {
    logger.info(`[KnowledgeSync] 应用 ${remoteChanges.length} 个远程变更`);

    const resolvedMap = new Map(resolved.map(r => [r.noteId, r.resolution]));

    for (const change of remoteChanges) {
      try {
        // 检查是否有冲突解决方案
        const resolution = resolvedMap.get(change.noteId);
        const changeToApply = resolution || change;

        if (changeToApply.type === 'delete') {
          await this.database.execute(
            'UPDATE notes SET deleted = 1, updated_at = ? WHERE id = ?',
            [changeToApply.timestamp, changeToApply.noteId]
          );
        } else {
          await this.database.execute(`
            INSERT OR REPLACE INTO notes (id, title, content, updated_at, version)
            VALUES (?, ?, ?, ?, ?)
          `, [
            changeToApply.noteId,
            changeToApply.data.title,
            changeToApply.data.content,
            changeToApply.timestamp,
            changeToApply.version || 1
          ]);
        }

        this.stats.notesDownloaded++;

      } catch (error) {
        logger.error('[KnowledgeSync] 应用变更失败:', error);
      }
    }
  }

  /**
   * 上传本地变更
   */
  async uploadLocalChanges(peerId, localChanges) {
    logger.info(`[KnowledgeSync] 上传 ${localChanges.length} 个本地变更`);

    // 批量上传
    const batches = this.chunkArray(localChanges, this.options.batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      await this.messageManager.sendMessage(peerId, {
        type: 'knowledge:sync-push',
        changes: batch,
        batchIndex: i,
        totalBatches: batches.length
      }, {
        priority: 'normal',
        requireAck: true
      });

      this.stats.notesUploaded += batch.length;

      // 更新进度
      this.syncProgress.set(peerId, {
        total: localChanges.length,
        synced: (i + 1) * this.options.batchSize
      });

      this.emit('sync:progress', {
        peerId,
        progress: this.syncProgress.get(peerId)
      });
    }
  }

  /**
   * 处理同步请求（作为服务端）
   */
  async handleSyncRequest(peerId, since) {
    logger.info('[KnowledgeSync] 处理同步请求:', peerId, since);

    try {
      const changes = await this.detectLocalChanges(since);

      await this.messageManager.sendMessage(peerId, {
        type: 'knowledge:sync-response',
        changes: changes
      }, {
        priority: 'high'
      });

    } catch (error) {
      logger.error('[KnowledgeSync] 处理同步请求失败:', error);
    }
  }

  /**
   * 处理同步推送（作为客户端）
   */
  async handleSyncPush(peerId, changes) {
    logger.info(`[KnowledgeSync] 处理同步推送: ${changes.length}条`);

    try {
      await this.applyRemoteChanges(changes, []);

      // 发送确认
      await this.messageManager.sendMessage(peerId, {
        type: 'knowledge:sync-ack',
        count: changes.length
      });

    } catch (error) {
      logger.error('[KnowledgeSync] 处理同步推送失败:', error);
    }
  }

  /**
   * 计算哈希
   */
  calculateHash(note) {
    const content = JSON.stringify({
      title: note.title,
      content: note.content
    });

    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * 分块数组
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 设置变更追踪
   */
  setupChangeTracking() {
    // 监听数据库变更事件
    // 这里简化处理，实际应该监听数据库触发器或事件
  }

  /**
   * 启动自动同步
   */
  startAutoSync() {
    setInterval(() => {
      // 对所有已配对设备进行同步
      // 这里简化处理，实际应该从设备管理器获取设备列表
    }, this.options.syncInterval);
  }

  /**
   * 获取冲突列表
   */
  getConflicts() {
    return this.conflicts;
  }

  /**
   * 手动解决冲突
   */
  async resolveConflictManually(conflictId, resolution) {
    const index = this.conflicts.findIndex(c => c.noteId === conflictId);
    if (index === -1) {
      throw new Error('冲突不存在');
    }

    const conflict = this.conflicts[index];

    // 应用解决方案
    await this.applyRemoteChanges([resolution], []);

    // 从冲突列表移除
    this.conflicts.splice(index, 1);

    this.stats.conflictsResolved++;

    this.emit('conflict:resolved', {
      noteId: conflictId,
      resolution
    });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      isSyncing: this.isSyncing,
      pendingConflicts: this.conflicts.length
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.lastSyncTime.clear();
    this.syncProgress.clear();
    this.conflicts = [];
    this.localChanges.clear();
  }
}

module.exports = KnowledgeSyncManager;
