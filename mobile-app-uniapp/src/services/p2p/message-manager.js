/**
 * 消息管理器 - 移动端版本
 *
 * 功能：
 * - 消息ID生成和管理
 * - 消息去重（基于ID）
 * - 批量消息发送
 * - 消息确认和重传
 */

class MessageManager {
  constructor(options = {}) {
    this.options = {
      batchSize: options.batchSize || 10,
      batchInterval: options.batchInterval || 100,
      deduplicationWindow: options.deduplicationWindow || 60000,
      maxDeduplicationCache: options.maxDeduplicationCache || 10000,
      enableRetry: options.enableRetry !== false,
      maxRetries: options.maxRetries || 3,
      retryInterval: options.retryInterval || 1000,
      ...options
    }

    // 消息队列
    this.outgoingQueue = new Map()
    this.batchTimers = new Map()

    // 去重缓存
    this.receivedMessages = new Map()
    this.sentMessages = new Map()

    // 待确认消息
    this.pendingAcks = new Map()

    // 事件监听器
    this.eventListeners = new Map()

    // 统计信息
    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      messagesDuplicated: 0,
      messagesRetried: 0,
      batchesSent: 0
    }

    // 定期清理
    this.startCleanupTimer()
  }

  /**
   * 生成消息ID
   */
  generateMessageId() {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 10)
    const counter = this.stats.messagesSent

    return `${timestamp}-${random}-${counter}`
  }

  /**
   * 发送消息
   */
  async sendMessage(peerId, payload, options = {}) {
    const {
      priority = 'normal',
      requireAck = false,
      immediate = false
    } = options

    const messageId = this.generateMessageId()

    const message = {
      id: messageId,
      type: payload.type,
      payload: payload,
      timestamp: Date.now(),
      priority,
      requireAck
    }

    this.sentMessages.set(messageId, {
      message,
      peerId,
      sentAt: Date.now(),
      retries: 0
    })

    if (priority === 'high' || immediate) {
      await this.sendImmediately(peerId, message)
    } else {
      this.queueMessage(peerId, message)
    }

    if (requireAck) {
      this.waitForAck(messageId, peerId, message)
    }

    this.stats.messagesSent++

    return messageId
  }

  /**
   * 接收消息
   */
  async receiveMessage(peerId, message) {
    const { id, type, payload, requireAck } = message

    if (this.isDuplicate(id)) {
      console.log('[MessageManager] 重复消息，已忽略:', id)
      this.stats.messagesDuplicated++
      return null
    }

    this.receivedMessages.set(id, Date.now())

    if (requireAck) {
      await this.sendAck(peerId, id)
    }

    this.stats.messagesReceived++

    this.emit('message', {
      peerId,
      messageId: id,
      type,
      payload,
      timestamp: message.timestamp
    })

    return {
      id,
      type,
      payload
    }
  }

  /**
   * 接收批量消息
   */
  async receiveBatchMessages(peerId, messages) {
    console.log(`[MessageManager] 接收批量消息: ${messages.length}条`)

    const results = []
    for (const message of messages) {
      try {
        const result = await this.receiveMessage(peerId, message)
        if (result) {
          results.push(result)
        }
      } catch (error) {
        console.error('[MessageManager] 处理消息失败:', error)
      }
    }

    return results
  }

  /**
   * 检查是否重复
   */
  isDuplicate(messageId) {
    return this.receivedMessages.has(messageId)
  }

  /**
   * 加入批量队列
   */
  queueMessage(peerId, message) {
    if (!this.outgoingQueue.has(peerId)) {
      this.outgoingQueue.set(peerId, [])
    }

    const queue = this.outgoingQueue.get(peerId)
    queue.push(message)

    if (queue.length >= this.options.batchSize) {
      this.flushQueue(peerId)
    } else {
      this.scheduleBatchSend(peerId)
    }
  }

  /**
   * 计划批量发送
   */
  scheduleBatchSend(peerId) {
    if (this.batchTimers.has(peerId)) {
      clearTimeout(this.batchTimers.get(peerId))
    }

    const timer = setTimeout(() => {
      this.flushQueue(peerId)
    }, this.options.batchInterval)

    this.batchTimers.set(peerId, timer)
  }

  /**
   * 刷新队列
   */
  async flushQueue(peerId) {
    const queue = this.outgoingQueue.get(peerId)
    if (!queue || queue.length === 0) return

    console.log(`[MessageManager] 批量发送 ${queue.length} 条消息`)

    if (this.batchTimers.has(peerId)) {
      clearTimeout(this.batchTimers.get(peerId))
      this.batchTimers.delete(peerId)
    }

    try {
      await this.sendBatch(peerId, queue)
      this.stats.batchesSent++
    } catch (error) {
      console.error('[MessageManager] 批量发送失败:', error)
    }

    this.outgoingQueue.set(peerId, [])
  }

  /**
   * 立即发送
   */
  async sendImmediately(peerId, message) {
    console.log('[MessageManager] 立即发送消息:', message.id)

    this.emit('send', {
      peerId,
      message
    })
  }

  /**
   * 发送批量消息
   */
  async sendBatch(peerId, messages) {
    console.log(`[MessageManager] 发送批量消息: ${messages.length}条`)

    this.emit('send-batch', {
      peerId,
      messages
    })
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
    }

    await this.sendImmediately(peerId, ackMessage)
  }

  /**
   * 等待确认
   */
  waitForAck(messageId, peerId, message) {
    const timeout = setTimeout(() => {
      console.warn('[MessageManager] 消息确认超时:', messageId)
      this.handleAckTimeout(messageId, peerId, message)
    }, this.options.retryInterval * this.options.maxRetries)

    this.pendingAcks.set(messageId, {
      message,
      peerId,
      timer: timeout
    })
  }

  /**
   * 接收确认
   */
  receiveAck(ackFor) {
    if (this.pendingAcks.has(ackFor)) {
      const { timer } = this.pendingAcks.get(ackFor)
      clearTimeout(timer)
      this.pendingAcks.delete(ackFor)

      console.log('[MessageManager] 收到消息确认:', ackFor)
      this.sentMessages.delete(ackFor)
    }
  }

  /**
   * 处理确认超时
   */
  async handleAckTimeout(messageId, peerId, message) {
    const sentInfo = this.sentMessages.get(messageId)
    if (!sentInfo) return

    if (sentInfo.retries < this.options.maxRetries) {
      console.log(`[MessageManager] 重试发送 (${sentInfo.retries + 1}/${this.options.maxRetries}):`, messageId)

      sentInfo.retries++
      sentInfo.sentAt = Date.now()

      await this.sendImmediately(peerId, message)
      this.stats.messagesRetried++

      this.waitForAck(messageId, peerId, message)
    } else {
      console.error('[MessageManager] 消息发送失败:', messageId)

      this.emit('send-failed', {
        messageId,
        peerId,
        message
      })

      this.sentMessages.delete(messageId)
      this.pendingAcks.delete(messageId)
    }
  }

  /**
   * 启动清理定时器
   */
  startCleanupTimer() {
    setInterval(() => {
      this.cleanupExpiredData()
    }, 60000)
  }

  /**
   * 清理过期数据
   */
  cleanupExpiredData() {
    const now = Date.now()
    let cleanedCount = 0

    for (const [messageId, timestamp] of this.receivedMessages.entries()) {
      if (now - timestamp > this.options.deduplicationWindow) {
        this.receivedMessages.delete(messageId)
        cleanedCount++
      }
    }

    if (this.receivedMessages.size > this.options.maxDeduplicationCache) {
      const toDelete = this.receivedMessages.size - this.options.maxDeduplicationCache
      const entries = Array.from(this.receivedMessages.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, toDelete)

      entries.forEach(([messageId]) => {
        this.receivedMessages.delete(messageId)
        cleanedCount++
      })
    }

    if (cleanedCount > 0) {
      console.log(`[MessageManager] 清理 ${cleanedCount} 条过期消息`)
    }
  }

  /**
   * 事件监听
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event).push(callback)
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.forEach(callback => callback(data))
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
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer)
    }
    this.batchTimers.clear()

    for (const { timer } of this.pendingAcks.values()) {
      clearTimeout(timer)
    }
    this.pendingAcks.clear()

    this.outgoingQueue.clear()
    this.receivedMessages.clear()
    this.sentMessages.clear()
  }
}

// 导出单例
let messageManagerInstance = null

export function getMessageManager(options) {
  if (!messageManagerInstance) {
    messageManagerInstance = new MessageManager(options)
  }
  return messageManagerInstance
}

export default MessageManager
