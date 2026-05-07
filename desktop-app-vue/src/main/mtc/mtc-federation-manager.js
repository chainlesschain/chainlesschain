/**
 * MtcFederationManager — MTC 联邦 gossipsub 通道封装
 *
 * Phase B v1：在 Phase A 直连 gossip 之上 *双轨* 加一条 MTC 联邦 gossipsub
 * 通道，给 community/channel 数据带可审计 transport（v1 只到 transport 层，
 * Merkle 批 finality / DID 签名 / M-of-N 留 B4 sub-phase）。
 *
 * 包装 `@chainlesschain/core-mtc/transports/libp2p` 的 Libp2pTransport
 * (gossipsub mode)，对外提供以社区为单位的 subscribe / publish API。
 *
 * Topic 命名约定：`cc.community.<communityId>.events`。
 *
 * 自动发现：v1 不做。`connectPeer(multiaddr)` 由调用方手动 bridge。
 *
 * @module mtc-federation-manager
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

const TOPIC_PREFIX = "cc.community.";
const TOPIC_SUFFIX = ".events";

function topicForCommunity(communityId) {
  if (typeof communityId !== "string" || !communityId) {
    throw new TypeError("communityId must be non-empty string");
  }
  return TOPIC_PREFIX + communityId + TOPIC_SUFFIX;
}

class MtcFederationManager extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {() => Promise<object>} [opts.transportFactory] - 测试桩；返回带
   *   subscribeRaw / publishRaw / connect / multiaddrs / peerIdString / close
   *   方法的对象。生产路径不传，走真实 Libp2pTransport.create。
   * @param {object} [opts.libp2pOpts] - 透传给 Libp2pTransport.create 的配置
   *   （listen / gossipD / gossipDlo / gossipDhi 等）。
   */
  constructor(opts = {}) {
    super();
    this._transportFactory = opts.transportFactory || null;
    this._libp2pOpts = opts.libp2pOpts || {};
    this._transport = null;
    this._unsubscribers = new Map(); // communityId → fn
    this._handlers = new Map(); // communityId → handler
    this._initialized = false;
    this._closed = false;
  }

  async initialize() {
    if (this._initialized) {
      return;
    }
    if (this._closed) {
      throw new Error("MtcFederationManager already closed");
    }
    try {
      if (this._transportFactory) {
        this._transport = await this._transportFactory();
      } else {
        // dynamic require to keep ESM/CJS interop simple — Libp2pTransport
        // module itself dynamic-imports its libp2p deps internally.
        const {
          Libp2pTransport,
        } = require("@chainlesschain/core-mtc/transports/libp2p");
        this._transport = await Libp2pTransport.create({
          mode: "gossipsub",
          ...this._libp2pOpts,
        });
      }
      this._initialized = true;
      const id = this.peerIdString();
      const addrs = this.multiaddrs();
      logger.info(
        "[MtcFederationManager] initialized: peerId=" +
          id +
          " addrs=" +
          JSON.stringify(addrs),
      );
      this.emit("initialized", { peerId: id, multiaddrs: addrs });
    } catch (err) {
      logger.error("[MtcFederationManager] initialize failed:", err);
      throw err;
    }
  }

  /**
   * Subscribe to a community's MTC topic. Handler receives the **decoded**
   * JSON payload (object). Idempotent on (communityId).
   *
   * @param {string} communityId
   * @param {(payload: object) => void} handler
   */
  async subscribeCommunity(communityId, handler) {
    this._assertReady();
    if (typeof handler !== "function") {
      throw new TypeError("subscribeCommunity: handler must be function");
    }
    if (this._unsubscribers.has(communityId)) {
      // Already subscribed — replace handler (single-handler-per-community
      // semantics; matches gossipReceiver pattern from Phase A)
      this._handlers.set(communityId, handler);
      return;
    }

    const topic = topicForCommunity(communityId);
    const wrapped = (bytes) => {
      let parsed;
      try {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        parsed = JSON.parse(text);
      } catch (err) {
        logger.warn(
          "[MtcFederationManager] payload decode failed on " +
            topic +
            ": " +
            err.message,
        );
        return;
      }
      try {
        // dispatch to current handler (allow handler swap on re-subscribe)
        const cur = this._handlers.get(communityId);
        if (cur) {
          cur(parsed);
        }
      } catch (err) {
        logger.warn(
          "[MtcFederationManager] handler threw on " +
            topic +
            ": " +
            err.message,
        );
      }
    };

    const unsub = this._transport.subscribeRaw(topic, wrapped);
    this._unsubscribers.set(communityId, unsub);
    this._handlers.set(communityId, handler);
    logger.info("[MtcFederationManager] subscribed: " + topic);
  }

  /**
   * Unsubscribe a community. Idempotent.
   * @param {string} communityId
   */
  unsubscribeCommunity(communityId) {
    const unsub = this._unsubscribers.get(communityId);
    if (unsub) {
      try {
        unsub();
      } catch (err) {
        logger.warn(
          "[MtcFederationManager] unsubscribe error (swallowed):",
          err.message,
        );
      }
    }
    this._unsubscribers.delete(communityId);
    this._handlers.delete(communityId);
  }

  /**
   * Publish a JSON payload to a community's MTC topic.
   * @param {string} communityId
   * @param {object} payload - any JSON-serializable
   * @returns {Promise<{recipients: number}>}
   */
  async publishCommunityEvent(communityId, payload) {
    this._assertReady();
    if (payload === null || typeof payload !== "object") {
      throw new TypeError("publishCommunityEvent: payload must be object");
    }
    const topic = topicForCommunity(communityId);
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    return await this._transport.publishRaw(topic, bytes);
  }

  /**
   * Manually dial a peer multiaddr (for cross-machine bridging until auto-
   * discovery is wired in a follow-up sub-phase).
   * @param {string} multiaddrStr - e.g. /ip4/.../tcp/.../p2p/<peerId>
   */
  async connectPeer(multiaddrStr) {
    this._assertReady();
    return await this._transport.connect(multiaddrStr);
  }

  multiaddrs() {
    if (!this._transport) {
      return [];
    }
    return typeof this._transport.multiaddrs === "function"
      ? this._transport.multiaddrs()
      : [];
  }

  peerIdString() {
    if (!this._transport) {
      return null;
    }
    return typeof this._transport.peerIdString === "function"
      ? this._transport.peerIdString()
      : null;
  }

  isInitialized() {
    return this._initialized && !this._closed;
  }

  getSubscriptions() {
    return Array.from(this._unsubscribers.keys());
  }

  async close() {
    if (this._closed) {
      return;
    }
    this._closed = true;
    for (const unsub of this._unsubscribers.values()) {
      try {
        unsub();
      } catch (_err) {
        /* best-effort */
      }
    }
    this._unsubscribers.clear();
    this._handlers.clear();
    if (this._transport) {
      try {
        await this._transport.close();
      } catch (err) {
        logger.warn(
          "[MtcFederationManager] transport close error (swallowed):",
          err.message,
        );
      }
      this._transport = null;
    }
    this._initialized = false;
    this.removeAllListeners();
  }

  _assertReady() {
    if (this._closed) {
      throw new Error("MtcFederationManager closed");
    }
    if (!this._initialized || !this._transport) {
      throw new Error("MtcFederationManager not initialized");
    }
  }
}

module.exports = {
  MtcFederationManager,
  topicForCommunity,
  TOPIC_PREFIX,
  TOPIC_SUFFIX,
};
