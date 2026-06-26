/**
 * OrganizationManager — p2pSync methods (prototype mixin).
 * Split verbatim from organization-manager.js; mixed into OrganizationManager.prototype.
 * Methods reference `this` exactly as before.
 *
 * @module organization/organization-manager-p2pSync
 */
const { logger } = require("../utils/logger.js");
const { OrgP2PNetwork } = require("./org-p2p-network");

// Tolerate a corrupt metadata column so one malformed change doesn't throw out
// of the sync-payload .map and break the whole sync response.
function safeParseMetadata(raw) {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

module.exports = {
  async initializeOrgP2PNetwork(orgId) {
    if (!this.orgP2PNetwork) {
      logger.warn("[OrganizationManager] OrgP2PNetwork未初始化，跳过网络设置");
      return;
    }

    try {
      logger.info("[OrganizationManager] 初始化组织P2P网络:", orgId);

      // 使用新的P2P网络模块初始化
      await this.orgP2PNetwork.initialize(orgId);

      logger.info("[OrganizationManager] ✓ 组织P2P网络初始化完成");
    } catch (error) {
      logger.error("[OrganizationManager] P2P网络初始化失败:", error);
      // 不抛出错误，允许组织创建继续
    }
  },

  async connectToOrgP2PNetwork(orgId) {
    if (!this.orgP2PNetwork) {
      logger.warn("[OrganizationManager] OrgP2PNetwork未初始化，跳过连接");
      return;
    }

    try {
      logger.info("[OrganizationManager] 连接到组织P2P网络:", orgId);

      // 初始化网络订阅
      await this.orgP2PNetwork.initialize(orgId);

      logger.info("[OrganizationManager] ✓ 已连接到组织P2P网络");
    } catch (error) {
      logger.error("[OrganizationManager] 连接P2P网络失败:", error);
    }
  },

  async handleOrgSyncMessage(orgId, message) {
    try {
      const data = JSON.parse(message.toString());
      logger.info("[OrganizationManager] 收到同步消息:", data.type);

      switch (data.type) {
        case "sync_request":
          // 收到同步请求,发送增量数据
          await this.sendIncrementalData(
            orgId,
            data.requester,
            data.localVersion,
          );
          break;

        case "sync_data":
          // 收到同步数据,应用到本地
          await this.applyIncrementalData(orgId, data);
          break;

        case "member_joined":
          // 成员加入通知
          logger.info("[OrganizationManager] 成员加入:", data.memberDID);
          break;

        case "member_updated":
          // 成员信息更新
          await this.syncMemberUpdate(orgId, data);
          break;

        case "knowledge_created":
        case "knowledge_updated":
        case "knowledge_deleted":
          // 知识库变更
          await this.syncKnowledgeChange(orgId, data);
          break;

        default:
          logger.warn("[OrganizationManager] 未知的同步消息类型:", data.type);
      }
    } catch (error) {
      logger.error("[OrganizationManager] 处理同步消息失败:", error);
    }
  },

  async broadcastOrgMessage(orgId, data) {
    if (!this.p2pManager || !this.p2pManager.node?.services?.pubsub) {
      logger.warn("[OrganizationManager] P2P网络未就绪，无法广播消息");
      return;
    }

    try {
      const topic = `org_${orgId}_sync`;
      const message = Buffer.from(JSON.stringify(data));

      await this.p2pManager.node.services.pubsub.publish(topic, message);
      logger.info("[OrganizationManager] ✓ 已广播消息:", data.type);
    } catch (error) {
      logger.error("[OrganizationManager] 广播消息失败:", error);
    }
  },

  async requestIncrementalSync(orgId) {
    try {
      // 获取本地最新版本号
      const localVersion = await this.getLocalVersion(orgId);

      // 广播同步请求
      await this.broadcastOrgMessage(orgId, {
        type: "sync_request",
        orgId: orgId,
        requester: await this.didManager.getCurrentDID(),
        localVersion: localVersion,
        timestamp: Date.now(),
      });

      logger.info(
        "[OrganizationManager] ✓ 已请求增量同步，本地版本:",
        localVersion,
      );
    } catch (error) {
      logger.error("[OrganizationManager] 请求同步失败:", error);
    }
  },

  async getLocalVersion(orgId) {
    try {
      const result = this.db
        .prepare(
          `SELECT MAX(timestamp) as max_timestamp FROM organization_activities WHERE org_id = ?`,
        )
        .get(orgId);

      return result?.max_timestamp || 0;
    } catch (error) {
      logger.error("[OrganizationManager] 获取本地版本失败:", error);
      return 0;
    }
  },

  async sendIncrementalData(orgId, targetDID, sinceVersion) {
    try {
      // 查询大于sinceVersion的所有变更
      const changes = this.db
        .prepare(
          `SELECT * FROM organization_activities
         WHERE org_id = ? AND timestamp > ?
         ORDER BY timestamp ASC
         LIMIT 100`,
        )
        .all(orgId, sinceVersion);

      if (changes.length === 0) {
        logger.info("[OrganizationManager] 没有新数据需要同步");
        return;
      }

      // 获取相关的完整数据
      const syncData = {
        type: "sync_data",
        orgId: orgId,
        sender: await this.didManager.getCurrentDID(),
        sinceVersion: sinceVersion,
        toVersion: await this.getLocalVersion(orgId),
        changes: changes.map((change) => ({
          ...change,
          metadata: safeParseMetadata(change.metadata),
        })),
        timestamp: Date.now(),
      };

      // 直接发送给请求者
      await this.p2pManager.sendEncryptedMessage(
        targetDID,
        JSON.stringify(syncData),
      );
      logger.info(
        "[OrganizationManager] ✓ 已发送增量数据，共",
        changes.length,
        "条变更",
      );
    } catch (error) {
      logger.error("[OrganizationManager] 发送增量数据失败:", error);
    }
  },

  async applyIncrementalData(orgId, syncData) {
    const { changes } = syncData;

    logger.info(
      "[OrganizationManager] 应用增量数据，共",
      changes.length,
      "条变更",
    );

    for (const change of changes) {
      try {
        // 检查是否有冲突
        const hasConflict = await this.checkConflict(orgId, change);

        if (hasConflict) {
          await this.resolveConflict(orgId, change);
          continue;
        }

        // 应用变更
        await this.applyChange(orgId, change);
      } catch (error) {
        logger.error("[OrganizationManager] 应用变更失败:", change, error);
      }
    }

    logger.info("[OrganizationManager] ✓ 增量数据应用完成");
  },

  async checkConflict(orgId, change) {
    try {
      const { resource_type, resource_id, timestamp } = change;

      // 查询本地是否有更新的版本
      const localActivity = this.db
        .prepare(
          `SELECT timestamp FROM organization_activities
         WHERE org_id = ? AND resource_type = ? AND resource_id = ?
         ORDER BY timestamp DESC LIMIT 1`,
        )
        .get(orgId, resource_type, resource_id);

      if (localActivity && localActivity.timestamp > timestamp) {
        logger.warn(
          "[OrganizationManager] 检测到冲突:",
          resource_type,
          resource_id,
        );
        return true;
      }

      return false;
    } catch (error) {
      logger.error("[OrganizationManager] 冲突检查失败:", error);
      return false;
    }
  },

  async resolveConflict(orgId, change) {
    logger.info("[OrganizationManager] 解决冲突:", change.action);

    // 策略1: Last-Write-Wins (保留时间戳更新的版本)
    const localActivity = this.db
      .prepare(
        `SELECT timestamp FROM organization_activities
       WHERE org_id = ? AND resource_type = ? AND resource_id = ?
       ORDER BY timestamp DESC LIMIT 1`,
      )
      .get(orgId, change.resource_type, change.resource_id);

    if (!localActivity || change.timestamp > localActivity.timestamp) {
      // 远程更新,覆盖本地
      await this.applyChange(orgId, change);
      logger.info("[OrganizationManager] ✓ 冲突已解决: 应用远程版本");
    } else {
      // 本地更新,保留本地
      logger.info("[OrganizationManager] ✓ 冲突已解决: 保留本地版本");
    }
  },

  async applyChange(orgId, change) {
    const { action, resource_type, resource_id, metadata } = change;

    logger.info(
      "[OrganizationManager] 应用变更:",
      action,
      resource_type,
      resource_id,
    );

    switch (action) {
      case "update_member_role":
        await this.db.run(
          `UPDATE organization_members SET role = ? WHERE org_id = ? AND member_did = ?`,
          [metadata.new_role, orgId, resource_id],
        );
        break;

      case "remove_member":
        await this.db.run(
          `UPDATE organization_members SET status = 'removed' WHERE org_id = ? AND member_did = ?`,
          [orgId, resource_id],
        );
        break;

      case "add_member": {
        // 检查成员是否已存在
        const existingMember = this.db
          .prepare(
            `SELECT id FROM organization_members WHERE org_id = ? AND member_did = ?`,
          )
          .get(orgId, metadata.member_did);

        if (!existingMember) {
          await this.db.run(
            `INSERT INTO organization_members (id, org_id, member_did, display_name, role, joined_at, status)
             VALUES (?, ?, ?, ?, ?, ?, 'active')`,
            [
              resource_id,
              orgId,
              metadata.member_did,
              metadata.display_name,
              metadata.role,
              metadata.joined_at,
            ],
          );
        }
        break;
      }

      default:
        logger.warn("[OrganizationManager] 未知的变更操作:", action);
    }

    // 记录到本地活动日志 (如果不存在)
    const existingActivity = this.db
      .prepare(`SELECT id FROM organization_activities WHERE id = ?`)
      .get(change.id);

    if (!existingActivity) {
      await this.db.run(
        `INSERT INTO organization_activities (id, org_id, actor_did, action, resource_type, resource_id, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          change.id,
          orgId,
          change.actor_did,
          action,
          resource_type,
          resource_id,
          JSON.stringify(metadata),
          change.timestamp,
        ],
      );
    }
  },

  async syncMemberUpdate(orgId, data) {
    try {
      const { memberDID, updates } = data;

      await this.db.run(
        `UPDATE organization_members SET display_name = ?, avatar = ?
         WHERE org_id = ? AND member_did = ?`,
        [updates.display_name, updates.avatar, orgId, memberDID],
      );

      logger.info("[OrganizationManager] ✓ 成员信息已同步:", memberDID);
    } catch (error) {
      logger.error("[OrganizationManager] 同步成员更新失败:", error);
    }
  },

  async syncKnowledgeChange(orgId, data) {
    try {
      const { type, knowledgeId, content, authorDID, timestamp } = data;
      logger.info("[OrganizationManager] 知识库变更:", type, knowledgeId);

      // 检查是否为本地已有的变更（避免重复应用）
      const existing = this.db
        .prepare(
          `
        SELECT id, updated_at FROM organization_knowledge
        WHERE org_id = ? AND knowledge_id = ?
      `,
        )
        .get(orgId, knowledgeId);

      if (existing && existing.updated_at >= timestamp) {
        logger.info(
          "[OrganizationManager] 跳过已同步的知识库变更:",
          knowledgeId,
        );
        return { skipped: true };
      }

      // 根据变更类型处理
      switch (type) {
        case "create":
          await this.createKnowledgeEntry(
            orgId,
            knowledgeId,
            content,
            authorDID,
            timestamp,
          );
          break;

        case "update":
          await this.updateKnowledgeEntry(
            orgId,
            knowledgeId,
            content,
            authorDID,
            timestamp,
          );
          break;

        case "delete":
          await this.deleteKnowledgeEntry(
            orgId,
            knowledgeId,
            authorDID,
            timestamp,
          );
          break;

        default:
          logger.warn("[OrganizationManager] 未知的知识库变更类型:", type);
          return { success: false, error: "未知变更类型" };
      }

      // 触发 RAG 索引更新（如果可用）
      try {
        const { getRAGManager } = require("../rag/rag-manager");
        const ragManager = getRAGManager();

        if (ragManager && ragManager.isInitialized) {
          if (type === "delete") {
            await ragManager.removeFromIndex(`org_knowledge_${knowledgeId}`);
          } else {
            await ragManager.addToIndex({
              id: `org_knowledge_${knowledgeId}`,
              title: content?.title || "",
              content: content?.content || "",
              type: "organization_knowledge",
              org_id: orgId,
              created_at: timestamp,
            });
          }
        }
      } catch (ragError) {
        logger.warn("[OrganizationManager] RAG索引更新失败:", ragError.message);
      }

      logger.info("[OrganizationManager] ✓ 知识库变更已应用:", knowledgeId);
      return { success: true };
    } catch (error) {
      logger.error("[OrganizationManager] 同步知识库变更失败:", error);
      return { success: false, error: error.message };
    }
  },

  async broadcastOrgP2PMessage(orgId, message) {
    if (!this.orgP2PNetwork) {
      throw new Error("OrgP2PNetwork未初始化");
    }
    await this.orgP2PNetwork.broadcastMessage(orgId, message);
  },

  getOrgNetworkStats(orgId) {
    if (!this.orgP2PNetwork) {
      return null;
    }
    return this.orgP2PNetwork.getNetworkStats(orgId);
  },

  async disconnectFromOrgP2PNetwork(orgId) {
    if (!this.orgP2PNetwork) {
      return;
    }
    await this.orgP2PNetwork.unsubscribeTopic(orgId);
  },
};
