/**
 * Gossip Protocol
 *
 * Bounded gossip-based message distribution for community channels.
 *
 * @module social/gossip-protocol
 * @version 0.42.0
 */

"use strict";

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const {
  DEFAULT_GOSSIP_BOUNDARIES,
  GossipBoundaryError,
  createGossipBoundaries,
  assertGossipId,
  assertCommunityId,
  assertPeerId,
  assertMessageId,
  normalizePayload,
  normalizeGossipMessage,
} = require("./gossip-boundaries");

const DEFAULTS = Object.freeze({
  PROTOCOL_ID: "/chainlesschain/gossip/1.0.0",
  FANOUT: DEFAULT_GOSSIP_BOUNDARIES.fanout,
  CACHE_CAPACITY: DEFAULT_GOSSIP_BOUNDARIES.cacheCapacity,
  MESSAGE_TTL: DEFAULT_GOSSIP_BOUNDARIES.messageTtlMs,
});

class LRUCache {
  constructor(capacity) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new GossipBoundaryError(
        "ERR_GOSSIP_BOUNDARY_CONFIG",
        "LRU cache capacity must be a positive safe integer",
      );
    }
    this.capacity = capacity;
    this.cache = new Map();
  }

  has(key) {
    if (!this.cache.has(key)) {
      return false;
    }
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return true;
  }

  set(key, value = true) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, value);
  }

  get size() {
    return this.cache.size;
  }

  clear() {
    this.cache.clear();
  }
}

class GossipProtocol extends EventEmitter {
  constructor(p2pManager, options = {}) {
    super();
    const boundaryConfig = { ...(options.boundaries || {}) };
    if (options.fanout !== undefined) {
      boundaryConfig.fanout = options.fanout;
    }
    if (options.cacheCapacity !== undefined) {
      boundaryConfig.cacheCapacity = options.cacheCapacity;
    }
    if (options.messageTTL !== undefined) {
      boundaryConfig.messageTtlMs = options.messageTTL;
    }

    this.boundaries = createGossipBoundaries(boundaryConfig);
    this.protocolId = assertGossipId(
      options.protocolId || DEFAULTS.PROTOCOL_ID,
      this.boundaries.maxProtocolIdBytes,
      "protocolId",
      "ERR_GOSSIP_PROTOCOL_ID",
    );
    this.fanout = this.boundaries.fanout;
    this.messageTTL = this.boundaries.messageTtlMs;
    this.p2pManager = p2pManager;
    this._now =
      typeof options.now === "function" ? options.now : () => Date.now();
    this._random =
      typeof options.random === "function" ? options.random : Math.random;

    this.seenMessages = new LRUCache(this.boundaries.cacheCapacity);
    this.subscriptions = new Map();
    this.peerSubscriptions = new Map();

    this._activeInbound = 0;
    this._activeBroadcasts = 0;
    this._activeSends = 0;
    this._pendingOperations = new Set();
    this._generation = 0;
    this._destroyed = false;
    this._listenersAttached = false;
    this._onGossipMessage = null;
    this._onGossipSubscribe = null;
    this._onGossipUnsubscribe = null;
    this.initialized = false;
  }

  async initialize() {
    this._assertUsable();
    if (this.initialized) {
      return;
    }
    logger.info("[GossipProtocol] Initializing gossip protocol...");
    try {
      this.setupP2PListeners();
      this.initialized = true;
      logger.info(
        "[GossipProtocol] Gossip protocol initialized with fanout:",
        this.fanout,
      );
    } catch (error) {
      this._teardownP2PListeners();
      logger.error("[GossipProtocol] Initialization failed:", error);
      throw error;
    }
  }

  setupP2PListeners() {
    if (!this.p2pManager) {
      logger.warn("[GossipProtocol] No P2P manager available");
      return;
    }
    if (this._listenersAttached) {
      return;
    }
    if (typeof this.p2pManager.on !== "function") {
      throw new GossipBoundaryError(
        "ERR_GOSSIP_TRANSPORT_INVALID",
        "P2P manager must expose event listener methods",
      );
    }

    this._onGossipMessage = (data) => {
      void this.handleIncomingMessage(data).catch((error) => {
        logger.warn(
          "[GossipProtocol] Failed to handle incoming message:",
          error.message,
        );
      });
    };
    this._onGossipSubscribe = ({ peerId, communityId } = {}) => {
      try {
        this.handlePeerSubscribe(peerId, communityId);
      } catch (error) {
        logger.warn(
          "[GossipProtocol] Rejected peer subscription:",
          error.message,
        );
      }
    };
    this._onGossipUnsubscribe = ({ peerId, communityId } = {}) => {
      try {
        this.handlePeerUnsubscribe(peerId, communityId);
      } catch (error) {
        logger.warn(
          "[GossipProtocol] Rejected peer unsubscription:",
          error.message,
        );
      }
    };

    this.p2pManager.on("gossip:message", this._onGossipMessage);
    this.p2pManager.on("gossip:subscribe", this._onGossipSubscribe);
    this.p2pManager.on("gossip:unsubscribe", this._onGossipUnsubscribe);
    this._listenersAttached = true;
    logger.info("[GossipProtocol] P2P listeners set up");
  }

  async broadcast(communityId, message) {
    this._assertUsable();
    const normalizedCommunityId = assertCommunityId(
      communityId,
      this.boundaries,
    );
    if (!this.subscriptions.has(normalizedCommunityId)) {
      throw new Error(`Not subscribed to community: ${normalizedCommunityId}`);
    }
    if (this._activeBroadcasts >= this.boundaries.maxConcurrentBroadcasts) {
      throw this._capacityError(
        "ERR_GOSSIP_BROADCAST_CAPACITY",
        "Gossip broadcast capacity reached",
      );
    }

    this._activeBroadcasts += 1;
    const generation = this._generation;
    try {
      const payload = normalizePayload(message, this.boundaries);
      const messageId = assertMessageId(
        message.id || uuidv4(),
        this.boundaries,
      );
      const gossipMessage = normalizeGossipMessage(
        {
          id: messageId,
          communityId: normalizedCommunityId,
          payload,
          sender: this.getLocalPeerId(),
          timestamp: this._now(),
          ttl: this.messageTTL,
          hops: 0,
        },
        this.boundaries,
        this._now(),
      );

      this.seenMessages.set(messageId);
      const selectedPeers = this.selectRandomPeers(
        this.getSubscribedPeers(normalizedCommunityId),
        this.fanout,
      );
      const results = await this._runPeerTasks(
        selectedPeers,
        async (peerId) => {
          try {
            await this.forward(peerId, gossipMessage);
            return true;
          } catch (error) {
            logger.warn(
              "[GossipProtocol] Failed to forward to peer:",
              peerId,
              error.message,
            );
            return false;
          }
        },
      );
      this._assertGeneration(generation);
      const forwarded = results.filter(Boolean).length;

      this.emit("message:broadcast", {
        messageId,
        communityId: normalizedCommunityId,
        peerCount: forwarded,
      });
      return { success: true, messageId, peersReached: forwarded };
    } finally {
      this._activeBroadcasts -= 1;
    }
  }

  async forward(peerId, message) {
    this._assertUsable();
    const normalizedPeerId = assertPeerId(peerId, this.boundaries);
    const normalized = normalizeGossipMessage(
      message,
      this.boundaries,
      this._now(),
    );
    if (normalized.hops >= this.boundaries.maxHops) {
      throw new GossipBoundaryError(
        "ERR_GOSSIP_HOP_LIMIT",
        `Gossip hop limit ${this.boundaries.maxHops} reached`,
      );
    }
    const forwardMessage = normalizeGossipMessage(
      { ...normalized, hops: normalized.hops + 1 },
      this.boundaries,
      this._now(),
    );
    const wireMessage = {
      type: "gossip:message",
      protocol: this.protocolId,
      data: forwardMessage,
    };
    this._assertWireSize(wireMessage);
    await this._sendWire(normalizedPeerId, wireMessage);
    this.emit("message:forwarded", {
      messageId: normalized.id,
      peerId: normalizedPeerId,
      hops: forwardMessage.hops,
    });
  }

  async handleIncomingMessage(data) {
    this._assertUsable();
    if (this._activeInbound >= this.boundaries.maxConcurrentInbound) {
      throw this._capacityError(
        "ERR_GOSSIP_INBOUND_CAPACITY",
        "Gossip inbound capacity reached",
      );
    }
    this._activeInbound += 1;
    const generation = this._generation;
    try {
      const rawMessage = data?.data || data;
      const message = normalizeGossipMessage(
        rawMessage,
        this.boundaries,
        this._now(),
      );
      const age = this._now() - message.timestamp;
      if (age > message.ttl) {
        return;
      }
      if (!this.subscriptions.has(message.communityId)) {
        return;
      }
      if (this.seenMessages.has(message.id)) {
        return;
      }
      this.seenMessages.set(message.id);

      this.emit("message:received", {
        messageId: message.id,
        communityId: message.communityId,
        payload: message.payload,
        sender: message.sender,
        hops: message.hops,
        timestamp: message.timestamp,
      });

      if (message.hops >= this.boundaries.maxHops) {
        return;
      }
      const fromPeerId = data?.fromPeerId;
      const eligiblePeers = this.getSubscribedPeers(message.communityId).filter(
        (peerId) => peerId !== message.sender && peerId !== fromPeerId,
      );
      const selectedPeers = this.selectRandomPeers(eligiblePeers, this.fanout);
      await this._runPeerTasks(selectedPeers, (peerId) =>
        this.forward(peerId, message),
      );
      this._assertGeneration(generation);
    } finally {
      this._activeInbound -= 1;
    }
  }

  subscribe(communityId) {
    this._assertUsable();
    const normalizedCommunityId = assertCommunityId(
      communityId,
      this.boundaries,
    );
    if (this.subscriptions.has(normalizedCommunityId)) {
      return;
    }
    if (this.subscriptions.size >= this.boundaries.maxSubscriptions) {
      throw this._capacityError(
        "ERR_GOSSIP_SUBSCRIPTION_CAPACITY",
        "Gossip subscription capacity reached",
      );
    }
    this.subscriptions.set(normalizedCommunityId, true);
    void this._announceSubscription(
      "gossip:subscribe",
      normalizedCommunityId,
    ).catch((error) => {
      logger.warn(
        "[GossipProtocol] Subscription announcement failed:",
        error.message,
      );
    });
    this.emit("subscribed", { communityId: normalizedCommunityId });
  }

  unsubscribe(communityId) {
    this._assertUsable();
    const normalizedCommunityId = assertCommunityId(
      communityId,
      this.boundaries,
    );
    if (!this.subscriptions.has(normalizedCommunityId)) {
      return;
    }
    this.subscriptions.delete(normalizedCommunityId);
    this.peerSubscriptions.delete(normalizedCommunityId);
    void this._announceSubscription(
      "gossip:unsubscribe",
      normalizedCommunityId,
    ).catch((error) => {
      logger.warn(
        "[GossipProtocol] Unsubscription announcement failed:",
        error.message,
      );
    });
    this.emit("unsubscribed", { communityId: normalizedCommunityId });
  }

  getSubscriptions() {
    return Array.from(this.subscriptions.keys());
  }

  handlePeerSubscribe(peerId, communityId) {
    this._assertUsable();
    const normalizedPeerId = assertPeerId(peerId, this.boundaries);
    const normalizedCommunityId = assertCommunityId(
      communityId,
      this.boundaries,
    );
    const existing = this.peerSubscriptions.get(normalizedCommunityId);
    if (!existing) {
      if (this.peerSubscriptions.size >= this.boundaries.maxPeerCommunities) {
        throw this._capacityError(
          "ERR_GOSSIP_PEER_COMMUNITY_CAPACITY",
          "Gossip peer-community capacity reached",
        );
      }
      const peers = new Set([normalizedPeerId]);
      this.peerSubscriptions.set(normalizedCommunityId, peers);
      return;
    }
    if (
      !existing.has(normalizedPeerId) &&
      existing.size >= this.boundaries.maxPeersPerCommunity
    ) {
      throw this._capacityError(
        "ERR_GOSSIP_PEER_CAPACITY",
        `Gossip peer capacity reached for ${normalizedCommunityId}`,
      );
    }
    existing.add(normalizedPeerId);
  }

  handlePeerUnsubscribe(peerId, communityId) {
    this._assertUsable();
    const normalizedPeerId = assertPeerId(peerId, this.boundaries);
    const normalizedCommunityId = assertCommunityId(
      communityId,
      this.boundaries,
    );
    const peers = this.peerSubscriptions.get(normalizedCommunityId);
    peers?.delete(normalizedPeerId);
    if (peers?.size === 0) {
      this.peerSubscriptions.delete(normalizedCommunityId);
    }
  }

  getSubscribedPeers(communityId) {
    const normalizedCommunityId = assertCommunityId(
      communityId,
      this.boundaries,
    );
    const peers = this.peerSubscriptions.get(normalizedCommunityId);
    return peers?.size ? Array.from(peers) : this.getConnectedPeers();
  }

  getConnectedPeers() {
    if (!this.p2pManager?.getConnectedPeers) {
      return [];
    }
    try {
      const peers = this.p2pManager.getConnectedPeers();
      if (!Array.isArray(peers)) {
        return [];
      }
      const normalized = [];
      const seen = new Set();
      for (const peer of peers) {
        if (normalized.length >= this.boundaries.maxConnectedPeers) {
          break;
        }
        const value =
          typeof peer === "string" ? peer : peer?.id || peer?.peerId;
        try {
          const peerId = assertPeerId(
            typeof value === "string" ? value : value?.toString?.(),
            this.boundaries,
          );
          if (!seen.has(peerId)) {
            seen.add(peerId);
            normalized.push(peerId);
          }
        } catch (_error) {
          // Invalid peer records are not retained or returned.
        }
      }
      return normalized;
    } catch (_error) {
      return [];
    }
  }

  getLocalPeerId() {
    if (!this.p2pManager) {
      return "local";
    }
    try {
      const raw = this.p2pManager.peerId || this.p2pManager.localPeerId;
      const value = raw
        ? typeof raw === "string"
          ? raw
          : raw.toString()
        : "local";
      return assertPeerId(value, this.boundaries);
    } catch (_error) {
      return "local";
    }
  }

  selectRandomPeers(peers, count) {
    const boundedCount = Math.min(count, this.fanout);
    if (peers.length <= boundedCount) {
      return [...peers];
    }
    const shuffled = [...peers];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this._random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [
        shuffled[swapIndex],
        shuffled[index],
      ];
    }
    return shuffled.slice(0, boundedCount);
  }

  getStats() {
    return {
      protocolId: this.protocolId,
      fanout: this.fanout,
      subscriptions: this.subscriptions.size,
      seenMessagesCache: this.seenMessages.size,
      cacheCapacity: this.seenMessages.capacity,
      activeInbound: this._activeInbound,
      activeBroadcasts: this._activeBroadcasts,
      activeSends: this._activeSends,
      limits: this.boundaries,
      peerSubscriptions: Object.fromEntries(
        Array.from(this.peerSubscriptions.entries()).map(([key, peers]) => [
          key,
          peers.size,
        ]),
      ),
    };
  }

  async _announceSubscription(type, communityId) {
    const peers = this.getConnectedPeers().slice(
      0,
      this.boundaries.maxAnnouncementPeers,
    );
    const message = {
      type,
      communityId,
      peerId: this.getLocalPeerId(),
    };
    this._assertWireSize(message);
    await this._runPeerTasks(peers, (peerId) =>
      this._sendWire(peerId, message),
    );
  }

  async _runPeerTasks(peers, task) {
    const results = new Array(peers.length).fill(false);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < peers.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = await task(peers[index]);
        } catch (_error) {
          results[index] = false;
        }
      }
    };
    const workerCount = Math.min(
      peers.length,
      this.boundaries.maxConcurrentSends,
    );
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  async _sendWire(peerId, message) {
    this._assertUsable();
    if (!this.p2pManager?.sendMessage) {
      throw new Error("P2P manager not available");
    }
    if (this._activeSends >= this.boundaries.maxConcurrentSends) {
      throw this._capacityError(
        "ERR_GOSSIP_SEND_CAPACITY",
        "Gossip send capacity reached",
      );
    }
    this._activeSends += 1;
    try {
      await this._runWithDeadline(
        () => this.p2pManager.sendMessage(peerId, message),
        `Gossip send to ${peerId} exceeded its deadline`,
      );
    } finally {
      this._activeSends -= 1;
    }
  }

  async _runWithDeadline(operation, message) {
    const generation = this._generation;
    let timer;
    let cancel;
    const cancellation = new Promise((_, reject) => {
      cancel = () => reject(this._destroyedError());
      this._pendingOperations.add(cancel);
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new GossipBoundaryError("ERR_GOSSIP_DEADLINE", message, {
            deadlineMs: this.boundaries.sendDeadlineMs,
          }),
        );
      }, this.boundaries.sendDeadlineMs);
      timer.unref?.();
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(operation),
        timeout,
        cancellation,
      ]);
      this._assertGeneration(generation);
      return result;
    } finally {
      clearTimeout(timer);
      this._pendingOperations.delete(cancel);
    }
  }

  _assertWireSize(message) {
    let serialized;
    try {
      serialized = JSON.stringify(message);
    } catch (_error) {
      throw new GossipBoundaryError(
        "ERR_GOSSIP_MESSAGE_INVALID",
        "Gossip wire message must be JSON serializable",
      );
    }
    const byteLength = Buffer.byteLength(serialized, "utf8");
    if (byteLength > this.boundaries.maxMessageBytes) {
      throw new GossipBoundaryError(
        "ERR_GOSSIP_MESSAGE_TOO_LARGE",
        `Gossip wire message exceeds ${this.boundaries.maxMessageBytes} bytes`,
        { byteLength, limitBytes: this.boundaries.maxMessageBytes },
      );
    }
  }

  _capacityError(code, message) {
    return new GossipBoundaryError(code, message, { retryAfterMs: 1000 });
  }

  _assertUsable() {
    if (this._destroyed) {
      throw this._destroyedError();
    }
  }

  _assertGeneration(generation) {
    if (this._destroyed || generation !== this._generation) {
      throw this._destroyedError();
    }
  }

  _destroyedError() {
    return new GossipBoundaryError(
      "ERR_GOSSIP_DESTROYED",
      "Gossip protocol has been destroyed",
    );
  }

  _teardownP2PListeners() {
    if (!this._listenersAttached || !this.p2pManager) {
      return;
    }
    const remove = this.p2pManager.off || this.p2pManager.removeListener;
    remove?.call(this.p2pManager, "gossip:message", this._onGossipMessage);
    remove?.call(this.p2pManager, "gossip:subscribe", this._onGossipSubscribe);
    remove?.call(
      this.p2pManager,
      "gossip:unsubscribe",
      this._onGossipUnsubscribe,
    );
    this._listenersAttached = false;
    this._onGossipMessage = null;
    this._onGossipSubscribe = null;
    this._onGossipUnsubscribe = null;
  }

  async destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._generation += 1;
    for (const cancel of this._pendingOperations) {
      cancel();
    }
    this._pendingOperations.clear();
    this._teardownP2PListeners();
    this.subscriptions.clear();
    this.peerSubscriptions.clear();
    this.seenMessages.clear();
    this.removeAllListeners();
    this.initialized = false;
    this.p2pManager = null;
    logger.info("[GossipProtocol] Destroyed");
  }

  async close() {
    await this.destroy();
  }
}

module.exports = {
  GossipProtocol,
  LRUCache,
  DEFAULTS,
};
