const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * P2P 数据同步引擎
 * 负责去中心化组织的数据同步、冲突检测和解决
 *
 * @class P2PSyncEngine
 */
class P2PSyncEngine {
  constructor(db, didManager, p2pManager) {
    this.db = db;
    this.didManager = didManager;
    this.p2pManager = p2pManager;

    // 同步配置
    this.config = {
      syncInterval: 30000, // 30秒
      queueProcessInterval: 5000, // 5秒
      maxRetryCount: 5,
      batchSize: 50,
      defaultStrategy: 'lww' // Last-Write-Wins
    };

    // 同步定时器
    this.syncTimer = null;
    this.queueTimer = null;

    // 同步状态
    this.syncing = false;
    this.lastSyncTime = null;
  }

  /**
   * 初始化同步引擎
   * @returns {Promise<void>}
   */
  async initialize() {
    console.log('[P2PSyncEngine] 初始化同步引擎...');

    // 注册 P2P 消息处理器
    if (this.p2pManager) {
      this.p2pManager.on('sync:request', this.handleSyncRequest.bind(this));
      this.p2pManager.on('sync:response', this.handleSyncResponse.bind(this));
      this.p2pManager.on('sync:change', this.handleSyncChange.bind(this));
      this.p2pManager.on('sync:conflict', this.handleSyncConflict.bind(this));
    }

    console.log('[P2PSyncEngine] ✓ 同步引擎初始化完成');
  }

  /**
   * 启动自动同步
   * @param {string} orgId - 组织ID
   */
  startAutoSync(orgId) {
    if (this.syncTimer) {
      this.stopAutoSync();
    }

    console.log(`[P2PSyncEngine] 启动自动同步: ${orgId}`);

    // 定期同步
    this.syncTimer = setInterval(async () => {
      try {
        await this.sync(orgId);
      } catch (error) {
        console.error('[P2PSyncEngine] 自动同步失败:', error);
      }
    }, this.config.syncInterval);

    // 定期处理离线队列
    this.queueTimer = setInterval(async () => {
      try {
        await this.processQueue(orgId);
      } catch (error) {
        console.error('[P2PSyncEngine] 队列处理失败:', error);
      }
    }, this.config.queueProcessInterval);

    // 立即执行一次同步
    this.sync(orgId).catch(error => {
      console.error('[P2PSyncEngine] 初始同步失败:', error);
    });
  }

  /**
   * 停止自动同步
   */
  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
    }

    console.log('[P2PSyncEngine] 自动同步已停止');
  }

  /**
   * 执行同步
   * @param {string} orgId - 组织ID
   * @param {Object} options - 同步选项
   * @returns {Promise<Object>} 同步结果
   */
  async sync(orgId, options = {}) {
    if (this.syncing) {
      console.log('[P2PSyncEngine] 同步进行中，跳过');
      return { skipped: true };
    }

    this.syncing = true;
    const startTime = Date.now();

    try {
      console.log(`[P2PSyncEngine] 开始同步: ${orgId}`);

      // 1. 获取待同步的资源
      const pendingResources = await this.getPendingResources(orgId);
      console.log(`[P2PSyncEngine] 待同步资源: ${pendingResources.length} 个`);

      // 2. 请求远程变更
      const remoteChanges = await this.requestRemoteChanges(orgId, options);
      console.log(`[P2PSyncEngine] 远程变更: ${remoteChanges.length} 个`);

      // 3. 应用远程变更
      const applied = await this.applyRemoteChanges(orgId, remoteChanges);

      // 4. 推送本地变更
      const pushed = await this.pushLocalChanges(orgId, pendingResources);

      const duration = Date.now() - startTime;
      this.lastSyncTime = Date.now();

      const result = {
        success: true,
        duration,
        applied,
        pushed,
        conflicts: applied.conflicts || 0
      };

      console.log(`[P2PSyncEngine] ✓ 同步完成:`, result);
      return result;
    } catch (error) {
      console.error('[P2PSyncEngine] 同步失败:', error);
      throw error;
    } finally {
      this.syncing = false;
    }
  }

  /**
   * 获取待同步的资源
   * @param {string} orgId - 组织ID
   * @returns {Promise<Array>} 待同步资源列表
   */
  async getPendingResources(orgId) {
    const resources = this.db.prepare(`
      SELECT * FROM p2p_sync_state
      WHERE org_id = ? AND sync_status = 'pending'
      ORDER BY local_version DESC
      LIMIT ?
    `).all(orgId, this.config.batchSize);

    return resources;
  }

  /**
   * 请求远程变更
   * @param {string} orgId - 组织ID
   * @param {Object} options - 请求选项
   * @returns {Promise<Array>} 远程变更列表
   */
  async requestRemoteChanges(orgId, options = {}) {
    if (!this.p2pManager) {
      console.log('[P2PSyncEngine] P2P管理器未初始化，跳过远程同步');
      return [];
    }

    const message = {
      type: 'sync:request',
      org_id: orgId,
      last_sync_time: this.lastSyncTime || 0,
      resource_types: options.resourceTypes || ['knowledge', 'project', 'member', 'role']
    };

    try {
      // 广播同步请求
      await this.p2pManager.broadcastToOrg(orgId, message);

      // 等待收集响应（简化版：实际应该收集多个节点的响应）
      // TODO: 实现响应收集和聚合机制
      return [];
    } catch (error) {
      console.error('[P2PSyncEngine] 请求远程变更失败:', error);
      return [];
    }
  }

  /**
   * 应用远程变更
   * @param {string} orgId - 组织ID
   * @param {Array} changes - 远程变更列表
   * @returns {Promise<Object>} 应用结果
   */
  async applyRemoteChanges(orgId, changes) {
    let applied = 0;
    let conflicts = 0;
    let errors = 0;

    for (const change of changes) {
      try {
        const result = await this.applyChange(orgId, change);

        if (result.conflict) {
          conflicts++;
        } else if (result.applied) {
          applied++;
        }
      } catch (error) {
        console.error(`[P2PSyncEngine] 应用变更失败:`, change, error);
        errors++;
      }
    }

    return { applied, conflicts, errors };
  }

  /**
   * 应用单个变更
   * @param {string} orgId - 组织ID
   * @param {Object} change - 变更对象
   * @returns {Promise<Object>} 应用结果
   */
  async applyChange(orgId, change) {
    const {
      resource_type,
      resource_id,
      action,
      data,
      version,
      vector_clock,
      author_did,
      timestamp
    } = change;

    // 1. 获取本地同步状态
    const localState = this.getSyncState(orgId, resource_type, resource_id);

    // 2. 检测冲突
    const conflictResult = this.detectConflict(localState, {
      version,
      vector_clock,
      timestamp
    });

    if (conflictResult.isConflict) {
      // 记录冲突
      await this.recordConflict(orgId, resource_type, resource_id, localState, change);

      // 尝试自动解决冲突
      const resolved = await this.resolveConflict(orgId, resource_type, resource_id, localState, change);

      if (resolved) {
        return { applied: true, conflict: false, resolved: true };
      } else {
        return { applied: false, conflict: true };
      }
    }

    // 3. 如果远程更新，应用变更
    if (conflictResult.winner === 'remote') {
      await this.applyResourceChange(resource_type, resource_id, action, data);

      // 更新同步状态
      this.updateSyncState(orgId, resource_type, resource_id, {
        remote_version: version,
        vector_clock: JSON.stringify(vector_clock),
        sync_status: 'synced',
        last_synced_at: Date.now()
      });

      return { applied: true, conflict: false };
    }

    // 4. 本地更新，无需应用
    return { applied: false, conflict: false };
  }

  /**
   * 推送本地变更
   * @param {string} orgId - 组织ID
   * @param {Array} resources - 待推送资源列表
   * @returns {Promise<number>} 推送数量
   */
  async pushLocalChanges(orgId, resources) {
    if (!this.p2pManager) {
      console.log('[P2PSyncEngine] P2P管理器未初始化，跳过推送');
      return 0;
    }

    let pushed = 0;

    for (const resource of resources) {
      try {
        // 获取资源数据
        const data = await this.getResourceData(
          resource.resource_type,
          resource.resource_id
        );

        if (!data) {
          console.warn(`[P2PSyncEngine] 资源不存在: ${resource.resource_type}/${resource.resource_id}`);
          continue;
        }

        // 构建同步消息
        const currentDID = await this.didManager.getDefaultIdentity();
        const message = {
          type: 'sync:change',
          org_id: orgId,
          resource_type: resource.resource_type,
          resource_id: resource.resource_id,
          action: 'update',
          data: data,
          version: resource.local_version,
          vector_clock: JSON.parse(resource.vector_clock || '{}'),
          author_did: currentDID.did,
          timestamp: Date.now()
        };

        // 签名消息
        message.signature = await this.signMessage(message);

        // 广播变更
        await this.p2pManager.broadcastToOrg(orgId, message);

        // 更新同步状态为已同步
        this.updateSyncState(orgId, resource.resource_type, resource.resource_id, {
          sync_status: 'synced',
          last_synced_at: Date.now()
        });

        pushed++;
      } catch (error) {
        console.error(`[P2PSyncEngine] 推送变更失败:`, resource, error);
      }
    }

    return pushed;
  }

  /**
   * 检测冲突
   * @param {Object} localState - 本地状态
   * @param {Object} remoteState - 远程状态
   * @returns {Object} 冲突检测结果
   */
  detectConflict(localState, remoteState) {
    // 如果本地没有状态，远程获胜
    if (!localState) {
      return { isConflict: false, winner: 'remote' };
    }

    const localVC = JSON.parse(localState.vector_clock || '{}');
    const remoteVC = remoteState.vector_clock || {};

    let localNewer = false;
    let remoteNewer = false;

    // 比较向量时钟
    const allDIDs = new Set([
      ...Object.keys(localVC),
      ...Object.keys(remoteVC)
    ]);

    for (const did of allDIDs) {
      const localV = localVC[did] || 0;
      const remoteV = remoteVC[did] || 0;

      if (localV > remoteV) localNewer = true;
      if (remoteV > localV) remoteNewer = true;
    }

    // 并发修改 = 冲突
    if (localNewer && remoteNewer) {
      return { isConflict: true, winner: null };
    }

    // 本地更新
    if (localNewer) {
      return { isConflict: false, winner: 'local' };
    }

    // 远程更新
    if (remoteNewer) {
      return { isConflict: false, winner: 'remote' };
    }

    // 已同步
    return { isConflict: false, winner: null };
  }

  /**
   * 记录冲突
   * @param {string} orgId - 组织ID
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {Object} localState - 本地状态
   * @param {Object} remoteChange - 远程变更
   * @returns {Promise<string>} 冲突记录ID
   */
  async recordConflict(orgId, resourceType, resourceId, localState, remoteChange) {
    const conflictId = uuidv4();
    const now = Date.now();

    // 获取本地数据
    const localData = await this.getResourceData(resourceType, resourceId);

    this.db.run(`
      INSERT INTO sync_conflicts
      (id, org_id, resource_type, resource_id, local_version, remote_version,
       local_data, remote_data, local_vector_clock, remote_vector_clock,
       resolution_strategy, resolved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      conflictId,
      orgId,
      resourceType,
      resourceId,
      localState.local_version,
      remoteChange.version,
      JSON.stringify(localData),
      JSON.stringify(remoteChange.data),
      localState.vector_clock,
      JSON.stringify(remoteChange.vector_clock),
      null, // 待解决
      0,
      now
    ]);

    console.log(`[P2PSyncEngine] 冲突已记录: ${conflictId}`);
    return conflictId;
  }

  /**
   * 解决冲突
   * @param {string} orgId - 组织ID
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {Object} localState - 本地状态
   * @param {Object} remoteChange - 远程变更
   * @returns {Promise<boolean>} 是否成功解决
   */
  async resolveConflict(orgId, resourceType, resourceId, localState, remoteChange) {
    const strategy = this.getConflictResolutionStrategy(resourceType);

    console.log(`[P2PSyncEngine] 解决冲突: ${resourceType}/${resourceId}, 策略: ${strategy}`);

    switch (strategy) {
      case 'lww':
        return await this.resolveLWW(orgId, resourceType, resourceId, localState, remoteChange);

      case 'manual':
        // 手动解决，不自动处理
        console.log('[P2PSyncEngine] 需要手动解决冲突');
        return false;

      default:
        console.warn(`[P2PSyncEngine] 未知冲突解决策略: ${strategy}`);
        return false;
    }
  }

  /**
   * Last-Write-Wins 冲突解决
   * @param {string} orgId - 组织ID
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {Object} localState - 本地状态
   * @param {Object} remoteChange - 远程变更
   * @returns {Promise<boolean>} 是否成功解决
   */
  async resolveLWW(orgId, resourceType, resourceId, localState, remoteChange) {
    // 比较时间戳
    const localTimestamp = localState.last_synced_at || 0;
    const remoteTimestamp = remoteChange.timestamp;

    let winner;
    if (remoteTimestamp > localTimestamp) {
      winner = 'remote';
      await this.applyResourceChange(resourceType, resourceId, remoteChange.action, remoteChange.data);
    } else {
      winner = 'local';
      // 保持本地数据
    }

    // 更新冲突记录
    this.db.run(`
      UPDATE sync_conflicts
      SET resolution_strategy = 'lww',
          resolved = 1,
          resolved_at = ?,
          resolved_by_did = 'system'
      WHERE org_id = ? AND resource_type = ? AND resource_id = ? AND resolved = 0
    `, [Date.now(), orgId, resourceType, resourceId]);

    // 更新同步状态
    this.updateSyncState(orgId, resourceType, resourceId, {
      sync_status: 'synced',
      last_synced_at: Date.now()
    });

    console.log(`[P2PSyncEngine] LWW冲突已解决, 获胜者: ${winner}`);
    return true;
  }

  /**
   * 获取冲突解决策略
   * @param {string} resourceType - 资源类型
   * @returns {string} 策略名称
   */
  getConflictResolutionStrategy(resourceType) {
    const strategies = {
      knowledge: 'manual', // 知识库需要手动解决（重要内容）
      member: 'lww',       // 成员信息使用 LWW
      role: 'manual',      // 角色配置需要手动解决
      settings: 'manual',  // 组织设置需要手动解决
      project: 'lww'       // 项目元数据使用 LWW
    };

    return strategies[resourceType] || this.config.defaultStrategy;
  }

  /**
   * 获取同步状态
   * @param {string} orgId - 组织ID
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @returns {Object|null} 同步状态
   */
  getSyncState(orgId, resourceType, resourceId) {
    return this.db.prepare(`
      SELECT * FROM p2p_sync_state
      WHERE org_id = ? AND resource_type = ? AND resource_id = ?
    `).get(orgId, resourceType, resourceId) || null;
  }

  /**
   * 更新同步状态
   * @param {string} orgId - 组织ID
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {Object} updates - 更新字段
   */
  updateSyncState(orgId, resourceType, resourceId, updates) {
    const existing = this.getSyncState(orgId, resourceType, resourceId);

    if (existing) {
      // 更新
      const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), orgId, resourceType, resourceId];

      this.db.run(`
        UPDATE p2p_sync_state
        SET ${fields}
        WHERE org_id = ? AND resource_type = ? AND resource_id = ?
      `, values);
    } else {
      // 插入
      this.db.run(`
        INSERT INTO p2p_sync_state
        (id, org_id, resource_type, resource_id, local_version, remote_version, vector_clock, sync_status, last_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        uuidv4(),
        orgId,
        resourceType,
        resourceId,
        updates.local_version || 1,
        updates.remote_version || 1,
        updates.vector_clock || '{}',
        updates.sync_status || 'synced',
        updates.last_synced_at || Date.now()
      ]);
    }
  }

  /**
   * 获取资源数据
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @returns {Promise<Object|null>} 资源数据
   */
  async getResourceData(resourceType, resourceId) {
    const tableMap = {
      knowledge: 'knowledge_items',
      project: 'projects',
      member: 'organization_members',
      role: 'organization_roles'
    };

    const table = tableMap[resourceType];
    if (!table) {
      console.warn(`[P2PSyncEngine] 未知资源类型: ${resourceType}`);
      return null;
    }

    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(resourceId);
  }

  /**
   * 应用资源变更
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {string} action - 操作类型
   * @param {Object} data - 数据
   * @returns {Promise<void>}
   */
  async applyResourceChange(resourceType, resourceId, action, data) {
    const tableMap = {
      knowledge: 'knowledge_items',
      project: 'projects',
      member: 'organization_members',
      role: 'organization_roles'
    };

    const table = tableMap[resourceType];
    if (!table) {
      throw new Error(`未知资源类型: ${resourceType}`);
    }

    if (action === 'delete') {
      this.db.run(`DELETE FROM ${table} WHERE id = ?`, [resourceId]);
    } else {
      // create or update
      const fields = Object.keys(data);
      const placeholders = fields.map(() => '?').join(', ');
      const values = Object.values(data);

      this.db.run(`
        INSERT OR REPLACE INTO ${table} (${fields.join(', ')})
        VALUES (${placeholders})
      `, values);
    }

    console.log(`[P2PSyncEngine] 资源变更已应用: ${action} ${resourceType}/${resourceId}`);
  }

  /**
   * 签名消息
   * @param {Object} message - 消息对象
   * @returns {Promise<string>} 签名
   */
  async signMessage(message) {
    // 简化版：使用哈希作为签名
    // TODO: 使用 DID 私钥进行真实签名
    const content = JSON.stringify(message);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * 验证消息签名
   * @param {Object} message - 消息对象
   * @returns {Promise<boolean>} 是否有效
   */
  async verifyMessage(message) {
    // TODO: 使用 DID 公钥验证签名
    return true;
  }

  // ========== P2P 消息处理器 ==========

  /**
   * 处理同步请求
   * @param {Object} message - 同步请求消息
   */
  async handleSyncRequest(message) {
    console.log('[P2PSyncEngine] 收到同步请求:', message);

    const { org_id, last_sync_time, resource_types } = message;

    // 获取变更列表
    const changes = await this.getChangesSince(org_id, last_sync_time, resource_types);

    // 发送响应
    const response = {
      type: 'sync:response',
      org_id,
      changes
    };

    // TODO: 发送给请求者
    console.log('[P2PSyncEngine] 同步响应:', response);
  }

  /**
   * 处理同步响应
   * @param {Object} message - 同步响应消息
   */
  async handleSyncResponse(message) {
    console.log('[P2PSyncEngine] 收到同步响应:', message);

    const { org_id, changes } = message;

    // 应用远程变更
    await this.applyRemoteChanges(org_id, changes);
  }

  /**
   * 处理同步变更
   * @param {Object} message - 同步变更消息
   */
  async handleSyncChange(message) {
    console.log('[P2PSyncEngine] 收到同步变更:', message);

    const { org_id } = message;

    // 验证签名
    const isValid = await this.verifyMessage(message);
    if (!isValid) {
      console.error('[P2PSyncEngine] 消息签名验证失败');
      return;
    }

    // 应用变更
    await this.applyChange(org_id, message);
  }

  /**
   * 处理同步冲突
   * @param {Object} message - 同步冲突消息
   */
  async handleSyncConflict(message) {
    console.log('[P2PSyncEngine] 收到同步冲突:', message);
    // TODO: 显示冲突通知给用户
  }

  /**
   * 获取指定时间之后的变更
   * @param {string} orgId - 组织ID
   * @param {number} sinceTime - 起始时间戳
   * @param {Array} resourceTypes - 资源类型列表
   * @returns {Promise<Array>} 变更列表
   */
  async getChangesSince(orgId, sinceTime, resourceTypes) {
    // TODO: 实现获取变更逻辑
    return [];
  }

  /**
   * 处理离线队列
   * @param {string} orgId - 组织ID
   * @returns {Promise<number>} 处理数量
   */
  async processQueue(orgId) {
    const items = this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE org_id = ? AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 100
    `).all(orgId);

    if (items.length === 0) {
      return 0;
    }

    console.log(`[P2PSyncEngine] 处理离线队列: ${items.length} 项`);

    let processed = 0;

    for (const item of items) {
      try {
        // 标记为处理中
        this.db.run(`
          UPDATE sync_queue SET status = 'processing' WHERE id = ?
        `, [item.id]);

        // 执行同步操作
        // TODO: 实现队列项处理

        // 标记为完成
        this.db.run(`
          UPDATE sync_queue SET status = 'completed' WHERE id = ?
        `, [item.id]);

        processed++;
      } catch (error) {
        console.error('[P2PSyncEngine] 队列项处理失败:', item, error);

        // 更新重试计数
        const retryCount = item.retry_count + 1;

        if (retryCount >= this.config.maxRetryCount) {
          // 超过最大重试次数，标记为失败
          this.db.run(`
            UPDATE sync_queue
            SET status = 'failed', retry_count = ?, last_retry_at = ?
            WHERE id = ?
          `, [retryCount, Date.now(), item.id]);
        } else {
          // 重新标记为待处理
          this.db.run(`
            UPDATE sync_queue
            SET status = 'pending', retry_count = ?, last_retry_at = ?
            WHERE id = ?
          `, [retryCount, Date.now(), item.id]);
        }
      }
    }

    console.log(`[P2PSyncEngine] ✓ 离线队列处理完成: ${processed}/${items.length}`);
    return processed;
  }

  /**
   * 添加到离线队列
   * @param {string} orgId - 组织ID
   * @param {string} action - 操作类型
   * @param {string} resourceType - 资源类型
   * @param {string} resourceId - 资源ID
   * @param {Object} data - 数据
   * @returns {string} 队列项ID
   */
  addToQueue(orgId, action, resourceType, resourceId, data) {
    const id = uuidv4();
    const now = Date.now();

    // 获取当前版本号
    const syncState = this.getSyncState(orgId, resourceType, resourceId);
    const version = syncState ? syncState.local_version + 1 : 1;

    this.db.run(`
      INSERT INTO sync_queue
      (id, org_id, action, resource_type, resource_id, data, version, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      orgId,
      action,
      resourceType,
      resourceId,
      JSON.stringify(data),
      version,
      now,
      'pending'
    ]);

    console.log(`[P2PSyncEngine] 已添加到离线队列: ${id}`);
    return id;
  }

  /**
   * 获取同步统计
   * @param {string} orgId - 组织ID
   * @returns {Object} 统计信息
   */
  getSyncStats(orgId) {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN sync_status = 'synced' THEN 1 ELSE 0 END), 0) as synced,
        COALESCE(SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
        COALESCE(SUM(CASE WHEN sync_status = 'conflict' THEN 1 ELSE 0 END), 0) as conflicts,
        MAX(last_synced_at) as last_sync_time
      FROM p2p_sync_state
      WHERE org_id = ?
    `).get(orgId);

    const queueSize = this.db.prepare(`
      SELECT COUNT(*) as count FROM sync_queue
      WHERE org_id = ? AND status IN ('pending', 'processing')
    `).get(orgId);

    return {
      ...stats,
      queue_size: queueSize.count || 0,
      last_sync_time: this.lastSyncTime
    };
  }
}

module.exports = P2PSyncEngine;
