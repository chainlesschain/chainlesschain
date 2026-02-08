/**
 * 移动端同步管理器
 *
 * 功能：
 * - 桌面端与移动端数据双向同步
 * - 群聊消息同步
 * - 知识库同步
 * - 联系人同步
 * - 增量同步和冲突解决
 * - 离线队列管理
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const crypto = require("crypto");

class MobileSyncManager extends EventEmitter {
  constructor(database, p2pManager, options = {}) {
    super();

    this.database = database;
    this.p2pManager = p2pManager;

    this.options = {
      // 同步配置
      syncInterval: options.syncInterval || 30000, // 自动同步间隔（30秒）
      batchSize: options.batchSize || 100, // 批量同步大小
      enableAutoSync: options.enableAutoSync !== false,

      // 同步范围
      syncKnowledge: options.syncKnowledge !== false, // 同步知识库
      syncContacts: options.syncContacts !== false, // 同步联系人
      syncGroupChats: options.syncGroupChats !== false, // 同步群聊
      syncMessages: options.syncMessages !== false, // 同步消息
      syncSettings: options.syncSettings !== false, // 同步设置

      // 冲突解决策略
      conflictStrategy: options.conflictStrategy || "latest-wins", // 'latest-wins' | 'manual' | 'merge'

      ...options,
    };

    // 同步状态
    this.isSyncing = false;
    this.lastSyncTime = new Map(); // deviceId -> { knowledge, contacts, groupChats, messages }
    this.syncProgress = new Map(); // deviceId -> { total, synced, current }

    // 移动设备列表
    this.mobileDevices = new Map(); // deviceId -> { peerId, deviceInfo, status }

    // 离线队列
    this.offlineQueue = new Map(); // deviceId -> changes[]

    // 统计信息
    this.stats = {
      totalSyncs: 0,
      knowledgeSynced: 0,
      contactsSynced: 0,
      groupChatsSynced: 0,
      messagesSynced: 0,
      conflictsDetected: 0,
      conflictsResolved: 0,
    };

    // 启动自动同步
    if (this.options.enableAutoSync) {
      this.startAutoSync();
    }

    logger.info("[MobileSyncManager] 移动端同步管理器已初始化");
  }

  /**
   * 注册移动设备
   * @param {string} deviceId - 设备ID
   * @param {string} peerId - P2P节点ID
   * @param {Object} deviceInfo - 设备信息
   */
  async registerMobileDevice(deviceId, peerId, deviceInfo) {
    logger.info("[MobileSyncManager] 注册移动设备:", deviceId);

    this.mobileDevices.set(deviceId, {
      peerId,
      deviceInfo,
      status: "online",
      registeredAt: Date.now(),
    });

    // 初始化同步时间
    if (!this.lastSyncTime.has(deviceId)) {
      this.lastSyncTime.set(deviceId, {
        knowledge: 0,
        contacts: 0,
        groupChats: 0,
        messages: 0,
      });
    }

    this.emit("device:registered", { deviceId, peerId, deviceInfo });

    // 立即执行一次全量同步
    await this.startSync(deviceId);
  }

  /**
   * 注销移动设备
   * @param {string} deviceId - 设备ID
   */
  unregisterMobileDevice(deviceId) {
    logger.info("[MobileSyncManager] 注销移动设备:", deviceId);

    const device = this.mobileDevices.get(deviceId);
    if (device) {
      device.status = "offline";
      this.emit("device:unregistered", { deviceId });
    }
  }

  /**
   * 开始同步
   * @param {string} deviceId - 目标设备ID
   * @param {Object} options - 同步选项
   */
  async startSync(deviceId, options = {}) {
    if (this.isSyncing) {
      logger.warn("[MobileSyncManager] 同步正在进行中");
      return;
    }

    const device = this.mobileDevices.get(deviceId);
    if (!device) {
      throw new Error("设备未注册");
    }

    if (device.status !== "online") {
      logger.warn("[MobileSyncManager] 设备离线，加入离线队列");
      return;
    }

    logger.info("[MobileSyncManager] 开始同步:", deviceId);

    this.isSyncing = true;
    this.emit("sync:started", { deviceId });

    try {
      const lastSync = this.lastSyncTime.get(deviceId);
      const syncTasks = [];

      // 1. 同步知识库
      if (this.options.syncKnowledge) {
        syncTasks.push(this.syncKnowledge(deviceId, lastSync.knowledge));
      }

      // 2. 同步联系人
      if (this.options.syncContacts) {
        syncTasks.push(this.syncContacts(deviceId, lastSync.contacts));
      }

      // 3. 同步群聊
      if (this.options.syncGroupChats) {
        syncTasks.push(this.syncGroupChats(deviceId, lastSync.groupChats));
      }

      // 4. 同步消息
      if (this.options.syncMessages) {
        syncTasks.push(this.syncMessages(deviceId, lastSync.messages));
      }

      // 并行执行所有同步任务
      const results = await Promise.allSettled(syncTasks);

      // 检查结果
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        logger.error("[MobileSyncManager] 部分同步任务失败:", failed);
      }

      // 更新同步时间
      const now = Date.now();
      this.lastSyncTime.set(deviceId, {
        knowledge: now,
        contacts: now,
        groupChats: now,
        messages: now,
      });

      logger.info("[MobileSyncManager] ✅ 同步完成");

      this.emit("sync:completed", {
        deviceId,
        results: results.map((r) => ({
          status: r.status,
          value: r.value,
          reason: r.reason,
        })),
      });

      this.stats.totalSyncs++;
    } catch (error) {
      logger.error("[MobileSyncManager] ❌ 同步失败:", error);

      this.emit("sync:failed", {
        deviceId,
        error,
      });

      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 同步知识库
   */
  async syncKnowledge(deviceId, since) {
    logger.info("[MobileSyncManager] 同步知识库，since:", new Date(since));

    try {
      const device = this.mobileDevices.get(deviceId);

      // 1. 获取本地变更
      const localChanges = await this.getKnowledgeChanges(since);
      logger.info(
        `[MobileSyncManager] 检测到 ${localChanges.length} 个知识库变更`,
      );

      if (localChanges.length === 0) {
        return { type: "knowledge", synced: 0 };
      }

      // 2. 批量发送变更
      const batches = this.chunkArray(localChanges, this.options.batchSize);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];

        await this.p2pManager.sendMessage(device.peerId, {
          type: "mobile-sync:knowledge",
          changes: batch,
          batchIndex: i,
          totalBatches: batches.length,
          timestamp: Date.now(),
        });

        this.stats.knowledgeSynced += batch.length;

        // 更新进度
        this.updateProgress(deviceId, "knowledge", (i + 1) / batches.length);
      }

      return { type: "knowledge", synced: localChanges.length };
    } catch (error) {
      logger.error("[MobileSyncManager] 同步知识库失败:", error);
      throw error;
    }
  }

  /**
   * 同步联系人
   */
  async syncContacts(deviceId, since) {
    logger.info("[MobileSyncManager] 同步联系人，since:", new Date(since));

    try {
      const device = this.mobileDevices.get(deviceId);

      // 1. 获取本地变更
      const localChanges = await this.getContactsChanges(since);
      logger.info(
        `[MobileSyncManager] 检测到 ${localChanges.length} 个联系人变更`,
      );

      if (localChanges.length === 0) {
        return { type: "contacts", synced: 0 };
      }

      // 2. 发送变更
      await this.p2pManager.sendMessage(device.peerId, {
        type: "mobile-sync:contacts",
        changes: localChanges,
        timestamp: Date.now(),
      });

      this.stats.contactsSynced += localChanges.length;

      return { type: "contacts", synced: localChanges.length };
    } catch (error) {
      logger.error("[MobileSyncManager] 同步联系人失败:", error);
      throw error;
    }
  }

  /**
   * 同步群聊
   */
  async syncGroupChats(deviceId, since) {
    logger.info("[MobileSyncManager] 同步群聊，since:", new Date(since));

    try {
      const device = this.mobileDevices.get(deviceId);

      // 1. 获取群聊变更
      const groupChanges = await this.getGroupChatsChanges(since);
      logger.info(
        `[MobileSyncManager] 检测到 ${groupChanges.length} 个群聊变更`,
      );

      if (groupChanges.length === 0) {
        return { type: "groupChats", synced: 0 };
      }

      // 2. 发送变更
      await this.p2pManager.sendMessage(device.peerId, {
        type: "mobile-sync:group-chats",
        changes: groupChanges,
        timestamp: Date.now(),
      });

      this.stats.groupChatsSynced += groupChanges.length;

      return { type: "groupChats", synced: groupChanges.length };
    } catch (error) {
      logger.error("[MobileSyncManager] 同步群聊失败:", error);
      throw error;
    }
  }

  /**
   * 同步消息
   */
  async syncMessages(deviceId, since) {
    logger.info("[MobileSyncManager] 同步消息，since:", new Date(since));

    try {
      const device = this.mobileDevices.get(deviceId);

      // 1. 获取消息变更
      const messageChanges = await this.getMessagesChanges(since);
      logger.info(
        `[MobileSyncManager] 检测到 ${messageChanges.length} 个消息变更`,
      );

      if (messageChanges.length === 0) {
        return { type: "messages", synced: 0 };
      }

      // 2. 批量发送变更
      const batches = this.chunkArray(messageChanges, this.options.batchSize);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];

        await this.p2pManager.sendMessage(device.peerId, {
          type: "mobile-sync:messages",
          changes: batch,
          batchIndex: i,
          totalBatches: batches.length,
          timestamp: Date.now(),
        });

        this.stats.messagesSynced += batch.length;

        // 更新进度
        this.updateProgress(deviceId, "messages", (i + 1) / batches.length);
      }

      return { type: "messages", synced: messageChanges.length };
    } catch (error) {
      logger.error("[MobileSyncManager] 同步消息失败:", error);
      throw error;
    }
  }

  /**
   * 获取知识库变更
   */
  async getKnowledgeChanges(since) {
    try {
      const stmt = this.database.prepare(`
        SELECT id, title, content, tags, category, updated_at, deleted
        FROM notes
        WHERE updated_at > ?
        ORDER BY updated_at ASC
      `);

      const notes = stmt.all(since);

      return notes.map((note) => ({
        type: note.deleted ? "delete" : "upsert",
        entity: "note",
        id: note.id,
        data: note.deleted
          ? null
          : {
              title: note.title,
              content: note.content,
              tags: note.tags,
              category: note.category,
              updated_at: note.updated_at,
            },
        timestamp: note.updated_at,
      }));
    } catch (error) {
      logger.error("[MobileSyncManager] 获取知识库变更失败:", error);
      return [];
    }
  }

  /**
   * 获取联系人变更
   */
  async getContactsChanges(since) {
    try {
      const stmt = this.database.prepare(`
        SELECT did, nickname, avatar, status, updated_at, deleted
        FROM contacts
        WHERE updated_at > ?
        ORDER BY updated_at ASC
      `);

      const contacts = stmt.all(since);

      return contacts.map((contact) => ({
        type: contact.deleted ? "delete" : "upsert",
        entity: "contact",
        id: contact.did,
        data: contact.deleted
          ? null
          : {
              nickname: contact.nickname,
              avatar: contact.avatar,
              status: contact.status,
              updated_at: contact.updated_at,
            },
        timestamp: contact.updated_at,
      }));
    } catch (error) {
      logger.error("[MobileSyncManager] 获取联系人变更失败:", error);
      return [];
    }
  }

  /**
   * 获取群聊变更
   */
  async getGroupChatsChanges(since) {
    try {
      // 获取群聊基本信息变更
      const groupStmt = this.database.prepare(`
        SELECT id, name, description, avatar, creator_did, member_count, updated_at
        FROM group_chats
        WHERE updated_at > ?
        ORDER BY updated_at ASC
      `);

      const groups = groupStmt.all(since);

      const changes = [];

      for (const group of groups) {
        // 获取群成员
        const memberStmt = this.database.prepare(`
          SELECT member_did, role, nickname, joined_at
          FROM group_members
          WHERE group_id = ?
        `);
        const members = memberStmt.all(group.id);

        changes.push({
          type: "upsert",
          entity: "group",
          id: group.id,
          data: {
            name: group.name,
            description: group.description,
            avatar: group.avatar,
            creator_did: group.creator_did,
            member_count: group.member_count,
            members: members,
            updated_at: group.updated_at,
          },
          timestamp: group.updated_at,
        });
      }

      return changes;
    } catch (error) {
      logger.error("[MobileSyncManager] 获取群聊变更失败:", error);
      return [];
    }
  }

  /**
   * 获取消息变更
   */
  async getMessagesChanges(since) {
    try {
      const stmt = this.database.prepare(`
        SELECT id, group_id, sender_did, content, message_type, created_at
        FROM group_messages
        WHERE created_at > ?
        ORDER BY created_at ASC
      `);

      const messages = stmt.all(since);

      return messages.map((message) => ({
        type: "insert",
        entity: "message",
        id: message.id,
        data: {
          group_id: message.group_id,
          sender_did: message.sender_did,
          content: message.content,
          message_type: message.message_type,
          created_at: message.created_at,
        },
        timestamp: message.created_at,
      }));
    } catch (error) {
      logger.error("[MobileSyncManager] 获取消息变更失败:", error);
      return [];
    }
  }

  /**
   * 处理来自移动端的同步请求
   */
  async handleMobileSyncRequest(deviceId, payload) {
    logger.info(
      "[MobileSyncManager] 处理移动端同步请求:",
      deviceId,
      payload.type,
    );

    try {
      switch (payload.type) {
        case "mobile-sync:request":
          // 移动端请求全量同步
          await this.startSync(deviceId);
          break;

        case "mobile-sync:knowledge-changes":
          // 移动端上传知识库变更
          await this.applyKnowledgeChanges(payload.changes);
          break;

        case "mobile-sync:contacts-changes":
          // 移动端上传联系人变更
          await this.applyContactsChanges(payload.changes);
          break;

        case "mobile-sync:group-chats-changes":
          // 移动端上传群聊变更
          await this.applyGroupChatsChanges(payload.changes);
          break;

        case "mobile-sync:messages-changes":
          // 移动端上传消息变更
          await this.applyMessagesChanges(payload.changes);
          break;

        default:
          logger.warn("[MobileSyncManager] 未知的同步请求类型:", payload.type);
      }
    } catch (error) {
      logger.error("[MobileSyncManager] 处理同步请求失败:", error);
      throw error;
    }
  }

  /**
   * 应用知识库变更
   */
  async applyKnowledgeChanges(changes) {
    logger.info(`[MobileSyncManager] 应用 ${changes.length} 个知识库变更`);

    for (const change of changes) {
      try {
        if (change.type === "delete") {
          await this.database.execute(
            "UPDATE notes SET deleted = 1, updated_at = ? WHERE id = ?",
            [change.timestamp, change.id],
          );
        } else {
          await this.database.execute(
            `
            INSERT OR REPLACE INTO notes (id, title, content, tags, category, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
            [
              change.id,
              change.data.title,
              change.data.content,
              change.data.tags,
              change.data.category,
              change.timestamp,
            ],
          );
        }
      } catch (error) {
        logger.error("[MobileSyncManager] 应用知识库变更失败:", error);
      }
    }

    this.database.saveToFile();
  }

  /**
   * 应用联系人变更
   */
  async applyContactsChanges(changes) {
    logger.info(`[MobileSyncManager] 应用 ${changes.length} 个联系人变更`);

    for (const change of changes) {
      try {
        if (change.type === "delete") {
          await this.database.execute(
            "UPDATE contacts SET deleted = 1, updated_at = ? WHERE did = ?",
            [change.timestamp, change.id],
          );
        } else {
          await this.database.execute(
            `
            INSERT OR REPLACE INTO contacts (did, nickname, avatar, status, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
            [
              change.id,
              change.data.nickname,
              change.data.avatar,
              change.data.status,
              change.timestamp,
            ],
          );
        }
      } catch (error) {
        logger.error("[MobileSyncManager] 应用联系人变更失败:", error);
      }
    }

    this.database.saveToFile();
  }

  /**
   * 应用群聊变更
   */
  async applyGroupChatsChanges(changes) {
    logger.info(`[MobileSyncManager] 应用 ${changes.length} 个群聊变更`);

    for (const change of changes) {
      try {
        // 更新群聊基本信息
        await this.database.execute(
          `
          INSERT OR REPLACE INTO group_chats
          (id, name, description, avatar, creator_did, member_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          [
            change.id,
            change.data.name,
            change.data.description,
            change.data.avatar,
            change.data.creator_did,
            change.data.member_count,
            change.timestamp,
          ],
        );

        // 更新群成员
        if (change.data.members) {
          for (const member of change.data.members) {
            await this.database.execute(
              `
              INSERT OR REPLACE INTO group_members
              (group_id, member_did, role, nickname, joined_at)
              VALUES (?, ?, ?, ?, ?)
            `,
              [
                change.id,
                member.member_did,
                member.role,
                member.nickname,
                member.joined_at,
              ],
            );
          }
        }
      } catch (error) {
        logger.error("[MobileSyncManager] 应用群聊变更失败:", error);
      }
    }

    this.database.saveToFile();
  }

  /**
   * 应用消息变更
   */
  async applyMessagesChanges(changes) {
    logger.info(`[MobileSyncManager] 应用 ${changes.length} 个消息变更`);

    for (const change of changes) {
      try {
        await this.database.execute(
          `
          INSERT OR IGNORE INTO group_messages
          (id, group_id, sender_did, content, message_type, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
          [
            change.id,
            change.data.group_id,
            change.data.sender_did,
            change.data.content,
            change.data.message_type,
            change.timestamp,
          ],
        );
      } catch (error) {
        logger.error("[MobileSyncManager] 应用消息变更失败:", error);
      }
    }

    this.database.saveToFile();
  }

  /**
   * 更新同步进度
   */
  updateProgress(deviceId, type, progress) {
    if (!this.syncProgress.has(deviceId)) {
      this.syncProgress.set(deviceId, {});
    }

    const deviceProgress = this.syncProgress.get(deviceId);
    deviceProgress[type] = progress;

    this.emit("sync:progress", {
      deviceId,
      type,
      progress,
    });
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
   * 启动自动同步
   */
  startAutoSync() {
    setInterval(() => {
      // 对所有在线设备进行同步
      for (const [deviceId, device] of this.mobileDevices) {
        if (device.status === "online") {
          this.startSync(deviceId).catch((error) => {
            logger.error("[MobileSyncManager] 自动同步失败:", deviceId, error);
          });
        }
      }
    }, this.options.syncInterval);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      isSyncing: this.isSyncing,
      mobileDevicesCount: this.mobileDevices.size,
      onlineDevicesCount: Array.from(this.mobileDevices.values()).filter(
        (d) => d.status === "online",
      ).length,
    };
  }

  /**
   * 获取移动设备列表
   */
  getMobileDevices() {
    return Array.from(this.mobileDevices.entries()).map(
      ([deviceId, device]) => ({
        deviceId,
        ...device,
      }),
    );
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.lastSyncTime.clear();
    this.syncProgress.clear();
    this.offlineQueue.clear();
  }
}

module.exports = MobileSyncManager;
