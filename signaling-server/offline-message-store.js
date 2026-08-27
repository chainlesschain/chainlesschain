"use strict";

const { serializedBytes } = require("./boundaries");

class OfflineMessageStore {
  constructor(limits) {
    this.limits = limits;
    this.queues = new Map();
    this.totalMessages = 0;
    this.totalBytes = 0;
    this.totalStored = 0;
    this.totalRejected = 0;
    this.totalExpired = 0;
    this.nextId = 0;
  }

  reject(reason) {
    this.totalRejected++;
    return {
      success: false,
      code: "OVERLOADED",
      reason,
      retryAfterMs: this.limits.retryAfterMs,
    };
  }

  enqueue(peerId, message, now = Date.now()) {
    if (
      typeof peerId !== "string" ||
      peerId.length === 0 ||
      Buffer.byteLength(peerId, "utf8") > this.limits.maxPeerIdBytes
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

    const queue = this.queues.get(peerId);
    const queueBytes = queue
      ? queue.reduce((total, entry) => total + entry.byteSize, 0)
      : 0;
    if (!queue && this.queues.size >= this.limits.maxQueuePeers) {
      return this.reject("OFFLINE_PEER_LIMIT");
    }
    if (queue && queue.length >= this.limits.maxQueueSize) {
      return this.reject("PEER_MESSAGE_LIMIT");
    }
    if (this.totalMessages >= this.limits.maxTotalMessages) {
      return this.reject("TOTAL_MESSAGE_LIMIT");
    }
    if (
      byteSize > this.limits.maxQueueBytes ||
      queueBytes + byteSize > this.limits.maxQueueBytes
    ) {
      return this.reject("PEER_BYTE_LIMIT");
    }
    if (this.totalBytes + byteSize > this.limits.maxTotalQueueBytes) {
      return this.reject("TOTAL_BYTE_LIMIT");
    }

    const targetQueue = queue || [];
    if (!queue) this.queues.set(peerId, targetQueue);
    const entry = {
      messageId: `offline_${now}_${++this.nextId}`,
      message,
      storedAt: now,
      byteSize,
    };
    targetQueue.push(entry);
    this.totalMessages++;
    this.totalBytes += byteSize;
    this.totalStored++;
    return { success: true, messageId: entry.messageId };
  }

  peek(peerId) {
    return [...(this.queues.get(peerId) || [])];
  }

  acknowledge(peerId, messageId) {
    const queue = this.queues.get(peerId);
    if (!queue) return false;
    const index = queue.findIndex((entry) => entry.messageId === messageId);
    if (index === -1) return false;
    const [removed] = queue.splice(index, 1);
    this.totalMessages--;
    this.totalBytes -= removed.byteSize;
    if (queue.length === 0) this.queues.delete(peerId);
    return true;
  }

  cleanup(now = Date.now()) {
    let expired = 0;
    for (const [peerId, queue] of this.queues.entries()) {
      const expiredIds = queue
        .filter((entry) => now - entry.storedAt >= this.limits.messageTTL)
        .map((entry) => entry.messageId);
      for (const messageId of expiredIds) {
        if (this.acknowledge(peerId, messageId)) expired++;
      }
    }
    this.totalExpired += expired;
    return expired;
  }

  clear() {
    this.queues.clear();
    this.totalMessages = 0;
    this.totalBytes = 0;
  }

  getStats() {
    return {
      peerQueues: this.queues.size,
      totalMessages: this.totalMessages,
      totalBytes: this.totalBytes,
      totalStored: this.totalStored,
      totalRejected: this.totalRejected,
      totalExpired: this.totalExpired,
    };
  }
}

module.exports = OfflineMessageStore;
