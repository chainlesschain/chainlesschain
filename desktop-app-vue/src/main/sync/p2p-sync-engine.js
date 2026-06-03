const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const { EventEmitter } = require("events");

/**
 * P2P 数据同步引擎
 * 负责去中心化组织的数据同步、冲突检测和解决
 *
 * @class P2PSyncEngine
 */
class P2PSyncEngine extends EventEmitter {
  constructor(db, didManager, p2pManager, mainWindow = null) {
    super();
    this.db = db;
    this.didManager = didManager;
    this.p2pManager = p2pManager;
    this.mainWindow = mainWindow;

    // 同步配置
    this.config = {
      syncInterval: 30000, // 30秒
      queueProcessInterval: 5000, // 5秒
      maxRetryCount: 5,
      batchSize: 50,
      defaultStrategy: "lww", // Last-Write-Wins
      responseTimeout: 10000, // 响应超时时间 10秒
      minResponses: 1, // 最少响应数量
    };

    // 同步定时器
    this.syncTimer = null;
    this.queueTimer = null;

    // 同步状态
    this.syncing = false;
    this.lastSyncTime = null;
    this.localDID = null;

    // 响应收集器
    this.pendingRequests = new Map();
  }

  /**
   * 初始化同步引擎
   * @returns {Promise<void>}
   */
  async initialize() {
    logger.info("[P2PSyncEngine] 初始化同步引擎...");

    // 获取本地 DID
    if (this.didManager) {
      try {
        const identity = await this.didManager.getDefaultIdentity();
        this.localDID = identity?.did || null;
        logger.info(`[P2PSyncEngine] 本地 DID: ${this.localDID}`);
      } catch (error) {
        logger.warn("[P2PSyncEngine] 获取本地 DID 失败:", error.message);
      }
    }

    // 注册 P2P 消息处理器
    if (this.p2pManager) {
      this.p2pManager.on("sync:request", this.handleSyncRequest.bind(this));
      this.p2pManager.on("sync:response", this.handleSyncResponse.bind(this));
      this.p2pManager.on("sync:change", this.handleSyncChange.bind(this));
      this.p2pManager.on("sync:conflict", this.handleSyncConflict.bind(this));
    }

    logger.info("[P2PSyncEngine] ✓ 同步引擎初始化完成");
  }

  /**
   * 设置主窗口引用
   * @param {BrowserWindow} mainWindow - Electron 主窗口
   */
  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  /**
   * 启动自动同步
   * @param {string} orgId - 组织ID
   */
  startAutoSync(orgId) {
    if (this.syncTimer) {
      this.stopAutoSync();
    }

    logger.info(`[P2PSyncEngine] 启动自动同步: ${orgId}`);

    // 定期同步
    this.syncTimer = setInterval(async () => {
      try {
        await this.sync(orgId);
      } catch (error) {
        logger.error("[P2PSyncEngine] 自动同步失败:", error);
      }
    }, this.config.syncInterval);

    // 定期处理离线队列
    this.queueTimer = setInterval(async () => {
      try {
        await this.processQueue(orgId);
      } catch (error) {
        logger.error("[P2PSyncEngine] 队列处理失败:", error);
      }
    }, this.config.queueProcessInterval);

    // 立即执行一次同步
    this.sync(orgId).catch((error) => {
      logger.error("[P2PSyncEngine] 初始同步失败:", error);
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

    logger.info("[P2PSyncEngine] 自动同步已停止");
  }

  /**
   * 执行同步
   * @param {string} orgId - 组织ID
   * @param {Object} options - 同步选项
   * @returns {Promise<Object>} 同步结果
   */
  async sync(orgId, options = {}) {
    if (this.syncing) {
      logger.info("[P2PSyncEngine] 同步进行中，跳过");
      return { skipped: true };
    }

    this.syncing = true;
    const startTime = Date.now();

    try {
      logger.info(`[P2PSyncEngine] 开始同步: ${orgId}`);

      // 1. 获取待同步的资源
      const pendingResources = await this.getPendingResources(orgId);
      logger.info(`[P2PSyncEngine] 待同步资源: ${pendingResources.length} 个`);

      // 2. 请求远程变更
      const remoteChanges = await this.requestRemoteChanges(orgId, options);
      logger.info(`[P2PSyncEngine] 远程变更: ${remoteChanges.length} 个`);

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
        conflicts: applied.conflicts || 0,
      };

      logger.info(`[P2PSyncEngine] ✓ 同步完成:`, result);
      return result;
    } catch (error) {
      logger.error("[P2PSyncEngine] 同步失败:", error);
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
    const resources = this.db
      .prepare(
        `
      SELECT * FROM p2p_sync_state
      WHERE org_id = ? AND sync_status = 'pending'
      ORDER BY local_version DESC
      LIMIT ?
    `,
      )
      .all(orgId, this.config.batchSize);

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
      logger.info("[P2PSyncEngine] P2P管理器未初始化，跳过远程同步");
      return [];
    }

    const requestId = uuidv4();
    const timeout = options.timeout || this.config.responseTimeout;
    const minResponses = options.minResponses || this.config.minResponses;

    const message = {
      type: "sync:request",
      request_id: requestId,
      org_id: orgId,
      last_sync_time: this.lastSyncTime || 0,
      resource_types: options.resourceTypes || [
        "knowledge",
        "project",
        "member",
        "role",
      ],
      sender_did: this.localDID,
      timestamp: Date.now(),
    };

    try {
      // 创建响应收集器
      const collector = this.createResponseCollector(
        requestId,
        timeout,
        minResponses,
      );

      // 广播同步请求
      await this.p2pManager.broadcastToOrg(orgId, message);
      logger.info(`[P2PSyncEngine] 已广播同步请求: ${requestId}`);

      // 等待收集响应
      const responses = await collector.promise;
      logger.info(`[P2PSyncEngine] 收到 ${responses.length} 个响应`);

      // 聚合和去重变更
      const aggregatedChanges = this.aggregateChanges(responses);
      logger.info(`[P2PSyncEngine] 聚合后变更: ${aggregatedChanges.length} 条`);

      return aggregatedChanges;
    } catch (error) {
      logger.error("[P2PSyncEngine] 请求远程变更失败:", error);
      return [];
    } finally {
      // 清理收集器
      this.pendingRequests.delete(requestId);
    }
  }

  /**
   * 创建响应收集器
   * @param {string} requestId - 请求ID
   * @param {number} timeout - 超时时间（毫秒）
   * @param {number} minResponses - 最少响应数量
   * @returns {Object} 收集器对象
   */
  createResponseCollector(requestId, timeout, minResponses) {
    const responses = [];
    let resolvePromise;
    let timeoutId;

    const promise = new Promise((resolve) => {
      resolvePromise = resolve;

      // 设置超时
      timeoutId = setTimeout(() => {
        logger.info(
          `[P2PSyncEngine] 响应收集超时: ${requestId}, 已收集 ${responses.length} 个响应`,
        );
        resolve(responses);
      }, timeout);
    });

    const collector = {
      promise,
      responses,
      addResponse: (response) => {
        responses.push(response);
        logger.debug(
          `[P2PSyncEngine] 收到响应 ${responses.length} for ${requestId}`,
        );

        // 如果达到最小响应数且已有足够响应，提前解决
        if (responses.length >= minResponses) {
          // 给予额外 2 秒收集更多响应
          setTimeout(() => {
            if (this.pendingRequests.has(requestId)) {
              clearTimeout(timeoutId);
              resolvePromise(responses);
            }
          }, 2000);
        }
      },
    };

    this.pendingRequests.set(requestId, collector);
    return collector;
  }

  /**
   * 聚合多个响应的变更
   * @param {Array} responses - 响应列表
   * @returns {Array} 去重后的变更列表
   */
  aggregateChanges(responses) {
    const changeMap = new Map();

    for (const response of responses) {
      const changes = response.changes || [];

      for (const change of changes) {
        const key = `${change.resourceType || change.resource_type}:${change.resourceId || change.resource_id}`;
        const existing = changeMap.get(key);

        // 使用最新的变更（按时间戳比较）
        if (!existing || (change.timestamp || 0) > (existing.timestamp || 0)) {
          changeMap.set(key, {
            resource_type: change.resourceType || change.resource_type,
            resource_id: change.resourceId || change.resource_id,
            action: change.action,
            data: change.data,
            version: change.version,
            vector_clock: change.vectorClock || change.vector_clock,
            author_did: change.authorDID || change.author_did,
            timestamp: change.timestamp,
          });
        }
      }
    }

    // 按时间戳排序
    return Array.from(changeMap.values()).sort(
      (a, b) => (a.timestamp || 0) - (b.timestamp || 0),
    );
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
        logger.error(`[P2PSyncEngine] 应用变更失败:`, change, error);
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
      timestamp,
    } = change;

    // 1. 获取本地同步状态
    const localState = this.getSyncState(orgId, resource_type, resource_id);

    // 2. 检测冲突
    const conflictResult = this.detectConflict(localState, {
      version,
      vector_clock,
      timestamp,
    });

    if (conflictResult.isConflict) {
      // 记录冲突
      await this.recordConflict(
        orgId,
        resource_type,
        resource_id,
        localState,
        change,
      );

      // 尝试自动解决冲突
      const resolved = await this.resolveConflict(
        orgId,
        resource_type,
        resource_id,
        localState,
        change,
      );

      if (resolved) {
        return { applied: true, conflict: false, resolved: true };
      } else {
        return { applied: false, conflict: true };
      }
    }

    // 3. 如果远程更新，应用变更
    if (conflictResult.winner === "remote") {
      await this.applyResourceChange(resource_type, resource_id, action, data);

      // 更新同步状态
      this.updateSyncState(orgId, resource_type, resource_id, {
        remote_version: version,
        vector_clock: JSON.stringify(vector_clock),
        sync_status: "synced",
        last_synced_at: Date.now(),
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
      logger.info("[P2PSyncEngine] P2P管理器未初始化，跳过推送");
      return 0;
    }

    let pushed = 0;

    for (const resource of resources) {
      try {
        // 获取资源数据
        const data = await this.getResourceData(
          resource.resource_type,
          resource.resource_id,
        );

        if (!data) {
          logger.warn(
            `[P2PSyncEngine] 资源不存在: ${resource.resource_type}/${resource.resource_id}`,
          );
          continue;
        }

        // 构建同步消息
        const currentDID = await this.didManager.getDefaultIdentity();
        const message = {
          type: "sync:change",
          org_id: orgId,
          resource_type: resource.resource_type,
          resource_id: resource.resource_id,
          action: "update",
          data: data,
          version: resource.local_version,
          vector_clock: JSON.parse(resource.vector_clock || "{}"),
          author_did: currentDID.did,
          timestamp: Date.now(),
        };

        // 签名消息
        message.signature = await this.signMessage(message);

        // 广播变更
        await this.p2pManager.broadcastToOrg(orgId, message);

        // 更新同步状态为已同步
        this.updateSyncState(
          orgId,
          resource.resource_type,
          resource.resource_id,
          {
            sync_status: "synced",
            last_synced_at: Date.now(),
          },
        );

        pushed++;
      } catch (error) {
        logger.error(`[P2PSyncEngine] 推送变更失败:`, resource, error);
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
      return { isConflict: false, winner: "remote" };
    }

    const localVC = JSON.parse(localState.vector_clock || "{}");
    const remoteVC = remoteState.vector_clock || {};

    let localNewer = false;
    let remoteNewer = false;

    // 比较向量时钟
    const allDIDs = new Set([
      ...Object.keys(localVC),
      ...Object.keys(remoteVC),
    ]);

    for (const did of allDIDs) {
      const localV = localVC[did] || 0;
      const remoteV = remoteVC[did] || 0;

      if (localV > remoteV) {
        localNewer = true;
      }
      if (remoteV > localV) {
        remoteNewer = true;
      }
    }

    // 并发修改 = 冲突
    if (localNewer && remoteNewer) {
      return { isConflict: true, winner: null };
    }

    // 本地更新
    if (localNewer) {
      return { isConflict: false, winner: "local" };
    }

    // 远程更新
    if (remoteNewer) {
      return { isConflict: false, winner: "remote" };
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
  async recordConflict(
    orgId,
    resourceType,
    resourceId,
    localState,
    remoteChange,
  ) {
    const conflictId = uuidv4();
    const now = Date.now();

    // 获取本地数据
    const localData = await this.getResourceData(resourceType, resourceId);

    this.db.run(
      `
      INSERT INTO sync_conflicts
      (id, org_id, resource_type, resource_id, local_version, remote_version,
       local_data, remote_data, local_vector_clock, remote_vector_clock,
       resolution_strategy, resolved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
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
        now,
      ],
    );

    logger.info(`[P2PSyncEngine] 冲突已记录: ${conflictId}`);
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
  async resolveConflict(
    orgId,
    resourceType,
    resourceId,
    localState,
    remoteChange,
  ) {
    const strategy = this.getConflictResolutionStrategy(resourceType);

    logger.info(
      `[P2PSyncEngine] 解决冲突: ${resourceType}/${resourceId}, 策略: ${strategy}`,
    );

    switch (strategy) {
      case "lww":
        return await this.resolveLWW(
          orgId,
          resourceType,
          resourceId,
          localState,
          remoteChange,
        );

      case "manual":
        // 手动解决，不自动处理
        logger.info("[P2PSyncEngine] 需要手动解决冲突");
        return false;

      default:
        logger.warn(`[P2PSyncEngine] 未知冲突解决策略: ${strategy}`);
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
      winner = "remote";
      await this.applyResourceChange(
        resourceType,
        resourceId,
        remoteChange.action,
        remoteChange.data,
      );
    } else {
      winner = "local";
      // 保持本地数据
    }

    // 更新冲突记录
    this.db.run(
      `
      UPDATE sync_conflicts
      SET resolution_strategy = 'lww',
          resolved = 1,
          resolved_at = ?,
          resolved_by_did = 'system'
      WHERE org_id = ? AND resource_type = ? AND resource_id = ? AND resolved = 0
    `,
      [Date.now(), orgId, resourceType, resourceId],
    );

    // 更新同步状态
    this.updateSyncState(orgId, resourceType, resourceId, {
      sync_status: "synced",
      last_synced_at: Date.now(),
    });

    logger.info(`[P2PSyncEngine] LWW冲突已解决, 获胜者: ${winner}`);
    return true;
  }

  /**
   * 获取冲突解决策略
   * @param {string} resourceType - 资源类型
   * @returns {string} 策略名称
   */
  getConflictResolutionStrategy(resourceType) {
    const strategies = {
      knowledge: "manual", // 知识库需要手动解决（重要内容）
      member: "lww", // 成员信息使用 LWW
      role: "manual", // 角色配置需要手动解决
      settings: "manual", // 组织设置需要手动解决
      project: "lww", // 项目元数据使用 LWW
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
    return (
      this.db
        .prepare(
          `
      SELECT * FROM p2p_sync_state
      WHERE org_id = ? AND resource_type = ? AND resource_id = ?
    `,
        )
        .get(orgId, resourceType, resourceId) || null
    );
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
      const fields = Object.keys(updates)
        .map((k) => `${k} = ?`)
        .join(", ");
      const values = [
        ...Object.values(updates),
        orgId,
        resourceType,
        resourceId,
      ];

      this.db.run(
        `
        UPDATE p2p_sync_state
        SET ${fields}
        WHERE org_id = ? AND resource_type = ? AND resource_id = ?
      `,
        values,
      );
    } else {
      // 插入
      this.db.run(
        `
        INSERT INTO p2p_sync_state
        (id, org_id, resource_type, resource_id, local_version, remote_version, vector_clock, sync_status, last_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          uuidv4(),
          orgId,
          resourceType,
          resourceId,
          updates.local_version || 1,
          updates.remote_version || 1,
          updates.vector_clock || "{}",
          updates.sync_status || "synced",
          updates.last_synced_at || Date.now(),
        ],
      );
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
      knowledge: "knowledge_items",
      project: "projects",
      member: "organization_members",
      role: "organization_roles",
    };

    const table = tableMap[resourceType];
    if (!table) {
      logger.warn(`[P2PSyncEngine] 未知资源类型: ${resourceType}`);
      return null;
    }

    return this.db
      .prepare(`SELECT * FROM ${table} WHERE id = ?`)
      .get(resourceId);
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
      knowledge: "knowledge_items",
      project: "projects",
      member: "organization_members",
      role: "organization_roles",
    };

    const table = tableMap[resourceType];
    if (!table) {
      throw new Error(`未知资源类型: ${resourceType}`);
    }

    if (action === "delete") {
      this.db.run(`DELETE FROM ${table} WHERE id = ?`, [resourceId]);
    } else {
      // create or update
      const fields = Object.keys(data);
      const placeholders = fields.map(() => "?").join(", ");
      const values = Object.values(data);

      this.db.run(
        `
        INSERT OR REPLACE INTO ${table} (${fields.join(", ")})
        VALUES (${placeholders})
      `,
        values,
      );
    }

    logger.info(
      `[P2PSyncEngine] 资源变更已应用: ${action} ${resourceType}/${resourceId}`,
    );
  }

  /**
   * 签名消息
   * @param {Object} message - 消息对象
   * @returns {Promise<string>} 签名
   */
  async signMessage(message) {
    const content = JSON.stringify(message);

    // 尝试使用 DID 私钥进行签名
    if (this.didManager && typeof this.didManager.signData === "function") {
      try {
        const signature = await this.didManager.signData(content);
        return signature;
      } catch (error) {
        logger.warn(
          "[P2PSyncEngine] DID 签名失败，使用哈希签名:",
          error.message,
        );
      }
    }

    // 后备：使用 SHA-256 哈希作为简化签名
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /**
   * 验证消息签名
   * @param {Object} message - 消息对象
   * @returns {Promise<boolean>} 是否有效
   */
  async verifyMessage(message) {
    const { signature, sender_did, ...content } = message;

    if (!signature || !sender_did) {
      logger.warn("[P2PSyncEngine] 消息缺少签名或发送者DID");
      return false;
    }

    // 尝试使用 DID 公钥验证签名
    if (
      this.didManager &&
      typeof this.didManager.verifySignature === "function"
    ) {
      try {
        const isValid = await this.didManager.verifySignature(
          JSON.stringify(content),
          signature,
          sender_did,
        );
        return isValid;
      } catch (error) {
        logger.warn("[P2PSyncEngine] DID 签名验证失败:", error.message);
      }
    }

    // 后备：验证哈希签名
    const expectedHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(content))
      .digest("hex");
    return signature === expectedHash;
  }

  // ========== P2P 消息处理器 ==========

  /**
   * 处理同步请求
   * @param {Object} message - 同步请求消息
   * @param {string} senderPeerId - 发送者的 Peer ID
   */
  async handleSyncRequest(message, senderPeerId = null) {
    logger.info("[P2PSyncEngine] 收到同步请求:", message);

    const { org_id, last_sync_time, resource_types, request_id } = message;

    // 获取变更列表
    const changes = await this.getChangesSince(
      org_id,
      last_sync_time,
      resource_types,
    );

    // 构建响应
    const response = {
      type: "sync:response",
      request_id,
      org_id,
      changes,
      sender_did: this.localDID,
      timestamp: Date.now(),
    };

    // 签名响应
    response.signature = await this.signMessage(response);

    // 发送给请求者
    if (senderPeerId && this.p2pManager) {
      try {
        await this.p2pManager.sendToTarget(senderPeerId, response);
        logger.info(
          `[P2PSyncEngine] ✓ 同步响应已发送给 ${senderPeerId}: ${changes.length} 条变更`,
        );
      } catch (error) {
        logger.error("[P2PSyncEngine] 发送同步响应失败:", error);
      }
    } else {
      logger.warn("[P2PSyncEngine] 无法发送响应：缺少发送者信息");
    }

    return response;
  }

  /**
   * 处理同步响应
   * @param {Object} message - 同步响应消息
   */
  async handleSyncResponse(message) {
    logger.info("[P2PSyncEngine] 收到同步响应:", message);

    const { request_id, org_id, changes, sender_did } = message;

    // 如果有对应的请求收集器，添加响应
    if (request_id && this.pendingRequests.has(request_id)) {
      const collector = this.pendingRequests.get(request_id);
      collector.addResponse({
        senderDID: sender_did,
        changes: changes || [],
        timestamp: message.timestamp || Date.now(),
      });
      logger.info(`[P2PSyncEngine] 响应已添加到收集器: ${request_id}`);
      return;
    }

    // 兼容旧版本：直接应用远程变更
    if (changes && changes.length > 0) {
      logger.info(`[P2PSyncEngine] 直接应用远程变更: ${changes.length} 条`);
      await this.applyRemoteChanges(org_id, changes);
    }
  }

  /**
   * 处理同步变更
   * @param {Object} message - 同步变更消息
   */
  async handleSyncChange(message) {
    logger.info("[P2PSyncEngine] 收到同步变更:", message);

    const { org_id } = message;

    // 验证签名
    const isValid = await this.verifyMessage(message);
    if (!isValid) {
      logger.error("[P2PSyncEngine] 消息签名验证失败");
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
    logger.info("[P2PSyncEngine] 收到同步冲突:", message);

    const {
      org_id,
      resource_type,
      resource_id,
      local_version,
      remote_version,
    } = message;

    // 记录冲突到数据库
    try {
      this.db
        .prepare(
          `
        INSERT INTO sync_conflicts (
          id, org_id, resource_type, resource_id,
          local_version, remote_version, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      `,
        )
        .run(
          uuidv4(),
          org_id,
          resource_type,
          resource_id,
          JSON.stringify(local_version),
          JSON.stringify(remote_version),
          Date.now(),
        );
    } catch (error) {
      logger.error("[P2PSyncEngine] 记录冲突失败:", error);
    }

    // 发送通知给用户
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("sync:conflict", {
        orgId: org_id,
        resourceType: resource_type,
        resourceId: resource_id,
        localVersion: local_version,
        remoteVersion: remote_version,
        message: `同步冲突: ${resource_type} - ${resource_id}`,
      });
    }

    // 触发事件
    this.emit("conflict", {
      orgId: org_id,
      resourceType: resource_type,
      resourceId: resource_id,
      localVersion: local_version,
      remoteVersion: remote_version,
    });
  }

  /**
   * 获取指定时间之后的变更
   * @param {string} orgId - 组织ID
   * @param {number} sinceTime - 起始时间戳
   * @param {Array} resourceTypes - 资源类型列表
   * @returns {Promise<Array>} 变更列表
   */
  async getChangesSince(
    orgId,
    sinceTime,
    resourceTypes = ["knowledge", "project", "member", "role"],
  ) {
    const changes = [];

    try {
      // 获取知识库变更
      if (resourceTypes.includes("knowledge")) {
        const knowledgeChanges = this.db
          .prepare(
            `
          SELECT id, 'knowledge' as resource_type, 'update' as action,
                 title, content, author_did, updated_at as timestamp
          FROM organization_knowledge
          WHERE org_id = ? AND updated_at > ? AND sync_status = 'synced'
          ORDER BY updated_at ASC
          LIMIT 500
        `,
          )
          .all(orgId, sinceTime);

        changes.push(
          ...knowledgeChanges.map((k) => ({
            id: k.id,
            resourceType: "knowledge",
            resourceId: k.id,
            action: k.action,
            data: { title: k.title, content: k.content },
            authorDID: k.author_did,
            timestamp: k.timestamp,
          })),
        );
      }

      // 获取成员变更
      if (resourceTypes.includes("member")) {
        const memberChanges = this.db
          .prepare(
            `
          SELECT member_did as id, 'member' as resource_type,
                 role, status, joined_at, updated_at as timestamp
          FROM organization_members
          WHERE org_id = ? AND updated_at > ?
          ORDER BY updated_at ASC
          LIMIT 200
        `,
          )
          .all(orgId, sinceTime);

        changes.push(
          ...memberChanges.map((m) => ({
            id: m.id,
            resourceType: "member",
            resourceId: m.id,
            action: "update",
            data: { role: m.role, status: m.status, joinedAt: m.joined_at },
            timestamp: m.timestamp,
          })),
        );
      }

      // 获取角色变更
      if (resourceTypes.includes("role")) {
        const roleChanges = this.db
          .prepare(
            `
          SELECT id, 'role' as resource_type, name, permissions, updated_at as timestamp
          FROM organization_roles
          WHERE org_id = ? AND updated_at > ?
          ORDER BY updated_at ASC
          LIMIT 100
        `,
          )
          .all(orgId, sinceTime);

        changes.push(
          ...roleChanges.map((r) => ({
            id: r.id,
            resourceType: "role",
            resourceId: r.id,
            action: "update",
            data: {
              name: r.name,
              permissions: JSON.parse(r.permissions || "[]"),
            },
            timestamp: r.timestamp,
          })),
        );
      }

      // 按时间排序
      changes.sort((a, b) => a.timestamp - b.timestamp);

      logger.info(
        `[P2PSyncEngine] 获取到 ${changes.length} 条变更 (since ${new Date(sinceTime).toISOString()})`,
      );
      return changes;
    } catch (error) {
      logger.error("[P2PSyncEngine] 获取变更失败:", error);
      return [];
    }
  }

  /**
   * 处理离线队列
   * @param {string} orgId - 组织ID
   * @returns {Promise<number>} 处理数量
   */
  async processQueue(orgId) {
    const items = this.db
      .prepare(
        `
      SELECT * FROM sync_queue
      WHERE org_id = ? AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 100
    `,
      )
      .all(orgId);

    if (items.length === 0) {
      return 0;
    }

    logger.info(`[P2PSyncEngine] 处理离线队列: ${items.length} 项`);

    let processed = 0;

    for (const item of items) {
      try {
        // 标记为处理中
        this.db
          .prepare(
            `
          UPDATE sync_queue SET status = 'processing' WHERE id = ?
        `,
          )
          .run(item.id);

        // 解析队列项数据
        const data = JSON.parse(item.data || "{}");

        // 根据操作类型执行同步
        const syncMessage = {
          type: "sync:change",
          org_id: item.org_id,
          resource_type: item.resource_type,
          resource_id: item.resource_id,
          action: item.action,
          data,
          sender_did: this.localDID,
          timestamp: item.created_at,
        };

        // 签名消息
        syncMessage.signature = await this.signMessage(syncMessage);

        // 广播到组织网络
        if (this.p2pManager) {
          await this.p2pManager.broadcastToOrg(item.org_id, syncMessage);
          logger.info(
            `[P2PSyncEngine] ✓ 队列项已同步: ${item.resource_type}/${item.resource_id}`,
          );
        }

        // 标记为完成
        this.db
          .prepare(
            `
          UPDATE sync_queue SET status = 'completed', completed_at = ? WHERE id = ?
        `,
          )
          .run(Date.now(), item.id);

        processed++;
      } catch (error) {
        logger.error("[P2PSyncEngine] 队列项处理失败:", item, error);

        // 更新重试计数
        const retryCount = item.retry_count + 1;

        if (retryCount >= this.config.maxRetryCount) {
          // 超过最大重试次数，标记为失败
          this.db.run(
            `
            UPDATE sync_queue
            SET status = 'failed', retry_count = ?, last_retry_at = ?
            WHERE id = ?
          `,
            [retryCount, Date.now(), item.id],
          );
        } else {
          // 重新标记为待处理
          this.db.run(
            `
            UPDATE sync_queue
            SET status = 'pending', retry_count = ?, last_retry_at = ?
            WHERE id = ?
          `,
            [retryCount, Date.now(), item.id],
          );
        }
      }
    }

    logger.info(
      `[P2PSyncEngine] ✓ 离线队列处理完成: ${processed}/${items.length}`,
    );
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

    this.db.run(
      `
      INSERT INTO sync_queue
      (id, org_id, action, resource_type, resource_id, data, version, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        id,
        orgId,
        action,
        resourceType,
        resourceId,
        JSON.stringify(data),
        version,
        now,
        "pending",
      ],
    );

    logger.info(`[P2PSyncEngine] 已添加到离线队列: ${id}`);
    return id;
  }

  /**
   * 获取同步统计
   * @param {string} orgId - 组织ID
   * @returns {Object} 统计信息
   */
  getSyncStats(orgId) {
    const stats = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN sync_status = 'synced' THEN 1 ELSE 0 END), 0) as synced,
        COALESCE(SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
        COALESCE(SUM(CASE WHEN sync_status = 'conflict' THEN 1 ELSE 0 END), 0) as conflicts,
        MAX(last_synced_at) as last_sync_time
      FROM p2p_sync_state
      WHERE org_id = ?
    `,
      )
      .get(orgId);

    const queueSize = this.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM sync_queue
      WHERE org_id = ? AND status IN ('pending', 'processing')
    `,
      )
      .get(orgId);

    return {
      ...stats,
      queue_size: queueSize.count || 0,
      last_sync_time: this.lastSyncTime,
    };
  }
}

module.exports = P2PSyncEngine;
