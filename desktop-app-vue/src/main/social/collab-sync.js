/**
 * Social Collaboration Sync
 *
 * Bounded P2P document synchronization for social collaborative editing.
 * Transport framing and lifecycle are owned by SocialCollabTransport; this
 * module owns only document/peer session state and Yjs integration.
 *
 * @module social/collab-sync
 * @version 0.41.0
 */

"use strict";

const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");
const {
  SOCIAL_COLLAB_MESSAGE_TYPES: MessageType,
  SocialCollabBoundaryError,
  createSocialCollabBoundaries,
  assertSocialDocumentId,
  assertSocialPeerId,
  normalizeSocialCollabUpdate,
  normalizeSocialCollabMessage,
} = require("./social-collab-boundaries");
const {
  SocialCollabTransport,
  PROTOCOL_SOCIAL_COLLAB,
} = require("./social-collab-transport");

class CollabSync extends EventEmitter {
  constructor(p2pManager, yjsCollabManager = null, options = {}) {
    super();
    this.p2pManager = p2pManager;
    this.yjsCollabManager = yjsCollabManager;
    this.boundaries = createSocialCollabBoundaries(options.boundaries || {});
    this.transport = null;
    this.syncSessions = new Map();
    this.initialized = false;
    this._destroyed = false;
  }

  async initialize() {
    if (this._destroyed) {
      throw this._destroyedError();
    }
    if (this.initialized) {
      return;
    }
    logger.info("[CollabSync] Initializing...");
    const transport = new SocialCollabTransport({
      p2pManager: this.p2pManager,
      boundaries: this.boundaries,
      onMessage: (peerId, message) =>
        this.handleIncomingUpdate(peerId, message),
    });
    transport.on("peer:connected", (peerId) =>
      this._handlePeerConnected(peerId),
    );
    transport.on("peer:disconnected", (peerId) =>
      this._handlePeerDisconnected(peerId),
    );
    transport.on("boundary-error", (error) =>
      this.emit("boundary-error", error),
    );
    try {
      await transport.initialize();
      this.transport = transport;
      this.initialized = true;
      logger.info("[CollabSync] Initialized successfully");
    } catch (error) {
      await transport.destroy().catch(() => {});
      logger.error("[CollabSync] Initialization failed:", error);
      throw error;
    }
  }

  async startSync(docId, peerId) {
    this._requireReady();
    const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);
    const normalizedPeerId = assertSocialPeerId(peerId, this.boundaries);
    const { session, created } = this._ensureSession(normalizedDocId);
    const alreadyRetained = session.peers.has(normalizedPeerId);
    if (
      !alreadyRetained &&
      session.peers.size >= this.boundaries.maxPeersPerDocument
    ) {
      if (created) {
        this.syncSessions.delete(normalizedDocId);
      }
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_PEER_CAPACITY",
        `Document already retains ${this.boundaries.maxPeersPerDocument} peers`,
        { docId: normalizedDocId, limit: this.boundaries.maxPeersPerDocument },
      );
    }

    session.peers.add(normalizedPeerId);
    session.active = true;
    const deadlineAt = this.transport.createDeadline();
    try {
      await this._sendMessage(
        normalizedPeerId,
        {
          type: MessageType.SYNC_START,
          docId: normalizedDocId,
          timestamp: Date.now(),
        },
        deadlineAt,
      );
      await this._sendMessage(
        normalizedPeerId,
        {
          type: MessageType.FULL_STATE_REQUEST,
          docId: normalizedDocId,
          timestamp: Date.now(),
        },
        deadlineAt,
      );
    } catch (error) {
      if (!alreadyRetained) {
        session.peers.delete(normalizedPeerId);
      }
      if (session.peers.size === 0) {
        this.syncSessions.delete(normalizedDocId);
      }
      throw error;
    }

    this.emit("sync:connected", {
      docId: normalizedDocId,
      peerId: normalizedPeerId,
    });
    logger.info(
      `[CollabSync] Sync started for doc ${normalizedDocId} with peer ${normalizedPeerId}`,
    );
    return {
      success: true,
      docId: normalizedDocId,
      peerId: normalizedPeerId,
    };
  }

  async stopSync(docId, peerId = null) {
    this._requireReady();
    const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);
    const session = this.syncSessions.get(normalizedDocId);
    if (!session) {
      return { success: true };
    }

    const deadlineAt = this.transport.createDeadline();
    if (peerId !== null && peerId !== undefined) {
      const normalizedPeerId = assertSocialPeerId(peerId, this.boundaries);
      session.peers.delete(normalizedPeerId);
      if (session.peers.size === 0) {
        this.syncSessions.delete(normalizedDocId);
      }
      await this._sendMessage(
        normalizedPeerId,
        {
          type: MessageType.SYNC_STOP,
          docId: normalizedDocId,
          timestamp: Date.now(),
        },
        deadlineAt,
      ).catch(() => {});
      this.emit("sync:disconnected", {
        docId: normalizedDocId,
        peerId: normalizedPeerId,
      });
    } else {
      const peers = [...session.peers];
      this.syncSessions.delete(normalizedDocId);
      for (const retainedPeerId of peers) {
        await this._sendMessage(
          retainedPeerId,
          {
            type: MessageType.SYNC_STOP,
            docId: normalizedDocId,
            timestamp: Date.now(),
          },
          deadlineAt,
        ).catch(() => {});
        this.emit("sync:disconnected", {
          docId: normalizedDocId,
          peerId: retainedPeerId,
        });
      }
    }
    return { success: true };
  }

  async broadcastUpdate(docId, update) {
    this._requireReady();
    const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);
    const updateBytes = normalizeSocialCollabUpdate(update, this.boundaries);
    const session = this.syncSessions.get(normalizedDocId);
    if (!session?.active || session.peers.size === 0) {
      return { success: true, peersNotified: 0 };
    }

    const message = {
      type: MessageType.UPDATE,
      docId: normalizedDocId,
      data: Array.from(updateBytes),
      timestamp: Date.now(),
    };
    const deadlineAt = this.transport.createDeadline();
    let peersNotified = 0;
    for (const retainedPeerId of session.peers) {
      try {
        await this._sendMessage(retainedPeerId, message, deadlineAt);
        peersNotified += 1;
      } catch (error) {
        logger.warn(
          `[CollabSync] Failed to send update to peer ${retainedPeerId}:`,
          error.message,
        );
      }
    }
    this.emit("sync:update", { docId: normalizedDocId, peersNotified });
    return { success: true, peersNotified };
  }

  async requestFullState(docId, peerId) {
    this._requireReady();
    const normalizedDocId = assertSocialDocumentId(docId, this.boundaries);
    const normalizedPeerId = assertSocialPeerId(peerId, this.boundaries);
    await this._sendMessage(normalizedPeerId, {
      type: MessageType.FULL_STATE_REQUEST,
      docId: normalizedDocId,
      timestamp: Date.now(),
    });
    return { success: true };
  }

  async handleIncomingUpdate(peerId, data) {
    if (this._destroyed) {
      throw this._destroyedError();
    }
    const normalizedPeerId = assertSocialPeerId(peerId, this.boundaries);
    const message = normalizeSocialCollabMessage(data, this.boundaries);
    const { type, docId } = message;

    switch (type) {
      case MessageType.UPDATE:
      case MessageType.FULL_STATE_RESPONSE: {
        const updateBytes = normalizeSocialCollabUpdate(
          message.data,
          this.boundaries,
        );
        if (this.yjsCollabManager) {
          this.yjsCollabManager.applyUpdate(docId, updateBytes, "network");
        }
        this.emit("sync:update", {
          docId,
          peerId: normalizedPeerId,
          ...(type === MessageType.UPDATE
            ? { data: updateBytes }
            : { fullState: true }),
        });
        break;
      }

      case MessageType.FULL_STATE_REQUEST: {
        if (this.yjsCollabManager) {
          const Y = require("yjs");
          const ydoc = this.yjsCollabManager.getDocument(docId);
          const state = Y.encodeStateAsUpdate(ydoc);
          await this._sendMessage(normalizedPeerId, {
            type: MessageType.FULL_STATE_RESPONSE,
            docId,
            data: Array.from(state),
            timestamp: Date.now(),
          });
        }
        break;
      }

      case MessageType.SYNC_START:
        this._retainPeer(docId, normalizedPeerId);
        this.emit("sync:connected", {
          docId,
          peerId: normalizedPeerId,
        });
        break;

      case MessageType.SYNC_STOP: {
        const session = this.syncSessions.get(docId);
        session?.peers.delete(normalizedPeerId);
        if (session?.peers.size === 0) {
          this.syncSessions.delete(docId);
        }
        this.emit("sync:disconnected", {
          docId,
          peerId: normalizedPeerId,
        });
        break;
      }
    }
  }

  getSyncPeers(docId) {
    const session = this.syncSessions.get(docId);
    return session ? Array.from(session.peers) : [];
  }

  isSyncing(docId) {
    const session = this.syncSessions.get(docId);
    return Boolean(session?.active && session.peers.size > 0);
  }

  _ensureSession(docId) {
    let session = this.syncSessions.get(docId);
    if (session) {
      return { session, created: false };
    }
    if (this.syncSessions.size >= this.boundaries.maxActiveDocuments) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_DOCUMENT_CAPACITY",
        `Social collaboration already retains ${this.boundaries.maxActiveDocuments} documents`,
        { limit: this.boundaries.maxActiveDocuments },
      );
    }
    session = { peers: new Set(), active: true };
    this.syncSessions.set(docId, session);
    return { session, created: true };
  }

  _retainPeer(docId, peerId) {
    const { session, created } = this._ensureSession(docId);
    if (
      !session.peers.has(peerId) &&
      session.peers.size >= this.boundaries.maxPeersPerDocument
    ) {
      if (created) {
        this.syncSessions.delete(docId);
      }
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_PEER_CAPACITY",
        `Document already retains ${this.boundaries.maxPeersPerDocument} peers`,
        { docId, limit: this.boundaries.maxPeersPerDocument },
      );
    }
    session.peers.add(peerId);
    session.active = true;
  }

  _sendMessage(peerId, message, deadlineAt) {
    this._requireReady();
    return this.transport.send(peerId, message, deadlineAt);
  }

  _handlePeerConnected(peerId) {
    try {
      const normalizedPeerId = assertSocialPeerId(peerId, this.boundaries);
      for (const [docId, session] of this.syncSessions) {
        if (session.active && session.peers.has(normalizedPeerId)) {
          this.emit("sync:connected", { docId, peerId: normalizedPeerId });
        }
      }
    } catch (_error) {
      // Ignore malformed manager events at the trust boundary.
    }
  }

  _handlePeerDisconnected(peerId) {
    try {
      const normalizedPeerId = assertSocialPeerId(peerId, this.boundaries);
      for (const [docId, session] of this.syncSessions) {
        if (session.peers.has(normalizedPeerId)) {
          this.emit("sync:disconnected", {
            docId,
            peerId: normalizedPeerId,
          });
        }
      }
    } catch (_error) {
      // Ignore malformed manager events at the trust boundary.
    }
  }

  _requireReady() {
    if (this._destroyed) {
      throw this._destroyedError();
    }
    if (!this.initialized || !this.transport) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_NOT_INITIALIZED",
        "Social collaboration sync is not initialized",
      );
    }
  }

  _destroyedError() {
    return new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_DESTROYED",
      "Social collaboration sync has been destroyed",
    );
  }

  async destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    const transport = this.transport;
    this.transport = null;
    await transport?.destroy();
    this.syncSessions.clear();
    this.p2pManager = null;
    this.yjsCollabManager = null;
    this.initialized = false;
    this.removeAllListeners();
    logger.info("[CollabSync] Destroyed");
  }
}

module.exports = {
  CollabSync,
  PROTOCOL_SOCIAL_COLLAB,
  MessageType,
};
