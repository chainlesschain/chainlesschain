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

const { logger, createLogger } = require('../utils/logger.js');
const Y = require('yjs');
const { encoding, decoding } = require('lib0');
const EventEmitter = require('events');

class YjsCollabManager extends EventEmitter {
  constructor(p2pManager, database) {
    super();
    this.p2pManager = p2pManager;
    this.database = database;

    // Map of document ID to Yjs document
    this.documents = new Map();

    // Map of document ID to awareness state
    this.awareness = new Map();

    // Map of document ID to connected peers
    this.documentPeers = new Map();

    // Protocol for Yjs sync
    this.PROTOCOL_YIJS_SYNC = '/chainlesschain/yjs-sync/1.0.0';
    this.PROTOCOL_YIJS_AWARENESS = '/chainlesschain/yjs-awareness/1.0.0';

    // Initialize protocol handlers
    this._initializeProtocolHandlers();
  }

  /**
   * Initialize P2P protocol handlers for Yjs sync
   */
  _initializeProtocolHandlers() {
    if (!this.p2pManager || !this.p2pManager.node) {
      logger.warn('[YjsCollab] P2P manager not ready, will initialize handlers later');
      return;
    }

    // Handle Yjs sync messages
    this.p2pManager.node.handle(this.PROTOCOL_YIJS_SYNC, async ({ stream, connection }) => {
      try {
        const peerId = connection.remotePeer.toString();
        logger.info(`[YjsCollab] Received sync connection from ${peerId}`);

        // Read document ID
        const docIdBuffer = await this._readFromStream(stream);
        const docId = new TextDecoder().decode(docIdBuffer);

        // Get or create Yjs document
        const ydoc = this.getDocument(docId);

        // Send initial sync state
        const stateVector = Y.encodeStateVector(ydoc);
        await this._writeToStream(stream, stateVector);

        // Receive and apply updates
        stream.on('data', (data) => {
          try {
            Y.applyUpdate(ydoc, data);
            this.emit('document-updated', { docId, peerId });
          } catch (error) {
            logger.error('[YjsCollab] Error applying update:', error);
          }
        });

        // Track peer for this document
        if (!this.documentPeers.has(docId)) {
          this.documentPeers.set(docId, new Set());
        }
        this.documentPeers.get(docId).add(peerId);

        // Clean up on disconnect
        stream.on('close', () => {
          const peers = this.documentPeers.get(docId);
          if (peers) {
            peers.delete(peerId);
          }
          logger.info(`[YjsCollab] Peer ${peerId} disconnected from document ${docId}`);
        });

      } catch (error) {
        logger.error('[YjsCollab] Error handling sync:', error);
      }
    });

    // Handle awareness (presence) messages
    this.p2pManager.node.handle(this.PROTOCOL_YIJS_AWARENESS, async ({ stream, connection }) => {
      try {
        const peerId = connection.remotePeer.toString();

        // Read awareness update
        const awarenessBuffer = await this._readFromStream(stream);
        const decoder = decoding.createDecoder(awarenessBuffer);
        const docId = decoding.readVarString(decoder);
        const awarenessUpdate = decoding.readVarUint8Array(decoder);

        // Apply awareness update
        const awareness = this.getAwareness(docId);
        this._applyAwarenessUpdate(awareness, awarenessUpdate, peerId);

        this.emit('awareness-updated', { docId, peerId });

      } catch (error) {
        logger.error('[YjsCollab] Error handling awareness:', error);
      }
    });
  }

  /**
   * Get or create a Yjs document for the given ID
   */
  getDocument(docId) {
    if (!this.documents.has(docId)) {
      const ydoc = new Y.Doc();

      // Listen for updates
      ydoc.on('update', (update, origin) => {
        // Don't broadcast updates that came from network
        if (origin !== 'network') {
          this._broadcastUpdate(docId, update);
          this._saveUpdate(docId, update);
        }
      });

      this.documents.set(docId, ydoc);

      // Load existing updates from database
      this._loadDocument(docId, ydoc);
    }

    return this.documents.get(docId);
  }

  /**
   * Get or create awareness state for a document
   */
  getAwareness(docId) {
    if (!this.awareness.has(docId)) {
      const ydoc = this.getDocument(docId);
      const awareness = {
        doc: ydoc,
        states: new Map(),
        meta: new Map()
      };

      this.awareness.set(docId, awareness);
    }

    return this.awareness.get(docId);
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
          color: this._generateUserColor()
        },
        cursor: null,
        selection: null
      };

      awareness.states.set('local', localState);

      // Broadcast awareness to peers
      await this._broadcastAwareness(docId, organizationId);

      // Connect to peers editing this document
      await this._connectToPeers(docId, organizationId);

      return {
        doc: ydoc,
        awareness,
        text: ydoc.getText('content'),
        metadata: ydoc.getMap('metadata')
      };

    } catch (error) {
      logger.error('[YjsCollab] Error opening document:', error);
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
        awareness.states.delete('local');
        await this._broadcastAwareness(docId);
      }

      // Disconnect from peers
      const peers = this.documentPeers.get(docId);
      if (peers) {
        peers.clear();
      }

      // Keep document in memory for a while in case user reopens
      // Will be garbage collected eventually

      logger.info(`[YjsCollab] Closed document ${docId}`);

    } catch (error) {
      logger.error('[YjsCollab] Error closing document:', error);
    }
  }

  /**
   * Update cursor position for local user
   */
  async updateCursor(docId, cursor, selection = null) {
    try {
      const awareness = this.getAwareness(docId);
      const localState = awareness.states.get('local');

      if (localState) {
        localState.cursor = cursor;
        localState.selection = selection;
        localState.lastUpdate = Date.now();

        await this._broadcastAwareness(docId);
      }

    } catch (error) {
      logger.error('[YjsCollab] Error updating cursor:', error);
    }
  }

  /**
   * Get all users currently editing a document
   */
  getActiveUsers(docId) {
    const awareness = this.awareness.get(docId);
    if (!awareness) {return [];}

    const users = [];
    for (const [clientId, state] of awareness.states.entries()) {
      if (state.user) {
        users.push({
          clientId,
          ...state.user,
          cursor: state.cursor,
          selection: state.selection,
          lastUpdate: state.lastUpdate
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
        Date.now()
      );

      return result.lastInsertRowid;

    } catch (error) {
      logger.error('[YjsCollab] Error creating snapshot:', error);
      throw error;
    }
  }

  /**
   * Restore document from a snapshot
   */
  async restoreSnapshot(docId, snapshotId) {
    try {
      const db = this.database.getDatabase();
      const snapshot = db.prepare(`
        SELECT snapshot_data, state_vector
        FROM knowledge_snapshots
        WHERE id = ?
      `).get(snapshotId);

      if (!snapshot) {
        throw new Error('Snapshot not found');
      }

      const ydoc = this.getDocument(docId);
      const decodedSnapshot = Y.decodeSnapshot(snapshot.snapshot_data);

      // Create new document from snapshot
      const restoredDoc = Y.createDocFromSnapshot(ydoc, decodedSnapshot);

      // Replace current document
      this.documents.set(docId, restoredDoc);

      // Broadcast update to all peers
      const update = Y.encodeStateAsUpdate(restoredDoc);
      await this._broadcastUpdate(docId, update);

      return restoredDoc;

    } catch (error) {
      logger.error('[YjsCollab] Error restoring snapshot:', error);
      throw error;
    }
  }

  /**
   * Get version history for a document
   */
  async getVersionHistory(docId, limit = 50) {
    try {
      const db = this.database.getDatabase();
      const snapshots = db.prepare(`
        SELECT id, metadata, created_at
        FROM knowledge_snapshots
        WHERE knowledge_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(docId, limit);

      return snapshots.map(s => ({
        id: s.id,
        metadata: JSON.parse(s.metadata),
        createdAt: s.created_at
      }));

    } catch (error) {
      logger.error('[YjsCollab] Error getting version history:', error);
      return [];
    }
  }

  /**
   * Broadcast document update to all connected peers
   */
  async _broadcastUpdate(docId, update) {
    try {
      const peers = this.documentPeers.get(docId);
      if (!peers || peers.size === 0) {return;}

      for (const peerId of peers) {
        try {
          const stream = await this.p2pManager.node.dialProtocol(
            peerId,
            this.PROTOCOL_YIJS_SYNC
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
      logger.error('[YjsCollab] Error broadcasting update:', error);
    }
  }

  /**
   * Broadcast awareness update to peers
   */
  async _broadcastAwareness(docId, organizationId = null) {
    try {
      const awareness = this.awareness.get(docId);
      if (!awareness) {return;}

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
            type: 'yjs-awareness',
            docId,
            data: Array.from(message)
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
                this.PROTOCOL_YIJS_AWARENESS
              );

              await this._writeToStream(stream, message);
              stream.close();

            } catch (error) {
              logger.error(`[YjsCollab] Error broadcasting awareness to ${peerId}:`, error);
            }
          }
        }
      }

    } catch (error) {
      logger.error('[YjsCollab] Error broadcasting awareness:', error);
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
            type: 'document-open',
            docId
          });
        }
      }

      // Will receive connections from other peers via protocol handlers

    } catch (error) {
      logger.error('[YjsCollab] Error connecting to peers:', error);
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

      stmt.run(docId, Buffer.from(update), Date.now());

    } catch (error) {
      logger.error('[YjsCollab] Error saving update:', error);
    }
  }

  /**
   * Load document from database
   */
  async _loadDocument(docId, ydoc) {
    try {
      const db = this.database.getDatabase();
      const updates = db.prepare(`
        SELECT update_data
        FROM knowledge_yjs_updates
        WHERE knowledge_id = ?
        ORDER BY created_at ASC
      `).all(docId);

      // Apply all updates
      for (const { update_data } of updates) {
        Y.applyUpdate(ydoc, update_data, 'network');
      }

      logger.info(`[YjsCollab] Loaded ${updates.length} updates for document ${docId}`);

    } catch (error) {
      logger.error('[YjsCollab] Error loading document:', error);
    }
  }

  /**
   * Helper: Read data from libp2p stream
   */
  async _readFromStream(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  /**
   * Helper: Write data to libp2p stream
   */
  async _writeToStream(stream, data) {
    return new Promise((resolve, reject) => {
      stream.write(data, (err) => {
        if (err) {reject(err);}
        else {resolve();}
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
  _applyAwarenessUpdate(awareness, update, peerId) {
    try {
      const decoder = decoding.createDecoder(update);
      const numStates = decoding.readVarUint(decoder);

      for (let i = 0; i < numStates; i++) {
        const clientId = decoding.readVarString(decoder);
        const stateJson = decoding.readVarString(decoder);
        const state = JSON.parse(stateJson);

        awareness.states.set(clientId, state);
        awareness.meta.set(clientId, {
          peerId,
          lastUpdate: Date.now()
        });
      }

    } catch (error) {
      logger.error('[YjsCollab] Error applying awareness update:', error);
    }
  }

  /**
   * Helper: Get current user's name
   */
  async _getUserName() {
    try {
      const db = this.database.getDatabase();
      const user = db.prepare('SELECT name FROM user_profile LIMIT 1').get();
      return user?.name || 'Anonymous';
    } catch (error) {
      return 'Anonymous';
    }
  }

  /**
   * Helper: Get current user's DID
   */
  async _getUserDID() {
    try {
      const db = this.database.getDatabase();
      const identity = db.prepare('SELECT did FROM did_identities WHERE is_default = 1 LIMIT 1').get();
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
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
      '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * Clean up resources
   */
  destroy() {
    // Close all documents
    for (const [docId] of this.documents) {
      this.closeDocument(docId);
    }

    this.documents.clear();
    this.awareness.clear();
    this.documentPeers.clear();

    this.removeAllListeners();
  }
}

module.exports = YjsCollabManager;
