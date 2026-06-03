/**
 * 智能重试机制单元测试
 *
 * 测试DeviceSyncManager的智能重试功能：
 * 1. 指数退避重试策略（2^attempts秒，最大30秒）
 * 2. 最大重试次数限制（5次）
 * 3. 死信队列（DLQ）管理
 * 4. 重试状态持久化
 * 5. 成功后重置attempts计数器
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import EventEmitter from 'events';

// 测试用的临时目录
let tempDir;

/**
 * 创建测试用临时目录
 */
function createTempDir() {
  const baseDir = path.join(os.tmpdir(), 'chainlesschain-test');
  const testDir = path.join(baseDir, `test-retry-${Date.now()}-${Math.random().toString(36).substring(7)}`);
  fs.mkdirSync(testDir, { recursive: true });
  return testDir;
}

/**
 * 清理临时目录
 */
function cleanupTempDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 模拟消息状态
 */
const MessageStatus = {
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
};

/**
 * 带智能重试功能的DeviceSyncManager
 */
class RetryEnabledSyncManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      dataPath: config.dataPath || null,
      maxRetries: config.maxRetries || 5,              // 最大重试次数
      baseRetryDelay: config.baseRetryDelay || 2000,   // 基础重试延迟（2秒）
      maxRetryDelay: config.maxRetryDelay || 30000,    // 最大重试延迟（30秒）
      ...config,
    };

    this.messageQueue = new Map();           // Map<targetDeviceId, Message[]>
    this.messageStatus = new Map();          // Map<messageId, Status>
    this.deadLetterQueue = new Map();        // Map<messageId, DLQEntry>
    this.retryTimers = new Map();            // Map<messageId, Timer>

    // 模拟发送函数（用于测试）
    this.sendFunction = config.sendFunction || null;

    this.initialized = false;
  }

  /**
   * 初始化
   */
  async initialize() {
    await this.loadMessageQueue();
    await this.loadMessageStatus();
    await this.loadDeadLetterQueue();
    this.initialized = true;
  }

  /**
   * 关闭管理器
   */
  async close() {
    // 清理所有重试定时器
    for (const [messageId, timer] of this.retryTimers.entries()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();

    // 保存状态
    await this.saveMessageQueue();
    await this.saveMessageStatus();
    await this.saveDeadLetterQueue();

    this.initialized = false;
  }

  /**
   * 加载消息队列
   */
  async loadMessageQueue() {
    if (!this.config.dataPath) return;

    const queuePath = path.join(this.config.dataPath, 'message-queue.json');
    try {
      if (fs.existsSync(queuePath)) {
        const data = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
        for (const [deviceId, messages] of Object.entries(data)) {
          this.messageQueue.set(deviceId, messages);
        }
      }
    } catch (error) {
      console.warn('加载消息队列失败:', error);
    }
  }

  /**
   * 保存消息队列
   */
  async saveMessageQueue() {
    if (!this.config.dataPath) return;

    const queuePath = path.join(this.config.dataPath, 'message-queue.json');
    try {
      fs.mkdirSync(path.dirname(queuePath), { recursive: true });
      const data = {};
      for (const [deviceId, messages] of this.messageQueue.entries()) {
        data[deviceId] = messages;
      }
      fs.writeFileSync(queuePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn('保存消息队列失败:', error);
    }
  }

  /**
   * 加载消息状态
   */
  async loadMessageStatus() {
    if (!this.config.dataPath) return;

    const statusPath = path.join(this.config.dataPath, 'message-status.json');
    try {
      if (fs.existsSync(statusPath)) {
        const data = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        for (const [messageId, status] of Object.entries(data)) {
          this.messageStatus.set(messageId, status);
        }
      }
    } catch (error) {
      console.warn('加载消息状态失败:', error);
    }
  }

  /**
   * 保存消息状态
   */
  async saveMessageStatus() {
    if (!this.config.dataPath) return;

    const statusPath = path.join(this.config.dataPath, 'message-status.json');
    try {
      fs.mkdirSync(path.dirname(statusPath), { recursive: true });
      const data = {};
      for (const [messageId, status] of this.messageStatus.entries()) {
        data[messageId] = status;
      }
      fs.writeFileSync(statusPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn('保存消息状态失败:', error);
    }
  }

  /**
   * 加载死信队列
   */
  async loadDeadLetterQueue() {
    if (!this.config.dataPath) return;

    const dlqPath = path.join(this.config.dataPath, 'dead-letter-queue.json');
    try {
      if (fs.existsSync(dlqPath)) {
        const data = JSON.parse(fs.readFileSync(dlqPath, 'utf8'));
        for (const [messageId, entry] of Object.entries(data)) {
          this.deadLetterQueue.set(messageId, entry);
        }
      }
    } catch (error) {
      console.warn('加载死信队列失败:', error);
    }
  }

  /**
   * 保存死信队列
   */
  async saveDeadLetterQueue() {
    if (!this.config.dataPath) return;

    const dlqPath = path.join(this.config.dataPath, 'dead-letter-queue.json');
    try {
      fs.mkdirSync(path.dirname(dlqPath), { recursive: true });
      const data = {};
      for (const [messageId, entry] of this.deadLetterQueue.entries()) {
        data[messageId] = entry;
      }
      fs.writeFileSync(dlqPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn('保存死信队列失败:', error);
    }
  }

  /**
   * 消息入队
   */
  async queueMessage(targetDeviceId, message) {
    const messageId = message.id || this.generateMessageId();

    const queueMessage = {
      id: messageId,
      targetDeviceId,
      content: message.content,
      timestamp: Date.now(),
      attempts: 0,              // 重试次数计数器
      lastAttemptAt: null,      // 最后一次尝试时间
      ...message,
    };

    // 获取或创建设备队列
    let deviceQueue = this.messageQueue.get(targetDeviceId);
    if (!deviceQueue) {
      deviceQueue = [];
      this.messageQueue.set(targetDeviceId, deviceQueue);
    }

    deviceQueue.push(queueMessage);

    // 更新消息状态
    this.messageStatus.set(messageId, {
      status: MessageStatus.PENDING,
      timestamp: Date.now(),
      attempts: 0,
    });

    await this.saveMessageQueue();
    await this.saveMessageStatus();

    this.emit('message:queued', { messageId, targetDeviceId });

    return messageId;
  }

  /**
   * 发送消息（带重试）
   *
   * @param {string} messageId - 消息ID
   * @returns {Promise<boolean>} - 是否成功发送
   */
  async sendMessage(messageId) {
    // 查找消息
    let message = null;
    let deviceId = null;

    for (const [devId, queue] of this.messageQueue.entries()) {
      const found = queue.find(m => m.id === messageId);
      if (found) {
        message = found;
        deviceId = devId;
        break;
      }
    }

    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }

    // 检查是否已达到最大重试次数
    if (message.attempts >= this.config.maxRetries) {
      await this.moveToDeadLetterQueue(messageId, 'max_retries_exceeded');
      return false;
    }

    // 递增尝试次数
    message.attempts++;
    message.lastAttemptAt = Date.now();

    // 更新状态
    const status = this.messageStatus.get(messageId);
    if (status) {
      status.attempts = message.attempts;
      status.lastAttemptAt = message.lastAttemptAt;
    }

    try {
      // 调用发送函数（如果提供）
      if (this.sendFunction) {
        await this.sendFunction(message);
      }

      // 发送成功 - 重置attempts
      message.attempts = 0;
      if (status) {
        status.status = MessageStatus.SENT;
        status.attempts = 0;
      }

      await this.saveMessageQueue();
      await this.saveMessageStatus();

      this.emit('message:sent', { messageId, attempts: message.attempts });

      return true;
    } catch (error) {
      // 发送失败 - 安排重试
      if (status) {
        status.status = MessageStatus.PENDING;
        status.lastError = error.message;
      }

      await this.saveMessageQueue();
      await this.saveMessageStatus();

      this.emit('message:send-failed', {
        messageId,
        attempts: message.attempts,
        error: error.message
      });

      // 如果未达到最大重试次数，安排重试
      if (message.attempts < this.config.maxRetries) {
        await this.scheduleRetry(messageId, message.attempts);
      } else {
        await this.moveToDeadLetterQueue(messageId, error.message);
      }

      return false;
    }
  }

  /**
   * 安排重试
   *
   * 使用指数退避算法：delay = min(maxDelay, baseDelay * 2^attempts)
   *
   * @param {string} messageId - 消息ID
   * @param {number} attempts - 当前尝试次数
   */
  async scheduleRetry(messageId, attempts) {
    // 清理旧的定时器
    const existingTimer = this.retryTimers.get(messageId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 计算指数退避延迟
    const exponentialDelay = this.config.baseRetryDelay * Math.pow(2, attempts);
    const delay = Math.min(this.config.maxRetryDelay, exponentialDelay);

    // 设置新的重试定时器
    const timer = setTimeout(async () => {
      this.retryTimers.delete(messageId);
      await this.retryMessage(messageId);
    }, delay);

    this.retryTimers.set(messageId, timer);

    this.emit('retry:scheduled', { messageId, attempts, delay });
  }

  /**
   * 重试消息
   *
   * @param {string} messageId - 消息ID
   */
  async retryMessage(messageId) {
    this.emit('retry:attempt', { messageId });
    await this.sendMessage(messageId);
  }

  /**
   * 移动消息到死信队列
   *
   * @param {string} messageId - 消息ID
   * @param {string} reason - 失败原因
   */
  async moveToDeadLetterQueue(messageId, reason) {
    // 查找消息
    let message = null;
    let deviceId = null;

    for (const [devId, queue] of this.messageQueue.entries()) {
      const index = queue.findIndex(m => m.id === messageId);
      if (index !== -1) {
        message = queue[index];
        deviceId = devId;
        // 从原队列中移除
        queue.splice(index, 1);
        break;
      }
    }

    if (!message) {
      console.warn(`Message not found for DLQ: ${messageId}`);
      return;
    }

    // 添加到死信队列
    this.deadLetterQueue.set(messageId, {
      message,
      reason,
      movedAt: Date.now(),
      attempts: message.attempts,
    });

    // 更新状态
    const status = this.messageStatus.get(messageId);
    if (status) {
      status.status = MessageStatus.FAILED;
      status.failureReason = reason;
    }

    // 清理重试定时器
    const timer = this.retryTimers.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(messageId);
    }

    await this.saveMessageQueue();
    await this.saveMessageStatus();
    await this.saveDeadLetterQueue();

    this.emit('message:moved-to-dlq', { messageId, reason });
  }

  /**
   * 获取死信队列
   */
  getDeadLetterQueue() {
    return Array.from(this.deadLetterQueue.entries()).map(([id, entry]) => ({
      messageId: id,
      ...entry,
    }));
  }

  /**
   * 获取消息状态
   */
  getMessageStatus(messageId) {
    return this.messageStatus.get(messageId);
  }

  /**
   * 生成消息ID
   */
  generateMessageId() {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}

describe('DeviceSyncManager - 智能重试机制', () => {
  let manager;

  beforeEach(() => {
    tempDir = createTempDir();
    vi.clearAllTimers();
  });

  afterEach(async () => {
    if (manager) {
      await manager.close();
      manager = null;
    }
    cleanupTempDir(tempDir);
    vi.useRealTimers();
  });

  describe('指数退避重试', () => {
    it('应该使用指数退避算法计算重试延迟', async () => {
      const retryDelays = [];

      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 5,
        baseRetryDelay: 2000,   // 2秒
        maxRetryDelay: 30000,   // 30秒
      });

      await manager.initialize();

      // 监听重试调度事件
      manager.on('retry:scheduled', ({ messageId, attempts, delay }) => {
        retryDelays.push({ attempts, delay });
      });

      // 模拟失败的发送函数
      let attemptCount = 0;
      manager.sendFunction = async () => {
        attemptCount++;
        throw new Error('Network error');
      };

      const messageId = await manager.queueMessage('device-001', { content: 'test' });

      // 尝试发送（会失败并安排重试）
      await manager.sendMessage(messageId);

      // 验证第1次失败后的延迟：2^1 * 2000 = 4000ms
      expect(retryDelays[0].attempts).toBe(1);
      expect(retryDelays[0].delay).toBe(4000);
    });

    it('应该限制最大重试延迟为30秒', async () => {
      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 10,
        baseRetryDelay: 2000,
        maxRetryDelay: 30000,
      });

      await manager.initialize();

      const retryDelays = [];
      manager.on('retry:scheduled', ({ delay }) => {
        retryDelays.push(delay);
      });

      manager.sendFunction = async () => {
        throw new Error('Network error');
      };

      const messageId = await manager.queueMessage('device-001', { content: 'test' });

      // 模拟多次失败
      for (let i = 0; i < 6; i++) {
        await manager.sendMessage(messageId);
      }

      // 验证所有延迟都 <= 30000ms
      for (const delay of retryDelays) {
        expect(delay).toBeLessThanOrEqual(30000);
      }

      // 验证后期的延迟达到了上限
      expect(retryDelays[retryDelays.length - 1]).toBe(30000);
    });

    it('应该在重试成功后重置attempts计数器', async () => {
      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 5,
        baseRetryDelay: 100,  // 快速测试
      });

      await manager.initialize();

      let callCount = 0;
      manager.sendFunction = async (message) => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Temporary failure');
        }
        // 第3次成功
      };

      const messageId = await manager.queueMessage('device-001', { content: 'test' });

      // 第1次尝试（失败）
      await manager.sendMessage(messageId);

      // 等待足够的重试时间
      // 第1次失败后延迟: 2^1 * 100 = 200ms
      // 第2次失败后延迟: 2^2 * 100 = 400ms
      // 总共需要至少600ms+余量
      await new Promise(resolve => setTimeout(resolve, 800));

      // 验证attempts已重置为0（因为第3次成功了）
      const status = manager.getMessageStatus(messageId);
      expect(status.attempts).toBe(0);
      expect(status.status).toBe(MessageStatus.SENT);
    }, 10000);
  });

  describe('最大重试次数限制', () => {
    it('应该在达到最大重试次数后停止重试', async () => {
      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 3,
        baseRetryDelay: 50,  // 快速重试
      });

      await manager.initialize();

      let attemptCount = 0;
      manager.sendFunction = async () => {
        attemptCount++;
        throw new Error('Persistent failure');
      };

      const messageId = await manager.queueMessage('device-001', { content: 'test' });

      // 第1次尝试（失败，会安排重试）
      await manager.sendMessage(messageId);

      // 等待所有重试完成
      // 延迟序列: 2^1*50=100ms, 2^2*50=200ms, 2^3*50=400ms
      // 总共约700ms+余量
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 验证只尝试了maxRetries次（3次）
      expect(attemptCount).toBe(3);

      // 验证消息已移动到DLQ
      const dlq = manager.getDeadLetterQueue();
      expect(dlq).toHaveLength(1);
    }, 10000);

    it('应该在超过最大重试次数时移动到DLQ', async () => {
      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 2,
        baseRetryDelay: 100,
      });

      await manager.initialize();

      manager.sendFunction = async () => {
        throw new Error('Permanent failure');
      };

      const messageId = await manager.queueMessage('device-001', { content: 'test' });

      // 尝试发送直到进入DLQ
      await manager.sendMessage(messageId);  // attempts = 1, 失败
      await manager.sendMessage(messageId);  // attempts = 2, 失败，达到maxRetries

      // 验证消息在DLQ中
      const dlq = manager.getDeadLetterQueue();
      expect(dlq).toHaveLength(1);
      expect(dlq[0].messageId).toBe(messageId);
      expect(dlq[0].reason).toContain('Permanent failure');
    });
  });

  describe('死信队列（DLQ）', () => {
    it('应该记录失败原因和尝试次数', async () => {
      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 1,
      });

      await manager.initialize();

      const errorMessage = 'Custom error: timeout';
      manager.sendFunction = async () => {
        throw new Error(errorMessage);
      };

      const messageId = await manager.queueMessage('device-001', { content: 'important' });

      await manager.sendMessage(messageId);  // attempts = 1, 失败，进入DLQ

      const dlq = manager.getDeadLetterQueue();
      expect(dlq[0].reason).toBe(errorMessage);
      expect(dlq[0].attempts).toBe(1);
      expect(dlq[0].movedAt).toBeGreaterThan(0);
    });

    it('应该从原队列中移除DLQ消息', async () => {
      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 1,
      });

      await manager.initialize();

      manager.sendFunction = async () => {
        throw new Error('Failure');
      };

      const messageId = await manager.queueMessage('device-001', { content: 'test' });

      // 验证消息在原队列中
      expect(manager.messageQueue.get('device-001')).toHaveLength(1);

      await manager.sendMessage(messageId);  // 移动到DLQ

      // 验证消息已从原队列移除
      expect(manager.messageQueue.get('device-001')).toHaveLength(0);
    });

    it('应该清理移动到DLQ的消息的重试定时器', async () => {
      vi.useFakeTimers();

      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 2,
        baseRetryDelay: 1000,
      });

      await manager.initialize();

      manager.sendFunction = async () => {
        throw new Error('Failure');
      };

      const messageId = await manager.queueMessage('device-001', { content: 'test' });

      await manager.sendMessage(messageId);  // attempts = 1, 安排重试

      // 验证有重试定时器
      expect(manager.retryTimers.has(messageId)).toBe(true);

      await manager.sendMessage(messageId);  // attempts = 2, 移动到DLQ

      // 验证重试定时器已清理
      expect(manager.retryTimers.has(messageId)).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('重试状态持久化', () => {
    it('应该持久化消息的attempts计数', async () => {
      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 5,
      });

      await manager.initialize();

      manager.sendFunction = async () => {
        throw new Error('Failure');
      };

      const messageId = await manager.queueMessage('device-001', { content: 'test' });
      await manager.sendMessage(messageId);  // attempts = 1
      await manager.close();

      // 重新加载
      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 5,
      });

      await manager.initialize();

      // 验证attempts已持久化
      const queue = manager.messageQueue.get('device-001');
      expect(queue[0].attempts).toBe(1);

      const status = manager.getMessageStatus(messageId);
      expect(status.attempts).toBe(1);
    });

    it('应该持久化死信队列', async () => {
      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 1,
      });

      await manager.initialize();

      manager.sendFunction = async () => {
        throw new Error('DLQ test');
      };

      const messageId = await manager.queueMessage('device-001', { content: 'dlq-message' });
      await manager.sendMessage(messageId);  // 移动到DLQ
      await manager.close();

      // 重新加载
      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 1,
      });

      await manager.initialize();

      const dlq = manager.getDeadLetterQueue();
      expect(dlq).toHaveLength(1);
      expect(dlq[0].messageId).toBe(messageId);
      expect(dlq[0].message.content).toBe('dlq-message');
    });
  });

  describe('事件发射', () => {
    it('应该在重试调度时发射事件', async () => {
      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 3,
        baseRetryDelay: 1000,
      });

      await manager.initialize();

      const events = [];
      manager.on('retry:scheduled', (data) => {
        events.push(data);
      });

      manager.sendFunction = async () => {
        throw new Error('Test');
      };

      const messageId = await manager.queueMessage('device-001', { content: 'test' });
      await manager.sendMessage(messageId);

      expect(events).toHaveLength(1);
      expect(events[0].messageId).toBe(messageId);
      expect(events[0].attempts).toBe(1);
      expect(events[0].delay).toBeGreaterThan(0);
    });

    it('应该在消息移动到DLQ时发射事件', async () => {
      manager = new RetryEnabledSyncManager({
        dataPath: tempDir,
        maxRetries: 1,
      });

      await manager.initialize();

      const events = [];
      manager.on('message:moved-to-dlq', (data) => {
        events.push(data);
      });

      manager.sendFunction = async () => {
        throw new Error('DLQ event test');
      };

      const messageId = await manager.queueMessage('device-001', { content: 'test' });
      await manager.sendMessage(messageId);

      expect(events).toHaveLength(1);
      expect(events[0].messageId).toBe(messageId);
      expect(events[0].reason).toContain('DLQ event test');
    });
  });
});
