/**
 * channel-envelope-distribution — cross-machine envelope sharing on top of
 * Phase B v1 (MtcFederationManager gossipsub) + B4-merkle v1 (local
 * ChannelEventBatcher).
 *
 * Two paths:
 *   1. Landmark broadcast (gossipsub topic `cc.community.<id>.envelopes`):
 *      every closeBatch publishes the new landmark so subscribers cache it.
 *      Small (~1KB), eagerly distributed, lets receivers verify any envelope
 *      from that batch the moment they have the envelope itself.
 *   2. Envelope on-demand pull (typed request/response via Phase A's
 *      /chainlesschain/message/1.0.0): when a peer wants to verify a specific
 *      message X they send `mtc:envelope-request{communityId, messageId,
 *      requestId}` to known peers; the responder looks up its local
 *      ChannelEventBatcher and replies `mtc:envelope-response{requestId,
 *      found, envelope?}`. Bandwidth-efficient (only fetched when needed).
 *
 * v1 trust model: NONE — caches whatever arrives, no signature check on
 * inbound landmarks. Acceptable because (a) Noise transport prevents MITM,
 * (b) the receiver still ultimately verifies the envelope's inclusion proof
 * against the landmark's tree-head signature when running `cc mtc verify`
 * or equivalent. Future v2: filter inbound landmarks by trust_anchors
 * matching expected federation members.
 *
 * @module channel-envelope-distribution
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

const TOPIC_PREFIX = "cc.community.";
const TOPIC_SUFFIX = ".envelopes";
const REQUEST_TIMEOUT_MS = 8000;

function envelopeTopicForCommunity(communityId) {
  if (typeof communityId !== "string" || !communityId) {
    throw new TypeError("communityId required");
  }
  return TOPIC_PREFIX + communityId + TOPIC_SUFFIX;
}

class ChannelEnvelopeDistribution extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.mtcFederationManager - publishes/subscribes
   *   gossipsub topics
   * @param {object} opts.p2pManager - sends typed messages, fires
   *   'mtc:envelope-request' / 'mtc:envelope-response' events via the
   *   dispatchTypedMessage path
   * @param {object} opts.channelEventBatcher - local event batcher (also
   *   stores received remote landmarks/envelopes)
   * @param {number} [opts.requestTimeoutMs=8000]
   */
  constructor(opts = {}) {
    super();
    if (!opts.mtcFederationManager) {
      throw new Error(
        "ChannelEnvelopeDistribution: mtcFederationManager required",
      );
    }
    if (!opts.p2pManager) {
      throw new Error("ChannelEnvelopeDistribution: p2pManager required");
    }
    if (!opts.channelEventBatcher) {
      throw new Error(
        "ChannelEnvelopeDistribution: channelEventBatcher required",
      );
    }
    this._fed = opts.mtcFederationManager;
    this._p2p = opts.p2pManager;
    this._batcher = opts.channelEventBatcher;
    this._requestTimeoutMs = opts.requestTimeoutMs || REQUEST_TIMEOUT_MS;

    this._communitySubs = new Map(); // communityId → unsubscribe fn (gossipsub)
    this._inflight = new Map(); // requestId → { resolve, reject, timer }
    this._reqCounter = 0;
    this._initialized = false;
    this._closed = false;

    this._batcherUnhook = null;
    this._reqListener = null;
    this._respListener = null;
  }

  initialize() {
    if (this._initialized) {
      return;
    }
    if (this._closed) {
      throw new Error("already closed");
    }

    // Hook batcher: every successful close publishes the landmark
    this._batcherUnhook = this._batcher.onBatchClosed(
      ({ communityId, batchId, treeHeadId, landmark, manifest }) => {
        this._publishLandmark(
          communityId,
          batchId,
          treeHeadId,
          landmark,
          manifest,
        ).catch((err) =>
          logger.warn(
            "[ChannelEnvelopeDist] auto-publish failed for batch " +
              batchId +
              ": " +
              err.message,
          ),
        );
      },
    );

    // Hook p2pManager typed message events (dispatchTypedMessage routes
    // type='mtc:envelope-request' to this event)
    this._reqListener = (req) => this._onEnvelopeRequest(req);
    this._p2p.on("mtc:envelope-request", this._reqListener);

    this._respListener = (resp) => this._onEnvelopeResponse(resp);
    this._p2p.on("mtc:envelope-response", this._respListener);

    this._initialized = true;
    logger.info("[ChannelEnvelopeDist] initialized");
  }

  async close() {
    if (this._closed) {
      return;
    }
    this._closed = true;
    if (this._batcherUnhook) {
      try {
        this._batcherUnhook();
      } catch (_err) {
        /* ignore */
      }
    }
    if (this._reqListener) {
      this._p2p.off("mtc:envelope-request", this._reqListener);
    }
    if (this._respListener) {
      this._p2p.off("mtc:envelope-response", this._respListener);
    }
    for (const [, pending] of this._inflight) {
      clearTimeout(pending.timer);
      pending.reject(new Error("ChannelEnvelopeDistribution closed"));
    }
    this._inflight.clear();
    for (const unsub of this._communitySubs.values()) {
      try {
        unsub();
      } catch (_err) {
        /* ignore */
      }
    }
    this._communitySubs.clear();
    this._initialized = false;
    this.removeAllListeners();
  }

  /**
   * Subscribe to a community's envelope topic so we cache landmarks
   * broadcast by other federation members. Idempotent.
   *
   * @param {string} communityId
   */
  async subscribeCommunity(communityId) {
    this._assertReady();
    if (this._communitySubs.has(communityId)) {
      return;
    }
    if (!this._fed.isInitialized || !this._fed.isInitialized()) {
      logger.warn(
        "[ChannelEnvelopeDist] mtcFedMgr not initialized, skipping subscribe for " +
          communityId,
      );
      return;
    }

    // MtcFederationManager.subscribeCommunity uses
    // `cc.community.<id>.events` topic; we want a SEPARATE topic for
    // envelopes. Direct gossipsub subscribe via Libp2pTransport's
    // subscribeRaw is the cleanest path — but that's not exposed on
    // mtcFedMgr. Workaround: use mtcFedMgr.subscribeCommunity but with
    // a synthetic communityId of `<id>.envelopes` so we get a unique
    // topic. Slight abuse of the API but avoids leaking transport details.
    const syntheticId = communityId + ".envelopes-track";
    await this._fed.subscribeCommunity(syntheticId, (payload) => {
      try {
        this._handleIncomingLandmark(communityId, payload);
      } catch (err) {
        logger.warn(
          "[ChannelEnvelopeDist] inbound landmark handler threw: " +
            err.message,
        );
      }
    });
    this._communitySubs.set(communityId, () => {
      try {
        this._fed.unsubscribeCommunity(syntheticId);
      } catch (_err) {
        /* ignore */
      }
    });
    logger.info(
      "[ChannelEnvelopeDist] subscribed envelope topic for " + communityId,
    );
  }

  unsubscribeCommunity(communityId) {
    const unsub = this._communitySubs.get(communityId);
    if (unsub) {
      unsub();
    }
    this._communitySubs.delete(communityId);
  }

  /**
   * Request a specific envelope from a known peer. Times out after
   * `requestTimeoutMs` (default 8s). Returns `null` on timeout / not-found,
   * or the envelope object on success.
   *
   * @param {string} peerId - peer to ask
   * @param {string} communityId
   * @param {string} messageId
   * @returns {Promise<object|null>}
   */
  async requestEnvelope(peerId, communityId, messageId) {
    this._assertReady();
    const requestId = "req-" + Date.now() + "-" + ++this._reqCounter;

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._inflight.delete(requestId)) {
          resolve(null); // treat timeout as not-found, not an error
        }
      }, this._requestTimeoutMs);
      this._inflight.set(requestId, { resolve, reject, timer });
    });

    try {
      await this._p2p.sendMessage(peerId, {
        type: "mtc:envelope-request",
        communityId,
        messageId,
        requestId,
      });
    } catch (err) {
      const pending = this._inflight.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this._inflight.delete(requestId);
        pending.reject(err);
      }
    }

    return promise;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────

  async _publishLandmark(communityId, batchId, treeHeadId, landmark, manifest) {
    if (!this._fed.isInitialized || !this._fed.isInitialized()) {
      logger.warn(
        "[ChannelEnvelopeDist] mtcFedMgr down, dropping landmark publish for " +
          batchId,
      );
      return;
    }
    const syntheticId = communityId + ".envelopes-track";
    const wirePayload = {
      type: "channel.landmark",
      communityId,
      batchId,
      treeHeadId,
      landmark,
      manifest,
      publishedAt: new Date().toISOString(),
    };
    const result = await this._fed.publishCommunityEvent(
      syntheticId,
      wirePayload,
    );
    logger.info(
      "[ChannelEnvelopeDist] published landmark batch=" +
        batchId +
        " th=" +
        treeHeadId +
        " recipients=" +
        (result && result.recipients),
    );
    this.emit("landmark:published", {
      communityId,
      batchId,
      treeHeadId,
      recipients: result && result.recipients,
    });
  }

  _handleIncomingLandmark(communityId, payload) {
    if (!payload || payload.type !== "channel.landmark") {
      return;
    }
    if (!payload.treeHeadId || !payload.landmark) {
      return;
    }
    const stored = this._batcher.storeRemoteLandmark(
      communityId,
      payload.treeHeadId,
      payload.landmark,
    );
    if (stored.alreadyExists) {
      logger.debug(
        "[ChannelEnvelopeDist] landmark already cached: " + payload.treeHeadId,
      );
    } else {
      logger.info(
        "[ChannelEnvelopeDist] cached remote landmark th=" +
          payload.treeHeadId +
          " for " +
          communityId,
      );
    }
    this.emit("landmark:received", {
      communityId,
      treeHeadId: payload.treeHeadId,
      batchId: payload.batchId,
    });
  }

  async _onEnvelopeRequest(reqEvent) {
    if (this._closed) {
      return;
    }
    if (
      !reqEvent ||
      !reqEvent.requestId ||
      !reqEvent.communityId ||
      !reqEvent.messageId
    ) {
      return;
    }
    const fromPeerId = reqEvent.fromPeerId;
    if (!fromPeerId) {
      return;
    }

    let foundEnvelope = null;
    let batchId = null;
    try {
      const found = this._batcher.findEnvelope(
        reqEvent.communityId,
        reqEvent.messageId,
      );
      if (found.found && !found.staging) {
        const fs = require("fs");
        foundEnvelope = JSON.parse(
          fs.readFileSync(found.envelopePath, "utf-8"),
        );
        batchId = found.batchId || null;
      }
    } catch (err) {
      logger.warn(
        "[ChannelEnvelopeDist] lookup failed for " +
          reqEvent.messageId +
          ": " +
          err.message,
      );
    }

    try {
      await this._p2p.sendMessage(fromPeerId, {
        type: "mtc:envelope-response",
        requestId: reqEvent.requestId,
        communityId: reqEvent.communityId,
        messageId: reqEvent.messageId,
        found: !!foundEnvelope,
        envelope: foundEnvelope || undefined,
        batchId: batchId || undefined,
      });
    } catch (err) {
      logger.warn(
        "[ChannelEnvelopeDist] response send failed to " +
          fromPeerId +
          ": " +
          err.message,
      );
    }
  }

  _onEnvelopeResponse(respEvent) {
    if (this._closed) {
      return;
    }
    if (!respEvent || !respEvent.requestId) {
      return;
    }
    const pending = this._inflight.get(respEvent.requestId);
    if (!pending) {
      return;
    } // duplicate / stale response, ignore

    clearTimeout(pending.timer);
    this._inflight.delete(respEvent.requestId);

    if (respEvent.found && respEvent.envelope) {
      // Cache it locally so the next findEnvelope hits without a round-trip
      try {
        this._batcher.storeRemoteEnvelope(
          respEvent.communityId,
          respEvent.messageId,
          respEvent.envelope,
        );
      } catch (err) {
        logger.warn(
          "[ChannelEnvelopeDist] failed to cache fetched envelope " +
            respEvent.messageId +
            ": " +
            err.message,
        );
      }
      pending.resolve(respEvent.envelope);
    } else {
      pending.resolve(null);
    }
  }

  _assertReady() {
    if (this._closed) {
      throw new Error("ChannelEnvelopeDistribution closed");
    }
    if (!this._initialized) {
      throw new Error("ChannelEnvelopeDistribution not initialized");
    }
  }
}

module.exports = {
  ChannelEnvelopeDistribution,
  envelopeTopicForCommunity,
  TOPIC_PREFIX,
  TOPIC_SUFFIX,
  REQUEST_TIMEOUT_MS,
};
