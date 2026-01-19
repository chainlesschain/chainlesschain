/**
 * 群聊同步管理器
 *
 * 功能：
 * - 群聊消息实时同步
 * - 群成员变更同步
 * - 群聊设置同步
 * - 离线消息队列
 * - 消息去重和顺序保证
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');
const crypto = require('crypto');

class GroupChatSyncManager extends EventEmitter {
  constructor(database, p2pManager, groupChatManager, options = {}) {
    super();

    this.database = database;
    this.p2pManager = p2pManager;
    this.groupChatManager = groupChatManager;

    this.options = {
      // 同步配置
      enableRealTimeSync: options.enableRealTimeSync !== false,
      messageQueueSize: options.messageQueueSize || 1000,
      syncBatchSize: options.syncBatchSize || 50,

      // 消息去重
      enableDeduplication: options.enableDeduplication !== false,
      deduplicationWindow: options.deduplicationWindow || 300000, // 5分钟

      ...options
    };

    // 消息队列（按群组ID分组）
    this.messageQueues = new Map(); // groupId -> messages[]

    // 消息去重缓存
    this.messageCache = new Map(); // messageId -> timestamp

    // 同步状态
    this.syncStatus = new Map(); // groupId -> { lastSyncTime, isSyncing }

    // 群成员在线状态
    this.memberOnlineStatus = new Map(); // groupId -> Map<memberDid, status>

    // 统计信息
    this.stats = {
      messagesSynced: 0,
      messagesQueued: 0,
      messagesDeduplicated: 0,
      memberChangesSynced: 0,
      groupSettingsSynced: 0
    };

    // 启动实时同步
    if (this.options.enableRealTimeSync) {
      this.startRealTimeSync();
    }

    // 启动定期清理
    this.startCleanup();

    logger.info('[GroupChatSyncManager] 群聊同步管理器已初始化');
  }

  /**
   * 同步群聊消息
   * @param {string} groupId - 群聊ID
   * @param {Object} message - 消息对象
   */
  async syncMessage(groupId, message) {
    logger.info('[GroupChatSyncManager] 同步群聊消息:', groupId, message.id);

    try {
      // 1. 消息去重
      if (this.options.enableDeduplication) {
        if (this.isDuplicateMessage(message.id)) {
          logger.info('[GroupChatSyncManager] 消息已存在，跳过:', message.id);
          this.stats.messagesDeduplicated++;
          return;
        }
      }

      // 2. 保存到数据库
      await this.saveMessage(groupId, message);

      // 3. 获取群成员列表
      const members = await this.getGroupMembers(groupId);

      // 4. 向所有在线成员发送消息
      const onlineMembers = members.filter(m => this.isMemberOnline(groupId, m.member_did));

      for (const member of onlineMembers) {
        try {
          await this.sendMessageToMember(member.member_did, {
            type: 'group-chat:message',
            groupId,
            message
          });
        } catch (error) {
          logger.error('[GroupChatSyncManager] 发送消息失败:', member.member_did, error);
          // 加入离线队列
          this.queueMessage(groupId, member.member_did, message);
        }
      }

      // 5. 为离线成员加入队列
      const offlineMembers = members.filter(m => !this.isMemberOnline(groupId, m.member_did));
      for (const member of offlineMembers) {
        this.queueMessage(groupId, member.member_did, message);
      }

      // 6. 添加到去重缓存
      if (this.options.enableDeduplication) {
        this.messageCache.set(message.id, Date.now());
      }

      this.stats.messagesSynced++;

      this.emit('message:synced', { groupId, messageId: message.id });

      logger.info('[GroupChatSyncManager] ✅ 消息同步完成');

    } catch (error) {
      logger.error('[GroupChatSyncManager] ❌ 同步消息失败:', error);
      throw error;
    }
  }

  /**
   * 同步群成员变更
   * @param {string} groupId - 群聊ID
   * @param {Object} change - 变更对象
   */
  async syncMemberChange(groupId, change) {
    logger.info('[GroupChatSyncManager] 同步群成员变更:', groupId, change.type);

    try {
      // 1. 获取群成员列表
      const members = await this.getGroupMembers(groupId);

      // 2. 向所有成员广播变更
      for (const member of members) {
        try {
          await this.sendMessageToMember(member.member_did, {
            type: 'group-chat:member-change',
            groupId,
            change
          });
        } catch (error) {
          logger.error('[GroupChatSyncManager] 发送成员变更失败:', member.member_did, error);
        }
      }

      this.stats.memberChangesSynced++;

      this.emit('member-change:synced', { groupId, change });

      logger.info('[GroupChatSyncManager] ✅ 成员变更同步完成');

    } catch (error) {
      logger.error('[GroupChatSyncManager] ❌ 同步成员变更失败:', error);
      throw error;
    }
  }

  /**
   * 同步群聊设置
   * @param {string} groupId - 群聊ID
   * @param {Object} settings - 设置对象
   */
  async syncGroupSettings(groupId, settings) {
    logger.info('[GroupChatSyncManager] 同步群聊设置:', groupId);

    try {
      // 1. 更新数据库
      await this.updateGroupSettings(groupId, settings);

      // 2. 获取群成员列表
      const members = await this.getGroupMembers(groupId);

      // 3. 向所有成员广播设置变更
      for (const member of members) {
        try {
          await this.sendMessageToMember(member.member_did, {
            type: 'group-chat:settings-change',
            groupId,
            settings
          });
        } catch (error) {
          logger.error('[GroupChatSyncManager] 发送设置变更失败:', member.member_did, error);
        }
      }

      this.stats.groupSettingsSynced++;

      this.emit('settings:synced', { groupId, settings });

      logger.info('[GroupChatSyncManager] ✅ 群聊设置同步完成');

    } catch (error) {
      logger.error('[GroupChatSyncManager] ❌ 同步群聊设置失败:', error);
      throw error;
    }
  }

  /**
   * 请求群聊历史消息
   * @param {string} groupId - 群聊ID
   * @param {number} since - 起始时间戳
   * @param {number} limit - 消息数量限制
   */
  async requestHistory(groupId, since = 0, limit = 100) {
    logger.info('[GroupChatSyncManager] 请求群聊历史消息:', groupId, since, limit);

    try {
      const stmt = this.database.prepare(`
        SELECT *
        FROM group_messages
        WHERE group_id = ? AND created_at > ?
        ORDER BY created_at ASC
        LIMIT ?
      `);

      const messages = stmt.all(groupId, since, limit);

      return messages || [];

    } catch (error) {
      logger.error('[GroupChatSyncManager] ❌ 请求历史消息失败:', error);
      return [];
    }
  }

  /**
   * 处理来自移动端的群聊同步请求
   */
  async handleMobileSyncRequest(peerId, payload) {
    logger.info('[GroupChatSyncManager] 处理移动端群聊同步请求:', payload.type);

    try {
      switch (payload.type) {
        case 'group-chat:request-history':
          // 请求历史消息
          const history = await this.requestHistory(
            payload.groupId,
            payload.since,
            payload.limit
          );

          await this.p2pManager.sendMessage(peerId, {
            type: 'group-chat:history-response',
            groupId: payload.groupId,
            messages: history
          });
          break;

        case 'group-chat:send-message':
          // 移动端发送消息
          await this.syncMessage(payload.groupId, payload.message);
          break;

        case 'group-chat:member-status':
          // 更新成员在线状态
          this.updateMemberStatus(payload.groupId, payload.memberDid, payload.status);
          break;

        default:
          logger.warn('[GroupChatSyncManager] 未知的同步请求类型:', payload.type);
      }

    } catch (error) {
      logger.error('[GroupChatSyncManager] ❌ 处理同步请求失败:', error);
    }
  }

  /**
   * 保存消息到数据库
   */
  async saveMessage(groupId, message) {
    try {
      const stmt = this.database.prepare(`
        INSERT OR IGNORE INTO group_messages
        (id, group_id, sender_did, content, message_type, created_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        message.id,
        groupId,
        message.sender_did,
        message.content,
        message.message_type || 'text',
        message.created_at || Date.now(),
        message.status || 'sent'
      );

      this.database.saveToFile();

    } catch (error) {
      logger.error('[GroupChatSyncManager] 保存消息失败:', error);
      throw error;
    }
  }

  /**
   * 获取群成员列表
   */
  async getGroupMembers(groupId) {
    try {
      const stmt = this.database.prepare(`
        SELECT member_did, role, nickname
        FROM group_members
        WHERE group_id = ?
      `);

      return stmt.all(groupId) || [];

    } catch (error) {
      logger.error('[GroupChatSyncManager] 获取群成员失败:', error);
      return [];
    }
  }

  /**
   * 更新群聊设置
   */
  async updateGroupSettings(groupId, settings) {
    try {
      const updates = [];
      const values = [];

      if (settings.name !== undefined) {
        updates.push('name = ?');
        values.push(settings.name);
      }

      if (settings.description !== undefined) {
        updates.push('description = ?');
        values.push(settings.description);
      }

      if (settings.avatar !== undefined) {
        updates.push('avatar = ?');
        values.push(settings.avatar);
      }

      if (updates.length === 0) {
        return;
      }

      updates.push('updated_at = ?');
      values.push(Date.now());

      values.push(groupId);

      const stmt = this.database.prepare(`
        UPDATE group_chats
        SET ${updates.join(', ')}
        WHERE id = ?
      `);

      stmt.run(...values);

      this.database.saveToFile();

    } catch (error) {
      logger.error('[GroupChatSyncManager] 更新群聊设置失败:', error);
      throw error;
    }
  }

  /**
   * 发送消息给成员
   */
  async sendMessageToMember(memberDid, message) {
    // 通过P2P网络发送消息
    // 这里需要根据memberDid获取对应的peerId
    // 简化处理，假设memberDid就是peerId
    await this.p2pManager.sendMessage(memberDid, message);
  }

  /**
   * 将消息加入队列
   */
  queueMessage(groupId, memberDid, message) {
    const queueKey = `${groupId}:${memberDid}`;

    if (!this.messageQueues.has(queueKey)) {
      this.messageQueues.set(queueKey, []);
    }

    const queue = this.messageQueues.get(queueKey);

    // 检查队列大小
    if (queue.length >= this.options.messageQueueSize) {
      logger.warn('[GroupChatSyncManager] 消息队列已满，移除最旧的消息');
      queue.shift();
    }

    queue.push(message);

    this.stats.messagesQueued++;

    logger.info('[GroupChatSyncManager] 消息已加入队列:', queueKey, queue.length);
  }

  /**
   * 刷新消息队列
   */
  async flushMessageQueue(groupId, memberDid) {
    const queueKey = `${groupId}:${memberDid}`;
    const queue = this.messageQueues.get(queueKey);

    if (!queue || queue.length === 0) {
      return;
    }

    logger.info('[GroupChatSyncManager] 刷新消息队列:', queueKey, queue.length);

    try {
      // 批量发送消息
      const batches = this.chunkArray(queue, this.options.syncBatchSize);

      for (const batch of batches) {
        await this.sendMessageToMember(memberDid, {
          type: 'group-chat:batch-messages',
          groupId,
          messages: batch
        });
      }

      // 清空队列
      this.messageQueues.delete(queueKey);

      logger.info('[GroupChatSyncManager] ✅ 消息队列已刷新');

    } catch (error) {
      logger.error('[GroupChatSyncManager] ❌ 刷新消息队列失败:', error);
    }
  }

  /**
   * 检查是否为重复消息
   */
  isDuplicateMessage(messageId) {
    return this.messageCache.has(messageId);
  }

  /**
   * 检查成员是否在线
   */
  isMemberOnline(groupId, memberDid) {
    const groupStatus = this.memberOnlineStatus.get(groupId);
    if (!groupStatus) {
      return false;
    }

    const status = groupStatus.get(memberDid);
    return status === 'online';
  }

  /**
   * 更新成员在线状态
   */
  updateMemberStatus(groupId, memberDid, status) {
    if (!this.memberOnlineStatus.has(groupId)) {
      this.memberOnlineStatus.set(groupId, new Map());
    }

    const groupStatus = this.memberOnlineStatus.get(groupId);
    groupStatus.set(memberDid, status);

    // 如果成员上线，刷新消息队列
    if (status === 'online') {
      this.flushMessageQueue(groupId, memberDid);
    }

    this.emit('member:status-changed', { groupId, memberDid, status });
  }

  /**
   * 启动实时同步
   */
  startRealTimeSync() {
    // 监听群聊管理器的事件
    this.groupChatManager.on('message:sent', async ({ groupId, message }) => {
      await this.syncMessage(groupId, message);
    });

    this.groupChatManager.on('member:added', async ({ groupId, memberDid }) => {
      await this.syncMemberChange(groupId, {
        type: 'member-added',
        memberDid,
        timestamp: Date.now()
      });
    });

    this.groupChatManager.on('member:removed', async ({ groupId, memberDid }) => {
      await this.syncMemberChange(groupId, {
        type: 'member-removed',
        memberDid,
        timestamp: Date.now()
      });
    });

    this.groupChatManager.on('settings:changed', async ({ groupId, settings }) => {
      await this.syncGroupSettings(groupId, settings);
    });

    logger.info('[GroupChatSyncManager] 实时同步已启动');
  }

  /**
   * 启动定期清理
   */
  startCleanup() {
    // 每小时清理一次过期的消息缓存
    setInterval(() => {
      this.cleanupMessageCache();
    }, 60 * 60 * 1000);
  }

  /**
   * 清理消息缓存
   */
  cleanupMessageCache() {
    const now = Date.now();
    const expiredKeys = [];

    for (const [messageId, timestamp] of this.messageCache.entries()) {
      if (now - timestamp > this.options.deduplicationWindow) {
        expiredKeys.push(messageId);
      }
    }

    for (const key of expiredKeys) {
      this.messageCache.delete(key);
    }

    if (expiredKeys.length > 0) {
      logger.info('[GroupChatSyncManager] 已清理', expiredKeys.length, '条过期消息缓存');
    }
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
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      messageQueuesCount: this.messageQueues.size,
      messageCacheSize: this.messageCache.size,
      onlineMembersCount: Array.from(this.memberOnlineStatus.values())
        .reduce((sum, groupStatus) => {
          return sum + Array.from(groupStatus.values()).filter(s => s === 'online').length;
        }, 0)
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.messageQueues.clear();
    this.messageCache.clear();
    this.syncStatus.clear();
    this.memberOnlineStatus.clear();
  }
}

module.exports = GroupChatSyncManager;
