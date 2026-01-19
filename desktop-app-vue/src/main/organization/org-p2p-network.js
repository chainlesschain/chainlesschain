/**
 * 组织P2P网络管理器
 *
 * 功能：
 * - Topic订阅机制
 * - 组织成员自动发现
 * - 组织内消息广播
 * - 成员在线状态同步
 * - 去中心化组织协作
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');

/**
 * 消息类型枚举
 */
const MessageType = {
  // 成员相关
  MEMBER_ONLINE: 'member_online',
  MEMBER_OFFLINE: 'member_offline',
  MEMBER_JOINED: 'member_joined',
  MEMBER_LEFT: 'member_left',
  MEMBER_UPDATED: 'member_updated',

  // 发现相关
  DISCOVERY_REQUEST: 'discovery_request',
  DISCOVERY_RESPONSE: 'discovery_response',
  HEARTBEAT: 'heartbeat',

  // 数据同步
  SYNC_REQUEST: 'sync_request',
  SYNC_RESPONSE: 'sync_response',
  KNOWLEDGE_CREATED: 'knowledge_created',
  KNOWLEDGE_UPDATED: 'knowledge_updated',
  KNOWLEDGE_DELETED: 'knowledge_deleted',

  // 广播消息
  BROADCAST: 'broadcast',
  ANNOUNCEMENT: 'announcement',
};

/**
 * 组织P2P网络管理器类
 */
class OrgP2PNetwork extends EventEmitter {
  constructor(p2pManager, didManager, db) {
    super();

    this.p2pManager = p2pManager;
    this.didManager = didManager;
    this.db = db;

    // 组织订阅映射 orgId -> { topic, members, lastActivity }
    this.orgSubscriptions = new Map();

    // 在线成员映射 orgId -> Set<memberDID>
    this.onlineMembers = new Map();

    // 心跳定时器
    this.heartbeatIntervals = new Map();

    // 发现定时器
    this.discoveryIntervals = new Map();

    // 配置
    this.config = {
      heartbeatInterval: 30000,      // 心跳间隔 30秒
      discoveryInterval: 60000,      // 发现间隔 60秒
      memberTimeout: 90000,          // 成员超时 90秒
      maxRetries: 3,                 // 最大重试次数
      broadcastTimeout: 5000,        // 广播超时 5秒
    };
  }

  /**
   * 初始化组织P2P网络
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async initialize(orgId) {
    logger.info(`[OrgP2PNetwork] 初始化组织网络: ${orgId}`);

    try {
      // 1. 生成Topic名称
      const topic = this.getOrgTopic(orgId);

      // 2. 订阅Topic
      await this.subscribeTopic(orgId, topic);

      // 3. 注册消息处理器
      this.registerMessageHandlers(orgId);

      // 4. 启动心跳
      this.startHeartbeat(orgId);

      // 5. 启动成员发现
      this.startDiscovery(orgId);

      // 6. 广播上线消息
      await this.broadcastMemberOnline(orgId);

      logger.info(`[OrgP2PNetwork] ✓ 组织网络初始化完成: ${orgId}`);

      this.emit('network:initialized', { orgId, topic });
    } catch (error) {
      logger.error(`[OrgP2PNetwork] 初始化失败:`, error);
      throw error;
    }
  }

  /**
   * 订阅组织Topic
   * @param {string} orgId - 组织ID
   * @param {string} topic - Topic名称
   * @returns {Promise<void>}
   */
  async subscribeTopic(orgId, topic) {
    if (!this.p2pManager || !this.p2pManager.node) {
      throw new Error('P2P Manager未初始化');
    }

    try {
      // 检查是否支持PubSub
      const pubsub = this.p2pManager.node.services?.pubsub;
      if (!pubsub) {
        logger.warn('[OrgP2PNetwork] PubSub服务不可用，使用直接消息模式');
        // 使用直接消息作为后备方案
        this.orgSubscriptions.set(orgId, {
          topic,
          members: new Set(),
          lastActivity: Date.now(),
          mode: 'direct'
        });
        return;
      }

      // 订阅Topic
      await pubsub.subscribe(topic);

      // 注册Topic消息处理器
      pubsub.addEventListener('message', (evt) => {
        if (evt.detail.topic === topic) {
          this.handleTopicMessage(orgId, evt.detail);
        }
      });

      // 保存订阅信息
      this.orgSubscriptions.set(orgId, {
        topic,
        members: new Set(),
        lastActivity: Date.now(),
        mode: 'pubsub'
      });

      logger.info(`[OrgP2PNetwork] ✓ 已订阅Topic: ${topic}`);
    } catch (error) {
      logger.error(`[OrgP2PNetwork] 订阅Topic失败:`, error);
      throw error;
    }
  }

  /**
   * 取消订阅组织Topic
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async unsubscribeTopic(orgId) {
    const subscription = this.orgSubscriptions.get(orgId);
    if (!subscription) {
      return;
    }

    try {
      // 停止心跳和发现
      this.stopHeartbeat(orgId);
      this.stopDiscovery(orgId);

      // 广播下线消息
      await this.broadcastMemberOffline(orgId);

      // 取消订阅
      if (subscription.mode === 'pubsub') {
        const pubsub = this.p2pManager.node.services?.pubsub;
        if (pubsub) {
          await pubsub.unsubscribe(subscription.topic);
        }
      }

      // 清理数据
      this.orgSubscriptions.delete(orgId);
      this.onlineMembers.delete(orgId);

      logger.info(`[OrgP2PNetwork] ✓ 已取消订阅: ${orgId}`);
    } catch (error) {
      logger.error(`[OrgP2PNetwork] 取消订阅失败:`, error);
    }
  }

  /**
   * 注册消息处理器
   * @param {string} orgId - 组织ID
   */
  registerMessageHandlers(orgId) {
    // P2P Manager的消息事件已经在subscribeTopic中处理
    // 这里可以添加额外的处理逻辑
  }

  /**
   * 处理Topic消息
   * @param {string} orgId - 组织ID
   * @param {Object} message - 消息对象
   */
  async handleTopicMessage(orgId, message) {
    try {
      const data = JSON.parse(new TextDecoder().decode(message.data));

      // 忽略自己发送的消息
      const currentDID = await this.didManager.getCurrentDID();
      if (data.senderDID === currentDID) {
        return;
      }

      logger.info(`[OrgP2PNetwork] 收到消息: ${data.type} from ${data.senderDID}`);

      // 更新最后活动时间
      const subscription = this.orgSubscriptions.get(orgId);
      if (subscription) {
        subscription.lastActivity = Date.now();
      }

      // 根据消息类型处理
      switch (data.type) {
        case MessageType.MEMBER_ONLINE:
          await this.handleMemberOnline(orgId, data);
          break;

        case MessageType.MEMBER_OFFLINE:
          await this.handleMemberOffline(orgId, data);
          break;

        case MessageType.HEARTBEAT:
          await this.handleHeartbeat(orgId, data);
          break;

        case MessageType.DISCOVERY_REQUEST:
          await this.handleDiscoveryRequest(orgId, data);
          break;

        case MessageType.DISCOVERY_RESPONSE:
          await this.handleDiscoveryResponse(orgId, data);
          break;

        case MessageType.MEMBER_JOINED:
        case MessageType.MEMBER_LEFT:
        case MessageType.MEMBER_UPDATED:
          await this.handleMemberEvent(orgId, data);
          break;

        case MessageType.KNOWLEDGE_CREATED:
        case MessageType.KNOWLEDGE_UPDATED:
        case MessageType.KNOWLEDGE_DELETED:
          await this.handleKnowledgeEvent(orgId, data);
          break;

        case MessageType.BROADCAST:
        case MessageType.ANNOUNCEMENT:
          await this.handleBroadcastMessage(orgId, data);
          break;

        default:
          logger.warn(`[OrgP2PNetwork] 未知消息类型: ${data.type}`);
      }

      // 触发事件
      this.emit('message:received', { orgId, message: data });
    } catch (error) {
      logger.error(`[OrgP2PNetwork] 处理消息失败:`, error);
    }
  }

  /**
   * 广播消息到组织
   * @param {string} orgId - 组织ID
   * @param {Object} message - 消息内容
   * @returns {Promise<void>}
   */
  async broadcastMessage(orgId, message) {
    const subscription = this.orgSubscriptions.get(orgId);
    if (!subscription) {
      throw new Error(`组织${orgId}未订阅`);
    }

    try {
      // 添加发送者信息
      const currentDID = await this.didManager.getCurrentDID();
      const messageData = {
        ...message,
        senderDID: currentDID,
        timestamp: Date.now(),
        orgId
      };

      if (subscription.mode === 'pubsub') {
        // 使用PubSub广播
        const pubsub = this.p2pManager.node.services.pubsub;
        const data = new TextEncoder().encode(JSON.stringify(messageData));
        await pubsub.publish(subscription.topic, data);
      } else {
        // 使用直接消息模式
        await this.broadcastDirect(orgId, messageData);
      }

      logger.info(`[OrgP2PNetwork] ✓ 消息已广播: ${message.type}`);
    } catch (error) {
      logger.error(`[OrgP2PNetwork] 广播消息失败:`, error);
      throw error;
    }
  }

  /**
   * 直接消息广播（PubSub不可用时的后备方案）
   * @param {string} orgId - 组织ID
   * @param {Object} message - 消息内容
   * @returns {Promise<void>}
   */
  async broadcastDirect(orgId, message) {
    const onlineMembers = this.onlineMembers.get(orgId);
    if (!onlineMembers || onlineMembers.size === 0) {
      logger.warn(`[OrgP2PNetwork] 没有在线成员可以接收消息`);
      return;
    }

    const promises = [];
    for (const memberDID of onlineMembers) {
      // 跳过自己
      if (memberDID === message.senderDID) {
        continue;
      }

      // 发送直接消息
      const promise = this.p2pManager.sendEncryptedMessage(
        memberDID,
        JSON.stringify(message),
        null,
        { autoQueue: true }
      ).catch(error => {
        logger.warn(`[OrgP2PNetwork] 发送消息到${memberDID}失败:`, error.message);
      });

      promises.push(promise);
    }

    await Promise.allSettled(promises);
  }

  /**
   * 启动心跳
   * @param {string} orgId - 组织ID
   */
  startHeartbeat(orgId) {
    // 清除旧的定时器
    this.stopHeartbeat(orgId);

    // 创建新的定时器
    const interval = setInterval(async () => {
      try {
        await this.sendHeartbeat(orgId);
      } catch (error) {
        logger.error(`[OrgP2PNetwork] 发送心跳失败:`, error);
      }
    }, this.config.heartbeatInterval);

    this.heartbeatIntervals.set(orgId, interval);
    logger.info(`[OrgP2PNetwork] ✓ 心跳已启动: ${orgId}`);
  }

  /**
   * 停止心跳
   * @param {string} orgId - 组织ID
   */
  stopHeartbeat(orgId) {
    const interval = this.heartbeatIntervals.get(orgId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(orgId);
      logger.info(`[OrgP2PNetwork] ✓ 心跳已停止: ${orgId}`);
    }
  }

  /**
   * 发送心跳
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async sendHeartbeat(orgId) {
    const currentDID = await this.didManager.getCurrentDID();
    const currentIdentity = await this.didManager.getDefaultIdentity();

    await this.broadcastMessage(orgId, {
      type: MessageType.HEARTBEAT,
      memberDID: currentDID,
      displayName: currentIdentity?.displayName || 'Unknown',
      avatar: currentIdentity?.avatar || '',
      status: 'online'
    });
  }

  /**
   * 启动成员发现
   * @param {string} orgId - 组织ID
   */
  startDiscovery(orgId) {
    // 清除旧的定时器
    this.stopDiscovery(orgId);

    // 立即执行一次发现
    this.requestDiscovery(orgId).catch(error => {
      logger.error(`[OrgP2PNetwork] 初始发现失败:`, error);
    });

    // 创建定时器
    const interval = setInterval(async () => {
      try {
        await this.requestDiscovery(orgId);
      } catch (error) {
        logger.error(`[OrgP2PNetwork] 成员发现失败:`, error);
      }
    }, this.config.discoveryInterval);

    this.discoveryIntervals.set(orgId, interval);
    logger.info(`[OrgP2PNetwork] ✓ 成员发现已启动: ${orgId}`);
  }

  /**
   * 停止成员发现
   * @param {string} orgId - 组织ID
   */
  stopDiscovery(orgId) {
    const interval = this.discoveryIntervals.get(orgId);
    if (interval) {
      clearInterval(interval);
      this.discoveryIntervals.delete(orgId);
      logger.info(`[OrgP2PNetwork] ✓ 成员发现已停止: ${orgId}`);
    }
  }

  /**
   * 请求成员发现
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async requestDiscovery(orgId) {
    const currentDID = await this.didManager.getCurrentDID();

    await this.broadcastMessage(orgId, {
      type: MessageType.DISCOVERY_REQUEST,
      requesterDID: currentDID
    });
  }

  /**
   * 广播成员上线
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async broadcastMemberOnline(orgId) {
    const currentDID = await this.didManager.getCurrentDID();
    const currentIdentity = await this.didManager.getDefaultIdentity();

    await this.broadcastMessage(orgId, {
      type: MessageType.MEMBER_ONLINE,
      memberDID: currentDID,
      displayName: currentIdentity?.displayName || 'Unknown',
      avatar: currentIdentity?.avatar || '',
      peerId: this.p2pManager.peerId?.toString()
    });

    // 添加到在线成员列表
    this.addOnlineMember(orgId, currentDID);
  }

  /**
   * 广播成员下线
   * @param {string} orgId - 组织ID
   * @returns {Promise<void>}
   */
  async broadcastMemberOffline(orgId) {
    const currentDID = await this.didManager.getCurrentDID();

    await this.broadcastMessage(orgId, {
      type: MessageType.MEMBER_OFFLINE,
      memberDID: currentDID
    });

    // 从在线成员列表移除
    this.removeOnlineMember(orgId, currentDID);
  }

  /**
   * 处理成员上线
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据
   */
  async handleMemberOnline(orgId, data) {
    logger.info(`[OrgP2PNetwork] 成员上线: ${data.memberDID}`);

    this.addOnlineMember(orgId, data.memberDID);

    this.emit('member:online', {
      orgId,
      memberDID: data.memberDID,
      displayName: data.displayName,
      avatar: data.avatar,
      peerId: data.peerId
    });
  }

  /**
   * 处理成员下线
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据
   */
  async handleMemberOffline(orgId, data) {
    logger.info(`[OrgP2PNetwork] 成员下线: ${data.memberDID}`);

    this.removeOnlineMember(orgId, data.memberDID);

    this.emit('member:offline', {
      orgId,
      memberDID: data.memberDID
    });
  }

  /**
   * 处理心跳
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据
   */
  async handleHeartbeat(orgId, data) {
    // 更新成员在线状态
    this.addOnlineMember(orgId, data.memberDID);

    this.emit('member:heartbeat', {
      orgId,
      memberDID: data.memberDID,
      status: data.status
    });
  }

  /**
   * 处理发现请求
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据
   */
  async handleDiscoveryRequest(orgId, data) {
    // 响应发现请求
    const currentDID = await this.didManager.getCurrentDID();
    const currentIdentity = await this.didManager.getDefaultIdentity();

    await this.broadcastMessage(orgId, {
      type: MessageType.DISCOVERY_RESPONSE,
      responderDID: currentDID,
      requesterDID: data.requesterDID,
      displayName: currentIdentity?.displayName || 'Unknown',
      avatar: currentIdentity?.avatar || '',
      peerId: this.p2pManager.peerId?.toString()
    });
  }

  /**
   * 处理发现响应
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据
   */
  async handleDiscoveryResponse(orgId, data) {
    const currentDID = await this.didManager.getCurrentDID();

    // 只处理发给自己的响应
    if (data.requesterDID !== currentDID) {
      return;
    }

    logger.info(`[OrgP2PNetwork] 发现成员: ${data.responderDID}`);

    this.addOnlineMember(orgId, data.responderDID);

    this.emit('member:discovered', {
      orgId,
      memberDID: data.responderDID,
      displayName: data.displayName,
      avatar: data.avatar,
      peerId: data.peerId
    });
  }

  /**
   * 处理成员事件
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据
   */
  async handleMemberEvent(orgId, data) {
    this.emit('member:event', {
      orgId,
      type: data.type,
      data
    });
  }

  /**
   * 处理知识库事件
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据
   */
  async handleKnowledgeEvent(orgId, data) {
    this.emit('knowledge:event', {
      orgId,
      type: data.type,
      data
    });
  }

  /**
   * 处理广播消息
   * @param {string} orgId - 组织ID
   * @param {Object} data - 消息数据
   */
  async handleBroadcastMessage(orgId, data) {
    this.emit('broadcast:received', {
      orgId,
      type: data.type,
      content: data.content,
      senderDID: data.senderDID
    });
  }

  /**
   * 添加在线成员
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   */
  addOnlineMember(orgId, memberDID) {
    if (!this.onlineMembers.has(orgId)) {
      this.onlineMembers.set(orgId, new Set());
    }

    const members = this.onlineMembers.get(orgId);
    const wasOffline = !members.has(memberDID);
    members.add(memberDID);

    if (wasOffline) {
      logger.info(`[OrgP2PNetwork] 在线成员 +1: ${orgId} (${members.size})`);
    }
  }

  /**
   * 移除在线成员
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   */
  removeOnlineMember(orgId, memberDID) {
    const members = this.onlineMembers.get(orgId);
    if (members) {
      members.delete(memberDID);
      logger.info(`[OrgP2PNetwork] 在线成员 -1: ${orgId} (${members.size})`);
    }
  }

  /**
   * 获取在线成员列表
   * @param {string} orgId - 组织ID
   * @returns {Array<string>} 在线成员DID列表
   */
  getOnlineMembers(orgId) {
    const members = this.onlineMembers.get(orgId);
    return members ? Array.from(members) : [];
  }

  /**
   * 获取在线成员数量
   * @param {string} orgId - 组织ID
   * @returns {number} 在线成员数量
   */
  getOnlineMemberCount(orgId) {
    const members = this.onlineMembers.get(orgId);
    return members ? members.size : 0;
  }

  /**
   * 检查成员是否在线
   * @param {string} orgId - 组织ID
   * @param {string} memberDID - 成员DID
   * @returns {boolean} 是否在线
   */
  isMemberOnline(orgId, memberDID) {
    const members = this.onlineMembers.get(orgId);
    return members ? members.has(memberDID) : false;
  }

  /**
   * 获取组织Topic名称
   * @param {string} orgId - 组织ID
   * @returns {string} Topic名称
   */
  getOrgTopic(orgId) {
    return `/chainlesschain/org/${orgId}/v1`;
  }

  /**
   * 获取网络统计信息
   * @param {string} orgId - 组织ID
   * @returns {Object} 统计信息
   */
  getNetworkStats(orgId) {
    const subscription = this.orgSubscriptions.get(orgId);
    const onlineMembers = this.onlineMembers.get(orgId);

    return {
      subscribed: !!subscription,
      topic: subscription?.topic,
      mode: subscription?.mode,
      onlineMemberCount: onlineMembers?.size || 0,
      onlineMembers: onlineMembers ? Array.from(onlineMembers) : [],
      lastActivity: subscription?.lastActivity,
      heartbeatActive: this.heartbeatIntervals.has(orgId),
      discoveryActive: this.discoveryIntervals.has(orgId)
    };
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info('[OrgP2PNetwork] 清理资源...');

    // 取消所有订阅
    const orgIds = Array.from(this.orgSubscriptions.keys());
    for (const orgId of orgIds) {
      await this.unsubscribeTopic(orgId);
    }

    // 清理所有数据
    this.orgSubscriptions.clear();
    this.onlineMembers.clear();
    this.heartbeatIntervals.clear();
    this.discoveryIntervals.clear();

    logger.info('[OrgP2PNetwork] ✓ 资源清理完成');
  }
}

module.exports = {
  OrgP2PNetwork,
  MessageType
};
