/**
 * 设备同步管理器
 *
 * 负责多设备间的消息同步和状态管理
 * 功能: 离线消息队列、消息状态同步、设备间数据同步
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

/**
 * 消息状态
 */
const MessageStatus = {
  PENDING: 'pending',       // 等待发送
  SENT: 'sent',            // 已发送到服务器/对等节点
  DELIVERED: 'delivered',  // 已送达目标设备
  READ: 'read',            // 已读
  FAILED: 'failed',        // 发送失败
};

/**
 * 同步消息类型
 */
const SyncMessageType = {
  MESSAGE_DELIVERY: 'message-delivery',      // 消息投递
  MESSAGE_STATUS: 'message-status',          // 消息状态更新
  DEVICE_STATUS: 'device-status',            // 设备状态更新
  SYNC_REQUEST: 'sync-request',              // 同步请求
  SYNC_RESPONSE: 'sync-response',            // 同步响应
};

/**
 * 设备同步管理器类
 */
class DeviceSyncManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      dataPath: config.dataPath || null,
      userId: config.userId || null,
      deviceId: config.deviceId || null,
      maxQueueSize: config.maxQueueSize || 1000,      // 最大队列大小
      syncInterval: config.syncInterval || 30000,      // 同步间隔 (30秒)
      messageRetention: config.messageRetention || 7,  // 消息保留天数
      ...config,
    };

    this.messageQueue = new Map();        // Map<targetDeviceId, Message[]>
    this.messageStatus = new Map();       // Map<messageId, Status>
    this.deviceStatus = new Map();        // Map<deviceId, DeviceStatus>
    this.syncTimers = new Map();          // Map<deviceId, Timer>
    this.initialized = false;
  }

  /**
   * 初始化同步管理器
   */
  async initialize() {
    logger.info('[DeviceSyncManager] 初始化设备同步管理器...');

    try {
      // 加载持久化的消息队列
      await this.loadMessageQueue();

      // 加载消息状态
      await this.loadMessageStatus();

      // 启动定期清理
      this.startCleanupTimer();

      this.initialized = true;
      logger.info('[DeviceSyncManager] 设备同步管理器已初始化');

      this.emit('initialized');
    } catch (error) {
      logger.error('[DeviceSyncManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 加载消息队列
   */
  async loadMessageQueue() {
    if (!this.config.dataPath) {
      logger.info('[DeviceSyncManager] 无数据路径，使用内存队列');
      return;
    }

    const queuePath = path.join(this.config.dataPath, 'message-queue.json');

    try {
      if (fs.existsSync(queuePath)) {
        const queueData = JSON.parse(fs.readFileSync(queuePath, 'utf8'));

        // 转换为 Map
        for (const [deviceId, messages] of Object.entries(queueData)) {
          this.messageQueue.set(deviceId, messages);
        }

        logger.info('[DeviceSyncManager] 已加载消息队列:', this.messageQueue.size, '个设备');
      }
    } catch (error) {
      logger.warn('[DeviceSyncManager] 加载消息队列失败:', error.message);
    }
  }

  /**
   * 保存消息队列
   */
  async saveMessageQueue() {
    if (!this.config.dataPath) {
      return;
    }

    const queuePath = path.join(this.config.dataPath, 'message-queue.json');

    try {
      fs.mkdirSync(path.dirname(queuePath), { recursive: true });

      // 转换 Map 为对象
      const queueData = {};
      for (const [deviceId, messages] of this.messageQueue.entries()) {
        queueData[deviceId] = messages;
      }

      fs.writeFileSync(queuePath, JSON.stringify(queueData, null, 2));
    } catch (error) {
      logger.warn('[DeviceSyncManager] 保存消息队列失败:', error.message);
    }
  }

  /**
   * 加载消息状态
   */
  async loadMessageStatus() {
    if (!this.config.dataPath) {
      logger.info('[DeviceSyncManager] 无数据路径，使用内存状态');
      return;
    }

    const statusPath = path.join(this.config.dataPath, 'message-status.json');

    try {
      if (fs.existsSync(statusPath)) {
        const statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8'));

        // 转换为 Map
        for (const [messageId, status] of Object.entries(statusData)) {
          this.messageStatus.set(messageId, status);
        }

        logger.info('[DeviceSyncManager] 已加载消息状态:', this.messageStatus.size, '条消息');
      }
    } catch (error) {
      logger.warn('[DeviceSyncManager] 加载消息状态失败:', error.message);
    }
  }

  /**
   * 保存消息状态
   */
  async saveMessageStatus() {
    if (!this.config.dataPath) {
      return;
    }

    const statusPath = path.join(this.config.dataPath, 'message-status.json');

    try {
      fs.mkdirSync(path.dirname(statusPath), { recursive: true });

      // 转换 Map 为对象
      const statusData = {};
      for (const [messageId, status] of this.messageStatus.entries()) {
        statusData[messageId] = status;
      }

      fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
    } catch (error) {
      logger.warn('[DeviceSyncManager] 保存消息状态失败:', error.message);
    }
  }

  /**
   * 将消息加入队列
   * @param {string} targetDeviceId - 目标设备ID
   * @param {Object} message - 消息对象
   */
  async queueMessage(targetDeviceId, message) {
    try {
      // 生成消息ID
      const messageId = message.id || this.generateMessageId();

      const queueMessage = {
        id: messageId,
        targetDeviceId,
        targetPeerId: message.targetPeerId,
        content: message.content,
        encrypted: message.encrypted || false,
        timestamp: Date.now(),
        attempts: 0,
        status: MessageStatus.PENDING,
        ...message,
      };

      // 获取或创建设备队列
      let deviceQueue = this.messageQueue.get(targetDeviceId);
      if (!deviceQueue) {
        deviceQueue = [];
        this.messageQueue.set(targetDeviceId, deviceQueue);
      }

      // 检查队列大小
      if (deviceQueue.length >= this.config.maxQueueSize) {
        logger.warn('[DeviceSyncManager] 设备队列已满:', targetDeviceId);
        // 移除最旧的消息
        deviceQueue.shift();
      }

      // 加入队列
      deviceQueue.push(queueMessage);

      // 更新消息状态
      this.messageStatus.set(messageId, {
        status: MessageStatus.PENDING,
        timestamp: Date.now(),
      });

      // 持久化
      await this.saveMessageQueue();
      await this.saveMessageStatus();

      logger.info('[DeviceSyncManager] 消息已加入队列:', messageId, '->', targetDeviceId);

      this.emit('message:queued', { messageId, targetDeviceId, message: queueMessage });

      return messageId;
    } catch (error) {
      logger.error('[DeviceSyncManager] 消息入队失败:', error);
      throw error;
    }
  }

  /**
   * 获取设备的消息队列
   * @param {string} deviceId - 设备ID
   */
  getDeviceQueue(deviceId) {
    return this.messageQueue.get(deviceId) || [];
  }

  /**
   * 标记消息已发送
   * @param {string} messageId - 消息ID
   */
  async markMessageSent(messageId) {
    try {
      const status = this.messageStatus.get(messageId);
      if (status) {
        status.status = MessageStatus.SENT;
        status.sentAt = Date.now();
        this.messageStatus.set(messageId, status);
        await this.saveMessageStatus();

        this.emit('message:sent', { messageId, status });
      }
    } catch (error) {
      logger.error('[DeviceSyncManager] 标记消息发送失败:', error);
    }
  }

  /**
   * 标记消息已送达
   * @param {string} messageId - 消息ID
   */
  async markMessageDelivered(messageId) {
    try {
      const status = this.messageStatus.get(messageId);
      if (status) {
        status.status = MessageStatus.DELIVERED;
        status.deliveredAt = Date.now();
        this.messageStatus.set(messageId, status);
        await this.saveMessageStatus();

        this.emit('message:delivered', { messageId, status });
      }
    } catch (error) {
      logger.error('[DeviceSyncManager] 标记消息送达失败:', error);
    }
  }

  /**
   * 标记消息已读
   * @param {string} messageId - 消息ID
   */
  async markMessageRead(messageId) {
    try {
      const status = this.messageStatus.get(messageId);
      if (status) {
        status.status = MessageStatus.READ;
        status.readAt = Date.now();
        this.messageStatus.set(messageId, status);
        await this.saveMessageStatus();

        this.emit('message:read', { messageId, status });
      }
    } catch (error) {
      logger.error('[DeviceSyncManager] 标记消息已读失败:', error);
    }
  }

  /**
   * 标记消息发送失败
   * @param {string} messageId - 消息ID
   * @param {string} error - 错误信息
   */
  async markMessageFailed(messageId, error) {
    try {
      const status = this.messageStatus.get(messageId);
      if (status) {
        status.status = MessageStatus.FAILED;
        status.error = error;
        status.failedAt = Date.now();
        this.messageStatus.set(messageId, status);
        await this.saveMessageStatus();

        this.emit('message:failed', { messageId, status, error });
      }
    } catch (error) {
      logger.error('[DeviceSyncManager] 标记消息失败:', error);
    }
  }

  /**
   * 移除已送达的消息
   * @param {string} messageId - 消息ID
   */
  async removeMessage(messageId) {
    try {
      // 从队列中移除
      for (const [deviceId, queue] of this.messageQueue.entries()) {
        const index = queue.findIndex(msg => msg.id === messageId);
        if (index >= 0) {
          queue.splice(index, 1);
          if (queue.length === 0) {
            this.messageQueue.delete(deviceId);
          }
          break;
        }
      }

      await this.saveMessageQueue();

      logger.info('[DeviceSyncManager] 消息已移除:', messageId);

      this.emit('message:removed', { messageId });
    } catch (error) {
      logger.error('[DeviceSyncManager] 移除消息失败:', error);
    }
  }

  /**
   * 更新设备状态
   * @param {string} deviceId - 设备ID
   * @param {Object} status - 设备状态
   */
  updateDeviceStatus(deviceId, status) {
    this.deviceStatus.set(deviceId, {
      ...status,
      lastUpdate: Date.now(),
    });

    this.emit('device:status-changed', { deviceId, status });
  }

  /**
   * 获取设备状态
   * @param {string} deviceId - 设备ID
   */
  getDeviceStatus(deviceId) {
    return this.deviceStatus.get(deviceId);
  }

  /**
   * 启动设备同步
   * @param {string} deviceId - 设备ID
   */
  startDeviceSync(deviceId) {
    // 如果已有定时器，先清除
    if (this.syncTimers.has(deviceId)) {
      clearInterval(this.syncTimers.get(deviceId));
    }

    // 创建新定时器
    const timer = setInterval(() => {
      this.syncDevice(deviceId);
    }, this.config.syncInterval);

    this.syncTimers.set(deviceId, timer);

    logger.info('[DeviceSyncManager] 已启动设备同步:', deviceId);

    // 立即执行一次同步
    this.syncDevice(deviceId);
  }

  /**
   * 停止设备同步
   * @param {string} deviceId - 设备ID
   */
  stopDeviceSync(deviceId) {
    if (this.syncTimers.has(deviceId)) {
      clearInterval(this.syncTimers.get(deviceId));
      this.syncTimers.delete(deviceId);
      logger.info('[DeviceSyncManager] 已停止设备同步:', deviceId);
    }
  }

  /**
   * 同步设备消息
   * @param {string} deviceId - 设备ID
   */
  async syncDevice(deviceId) {
    try {
      const queue = this.getDeviceQueue(deviceId);
      if (queue.length === 0) {
        return;
      }

      logger.info('[DeviceSyncManager] 同步设备消息:', deviceId, '队列大小:', queue.length);

      this.emit('sync:started', { deviceId, queueSize: queue.length });

      // 触发同步事件，由 P2P 管理器处理实际的消息发送
      for (const message of queue) {
        this.emit('sync:message', { deviceId, message });
      }
    } catch (error) {
      logger.error('[DeviceSyncManager] 同步设备失败:', error);
      this.emit('sync:error', { deviceId, error });
    }
  }

  /**
   * 启动定期清理
   */
  startCleanupTimer() {
    // 每小时清理一次
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);
  }

  /**
   * 清理过期消息
   */
  async cleanup() {
    try {
      logger.info('[DeviceSyncManager] 开始清理过期消息...');

      const now = Date.now();
      const retentionMs = this.config.messageRetention * 24 * 60 * 60 * 1000;
      let removedCount = 0;

      // 清理消息队列
      for (const [deviceId, queue] of this.messageQueue.entries()) {
        const filteredQueue = queue.filter(msg => {
          const age = now - msg.timestamp;
          return age < retentionMs;
        });

        removedCount += queue.length - filteredQueue.length;

        if (filteredQueue.length === 0) {
          this.messageQueue.delete(deviceId);
        } else {
          this.messageQueue.set(deviceId, filteredQueue);
        }
      }

      // 清理消息状态
      for (const [messageId, status] of this.messageStatus.entries()) {
        const age = now - status.timestamp;
        if (age >= retentionMs) {
          this.messageStatus.delete(messageId);
          removedCount++;
        }
      }

      if (removedCount > 0) {
        await this.saveMessageQueue();
        await this.saveMessageStatus();
        logger.info('[DeviceSyncManager] 已清理', removedCount, '条过期消息');
      }

      this.emit('cleanup:complete', { removedCount });
    } catch (error) {
      logger.error('[DeviceSyncManager] 清理失败:', error);
    }
  }

  /**
   * 生成消息ID
   */
  generateMessageId() {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    let totalMessages = 0;
    const deviceQueues = {};

    for (const [deviceId, queue] of this.messageQueue.entries()) {
      totalMessages += queue.length;
      deviceQueues[deviceId] = queue.length;
    }

    return {
      totalMessages,
      deviceCount: this.messageQueue.size,
      deviceQueues,
      statusCount: this.messageStatus.size,
      activeSyncs: this.syncTimers.size,
    };
  }

  /**
   * 关闭同步管理器
   */
  async close() {
    logger.info('[DeviceSyncManager] 关闭设备同步管理器');

    // 停止所有同步定时器
    for (const [deviceId, timer] of this.syncTimers.entries()) {
      clearInterval(timer);
    }
    this.syncTimers.clear();

    // 停止清理定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // 保存数据
    await this.saveMessageQueue();
    await this.saveMessageStatus();

    this.initialized = false;
    this.emit('closed');
  }
}

module.exports = {
  DeviceSyncManager,
  MessageStatus,
  SyncMessageType,
};
