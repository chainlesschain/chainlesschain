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
const {
  jsonBytesWithinLimit,
  resolveMtcRuntimeLimits,
  waitForTasksBounded,
} = require("./mtc-runtime-boundaries.js");

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
    this._limits = resolveMtcRuntimeLimits(opts.limits || {});
    this._unsubscribers = new Map(); // communityId → fn
    this._handlers = new Map(); // communityId → handler
    this._handlerTasks = new Set();
    this._initializePromise = null;
    this._closePromise = null;
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
    if (this._initializePromise) {
      return this._initializePromise;
    }
    this._initializePromise = this._initialize();
    try {
      return await this._initializePromise;
    } finally {
      this._initializePromise = null;
    }
  }

  async _initialize() {
    try {
      let transport;
      if (this._transportFactory) {
        transport = await this._transportFactory();
      } else {
        // dynamic require to keep ESM/CJS interop simple — Libp2pTransport
        // module itself dynamic-imports its libp2p deps internally.
        const {
          Libp2pTransport,
        } = require("@chainlesschain/core-mtc/transports/libp2p");
        transport = await Libp2pTransport.create({
          mode: "gossipsub",
          ...this._libp2pOpts,
        });
      }
      if (this._closed) {
        await transport?.close?.();
        throw new Error("MtcFederationManager closed during initialization");
      }
      this._transport = transport;
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
    if (this._unsubscribers.size >= this._limits.maxSubscriptions) {
      throw new Error("MtcFederationManager subscription limit exceeded");
    }

    const topic = topicForCommunity(communityId);
    const wrapped = (bytes) => {
      if (this._closed) {
        return;
      }
      if (
        !bytes ||
        !Number.isSafeInteger(bytes.byteLength) ||
        bytes.byteLength > this._limits.maxPayloadBytes
      ) {
        logger.warn("[MtcFederationManager] oversized payload dropped");
        return;
      }
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
      if (this._handlerTasks.size >= this._limits.maxInboundTasks) {
        logger.warn("[MtcFederationManager] inbound handler capacity exceeded");
        return;
      }
      const cur = this._handlers.get(communityId);
      let result;
      try {
        result = cur ? cur(parsed) : undefined;
      } catch (err) {
        logger.warn(
          "[MtcFederationManager] handler threw on " +
            topic +
            ": " +
            err.message,
        );
        return;
      }
      if (!result || typeof result.then !== "function") {
        return;
      }
      const task = Promise.resolve(result)
        .catch((err) =>
          logger.warn(
            "[MtcFederationManager] handler threw on " +
              topic +
              ": " +
              err.message,
          ),
        )
        .finally(() => this._handlerTasks.delete(task));
      this._handlerTasks.add(task);
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
    const { json } = jsonBytesWithinLimit(
      payload,
      this._limits.maxPayloadBytes,
      "MTC federation payload",
    );
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
    if (this._closePromise) {
      return this._closePromise;
    }
    this._closePromise = this._close();
    return this._closePromise;
  }

  async _close() {
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
    await waitForTasksBounded(this._handlerTasks, this._limits.closeTimeoutMs);
    this._handlerTasks.clear();
    if (this._transport) {
      try {
        let timer;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(resolve, this._limits.closeTimeoutMs);
          timer.unref?.();
        });
        await Promise.race([
          Promise.resolve(this._transport.close()),
          timeout,
        ]).finally(() => clearTimeout(timer));
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
