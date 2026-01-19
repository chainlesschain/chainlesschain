/**
 * 消息管理器 - 消息去重和批量处理
 *
 * 功能：
 * - 消息ID生成和管理
 * - 消息去重（基于ID）
 * - 批量消息发送
 * - 消息确认和重传
 * - 消息压缩（可选）
 */

const crypto = require('crypto');
const EventEmitter = require('events');

class MessageManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      // 批量发送配置
      batchSize: options.batchSize || 10,           // 批量大小
      batchInterval: options.batchInterval || 100,   // 批量间隔（ms）

      // 去重配置
      deduplicationWindow: options.deduplicationWindow || 60000, // 去重窗口（1分钟）
      maxDeduplicationCache: options.maxDeduplicationCache || 10000, // 最大缓存数

      // 重传配置
      enableRetry: options.enableRetry !== false,
      maxRetries: options.maxRetries || 3,
      retryInterval: options.retryInterval || 1000,

      // 压缩配置
      enableCompression: options.enableCompression || false,
      compressionThreshold: options.compressionThreshold || 1024, // 1KB

      ...options
    };

    // 消息队列
    this.outgoingQueue = new Map(); // peerId -> Message[]
    this.batchTimers = new Map();   // peerId -> timer

    // 去重缓存
    this.receivedMessages = new Map(); // messageId -> timestamp
    this.sentMessages = new Map();     // messageId -> { message, sentAt, retries }

    // 待确认消息
    this.pendingAcks = new Map(); // messageId -> { message, peerId, timer }

    // 统计信息
    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      messagesDuplicated: 0,
      messagesRetried: 0,
      batchesSent: 0,
      bytesCompressed: 0
    };

    // 定期清理过期数据
    this.startCleanupTimer();
  }

  /**
   * 生成消息ID
   */
  generateMessageId() {
    // 使用时间戳 + 随机数 + 计数器
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const counter = this.stats.messagesSent;

    return `${timestamp}-${random}-${counter}`;
  }

  /**
   * 发送消息（带去重和批量处理）
   * @param {string} peerId - 目标节点ID
   * @param {Object} payload - 消息内容
   * @param {Object} options - 发送选项
   */
  async sendMessage(peerId, payload, options = {}) {
    const {
      priority = 'normal',  // 'high' | 'normal' | 'low'
      requireAck = false,   // 是否需要确认
      compress = this.options.enableCompression,
      immediate = false     // 是否立即发送（不批量）
    } = options;

    // 生成消息ID
    const messageId = this.generateMessageId();

    // 构建消息
    const message = {
      id: messageId,
      type: payload.type,
      payload: payload,
      timestamp: Date.now(),
      priority,
      requireAck
    };

    // 压缩（如果需要）
    if (compress && this.shouldCompress(message)) {
      message.compressed = true;
      message.payload = await this.compressPayload(message.payload);
      this.stats.bytesCompressed += JSON.stringify(payload).length;
    }

    // 记录已发送消息
    this.sentMessages.set(messageId, {
      message,
      peerId,
      sentAt: Date.now(),
      retries: 0
    });

    // 高优先级或立即发送
    if (priority === 'high' || immediate) {
      await this.sendImmediately(peerId, message);
    } else {
      // 加入批量队列
      this.queueMessage(peerId, message);
    }

    // 需要确认
    if (requireAck) {
      this.waitForAck(messageId, peerId, message);
    }

    this.stats.messagesSent++;

    return messageId;
  }

  /**
   * 接收消息（带去重）
   * @param {string} peerId - 发送方节点ID
   * @param {Object} message - 消息对象
   */
  async receiveMessage(peerId, message) {
    const { id, type, payload, compressed, requireAck } = message;

    // 去重检查
    if (this.isDuplicate(id)) {
      console.log('[MessageManager] 重复消息，已忽略:', id);
      this.stats.messagesDuplicated++;
      return null;
    }

    // 记录已接收消息
    this.receivedMessages.set(id, Date.now());

    // 解压缩（如果需要）
    let decompressedPayload = payload;
    if (compressed) {
      decompressedPayload = await this.decompressPayload(payload);
    }

    // 发送确认（如果需要）
    if (requireAck) {
      await this.sendAck(peerId, id);
    }

    this.stats.messagesReceived++;

    // 触发事件
    this.emit('message', {
      peerId,
      messageId: id,
      type,
      payload: decompressedPayload,
      timestamp: message.timestamp
    });

    return {
      id,
      type,
      payload: decompressedPayload
    };
  }

  /**
   * 接收批量消息
   */
  async receiveBatchMessages(peerId, messages) {
    console.log(`[MessageManager] 接收批量消息: ${messages.length}条`);

    const results = [];
    for (const message of messages) {
      try {
        const result = await this.receiveMessage(peerId, message);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        console.error('[MessageManager] 处理消息失败:', error);
      }
    }

    return results;
  }

  /**
   * 检查是否重复
   */
  isDuplicate(messageId) {
    return this.receivedMessages.has(messageId);
  }

  /**
   * 加入批量队列
   */
  queueMessage(peerId, message) {
    if (!this.outgoingQueue.has(peerId)) {
      this.outgoingQueue.set(peerId, []);
    }

    const queue = this.outgoingQueue.get(peerId);
    queue.push(message);

    // 达到批量大小，立即发送
    if (queue.length >= this.options.batchSize) {
      this.flushQueue(peerId);
    } else {
      // 设置定时器
      this.scheduleBatchSend(peerId);
    }
  }

  /**
   * 计划批量发送
   */
  scheduleBatchSend(peerId) {
    // 清除旧定时器
    if (this.batchTimers.has(peerId)) {
      clearTimeout(this.batchTimers.get(peerId));
    }

    // 设置新定时器
    const timer = setTimeout(() => {
      this.flushQueue(peerId);
    }, this.options.batchInterval);

    this.batchTimers.set(peerId, timer);
  }

  /**
   * 刷新队列（批量发送）
   */
  async flushQueue(peerId) {
    const queue = this.outgoingQueue.get(peerId);
    if (!queue || queue.length === 0) {return;}

    console.log(`[MessageManager] 批量发送 ${queue.length} 条消息到:`, peerId);

    // 清除定时器
    if (this.batchTimers.has(peerId)) {
      clearTimeout(this.batchTimers.get(peerId));
      this.batchTimers.delete(peerId);
    }

    // 发送批量消息
    try {
      await this.sendBatch(peerId, queue);
      this.stats.batchesSent++;
    } catch (error) {
      console.error('[MessageManager] 批量发送失败:', error);
      // 失败的消息重新加入队列
      // 这里简化处理，实际应该有更复杂的重试逻辑
    }

    // 清空队列
    this.outgoingQueue.set(peerId, []);
  }

  /**
   * 立即发送单条消息
   */
  async sendImmediately(peerId, message) {
    console.log('[MessageManager] 立即发送消息:', message.id);

    // 触发发送事件（由P2P Manager处理实际发送）
    this.emit('send', {
      peerId,
      message
    });
  }

  /**
   * 发送批量消息
   */
  async sendBatch(peerId, messages) {
    console.log(`[MessageManager] 发送批量消息: ${messages.length}条`);

    // 触发批量发送事件
    this.emit('send-batch', {
      peerId,
      messages
    });
  }

  /**
   * 发送确认
   */
  async sendAck(peerId, messageId) {
    const ackMessage = {
      id: this.generateMessageId(),
      type: 'message:ack',
      payload: {
        ackFor: messageId
      },
      timestamp: Date.now()
    };

    await this.sendImmediately(peerId, ackMessage);
  }

  /**
   * 等待确认
   */
  waitForAck(messageId, peerId, message) {
    const timeout = setTimeout(() => {
      console.warn('[MessageManager] 消息确认超时:', messageId);
      this.handleAckTimeout(messageId, peerId, message);
    }, this.options.retryInterval * this.options.maxRetries);

    this.pendingAcks.set(messageId, {
      message,
      peerId,
      timer: timeout
    });
  }

  /**
   * 接收确认
   */
  receiveAck(ackFor) {
    if (this.pendingAcks.has(ackFor)) {
      const { timer } = this.pendingAcks.get(ackFor);
      clearTimeout(timer);
      this.pendingAcks.delete(ackFor);

      console.log('[MessageManager] 收到消息确认:', ackFor);

      // 从已发送消息中移除
      this.sentMessages.delete(ackFor);
    }
  }

  /**
   * 处理确认超时
   */
  async handleAckTimeout(messageId, peerId, message) {
    const sentInfo = this.sentMessages.get(messageId);
    if (!sentInfo) {return;}

    if (sentInfo.retries < this.options.maxRetries) {
      // 重试
      console.log(`[MessageManager] 重试发送消息 (${sentInfo.retries + 1}/${this.options.maxRetries}):`, messageId);

      sentInfo.retries++;
      sentInfo.sentAt = Date.now();

      await this.sendImmediately(peerId, message);
      this.stats.messagesRetried++;

      // 重新等待确认
      this.waitForAck(messageId, peerId, message);
    } else {
      // 达到最大重试次数
      console.error('[MessageManager] 消息发送失败，已达最大重试次数:', messageId);

      this.emit('send-failed', {
        messageId,
        peerId,
        message
      });

      this.sentMessages.delete(messageId);
      this.pendingAcks.delete(messageId);
    }
  }

  /**
   * 判断是否需要压缩
   */
  shouldCompress(message) {
    const size = JSON.stringify(message.payload).length;
    return size >= this.options.compressionThreshold;
  }

  /**
   * 压缩payload
   */
  async compressPayload(payload) {
    // 使用zlib压缩
    const zlib = require('zlib');
    const buffer = Buffer.from(JSON.stringify(payload));

    return new Promise((resolve, reject) => {
      zlib.deflate(buffer, (err, compressed) => {
        if (err) {
          reject(err);
        } else {
          resolve(compressed.toString('base64'));
        }
      });
    });
  }

  /**
   * 解压缩payload
   */
  async decompressPayload(compressedPayload) {
    const zlib = require('zlib');
    const buffer = Buffer.from(compressedPayload, 'base64');

    return new Promise((resolve, reject) => {
      zlib.inflate(buffer, (err, decompressed) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(decompressed.toString()));
        }
      });
    });
  }

  /**
   * 启动清理定时器
   */
  startCleanupTimer() {
    setInterval(() => {
      this.cleanupExpiredData();
    }, 60000); // 每分钟清理一次
  }

  /**
   * 清理过期数据
   */
  cleanupExpiredData() {
    const now = Date.now();
    let cleanedCount = 0;

    // 清理过期的接收消息记录
    for (const [messageId, timestamp] of this.receivedMessages.entries()) {
      if (now - timestamp > this.options.deduplicationWindow) {
        this.receivedMessages.delete(messageId);
        cleanedCount++;
      }
    }

    // 限制缓存大小
    if (this.receivedMessages.size > this.options.maxDeduplicationCache) {
      const toDelete = this.receivedMessages.size - this.options.maxDeduplicationCache;
      const entries = Array.from(this.receivedMessages.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, toDelete);

      entries.forEach(([messageId]) => {
        this.receivedMessages.delete(messageId);
        cleanedCount++;
      });
    }

    if (cleanedCount > 0) {
      console.log(`[MessageManager] 清理 ${cleanedCount} 条过期消息记录`);
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      queuedMessages: Array.from(this.outgoingQueue.values())
        .reduce((sum, queue) => sum + queue.length, 0),
      pendingAcks: this.pendingAcks.size,
      deduplicationCacheSize: this.receivedMessages.size
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 清除所有定时器
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();

    for (const { timer } of this.pendingAcks.values()) {
      clearTimeout(timer);
    }
    this.pendingAcks.clear();

    // 清空队列
    this.outgoingQueue.clear();
    this.receivedMessages.clear();
    this.sentMessages.clear();
  }
}

module.exports = MessageManager;
