/**
 * Yjs Collaboration Manager
 *
 * Manages real-time collaborative editing using Yjs CRDT.
 * Integrates with the existing P2P network for document synchronization.
 *
 * Features:
 * - Real-time document synchronization
 * - Conflict-free concurrent editing
 * - Cursor position tracking
 * - Presence awareness (who's editing)
 * - Offline support with automatic sync
 * - Version history integration
 */

const { logger } = require("../utils/logger.js");

/** Tolerant JSON column parse — a corrupt row must not abort a list-load loop. */
function safeParse(raw, fallback) {
  if (raw == null || raw === "") {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(`[YjsCollab] Bad JSON column, fallback: ${err.message}`);
    return fallback;
  }
}
const Y = require("yjs");
const { encoding, decoding } = require("lib0");
const EventEmitter = require("events");
const {
  CollabBoundaryError,
  createCollabBoundaries,
  assertDocumentId,
  normalizeUpdate,
  assertAwarenessState,
} = require("./collab-boundaries");

class YjsCollabManager extends EventEmitter {
  constructor(p2pManager, database, options = {}) {
    super();
    this.p2pManager = p2pManager;
    this.database = database;
    this.boundaries = createCollabBoundaries(options.boundaries);
    this._now = typeof options.now === "function" ? options.now : Date.now;

    // Map of document ID to Yjs document
    this.documents = new Map();

    // Map of document ID to awareness state
    this.awareness = new Map();

    // Map of document ID to connected peers
    this.documentPeers = new Map();

    // Current connection token per document/peer. A reconnect replaces the
    // token so late data/close events from the old stream cannot mutate or
    // release the new connection.
    this._peerConnections = new Map();

    // Last activity is tracked separately so inactive documents can be evicted
    // without walking or serializing the Y.Doc itself.
    this._documentActivity = new Map();

    // Protocol for Yjs sync
    this.PROTOCOL_YIJS_SYNC = "/chainlesschain/yjs-sync/1.0.0";
    this.PROTOCOL_YIJS_AWARENESS = "/chainlesschain/yjs-awareness/1.0.0";

    // Initialize protocol handlers
    this._initializeProtocolHandlers();
  }

  /**
   * Initialize P2P protocol handlers for Yjs sync
   */
  _initializeProtocolHandlers() {
    if (!this.p2pManager || !this.p2pManager.node) {
      logger.warn(
        "[YjsCollab] P2P manager not ready, will initialize handlers later",
      );
      return;
    }

    // Handle Yjs sync messages
    this.p2pManager.node.handle(
      this.PROTOCOL_YIJS_SYNC,
      async ({ stream, connection }) => {
        let docId = null;
        let peerId = null;
        let connectionToken = null;
        try {
          peerId = connection.remotePeer.toString();
          logger.info(`[YjsCollab] Received sync connection from ${peerId}`);

          // Read document ID
          const docIdBuffer = await this._readFromStream(stream);
          docId = new TextDecoder().decode(docIdBuffer);
          assertDocumentId(docId, this.boundaries);

          // Get or create Yjs document
          const ydoc = this.getDocument(docId);
          connectionToken = this._retainDocumentPeer(docId, peerId);

          // Send initial sync state
          const stateVector = Y.encodeStateVector(ydoc);
          await this._writeToStream(stream, stateVector);

          // Receive and apply updates
          stream.on("data", (data) => {
            try {
              this._applyPeerUpdate(docId, peerId, connectionToken, data);
            } catch (error) {
              logger.error("[YjsCollab] Error applying update:", error);
            }
          });

          // Clean up on disconnect
          stream.on("close", () => {
            if (this._releaseDocumentPeer(docId, peerId, connectionToken)) {
              logger.info(
                `[YjsCollab] Peer ${peerId} disconnected from document ${docId}`,
              );
            }
          });
        } catch (error) {
          if (connectionToken) {
            this._releaseDocumentPeer(docId, peerId, connectionToken);
          }
          try {
            stream.abort?.(error);
          } catch (_abortError) {
            // The collaboration boundary error remains authoritative.
          }
          logger.error("[YjsCollab] Error handling sync:", error);
        }
      },
    );

    // Handle awareness (presence) messages
    this.p2pManager.node.handle(
      this.PROTOCOL_YIJS_AWARENESS,
      async ({ stream, connection }) => {
        try {
          const peerId = connection.remotePeer.toString();

          // Read awareness update
          const awarenessBuffer = await this._readFromStream(stream);
          const decoder = decoding.createDecoder(awarenessBuffer);
          const docId = decoding.readVarString(decoder);
          assertDocumentId(docId, this.boundaries);
          const awarenessUpdate = decoding.readVarUint8Array(decoder);

          // Apply awareness update
          const awareness = this.getAwareness(docId);
          this._applyAwarenessUpdate(docId, awareness, awarenessUpdate, peerId);

          this.emit("awareness-updated", { docId, peerId });
        } catch (error) {
          logger.error("[YjsCollab] Error handling awareness:", error);
        }
      },
    );
  }

  /**
   * Get or create a Yjs document for the given ID
   */
  getDocument(docId) {
    assertDocumentId(docId, this.boundaries);
    this.sweepRetainedState();
    if (!this.documents.has(docId)) {
      this._ensureDocumentCapacity(docId);
      const ydoc = new Y.Doc();

      // Listen for updates (extracted so restoreSnapshot can re-attach it).
      this._attachUpdateListener(docId, ydoc);

      try {
        // Replay is synchronous because better-sqlite3 is synchronous. Returning
        // a mutable document before replay has finished creates a race where a
        // renderer observes stale state and local writes interleave with restore.
        this._loadDocument(docId, ydoc);
        this.documents.set(docId, ydoc);
      } catch (error) {
        ydoc.destroy?.();
        throw error;
      }
    }

    this._touchDocument(docId);
    return this.documents.get(docId);
  }

  _touchDocument(docId, now = this._now()) {
    if (this.documents.has(docId)) {
      this._documentActivity.set(docId, now);
    }
  }

  _isDocumentRetained(docId) {
    if ((this.documentPeers.get(docId)?.size || 0) > 0) {
      return true;
    }
    return this.awareness.get(docId)?.states?.has("local") === true;
  }

  _retainDocumentPeer(docId, peerId, token = Symbol("yjs-peer")) {
    assertDocumentId(docId, this.boundaries);
    if (typeof peerId !== "string" || peerId.length === 0) {
      throw new CollabBoundaryError(
        "ERR_COLLAB_PEER_INVALID",
        "peerId must be a non-empty string",
      );
    }
    const peerIdBytes = Buffer.byteLength(peerId, "utf8");
    if (peerIdBytes > this.boundaries.maxPeerIdBytes) {
      throw new CollabBoundaryError(
        "ERR_COLLAB_PEER_INVALID",
        `peerId exceeds ${this.boundaries.maxPeerIdBytes} bytes`,
        { peerIdBytes, limitBytes: this.boundaries.maxPeerIdBytes },
      );
    }

    if (!this.documentPeers.has(docId)) {
      this.documentPeers.set(docId, new Set());
    }
    const peers = this.documentPeers.get(docId);
    if (
      !peers.has(peerId) &&
      peers.size >= this.boundaries.maxPeersPerDocument
    ) {
      if (peers.size === 0) {
        this.documentPeers.delete(docId);
      }
      throw new CollabBoundaryError(
        "ERR_COLLAB_PEER_CAPACITY",
        `Document ${docId} already has ${this.boundaries.maxPeersPerDocument} peers`,
        { documentId: docId, limit: this.boundaries.maxPeersPerDocument },
      );
    }

    if (!this._peerConnections.has(docId)) {
      this._peerConnections.set(docId, new Map());
    }
    peers.add(peerId);
    this._peerConnections.get(docId).set(peerId, token);
    this._touchDocument(docId);
    return token;
  }

  _releaseDocumentPeer(docId, peerId, token) {
    const connections = this._peerConnections.get(docId);
    if (!connections || connections.get(peerId) !== token) {
      return false;
    }

    connections.delete(peerId);
    if (connections.size === 0) {
      this._peerConnections.delete(docId);
    }
    const peers = this.documentPeers.get(docId);
    peers?.delete(peerId);
    if (peers?.size === 0) {
      this.documentPeers.delete(docId);
    }
    this._touchDocument(docId);
    return true;
  }

  _applyPeerUpdate(docId, peerId, token, update) {
    if (this._peerConnections.get(docId)?.get(peerId) !== token) {
      return false;
    }
    this.applyUpdate(docId, update, "network");
    this.emit("document-updated", { docId, peerId });
    return true;
  }

  _evictDocument(docId, reason) {
    const ydoc = this.documents.get(docId);
    if (!ydoc) {
      return false;
    }
    ydoc.destroy?.();
    this.documents.delete(docId);
    this.awareness.delete(docId);
    this.documentPeers.delete(docId);
    this._peerConnections.delete(docId);
    this._documentActivity.delete(docId);
    this.emit("document-evicted", { docId, reason });
    return true;
  }

  _ensureDocumentCapacity(incomingDocId) {
    if (this.documents.size < this.boundaries.maxActiveDocuments) {
      return;
    }

    const evictable = [...this._documentActivity.entries()]
      .filter(([docId]) => !this._isDocumentRetained(docId))
      .sort((left, right) => left[1] - right[1]);
    if (evictable.length > 0) {
      this._evictDocument(evictable[0][0], "capacity");
      return;
    }

    throw new CollabBoundaryError(
      "ERR_COLLAB_DOCUMENT_CAPACITY",
      `Cannot retain more than ${this.boundaries.maxActiveDocuments} active Yjs documents`,
      {
        documentId: incomingDocId,
        activeDocuments: this.documents.size,
        limit: this.boundaries.maxActiveDocuments,
      },
    );
  }

  /**
   * Remove expired awareness entries and unreferenced idle documents. The
   * sweep is operation-driven, avoiding a process-lifetime interval handle.
   */
  sweepRetainedState(now = this._now()) {
    let awarenessStatesRemoved = 0;
    let documentsEvicted = 0;

    for (const [docId, awareness] of this.awareness) {
      for (const [clientId, meta] of awareness.meta) {
        if (
          clientId !== "local" &&
          now - Number(meta?.lastUpdate || 0) >=
            this.boundaries.awarenessStateTtlMs
        ) {
          awareness.meta.delete(clientId);
          awareness.states.delete(clientId);
          awarenessStatesRemoved += 1;
        }
      }
      if (awareness.states.size === 0 && !this.documents.has(docId)) {
        this.awareness.delete(docId);
      }
    }

    for (const [docId, lastActivity] of this._documentActivity) {
      if (
        !this._isDocumentRetained(docId) &&
        now - lastActivity >= this.boundaries.documentIdleTtlMs &&
        this._evictDocument(docId, "idle-ttl")
      ) {
        documentsEvicted += 1;
      }
    }

    return { awarenessStatesRemoved, documentsEvicted };
  }

  /** Apply a validated update through the manager-owned persistence path. */
  applyUpdate(docId, update, origin = "local") {
    const normalized = normalizeUpdate(update, this.boundaries);
    const ydoc = this.getDocument(docId);
    Y.applyUpdate(ydoc, normalized, origin);
    this._touchDocument(docId);
    return ydoc;
  }

  /**
   * Attach the local-update listener that broadcasts + persists edits. Must be
   * re-attached whenever the underlying Y.Doc is replaced (e.g. restoreSnapshot
   * swaps in a fresh doc), otherwise local edits to the new doc fire `update`
   * with no listener and are silently lost (not broadcast, not saved).
   */
  _attachUpdateListener(docId, ydoc) {
    ydoc.on("update", (update, origin) => {
      // Database replay is already durable and must not append duplicate rows.
      if (origin === "replay") {
        return;
      }

      // Don't broadcast updates that came from network, but do persist them:
      // otherwise a successful remote merge disappears after process restart.
      if (origin !== "network") {
        this._broadcastUpdate(docId, update);
      }
      this._saveUpdate(docId, update);
    });
  }

  /**
   * Get or create awareness state for a document
   */
  getAwareness(docId) {
    assertDocumentId(docId, this.boundaries);
    this.sweepRetainedState();
    if (!this.awareness.has(docId)) {
      const ydoc = this.getDocument(docId);
      const awareness = {
        doc: ydoc,
        states: new Map(),
        meta: new Map(),
      };

      this.awareness.set(docId, awareness);
    }

    this._touchDocument(docId);
    return this.awareness.get(docId);
  }

  /**
   * Store one validated awareness state without allowing renderer or peer
   * callers to bypass the per-document retained-state boundary.
   */
  setAwarenessState(docId, clientId, state, meta = {}) {
    assertAwarenessState(state, this.boundaries);
    const validNumericClientId =
      Number.isSafeInteger(clientId) && clientId >= 0;
    const validStringClientId =
      typeof clientId === "string" &&
      clientId.length > 0 &&
      Buffer.byteLength(clientId, "utf8") <= this.boundaries.maxPeerIdBytes;
    if (!validNumericClientId && !validStringClientId) {
      throw new CollabBoundaryError(
        "ERR_COLLAB_AWARENESS_INVALID",
        "Awareness clientId must be a bounded string or non-negative safe integer",
      );
    }
    if (
      meta.peerId !== undefined &&
      (typeof meta.peerId !== "string" ||
        Buffer.byteLength(meta.peerId, "utf8") > this.boundaries.maxPeerIdBytes)
    ) {
      throw new CollabBoundaryError(
        "ERR_COLLAB_PEER_INVALID",
        `Awareness peerId exceeds ${this.boundaries.maxPeerIdBytes} bytes`,
      );
    }
    const awareness = this.getAwareness(docId);
    if (
      !awareness.states.has(clientId) &&
      awareness.states.size >= this.boundaries.maxAwarenessStatesPerDocument
    ) {
      throw new CollabBoundaryError(
        "ERR_COLLAB_AWARENESS_CAPACITY",
        `Awareness state exceeds ${this.boundaries.maxAwarenessStatesPerDocument} clients`,
        {
          documentId: docId,
          limit: this.boundaries.maxAwarenessStatesPerDocument,
        },
      );
    }

    awareness.states.set(clientId, state);
    awareness.meta.set(clientId, {
      peerId: meta.peerId ?? null,
      lastUpdate: this._now(),
    });
    this._touchDocument(docId);
    return awareness;
  }

  /**
   * Open a document for collaborative editing
   */
  async openDocument(docId, organizationId = null) {
    try {
      const ydoc = this.getDocument(docId);
      const awareness = this.getAwareness(docId);

      // Set local user's awareness state
      const localState = {
        user: {
          name: await this._getUserName(),
          did: await this._getUserDID(),
          color: this._generateUserColor(),
        },
        cursor: null,
        selection: null,
      };

      this.setAwarenessState(docId, "local", localState, { peerId: "local" });

      // Broadcast awareness to peers
      await this._broadcastAwareness(docId, organizationId);

      // Connect to peers editing this document
      await this._connectToPeers(docId, organizationId);

      return {
        doc: ydoc,
        awareness,
        text: ydoc.getText("content"),
        metadata: ydoc.getMap("metadata"),
      };
    } catch (error) {
      logger.error("[YjsCollab] Error opening document:", error);
      throw error;
    }
  }

  /**
   * Close a document and clean up resources
   */
  async closeDocument(docId) {
    try {
      // Remove awareness state
      const awareness = this.awareness.get(docId);
      if (awareness) {
        awareness.states.delete("local");
        await this._broadcastAwareness(docId);
      }

      // Disconnect from peers
      const peers = this.documentPeers.get(docId);
      if (peers) {
        peers.clear();
        this.documentPeers.delete(docId);
      }
      this._peerConnections.delete(docId);

      // Keep document in memory for the bounded idle TTL in case it is reopened.
      this._touchDocument(docId);

      logger.info(`[YjsCollab] Closed document ${docId}`);
    } catch (error) {
      logger.error("[YjsCollab] Error closing document:", error);
    }
  }

  /**
   * Update cursor position for local user
   */
  async updateCursor(docId, cursor, selection = null) {
    try {
      const awareness = this.getAwareness(docId);
      const localState = awareness.states.get("local");

      if (localState) {
        localState.cursor = cursor;
        localState.selection = selection;
        localState.lastUpdate = Date.now();

        await this._broadcastAwareness(docId);
      }
    } catch (error) {
      logger.error("[YjsCollab] Error updating cursor:", error);
    }
  }

  /**
   * Get all users currently editing a document
   */
  getActiveUsers(docId) {
    this.sweepRetainedState();
    const awareness = this.awareness.get(docId);
    if (!awareness) {
      return [];
    }

    const users = [];
    for (const [clientId, state] of awareness.states.entries()) {
      if (state.user) {
        users.push({
          clientId,
          ...state.user,
          cursor: state.cursor,
          selection: state.selection,
          lastUpdate: state.lastUpdate,
        });
      }
    }

    return users;
  }

  /**
   * Create a snapshot of the current document state
   */
  async createSnapshot(docId, metadata = {}) {
    try {
      const ydoc = this.getDocument(docId);
      const snapshot = Y.snapshot(ydoc);
      const stateVector = Y.encodeStateVector(ydoc);

      // Save snapshot to database
      const db = this.database.getDatabase();
      const stmt = db.prepare(`
        INSERT INTO knowledge_snapshots (
          knowledge_id, snapshot_data, state_vector,
          metadata, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        docId,
        Buffer.from(Y.encodeSnapshot(snapshot)),
        Buffer.from(stateVector),
        JSON.stringify(metadata),
        Date.now(),
      );

      return result.lastInsertRowid;
    } catch (error) {
      logger.error("[YjsCollab] Error creating snapshot:", error);
      throw error;
    }
  }

  /**
   * Restore document from a snapshot
   */
  async restoreSnapshot(docId, snapshotId) {
    try {
      const db = this.database.getDatabase();
      const snapshot = db
        .prepare(
          `
        SELECT snapshot_data, state_vector
        FROM knowledge_snapshots
        WHERE id = ?
      `,
        )
        .get(snapshotId);

      if (!snapshot) {
        throw new Error("Snapshot not found");
      }

      const ydoc = this.getDocument(docId);
      const decodedSnapshot = Y.decodeSnapshot(snapshot.snapshot_data);

      // Create new document from snapshot
      const restoredDoc = Y.createDocFromSnapshot(ydoc, decodedSnapshot);

      // Replace current document
      this.documents.set(docId, restoredDoc);

      // Re-attach the update listener — the restored doc is brand new and would
      // otherwise drop (not broadcast/persist) every subsequent local edit.
      this._attachUpdateListener(docId, restoredDoc);
      const awareness = this.awareness.get(docId);
      if (awareness) {
        awareness.doc = restoredDoc;
      }
      ydoc.destroy?.();
      this._touchDocument(docId);

      // Broadcast update to all peers
      const update = Y.encodeStateAsUpdate(restoredDoc);
      await this._broadcastUpdate(docId, update);

      return restoredDoc;
    } catch (error) {
      logger.error("[YjsCollab] Error restoring snapshot:", error);
      throw error;
    }
  }

  /**
   * Get version history for a document
   */
  async getVersionHistory(docId, limit = 50) {
    assertDocumentId(docId, this.boundaries);
    if (
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      limit > this.boundaries.maxVersionHistoryEntries
    ) {
      throw new CollabBoundaryError(
        "ERR_COLLAB_HISTORY_LIMIT",
        `Version history limit must be between 1 and ${this.boundaries.maxVersionHistoryEntries}`,
        { limit, limitEntries: this.boundaries.maxVersionHistoryEntries },
      );
    }

    try {
      const db = this.database.getDatabase();
      const snapshots = db
        .prepare(
          `
        SELECT id, metadata, created_at
        FROM knowledge_snapshots
        WHERE knowledge_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
        )
        .all(docId, limit);

      return snapshots.map((s) => ({
        id: s.id,
        metadata: safeParse(s.metadata, {}),
        createdAt: s.created_at,
      }));
    } catch (error) {
      logger.error("[YjsCollab] Error getting version history:", error);
      if (error instanceof CollabBoundaryError) {
        throw error;
      }
      return [];
    }
  }

  /**
   * Broadcast document update to all connected peers
   */
  async _broadcastUpdate(docId, update) {
    try {
      const peers = this.documentPeers.get(docId);
      if (!peers || peers.size === 0) {
        return;
      }

      for (const peerId of peers) {
        try {
          const stream = await this.p2pManager.node.dialProtocol(
            peerId,
            this.PROTOCOL_YIJS_SYNC,
          );

          // Send document ID
          await this._writeToStream(stream, new TextEncoder().encode(docId));

          // Send update
          await this._writeToStream(stream, update);

          stream.close();
        } catch (error) {
          logger.error(`[YjsCollab] Error broadcasting to ${peerId}:`, error);
        }
      }
    } catch (error) {
      logger.error("[YjsCollab] Error broadcasting update:", error);
    }
  }

  /**
   * Broadcast awareness update to peers
   */
  async _broadcastAwareness(docId, organizationId = null) {
    try {
      const awareness = this.awareness.get(docId);
      if (!awareness) {
        return;
      }

      // Encode awareness state
      const encoder = encoding.createEncoder();
      encoding.writeVarString(encoder, docId);

      const awarenessUpdate = this._encodeAwarenessUpdate(awareness);
      encoding.writeVarUint8Array(encoder, awarenessUpdate);

      const message = encoding.toUint8Array(encoder);

      // Broadcast to organization or all peers
      if (organizationId && this.p2pManager.orgNetworks) {
        const orgNetwork = this.p2pManager.orgNetworks.get(organizationId);
        if (orgNetwork) {
          await orgNetwork.broadcast({
            type: "yjs-awareness",
            docId,
            data: Array.from(message),
          });
        }
      } else {
        // Broadcast to document peers
        const peers = this.documentPeers.get(docId);
        if (peers) {
          for (const peerId of peers) {
            try {
              const stream = await this.p2pManager.node.dialProtocol(
                peerId,
                this.PROTOCOL_YIJS_AWARENESS,
              );

              await this._writeToStream(stream, message);
              stream.close();
            } catch (error) {
              logger.error(
                `[YjsCollab] Error broadcasting awareness to ${peerId}:`,
                error,
              );
            }
          }
        }
      }
    } catch (error) {
      logger.error("[YjsCollab] Error broadcasting awareness:", error);
    }
  }

  /**
   * Connect to peers editing the same document
   */
  async _connectToPeers(docId, organizationId = null) {
    try {
      if (organizationId && this.p2pManager.orgNetworks) {
        // Use organization network
        const orgNetwork = this.p2pManager.orgNetworks.get(organizationId);
        if (orgNetwork) {
          // Announce document editing
          await orgNetwork.broadcast({
            type: "document-open",
            docId,
          });
        }
      }

      // Will receive connections from other peers via protocol handlers
    } catch (error) {
      logger.error("[YjsCollab] Error connecting to peers:", error);
    }
  }

  /**
   * Save document update to database
   */
  async _saveUpdate(docId, update) {
    try {
      const db = this.database.getDatabase();
      const stmt = db.prepare(`
        INSERT INTO knowledge_yjs_updates (
          knowledge_id, update_data, created_at
        ) VALUES (?, ?, ?)
      `);

      stmt.run(docId, Buffer.from(update), this._now());
    } catch (error) {
      logger.error("[YjsCollab] Error saving update:", error);
    }
  }

  /**
   * Load document from database
   */
  _loadDocument(docId, ydoc) {
    try {
      const db = this.database.getDatabase();
      const replayStats = db
        .prepare(
          `
        SELECT COUNT(*) AS update_count,
               COALESCE(SUM(LENGTH(update_data)), 0) AS total_bytes
        FROM knowledge_yjs_updates
        WHERE knowledge_id = ?
      `,
        )
        .get(docId) || { update_count: 0, total_bytes: 0 };
      const updateCount = Number(replayStats.update_count || 0);
      const replayBytes = Number(replayStats.total_bytes || 0);
      if (
        updateCount > this.boundaries.maxReplayUpdates ||
        replayBytes > this.boundaries.maxReplayBytes
      ) {
        throw new CollabBoundaryError(
          "ERR_COLLAB_REPLAY_LIMIT",
          `Stored Yjs replay for ${docId} exceeds the configured boundary`,
          {
            documentId: docId,
            updateCount,
            replayBytes,
            limitUpdates: this.boundaries.maxReplayUpdates,
            limitBytes: this.boundaries.maxReplayBytes,
          },
        );
      }

      const updates = db
        .prepare(
          `
        SELECT update_data
        FROM knowledge_yjs_updates
        WHERE knowledge_id = ?
        ORDER BY created_at ASC
        LIMIT ?
      `,
        )
        .all(docId, this.boundaries.maxReplayUpdates + 1);
      if (updates.length > this.boundaries.maxReplayUpdates) {
        throw new CollabBoundaryError(
          "ERR_COLLAB_REPLAY_LIMIT",
          `Stored Yjs replay for ${docId} exceeds ${this.boundaries.maxReplayUpdates} updates`,
          {
            documentId: docId,
            updateCount: updates.length,
            limitUpdates: this.boundaries.maxReplayUpdates,
          },
        );
      }

      // Apply all updates. Guard each one (like the snapshot path above): a
      // single corrupt/truncated update_data row must NOT throw out of the loop
      // and silently drop every LATER update — that would truncate the document
      // to a stale state. Skip the bad update and keep applying the rest.
      let applied = 0;
      let skipped = 0;
      let appliedBytes = 0;
      for (const { update_data } of updates) {
        const byteLength = Buffer.byteLength(update_data || Buffer.alloc(0));
        appliedBytes += byteLength;
        if (appliedBytes > this.boundaries.maxReplayBytes) {
          throw new CollabBoundaryError(
            "ERR_COLLAB_REPLAY_LIMIT",
            `Stored Yjs replay for ${docId} exceeds ${this.boundaries.maxReplayBytes} bytes`,
            {
              documentId: docId,
              replayBytes: appliedBytes,
              limitBytes: this.boundaries.maxReplayBytes,
            },
          );
        }
        try {
          Y.applyUpdate(ydoc, update_data, "replay");
          applied++;
        } catch (error) {
          skipped++;
          logger.warn(
            `[YjsCollab] Skipped a corrupt update for document ${docId}: ${error.message}`,
          );
        }
      }

      logger.info(
        `[YjsCollab] Loaded ${applied}/${updates.length} updates for document ${docId}` +
          (skipped ? ` (${skipped} corrupt skipped)` : ""),
      );
      return { applied, skipped, replayBytes: appliedBytes };
    } catch (error) {
      logger.error("[YjsCollab] Error loading document:", error);
      if (error instanceof CollabBoundaryError) {
        throw error;
      }
      throw new CollabBoundaryError(
        "ERR_COLLAB_REPLAY_FAILED",
        `Unable to replay stored Yjs updates for ${docId}`,
        { documentId: docId, causeCode: error?.code || null },
      );
    }
  }

  /**
   * Helper: Read data from libp2p stream
   */
  async _readFromStream(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let totalBytes = 0;
      let chunkCount = 0;
      let settled = false;

      const removeListener = (event, listener) => {
        if (typeof stream.off === "function") {
          stream.off(event, listener);
        } else if (typeof stream.removeListener === "function") {
          stream.removeListener(event, listener);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        removeListener("data", onData);
        removeListener("end", onEnd);
        removeListener("error", onError);
      };
      const fail = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (typeof stream.abort === "function") {
          try {
            const pendingAbort = stream.abort(error);
            pendingAbort?.catch?.(() => {});
          } catch (_abortError) {
            // The boundary error remains the authoritative failure.
          }
        }
        reject(error);
      };
      const onData = (chunk) => {
        if (settled) {
          return;
        }

        let normalized;
        try {
          normalized = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        } catch (_error) {
          fail(
            new CollabBoundaryError(
              "ERR_COLLAB_STREAM_CHUNK_INVALID",
              "Yjs stream emitted a non-binary chunk",
            ),
          );
          return;
        }

        chunkCount += 1;
        totalBytes += normalized.byteLength;
        if (chunkCount > this.boundaries.maxStreamChunks) {
          fail(
            new CollabBoundaryError(
              "ERR_COLLAB_STREAM_CHUNKS_EXCEEDED",
              `Yjs stream exceeded ${this.boundaries.maxStreamChunks} chunks`,
              {
                chunkCount,
                limitChunks: this.boundaries.maxStreamChunks,
              },
            ),
          );
          return;
        }
        if (totalBytes > this.boundaries.maxStreamBytes) {
          fail(
            new CollabBoundaryError(
              "ERR_COLLAB_STREAM_BYTES_EXCEEDED",
              `Yjs stream exceeded ${this.boundaries.maxStreamBytes} bytes`,
              { totalBytes, limitBytes: this.boundaries.maxStreamBytes },
            ),
          );
          return;
        }

        chunks.push(normalized);
      };
      const onEnd = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(Buffer.concat(chunks, totalBytes));
      };
      const onError = (error) => fail(error);
      const timer = setTimeout(() => {
        fail(
          new CollabBoundaryError(
            "ERR_COLLAB_STREAM_TIMEOUT",
            `Yjs stream did not finish within ${this.boundaries.streamReadTimeoutMs} ms`,
            { timeoutMs: this.boundaries.streamReadTimeoutMs },
          ),
        );
      }, this.boundaries.streamReadTimeoutMs);
      timer.unref?.();

      stream.on("data", onData);
      stream.on("end", onEnd);
      stream.on("error", onError);
    });
  }

  /**
   * Helper: Write data to libp2p stream
   */
  async _writeToStream(stream, data) {
    return new Promise((resolve, reject) => {
      stream.write(data, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Helper: Encode awareness update
   */
  _encodeAwarenessUpdate(awareness) {
    const encoder = encoding.createEncoder();
    const states = Array.from(awareness.states.entries());

    encoding.writeVarUint(encoder, states.length);
    for (const [clientId, state] of states) {
      encoding.writeVarString(encoder, clientId);
      encoding.writeVarString(encoder, JSON.stringify(state));
    }

    return encoding.toUint8Array(encoder);
  }

  /**
   * Helper: Apply awareness update
   */
  _applyAwarenessUpdate(docId, awareness, update, peerId) {
    try {
      this.sweepRetainedState();
      const decoder = decoding.createDecoder(update);
      const numStates = decoding.readVarUint(decoder);

      for (let i = 0; i < numStates; i++) {
        const clientId = decoding.readVarString(decoder);
        const stateJson = decoding.readVarString(decoder);
        const state = JSON.parse(stateJson);

        if (
          !awareness.states.has(clientId) &&
          awareness.states.size >= this.boundaries.maxAwarenessStatesPerDocument
        ) {
          throw new CollabBoundaryError(
            "ERR_COLLAB_AWARENESS_CAPACITY",
            `Awareness state exceeds ${this.boundaries.maxAwarenessStatesPerDocument} clients`,
            { limit: this.boundaries.maxAwarenessStatesPerDocument },
          );
        }

        this.setAwarenessState(docId, clientId, state, { peerId });
      }
    } catch (error) {
      logger.error("[YjsCollab] Error applying awareness update:", error);
      if (error instanceof CollabBoundaryError) {
        throw error;
      }
    }
  }

  /**
   * Helper: Get current user's name
   */
  async _getUserName() {
    try {
      const db = this.database.getDatabase();
      const user = db.prepare("SELECT name FROM user_profile LIMIT 1").get();
      return user?.name || "Anonymous";
    } catch (error) {
      return "Anonymous";
    }
  }

  /**
   * Helper: Get current user's DID
   */
  async _getUserDID() {
    try {
      const db = this.database.getDatabase();
      const identity = db
        .prepare("SELECT did FROM did_identities WHERE is_default = 1 LIMIT 1")
        .get();
      return identity?.did || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Helper: Generate random color for user cursor
   */
  _generateUserColor() {
    const colors = [
      "#FF6B6B",
      "#4ECDC4",
      "#45B7D1",
      "#FFA07A",
      "#98D8C8",
      "#F7DC6F",
      "#BB8FCE",
      "#85C1E2",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * Clean up resources
   */
  destroy() {
    for (const ydoc of this.documents.values()) {
      ydoc.destroy?.();
    }

    this.documents.clear();
    this.awareness.clear();
    this.documentPeers.clear();
    this._peerConnections.clear();
    this._documentActivity.clear();

    this.removeAllListeners();
  }
}

module.exports = YjsCollabManager;
