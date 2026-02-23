/**
 * Gossip Protocol
 * Implements gossip-based message distribution for community channels.
 * Uses LRU deduplication cache and configurable fanout for efficient
 * peer-to-peer message propagation.
 *
 * Protocol: /chainlesschain/gossip/1.0.0
 *
 * @module gossip-protocol
 * @version 0.42.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Default configuration
 */
const DEFAULTS = {
  PROTOCOL_ID: "/chainlesschain/gossip/1.0.0",
  FANOUT: 3,
  CACHE_CAPACITY: 10000,
  MESSAGE_TTL: 60 * 60 * 1000, // 1 hour
};

/**
 * Simple LRU Cache for message deduplication
 */
class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  /**
   * Check if a key exists in the cache
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    if (!this.cache.has(key)) {
      return false;
    }

    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return true;
  }

  /**
   * Add a key to the cache
   * @param {string} key - Cache key
   * @param {any} value - Cache value
   */
  set(key, value = true) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Remove the oldest entry (first entry)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  /**
   * Get cache size
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Clear the cache
   */
  clear() {
    this.cache.clear();
  }
}

class GossipProtocol extends EventEmitter {
  constructor(p2pManager, options = {}) {
    super();

    this.p2pManager = p2pManager;
    this.protocolId = options.protocolId || DEFAULTS.PROTOCOL_ID;
    this.fanout = options.fanout || DEFAULTS.FANOUT;
    this.messageTTL = options.messageTTL || DEFAULTS.MESSAGE_TTL;

    // LRU cache for message dedup
    this.seenMessages = new LRUCache(options.cacheCapacity || DEFAULTS.CACHE_CAPACITY);

    // Community subscriptions: Map<communityId, boolean>
    this.subscriptions = new Map();

    // Peer subscriptions: Map<communityId, Set<peerId>>
    this.peerSubscriptions = new Map();

    this.initialized = false;
  }

  /**
   * Initialize the gossip protocol
   */
  async initialize() {
    logger.info("[GossipProtocol] Initializing gossip protocol...");

    try {
      this.setupP2PListeners();

      this.initialized = true;
      logger.info("[GossipProtocol] Gossip protocol initialized with fanout:", this.fanout);
    } catch (error) {
      logger.error("[GossipProtocol] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Setup P2P event listeners
   */
  setupP2PListeners() {
    if (!this.p2pManager) {
      logger.warn("[GossipProtocol] No P2P manager available");
      return;
    }

    this.p2pManager.on("gossip:message", async (data) => {
      try {
        await this.handleIncomingMessage(data);
      } catch (error) {
        logger.warn("[GossipProtocol] Failed to handle incoming message:", error.message);
      }
    });

    this.p2pManager.on("gossip:subscribe", ({ peerId, communityId }) => {
      this.handlePeerSubscribe(peerId, communityId);
    });

    this.p2pManager.on("gossip:unsubscribe", ({ peerId, communityId }) => {
      this.handlePeerUnsubscribe(peerId, communityId);
    });

    logger.info("[GossipProtocol] P2P listeners set up");
  }

  /**
   * Broadcast a message to a community
   * @param {string} communityId - Community ID
   * @param {Object} message - Message payload
   * @returns {Object} Broadcast result
   */
  async broadcast(communityId, message) {
    if (!this.subscriptions.has(communityId)) {
      throw new Error("Not subscribed to community: " + communityId);
    }

    try {
      const messageId = message.id || uuidv4();
      const gossipMessage = {
        id: messageId,
        communityId,
        payload: message,
        sender: this.getLocalPeerId(),
        timestamp: Date.now(),
        ttl: this.messageTTL,
        hops: 0,
      };

      // Mark as seen to prevent loops
      this.seenMessages.set(messageId);

      // Get peers subscribed to this community
      const peers = this.getSubscribedPeers(communityId);

      // Select random subset (fanout)
      const selectedPeers = this.selectRandomPeers(peers, this.fanout);

      let forwarded = 0;
      for (const peerId of selectedPeers) {
        try {
          await this.forward(peerId, gossipMessage);
          forwarded++;
        } catch (error) {
          logger.warn("[GossipProtocol] Failed to forward to peer:", peerId, error.message);
        }
      }

      logger.info(
        "[GossipProtocol] Message broadcast:",
        messageId,
        "to",
        forwarded,
        "/",
        selectedPeers.length,
        "peers",
      );

      this.emit("message:broadcast", {
        messageId,
        communityId,
        peerCount: forwarded,
      });

      return { success: true, messageId, peersReached: forwarded };
    } catch (error) {
      logger.error("[GossipProtocol] Broadcast failed:", error);
      throw error;
    }
  }

  /**
   * Forward a message to a specific peer
   * @param {string} peerId - Peer ID
   * @param {Object} message - Gossip message
   */
  async forward(peerId, message) {
    if (!this.p2pManager) {
      throw new Error("P2P manager not available");
    }

    try {
      const forwardMessage = {
        ...message,
        hops: (message.hops || 0) + 1,
      };

      await this.p2pManager.sendMessage(peerId, {
        type: "gossip:message",
        protocol: this.protocolId,
        data: forwardMessage,
      });

      this.emit("message:forwarded", {
        messageId: message.id,
        peerId,
        hops: forwardMessage.hops,
      });
    } catch (error) {
      logger.warn("[GossipProtocol] Forward to", peerId, "failed:", error.message);
      throw error;
    }
  }

  /**
   * Handle an incoming gossip message
   * @param {Object} data - Incoming message data
   */
  async handleIncomingMessage(data) {
    const message = data.data || data;

    // Dedup: ignore if already seen
    if (this.seenMessages.has(message.id)) {
      return;
    }

    // Mark as seen
    this.seenMessages.set(message.id);

    // Check TTL
    const age = Date.now() - message.timestamp;
    if (age > (message.ttl || this.messageTTL)) {
      logger.info("[GossipProtocol] Message expired, dropping:", message.id);
      return;
    }

    // Check if we're subscribed to this community
    if (!this.subscriptions.has(message.communityId)) {
      return;
    }

    // Emit the received message
    this.emit("message:received", {
      messageId: message.id,
      communityId: message.communityId,
      payload: message.payload,
      sender: message.sender,
      hops: message.hops,
      timestamp: message.timestamp,
    });

    // Continue gossiping: forward to other peers (fanout)
    const peers = this.getSubscribedPeers(message.communityId);
    // Exclude the sender and ourselves
    const eligiblePeers = peers.filter(
      (p) => p !== message.sender && p !== data.fromPeerId,
    );

    const selectedPeers = this.selectRandomPeers(eligiblePeers, this.fanout);

    for (const peerId of selectedPeers) {
      try {
        await this.forward(peerId, message);
      } catch (error) {
        // Silently continue on forward failures
      }
    }
  }

  /**
   * Subscribe to a community's gossip channel
   * @param {string} communityId - Community ID
   */
  subscribe(communityId) {
    if (this.subscriptions.has(communityId)) {
      logger.info("[GossipProtocol] Already subscribed to:", communityId);
      return;
    }

    this.subscriptions.set(communityId, true);

    // Announce subscription to peers
    if (this.p2pManager) {
      const connectedPeers = this.getConnectedPeers();
      for (const peerId of connectedPeers) {
        try {
          this.p2pManager.sendMessage(peerId, {
            type: "gossip:subscribe",
            communityId,
            peerId: this.getLocalPeerId(),
          });
        } catch (error) {
          // Silently continue
        }
      }
    }

    logger.info("[GossipProtocol] Subscribed to community:", communityId);
    this.emit("subscribed", { communityId });
  }

  /**
   * Unsubscribe from a community's gossip channel
   * @param {string} communityId - Community ID
   */
  unsubscribe(communityId) {
    if (!this.subscriptions.has(communityId)) {
      return;
    }

    this.subscriptions.delete(communityId);
    this.peerSubscriptions.delete(communityId);

    // Announce unsubscription to peers
    if (this.p2pManager) {
      const connectedPeers = this.getConnectedPeers();
      for (const peerId of connectedPeers) {
        try {
          this.p2pManager.sendMessage(peerId, {
            type: "gossip:unsubscribe",
            communityId,
            peerId: this.getLocalPeerId(),
          });
        } catch (error) {
          // Silently continue
        }
      }
    }

    logger.info("[GossipProtocol] Unsubscribed from community:", communityId);
    this.emit("unsubscribed", { communityId });
  }

  /**
   * Get current subscriptions
   * @returns {string[]} Array of community IDs
   */
  getSubscriptions() {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Handle a peer subscribing to a community
   * @param {string} peerId - Peer ID
   * @param {string} communityId - Community ID
   */
  handlePeerSubscribe(peerId, communityId) {
    if (!this.peerSubscriptions.has(communityId)) {
      this.peerSubscriptions.set(communityId, new Set());
    }
    this.peerSubscriptions.get(communityId).add(peerId);

    logger.info("[GossipProtocol] Peer subscribed:", peerId, "to", communityId);
  }

  /**
   * Handle a peer unsubscribing from a community
   * @param {string} peerId - Peer ID
   * @param {string} communityId - Community ID
   */
  handlePeerUnsubscribe(peerId, communityId) {
    const peers = this.peerSubscriptions.get(communityId);
    if (peers) {
      peers.delete(peerId);
      if (peers.size === 0) {
        this.peerSubscriptions.delete(communityId);
      }
    }

    logger.info("[GossipProtocol] Peer unsubscribed:", peerId, "from", communityId);
  }

  /**
   * Get peers subscribed to a community
   * @param {string} communityId - Community ID
   * @returns {string[]} Array of peer IDs
   */
  getSubscribedPeers(communityId) {
    const peers = this.peerSubscriptions.get(communityId);
    if (!peers || peers.size === 0) {
      // Fallback: use all connected peers
      return this.getConnectedPeers();
    }
    return Array.from(peers);
  }

  /**
   * Get all connected peers
   * @returns {string[]} Array of peer IDs
   */
  getConnectedPeers() {
    if (!this.p2pManager) {
      return [];
    }
    try {
      const peers = this.p2pManager.getConnectedPeers
        ? this.p2pManager.getConnectedPeers()
        : [];
      return Array.isArray(peers)
        ? peers.map((p) => (typeof p === "string" ? p : p.id || p.peerId))
        : [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get local peer ID
   * @returns {string}
   */
  getLocalPeerId() {
    if (!this.p2pManager) {
      return "local";
    }
    try {
      return this.p2pManager.peerId || this.p2pManager.localPeerId || "local";
    } catch (error) {
      return "local";
    }
  }

  /**
   * Select random peers from a list
   * @param {string[]} peers - Available peers
   * @param {number} count - Number to select
   * @returns {string[]} Selected peers
   */
  selectRandomPeers(peers, count) {
    if (peers.length <= count) {
      return [...peers];
    }

    // Fisher-Yates shuffle and take first `count`
    const shuffled = [...peers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, count);
  }

  /**
   * Get protocol statistics
   * @returns {Object} Protocol stats
   */
  getStats() {
    return {
      protocolId: this.protocolId,
      fanout: this.fanout,
      subscriptions: this.subscriptions.size,
      seenMessagesCache: this.seenMessages.size,
      cacheCapacity: DEFAULTS.CACHE_CAPACITY,
      peerSubscriptions: Object.fromEntries(
        Array.from(this.peerSubscriptions.entries()).map(([k, v]) => [k, v.size]),
      ),
    };
  }

  /**
   * Clean up resources
   */
  async close() {
    logger.info("[GossipProtocol] Closing gossip protocol");

    this.subscriptions.clear();
    this.peerSubscriptions.clear();
    this.seenMessages.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  GossipProtocol,
  LRUCache,
  DEFAULTS,
};
