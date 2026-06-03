/**
 * Signaling Message Queue
 *
 * Store-and-forward queue for offline peers.
 * Messages are stored in memory with configurable TTL and queue size limits.
 */

const { logger } = require('../utils/logger.js');

class SignalingMessageQueue {
  constructor(options = {}) {
    // targetPeerId -> Array<{ message, storedAt, messageId }>
    this.queues = new Map();

    // Configuration
    this.maxQueueSize = options.maxQueueSize || 100; // Max messages per peer
    this.messageTTL = options.messageTTL || 24 * 60 * 60 * 1000; // 24 hours
    this.cleanupInterval = options.cleanupInterval || 60 * 60 * 1000; // 1 hour

    // Cleanup timer
    this.cleanupTimer = null;

    // Stats
    this.stats = {
      totalEnqueued: 0,
      totalDequeued: 0,
      totalExpired: 0,
      totalDropped: 0,
    };

    // Message ID counter
    this.messageIdCounter = 0;
  }

  /**
   * Initialize the queue (start cleanup timer)
   */
  initialize() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.cleanupInterval);

    logger.info('[MessageQueue] Initialized');
  }

  /**
   * Generate a unique message ID
   * @returns {string} Unique message ID
   */
  generateMessageId() {
    return `msg_${Date.now()}_${++this.messageIdCounter}`;
  }

  /**
   * Enqueue a message for an offline peer
   * @param {string} targetPeerId - Target peer identifier
   * @param {Object} message - Message to store
   * @returns {Object} Enqueue result with messageId
   */
  enqueue(targetPeerId, message) {
    if (!this.queues.has(targetPeerId)) {
      this.queues.set(targetPeerId, []);
    }

    const queue = this.queues.get(targetPeerId);
    const messageId = this.generateMessageId();

    // Check queue size limit
    if (queue.length >= this.maxQueueSize) {
      // Drop oldest message
      const dropped = queue.shift();
      this.stats.totalDropped++;
      logger.warn(`[MessageQueue] Queue full for ${targetPeerId}, dropped oldest message`);
    }

    const entry = {
      messageId,
      message,
      storedAt: Date.now(),
    };

    queue.push(entry);
    this.stats.totalEnqueued++;

    logger.info(`[MessageQueue] Enqueued message for ${targetPeerId}: ${messageId}`);

    return {
      success: true,
      messageId,
      queueSize: queue.length,
    };
  }

  /**
   * Dequeue all pending messages for a peer
   * @param {string} peerId - Peer identifier
   * @returns {Array} Array of message entries (with message, storedAt, messageId)
   */
  dequeue(peerId) {
    const queue = this.queues.get(peerId);

    if (!queue || queue.length === 0) {
      return [];
    }

    // Get all messages
    const messages = [...queue];
    this.stats.totalDequeued += messages.length;

    // Clear the queue
    this.queues.delete(peerId);

    logger.info(`[MessageQueue] Dequeued ${messages.length} messages for ${peerId}`);

    return messages;
  }

  /**
   * Peek at messages without removing them
   * @param {string} peerId - Peer identifier
   * @returns {Array} Array of message entries
   */
  peek(peerId) {
    const queue = this.queues.get(peerId);
    return queue ? [...queue] : [];
  }

  /**
   * Get the queue size for a peer
   * @param {string} peerId - Peer identifier
   * @returns {number} Number of pending messages
   */
  getQueueSize(peerId) {
    const queue = this.queues.get(peerId);
    return queue ? queue.length : 0;
  }

  /**
   * Clear the queue for a specific peer
   * @param {string} peerId - Peer identifier
   * @returns {number} Number of messages cleared
   */
  clearQueue(peerId) {
    const queue = this.queues.get(peerId);
    const count = queue ? queue.length : 0;

    this.queues.delete(peerId);

    if (count > 0) {
      logger.info(`[MessageQueue] Cleared ${count} messages for ${peerId}`);
    }

    return count;
  }

  /**
   * Remove a specific message by ID
   * @param {string} peerId - Peer identifier
   * @param {string} messageId - Message identifier
   * @returns {boolean} True if message was found and removed
   */
  removeMessage(peerId, messageId) {
    const queue = this.queues.get(peerId);

    if (!queue) {
      return false;
    }

    const index = queue.findIndex(entry => entry.messageId === messageId);

    if (index === -1) {
      return false;
    }

    queue.splice(index, 1);

    // Clean up empty queue
    if (queue.length === 0) {
      this.queues.delete(peerId);
    }

    return true;
  }

  /**
   * Set the maximum queue size per peer
   * @param {number} size - Maximum number of messages
   */
  setMaxQueueSize(size) {
    this.maxQueueSize = size;
    logger.info(`[MessageQueue] Max queue size set to ${size}`);
  }

  /**
   * Set the message TTL
   * @param {number} ttlMs - TTL in milliseconds
   */
  setMessageTTL(ttlMs) {
    this.messageTTL = ttlMs;
    logger.info(`[MessageQueue] Message TTL set to ${ttlMs}ms`);
  }

  /**
   * Clean up expired messages
   * @returns {Object} Cleanup statistics
   */
  cleanupExpired() {
    const now = Date.now();
    let totalExpired = 0;
    let queuesAffected = 0;

    for (const [peerId, queue] of this.queues.entries()) {
      const originalLength = queue.length;

      // Filter out expired messages
      const validMessages = queue.filter(entry => {
        const age = now - entry.storedAt;
        return age < this.messageTTL;
      });

      const expiredCount = originalLength - validMessages.length;

      if (expiredCount > 0) {
        totalExpired += expiredCount;
        queuesAffected++;

        if (validMessages.length === 0) {
          this.queues.delete(peerId);
        } else {
          this.queues.set(peerId, validMessages);
        }
      }
    }

    this.stats.totalExpired += totalExpired;

    if (totalExpired > 0) {
      logger.info(`[MessageQueue] Cleaned up ${totalExpired} expired messages from ${queuesAffected} queues`);
    }

    return {
      expiredCount: totalExpired,
      queuesAffected,
    };
  }

  /**
   * Get total count of all queued messages
   * @returns {number} Total message count
   */
  getTotalMessageCount() {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Get queue statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      currentQueues: this.queues.size,
      totalMessages: this.getTotalMessageCount(),
      maxQueueSize: this.maxQueueSize,
      messageTTL: this.messageTTL,
    };
  }

  /**
   * Get all peer IDs with pending messages
   * @returns {Array<string>} List of peer IDs
   */
  getPeersWithMessages() {
    return Array.from(this.queues.keys());
  }

  /**
   * Clear all queues
   */
  clearAll() {
    const totalCleared = this.getTotalMessageCount();
    this.queues.clear();
    logger.info(`[MessageQueue] Cleared all queues (${totalCleared} messages)`);
  }

  /**
   * Stop the queue (cleanup timers)
   */
  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    logger.info('[MessageQueue] Stopped');
  }
}

module.exports = SignalingMessageQueue;
