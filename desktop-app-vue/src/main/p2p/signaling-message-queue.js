/**
 * Bounded store-and-forward queue for offline signaling messages.
 */

const { logger } = require("../utils/logger.js");
const {
  HARD_SIGNALING_LIMITS,
  resolveSignalingLimits,
  serializedBytes,
} = require("./signaling-boundaries");

class SignalingMessageQueue {
  constructor(options = {}) {
    const limits = resolveSignalingLimits(options);
    this.queues = new Map();
    this.maxQueueSize = limits.maxQueueSize;
    this.maxPeerIdBytes = limits.maxPeerIdBytes;
    this.maxQueuePeers = limits.maxQueuePeers;
    this.maxTotalMessages = limits.maxTotalMessages;
    this.maxQueueBytes = limits.maxQueueBytes;
    this.maxTotalQueueBytes = limits.maxTotalQueueBytes;
    this.retryAfterMs = limits.retryAfterMs;
    this.messageTTL = limits.messageTTL;
    this.cleanupInterval = options.cleanupInterval || 60 * 60 * 1000;
    this.cleanupTimer = null;
    this.totalMessages = 0;
    this.totalBytes = 0;
    this.stats = {
      totalEnqueued: 0,
      totalDequeued: 0,
      totalExpired: 0,
      totalDropped: 0,
      totalRejected: 0,
    };
    this.messageIdCounter = 0;
  }

  initialize() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = setInterval(
      () => this.cleanupExpired(),
      this.cleanupInterval,
    );
    logger.info("[MessageQueue] Initialized");
  }

  generateMessageId() {
    return `msg_${Date.now()}_${++this.messageIdCounter}`;
  }

  reject(reason) {
    this.stats.totalDropped++;
    this.stats.totalRejected++;
    return {
      success: false,
      code: "OVERLOADED",
      reason,
      retryAfterMs: this.retryAfterMs,
    };
  }

  enqueue(targetPeerId, message) {
    if (
      typeof targetPeerId !== "string" ||
      targetPeerId.length === 0 ||
      Buffer.byteLength(targetPeerId, "utf8") > this.maxPeerIdBytes
    ) {
      return {
        success: false,
        code: "INVALID_MESSAGE",
        reason: "INVALID_TARGET_PEER",
      };
    }
    let byteSize;
    try {
      byteSize = serializedBytes(message);
    } catch {
      return {
        success: false,
        code: "INVALID_MESSAGE",
        reason: "UNSERIALIZABLE_MESSAGE",
      };
    }

    const queue = this.queues.get(targetPeerId);
    const queueBytes = queue
      ? queue.reduce((total, entry) => total + entry.byteSize, 0)
      : 0;

    if (!queue && this.queues.size >= this.maxQueuePeers) {
      return this.reject("OFFLINE_PEER_LIMIT");
    }
    if (queue && queue.length >= this.maxQueueSize) {
      return this.reject("PEER_MESSAGE_LIMIT");
    }
    if (this.totalMessages >= this.maxTotalMessages) {
      return this.reject("TOTAL_MESSAGE_LIMIT");
    }
    if (
      byteSize > this.maxQueueBytes ||
      queueBytes + byteSize > this.maxQueueBytes
    ) {
      return this.reject("PEER_BYTE_LIMIT");
    }
    if (this.totalBytes + byteSize > this.maxTotalQueueBytes) {
      return this.reject("TOTAL_BYTE_LIMIT");
    }

    const targetQueue = queue || [];
    if (!queue) {
      this.queues.set(targetPeerId, targetQueue);
    }
    const messageId = this.generateMessageId();
    targetQueue.push({ messageId, message, storedAt: Date.now(), byteSize });
    this.totalMessages++;
    this.totalBytes += byteSize;
    this.stats.totalEnqueued++;

    return {
      success: true,
      messageId,
      queueSize: targetQueue.length,
      totalMessages: this.totalMessages,
      totalBytes: this.totalBytes,
    };
  }

  dequeue(peerId) {
    const messages = this.peek(peerId);
    if (messages.length === 0) {
      return [];
    }
    this.clearQueue(peerId);
    this.stats.totalDequeued += messages.length;
    return messages;
  }

  peek(peerId) {
    const queue = this.queues.get(peerId);
    return queue ? [...queue] : [];
  }

  getQueueSize(peerId) {
    return this.queues.get(peerId)?.length || 0;
  }

  clearQueue(peerId) {
    const queue = this.queues.get(peerId);
    if (!queue) {
      return 0;
    }
    for (const entry of queue) {
      this.totalBytes -= entry.byteSize;
    }
    this.totalMessages -= queue.length;
    this.queues.delete(peerId);
    return queue.length;
  }

  removeMessage(peerId, messageId) {
    const queue = this.queues.get(peerId);
    if (!queue) {
      return false;
    }
    const index = queue.findIndex((entry) => entry.messageId === messageId);
    if (index === -1) {
      return false;
    }
    const [removed] = queue.splice(index, 1);
    this.totalMessages--;
    this.totalBytes -= removed.byteSize;
    this.stats.totalDequeued++;
    if (queue.length === 0) {
      this.queues.delete(peerId);
    }
    return true;
  }

  setMaxQueueSize(size) {
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > HARD_SIGNALING_LIMITS.maxQueueSize
    ) {
      throw new TypeError("maxQueueSize must be a positive safe integer");
    }
    this.maxQueueSize = size;
  }

  setMessageTTL(ttlMs) {
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs <= 0 ||
      ttlMs > HARD_SIGNALING_LIMITS.messageTTL
    ) {
      throw new TypeError("messageTTL must be a positive safe integer");
    }
    this.messageTTL = ttlMs;
  }

  setLimits(limits) {
    this.maxQueueSize = limits.maxQueueSize;
    this.maxPeerIdBytes = limits.maxPeerIdBytes;
    this.maxQueuePeers = limits.maxQueuePeers;
    this.maxTotalMessages = limits.maxTotalMessages;
    this.maxQueueBytes = limits.maxQueueBytes;
    this.maxTotalQueueBytes = limits.maxTotalQueueBytes;
    this.retryAfterMs = limits.retryAfterMs;
  }

  cleanupExpired() {
    const now = Date.now();
    let expiredCount = 0;
    let queuesAffected = 0;

    for (const [peerId, queue] of this.queues.entries()) {
      const expiredIds = queue
        .filter((entry) => now - entry.storedAt >= this.messageTTL)
        .map((entry) => entry.messageId);
      if (expiredIds.length === 0) {
        continue;
      }
      queuesAffected++;
      for (const messageId of expiredIds) {
        if (this.removeMessage(peerId, messageId)) {
          expiredCount++;
          this.stats.totalDequeued--;
        }
      }
    }

    this.stats.totalExpired += expiredCount;
    return { expiredCount, queuesAffected };
  }

  getTotalMessageCount() {
    return this.totalMessages;
  }

  getStats() {
    return {
      ...this.stats,
      currentQueues: this.queues.size,
      totalMessages: this.totalMessages,
      totalBytes: this.totalBytes,
      maxQueueSize: this.maxQueueSize,
      maxPeerIdBytes: this.maxPeerIdBytes,
      maxQueuePeers: this.maxQueuePeers,
      maxTotalMessages: this.maxTotalMessages,
      maxQueueBytes: this.maxQueueBytes,
      maxTotalQueueBytes: this.maxTotalQueueBytes,
      messageTTL: this.messageTTL,
    };
  }

  getPeersWithMessages() {
    return Array.from(this.queues.keys());
  }

  clearAll() {
    this.queues.clear();
    this.totalMessages = 0;
    this.totalBytes = 0;
  }

  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clearAll();
    logger.info("[MessageQueue] Stopped");
  }
}

module.exports = SignalingMessageQueue;
