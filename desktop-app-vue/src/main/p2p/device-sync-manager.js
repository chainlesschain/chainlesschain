/**
 * 设备同步管理器
 *
 * 负责多设备间的消息同步和状态管理
 * 功能: 离线消息队列、消息状态同步、设备间数据同步
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const {
  assertDeviceId,
  cloneBoundedMessage,
  readBoundedJsonFile,
  resolveDeviceSyncLimits,
} = require("./device-sync-boundaries");

// M2: _deps injection so tests can mock fs.promises (vi.mock cannot
// intercept fs.promises for inlined CJS modules)
const _deps = { fsp: fs.promises };

/**
 * 消息状态
 */
const MessageStatus = {
  PENDING: "pending", // 等待发送
  SENT: "sent", // 已发送到服务器/对等节点
  DELIVERED: "delivered", // 已送达目标设备
  READ: "read", // 已读
  FAILED: "failed", // 发送失败
};

/**
 * 同步消息类型
 */
const SyncMessageType = {
  MESSAGE_DELIVERY: "message-delivery", // 消息投递
  MESSAGE_STATUS: "message-status", // 消息状态更新
  DEVICE_STATUS: "device-status", // 设备状态更新
  SYNC_REQUEST: "sync-request", // 同步请求
  SYNC_RESPONSE: "sync-response", // 同步响应
};

/**
 * 设备同步管理器类
 */
class DeviceSyncManager extends EventEmitter {
  constructor(config = {}) {
    super();

    const requestedLimits = { ...(config.limits || {}) };
    if (config.maxQueueSize !== undefined) {
      requestedLimits.maxQueueSize = config.maxQueueSize;
    }
    this.limits = resolveDeviceSyncLimits(requestedLimits);
    this.statusLimits = Object.freeze({
      ...this.limits,
      maxMessageBytes: this.limits.maxStatusBytes,
    });

    this.config = {
      dataPath: config.dataPath || null,
      userId: config.userId || null,
      deviceId: config.deviceId || null,
      maxQueueSize: this.limits.maxQueueSize, // 最大队列大小
      syncInterval: config.syncInterval || 30000, // 同步间隔 (30秒)
      messageRetention: config.messageRetention || 7, // 消息保留天数
      ...config,
    };

    this.messageQueue = new Map(); // Map<targetDeviceId, Message[]>
    this.messageStatus = new Map(); // Map<messageId, Status>
    this.deviceStatus = new Map(); // Map<deviceId, DeviceStatus>
    this.syncTimers = new Map(); // Map<deviceId, Timer>
    this.syncTasks = new Map();
    this.queueBytesByDevice = new Map();
    this.totalQueueBytes = 0;
    this.totalQueueMessages = 0;
    this.deliveryHandler = null;
    this.cleanupPromise = null;
    this.closed = false;
    this.closePromise = null;
    this.initialized = false;
  }

  _clearQueueState() {
    this.messageQueue.clear();
    this.queueBytesByDevice.clear();
    this.totalQueueBytes = 0;
    this.totalQueueMessages = 0;
  }

  _rebuildQueueAccounting() {
    this.queueBytesByDevice.clear();
    this.totalQueueBytes = 0;
    this.totalQueueMessages = 0;
    for (const [deviceId, queue] of this.messageQueue) {
      let queueBytes = 0;
      for (const message of queue) {
        queueBytes += cloneBoundedMessage(message, this.limits).byteLength;
      }
      this.queueBytesByDevice.set(deviceId, queueBytes);
      this.totalQueueBytes += queueBytes;
      this.totalQueueMessages += queue.length;
    }
  }

  _removeQueuedMessage(deviceId, queue, index) {
    const [removed] = queue.splice(index, 1);
    if (!removed) {
      return null;
    }
    const { byteLength } = cloneBoundedMessage(removed, this.limits);
    const remainingBytes = Math.max(
      0,
      (this.queueBytesByDevice.get(deviceId) || 0) - byteLength,
    );
    this.totalQueueBytes = Math.max(0, this.totalQueueBytes - byteLength);
    this.totalQueueMessages = Math.max(0, this.totalQueueMessages - 1);
    if (queue.length === 0) {
      this.messageQueue.delete(deviceId);
      this.queueBytesByDevice.delete(deviceId);
    } else {
      this.queueBytesByDevice.set(deviceId, remainingBytes);
    }
    return removed;
  }

  _admitLoadedMessage(deviceId, message) {
    assertDeviceId(deviceId, this.limits);
    const { value, byteLength } = cloneBoundedMessage(message, this.limits);
    let queue = this.messageQueue.get(deviceId);
    if (!queue) {
      if (this.messageQueue.size >= this.limits.maxDevices) {
        return false;
      }
      queue = [];
    }
    const queueBytes = this.queueBytesByDevice.get(deviceId) || 0;
    if (
      queue.length >= this.limits.maxQueueSize ||
      queueBytes + byteLength > this.limits.maxQueueBytes ||
      this.totalQueueMessages >= this.limits.maxTotalMessages ||
      this.totalQueueBytes + byteLength > this.limits.maxTotalQueueBytes
    ) {
      return false;
    }
    if (!this.messageQueue.has(deviceId)) {
      this.messageQueue.set(deviceId, queue);
    }
    queue.push(value);
    this.queueBytesByDevice.set(deviceId, queueBytes + byteLength);
    this.totalQueueMessages += 1;
    this.totalQueueBytes += byteLength;
    return true;
  }

  setDeliveryHandler(handler) {
    if (handler !== null && typeof handler !== "function") {
      throw new TypeError("delivery handler must be a function or null");
    }
    if (this.closed && handler) {
      throw new Error("DeviceSyncManager is closed");
    }
    this.deliveryHandler = handler;
  }

  /**
   * 初始化同步管理器
   */
  async initialize() {
    if (this.closed) {
      throw new Error("DeviceSyncManager is closed");
    }
    logger.info("[DeviceSyncManager] 初始化设备同步管理器...");

    try {
      // 加载持久化的消息队列
      await this.loadMessageQueue();

      // 加载消息状态
      await this.loadMessageStatus();

      // 启动定期清理
      this.startCleanupTimer();

      this.initialized = true;
      logger.info("[DeviceSyncManager] 设备同步管理器已初始化");

      this.emit("initialized");
    } catch (error) {
      logger.error("[DeviceSyncManager] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 加载消息队列
   */
  async loadMessageQueue() {
    if (!this.config.dataPath) {
      logger.info("[DeviceSyncManager] 无数据路径，使用内存队列");
      return;
    }

    const queuePath = path.join(this.config.dataPath, "message-queue.json");

    // M2: 异步读取，避免启动期阻塞事件循环
    try {
      const queueData = await readBoundedJsonFile(
        _deps.fsp,
        queuePath,
        this.limits,
      );
      if (
        !queueData ||
        typeof queueData !== "object" ||
        Array.isArray(queueData)
      ) {
        throw new TypeError("persisted message queue must be an object");
      }

      this._clearQueueState();
      for (const [deviceId, messages] of Object.entries(queueData)) {
        if (!Array.isArray(messages)) {
          continue;
        }
        for (const message of messages.slice(-this.limits.maxQueueSize)) {
          this._admitLoadedMessage(deviceId, message);
        }
      }

      logger.info(
        "[DeviceSyncManager] 已加载消息队列:",
        this.messageQueue.size,
        "个设备",
      );
    } catch (error) {
      this._clearQueueState();
      if (error.code !== "ENOENT") {
        logger.warn("[DeviceSyncManager] 加载消息队列失败:", error.message);
      }
    }
  }

  /**
   * 保存消息队列
   */
  async saveMessageQueue() {
    if (!this.config.dataPath) {
      return;
    }

    const queuePath = path.join(this.config.dataPath, "message-queue.json");

    try {
      await _deps.fsp.mkdir(path.dirname(queuePath), { recursive: true });

      // 转换 Map 为对象
      const queueData = {};
      for (const [deviceId, messages] of this.messageQueue.entries()) {
        queueData[deviceId] = messages;
      }

      const serialized = JSON.stringify(queueData, null, 2);
      if (
        Buffer.byteLength(serialized, "utf8") > this.limits.maxPersistedBytes
      ) {
        throw new Error("persisted message queue exceeds byte limit");
      }
      await _deps.fsp.writeFile(queuePath, serialized);
    } catch (error) {
      logger.warn("[DeviceSyncManager] 保存消息队列失败:", error.message);
    }
  }

  /**
   * 加载消息状态
   */
  async loadMessageStatus() {
    if (!this.config.dataPath) {
      logger.info("[DeviceSyncManager] 无数据路径，使用内存状态");
      return;
    }

    const statusPath = path.join(this.config.dataPath, "message-status.json");

    // M2: 异步读取，避免启动期阻塞事件循环
    try {
      const statusData = await readBoundedJsonFile(
        _deps.fsp,
        statusPath,
        this.limits,
      );
      if (
        !statusData ||
        typeof statusData !== "object" ||
        Array.isArray(statusData)
      ) {
        throw new TypeError("persisted message status must be an object");
      }

      this.messageStatus.clear();
      const entries = Object.entries(statusData).slice(
        -this.limits.maxStatusEntries,
      );
      for (const [messageId, status] of entries) {
        assertDeviceId(messageId, this.limits);
        const { value } = cloneBoundedMessage(status, this.statusLimits);
        this.messageStatus.set(messageId, value);
      }

      logger.info(
        "[DeviceSyncManager] 已加载消息状态:",
        this.messageStatus.size,
        "条消息",
      );
    } catch (error) {
      this.messageStatus.clear();
      if (error.code !== "ENOENT") {
        logger.warn("[DeviceSyncManager] 加载消息状态失败:", error.message);
      }
    }
  }

  /**
   * 保存消息状态
   */
  async saveMessageStatus() {
    if (!this.config.dataPath) {
      return;
    }

    const statusPath = path.join(this.config.dataPath, "message-status.json");

    try {
      await _deps.fsp.mkdir(path.dirname(statusPath), { recursive: true });

      // 转换 Map 为对象
      const statusData = {};
      for (const [messageId, status] of this.messageStatus.entries()) {
        statusData[messageId] = status;
      }

      const serialized = JSON.stringify(statusData, null, 2);
      if (
        Buffer.byteLength(serialized, "utf8") > this.limits.maxPersistedBytes
      ) {
        throw new Error("persisted message status exceeds byte limit");
      }
      await _deps.fsp.writeFile(statusPath, serialized);
    } catch (error) {
      logger.warn("[DeviceSyncManager] 保存消息状态失败:", error.message);
    }
  }

  /**
   * 将消息加入队列
   * @param {string} targetDeviceId - 目标设备ID
   * @param {Object} message - 消息对象
   */
  async queueMessage(targetDeviceId, message) {
    try {
      if (this.closed) {
        throw new Error("DeviceSyncManager is closed");
      }
      assertDeviceId(targetDeviceId, this.limits);
      // 生成消息ID
      const messageId = message.id || this.generateMessageId();
      assertDeviceId(messageId, this.limits);

      const queueMessage = {
        ...message,
        id: messageId,
        targetDeviceId,
        targetPeerId: message.targetPeerId,
        content: message.content,
        encrypted: message.encrypted || false,
        timestamp: Date.now(),
        attempts: 0,
        status: MessageStatus.PENDING,
      };
      const admitted = cloneBoundedMessage(queueMessage, this.limits);

      let deviceQueue = this.messageQueue.get(targetDeviceId) || [];
      if (
        !this.messageQueue.has(targetDeviceId) &&
        this.messageQueue.size >= this.limits.maxDevices
      ) {
        const error = new Error("device sync device capacity reached");
        error.code = "DEVICE_SYNC_DEVICE_CAPACITY";
        throw error;
      }

      const existingBytes = this.queueBytesByDevice.get(targetDeviceId) || 0;
      let dropCount = 0;
      let droppedBytes = 0;
      while (
        deviceQueue.length - dropCount >= this.limits.maxQueueSize ||
        existingBytes - droppedBytes + admitted.byteLength >
          this.limits.maxQueueBytes
      ) {
        const candidate = deviceQueue[dropCount];
        if (!candidate) {
          break;
        }
        droppedBytes += cloneBoundedMessage(candidate, this.limits).byteLength;
        dropCount += 1;
      }
      if (
        this.totalQueueMessages - dropCount + 1 >
          this.limits.maxTotalMessages ||
        this.totalQueueBytes - droppedBytes + admitted.byteLength >
          this.limits.maxTotalQueueBytes
      ) {
        const error = new Error("device sync total queue capacity reached");
        error.code = "DEVICE_SYNC_QUEUE_CAPACITY";
        throw error;
      }

      if (!this.messageQueue.has(targetDeviceId)) {
        this.messageQueue.set(targetDeviceId, deviceQueue);
      }
      for (let index = 0; index < dropCount; index += 1) {
        const dropped = this._removeQueuedMessage(
          targetDeviceId,
          deviceQueue,
          0,
        );
        if (dropped?.id) {
          this.messageStatus.delete(dropped.id);
        }
      }
      if (!this.messageQueue.has(targetDeviceId)) {
        this.messageQueue.set(targetDeviceId, deviceQueue);
      }

      // 加入队列
      deviceQueue.push(admitted.value);
      this.queueBytesByDevice.set(
        targetDeviceId,
        (this.queueBytesByDevice.get(targetDeviceId) || 0) +
          admitted.byteLength,
      );
      this.totalQueueMessages += 1;
      this.totalQueueBytes += admitted.byteLength;

      // 更新消息状态
      if (
        !this.messageStatus.has(messageId) &&
        this.messageStatus.size >= this.limits.maxStatusEntries
      ) {
        this.messageStatus.delete(this.messageStatus.keys().next().value);
      }
      this.messageStatus.set(messageId, {
        status: MessageStatus.PENDING,
        timestamp: Date.now(),
      });

      // 持久化
      await this.saveMessageQueue();
      await this.saveMessageStatus();

      logger.info(
        "[DeviceSyncManager] 消息已加入队列:",
        messageId,
        "->",
        targetDeviceId,
      );

      this.emit("message:queued", {
        messageId,
        targetDeviceId,
        message: cloneBoundedMessage(admitted.value, this.limits).value,
      });

      return messageId;
    } catch (error) {
      logger.error("[DeviceSyncManager] 消息入队失败:", error);
      throw error;
    }
  }

  /**
   * 获取设备的消息队列
   * @param {string} deviceId - 设备ID
   */
  getDeviceQueue(deviceId) {
    return (this.messageQueue.get(deviceId) || []).map(
      (message) => cloneBoundedMessage(message, this.limits).value,
    );
  }

  _updateMessageStatus(messageId, patch) {
    if (this.closed) {
      return null;
    }
    const current = this.messageStatus.get(messageId);
    if (!current) {
      return null;
    }
    const { value } = cloneBoundedMessage(
      { ...current, ...patch },
      this.statusLimits,
    );
    this.messageStatus.set(messageId, value);
    return value;
  }

  /**
   * 标记消息已发送
   * @param {string} messageId - 消息ID
   */
  async markMessageSent(messageId) {
    try {
      const status = this._updateMessageStatus(messageId, {
        status: MessageStatus.SENT,
        sentAt: Date.now(),
      });
      if (status) {
        await this.saveMessageStatus();

        this.emit("message:sent", { messageId, status });
      }
    } catch (error) {
      logger.error("[DeviceSyncManager] 标记消息发送失败:", error);
    }
  }

  /**
   * 标记消息已送达
   * @param {string} messageId - 消息ID
   */
  async markMessageDelivered(messageId) {
    try {
      const status = this._updateMessageStatus(messageId, {
        status: MessageStatus.DELIVERED,
        deliveredAt: Date.now(),
      });
      if (status) {
        await this.saveMessageStatus();

        this.emit("message:delivered", { messageId, status });
      }
    } catch (error) {
      logger.error("[DeviceSyncManager] 标记消息送达失败:", error);
    }
  }

  /**
   * 标记消息已读
   * @param {string} messageId - 消息ID
   */
  async markMessageRead(messageId) {
    try {
      const status = this._updateMessageStatus(messageId, {
        status: MessageStatus.READ,
        readAt: Date.now(),
      });
      if (status) {
        await this.saveMessageStatus();

        this.emit("message:read", { messageId, status });
      }
    } catch (error) {
      logger.error("[DeviceSyncManager] 标记消息已读失败:", error);
    }
  }

  /**
   * 标记消息发送失败
   * @param {string} messageId - 消息ID
   * @param {string} error - 错误信息
   */
  async markMessageFailed(messageId, error) {
    try {
      const status = this._updateMessageStatus(messageId, {
        status: MessageStatus.FAILED,
        error: String(error),
        failedAt: Date.now(),
      });
      if (status) {
        await this.saveMessageStatus();

        this.emit("message:failed", { messageId, status, error });
      }
    } catch (error) {
      logger.error("[DeviceSyncManager] 标记消息失败:", error);
    }
  }

  /**
   * 移除已送达的消息
   * @param {string} messageId - 消息ID
   */
  async removeMessage(messageId) {
    try {
      if (this.closed) {
        return;
      }
      // 从队列中移除
      for (const [deviceId, queue] of this.messageQueue.entries()) {
        const index = queue.findIndex((msg) => msg.id === messageId);
        if (index >= 0) {
          this._removeQueuedMessage(deviceId, queue, index);
          break;
        }
      }
      this._rebuildQueueAccounting();

      await this.saveMessageQueue();

      logger.info("[DeviceSyncManager] 消息已移除:", messageId);

      this.emit("message:removed", { messageId });
    } catch (error) {
      logger.error("[DeviceSyncManager] 移除消息失败:", error);
    }
  }

  /**
   * 更新设备状态
   * @param {string} deviceId - 设备ID
   * @param {Object} status - 设备状态
   */
  updateDeviceStatus(deviceId, status) {
    if (this.closed) {
      throw new Error("DeviceSyncManager is closed");
    }
    assertDeviceId(deviceId, this.limits);
    if (
      !this.deviceStatus.has(deviceId) &&
      this.deviceStatus.size >= this.limits.maxDevices
    ) {
      const error = new Error("device status capacity reached");
      error.code = "DEVICE_SYNC_DEVICE_CAPACITY";
      throw error;
    }
    const { value: boundedStatus } = cloneBoundedMessage(
      status,
      this.statusLimits,
    );
    this.deviceStatus.set(deviceId, {
      ...boundedStatus,
      lastUpdate: Date.now(),
    });

    this.emit("device:status-changed", { deviceId, status });
  }

  /**
   * 获取设备状态
   * @param {string} deviceId - 设备ID
   */
  getDeviceStatus(deviceId) {
    const status = this.deviceStatus.get(deviceId);
    return status
      ? cloneBoundedMessage(status, this.statusLimits).value
      : undefined;
  }

  /**
   * 启动设备同步
   * @param {string} deviceId - 设备ID
   */
  startDeviceSync(deviceId) {
    if (this.closed) {
      throw new Error("DeviceSyncManager is closed");
    }
    assertDeviceId(deviceId, this.limits);
    if (
      !this.syncTimers.has(deviceId) &&
      this.syncTimers.size >= this.limits.maxDevices
    ) {
      const error = new Error("device sync timer capacity reached");
      error.code = "DEVICE_SYNC_DEVICE_CAPACITY";
      throw error;
    }
    // 如果已有定时器，先清除
    if (this.syncTimers.has(deviceId)) {
      clearInterval(this.syncTimers.get(deviceId));
    }

    // 创建新定时器
    const timer = setInterval(() => {
      this.syncDevice(deviceId);
    }, this.config.syncInterval);
    timer.unref?.();

    this.syncTimers.set(deviceId, timer);

    logger.info("[DeviceSyncManager] 已启动设备同步:", deviceId);

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
      logger.info("[DeviceSyncManager] 已停止设备同步:", deviceId);
    }
  }

  /**
   * 同步设备消息
   * @param {string} deviceId - 设备ID
   */
  async syncDevice(deviceId) {
    if (this.closed) {
      return;
    }
    if (this.syncTasks.has(deviceId)) {
      return this.syncTasks.get(deviceId);
    }
    const task = this._syncDevice(deviceId).finally(() => {
      if (this.syncTasks.get(deviceId) === task) {
        this.syncTasks.delete(deviceId);
      }
    });
    this.syncTasks.set(deviceId, task);
    return task;
  }

  async _syncDevice(deviceId) {
    try {
      const queue = this.getDeviceQueue(deviceId);
      if (queue.length === 0) {
        return;
      }

      logger.info(
        "[DeviceSyncManager] 同步设备消息:",
        deviceId,
        "队列大小:",
        queue.length,
      );

      this.emit("sync:started", { deviceId, queueSize: queue.length });

      // 触发同步事件，由 P2P 管理器处理实际的消息发送
      for (const message of [...queue]) {
        if (this.closed) {
          break;
        }
        if (this.deliveryHandler) {
          await this.deliveryHandler({ deviceId, message });
        } else {
          this.emit("sync:message", { deviceId, message });
        }
      }
    } catch (error) {
      logger.error("[DeviceSyncManager] 同步设备失败:", error);
      this.emit("sync:error", { deviceId, error });
    }
  }

  /**
   * 启动定期清理
   */
  startCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    // 每小时清理一次
    this.cleanupTimer = setInterval(
      () => {
        this.cleanup();
      },
      60 * 60 * 1000,
    );
    this.cleanupTimer.unref?.();
  }

  /**
   * 清理过期消息
   */
  async cleanup() {
    if (this.closed) {
      return;
    }
    if (this.cleanupPromise) {
      return this.cleanupPromise;
    }
    const task = this._cleanup().finally(() => {
      if (this.cleanupPromise === task) {
        this.cleanupPromise = null;
      }
    });
    this.cleanupPromise = task;
    return task;
  }

  async _cleanup() {
    try {
      logger.info("[DeviceSyncManager] 开始清理过期消息...");

      const now = Date.now();
      const retentionMs = this.config.messageRetention * 24 * 60 * 60 * 1000;
      let removedCount = 0;

      // 清理消息队列
      for (const [deviceId, queue] of this.messageQueue.entries()) {
        const filteredQueue = queue.filter((msg) => {
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
      this._rebuildQueueAccounting();

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
        logger.info("[DeviceSyncManager] 已清理", removedCount, "条过期消息");
      }

      this.emit("cleanup:complete", { removedCount });
    } catch (error) {
      logger.error("[DeviceSyncManager] 清理失败:", error);
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
      totalQueueBytes: this.totalQueueBytes,
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
    if (this.closePromise) {
      return this.closePromise;
    }
    this.closed = true;
    this.deliveryHandler = null;
    this.closePromise = this._close();
    return this.closePromise;
  }

  async _close() {
    logger.info("[DeviceSyncManager] 关闭设备同步管理器");

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

    const pendingTasks = [
      ...this.syncTasks.values(),
      this.cleanupPromise,
    ].filter(Boolean);
    if (pendingTasks.length > 0) {
      let timeoutHandle;
      await Promise.race([
        Promise.allSettled(pendingTasks),
        new Promise((resolve) => {
          timeoutHandle = setTimeout(resolve, this.limits.closeTimeoutMs);
          timeoutHandle.unref?.();
        }),
      ]);
      clearTimeout(timeoutHandle);
    }

    // 保存数据
    await this.saveMessageQueue();
    await this.saveMessageStatus();

    this.initialized = false;
    this.emit("closed");
    this.syncTasks.clear();
    this.cleanupPromise = null;
    this._clearQueueState();
    this.messageStatus.clear();
    this.deviceStatus.clear();
    this.removeAllListeners();
  }
}

module.exports = {
  DeviceSyncManager,
  MessageStatus,
  SyncMessageType,
};
module.exports._deps = _deps;
