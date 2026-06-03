'use strict';

/**
 * IPFS Manager - Decentralized Storage
 *
 * Core IPFS manager with dual mode support:
 * - Embedded mode: Helia node running in-process
 * - External mode: Connects to external Kubo daemon via HTTP API
 *
 * Provides content-addressed storage with optional AES-256-GCM encryption,
 * pinning management, storage quotas, and knowledge base integration.
 *
 * @module ipfs/ipfs-manager
 * @version 1.0.0
 */

const { EventEmitter } = require('events');
const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Lazy-load electron app to support test environments
let app;
try {
  app = require('electron').app;
} catch (_e) {
  app = global.app || {
    getPath: () => require('os').tmpdir(),
  };
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_STORAGE_QUOTA_BYTES = 1073741824; // 1GB
const DEFAULT_GATEWAY_URL = 'https://ipfs.io';
const DEFAULT_EXTERNAL_API_URL = 'http://127.0.0.1:5001';

// ============================================================
// IPFSManager
// ============================================================

class IPFSManager extends EventEmitter {
  constructor() {
    super();
    this.node = null;
    this.unixfs = null;
    this.jsonCodec = null;
    this.database = null;
    this.initialized = false;
    this.mode = 'embedded';
    this.config = {
      repoPath: '',
      gatewayUrl: DEFAULT_GATEWAY_URL,
      storageQuotaBytes: DEFAULT_STORAGE_QUOTA_BYTES,
      externalApiUrl: DEFAULT_EXTERNAL_API_URL,
      encryptionEnabled: false,
    };
    this.stats = {
      totalPinned: 0,
      totalSize: 0,
      peerCount: 0,
    };
  }

  /**
   * Initialize the IPFS manager with dependencies
   * @param {Object} dependencies - { database, config }
   */
  async initialize(dependencies) {
    if (this.initialized) {
      logger.info('[IPFS] Manager already initialized');
      return;
    }

    this.database = dependencies.database;

    if (dependencies.config) {
      Object.assign(this.config, dependencies.config);
    }

    // Set repo path
    const userDataPath = app?.getPath?.('userData') || '.';
    this.config.repoPath = path.join(userDataPath, '.chainlesschain', 'ipfs-repo');

    // Ensure directory exists
    fs.mkdirSync(this.config.repoPath, { recursive: true });

    // Ensure database tables exist
    this._ensureTables();

    this.initialized = true;
    logger.info('[IPFS] Manager initialized', {
      mode: this.mode,
      repoPath: this.config.repoPath,
    });
  }

  /**
   * Create required database tables
   */
  _ensureTables() {
    if (!this.database) {
      logger.warn('[IPFS] No database available, skipping table creation');
      return;
    }

    try {
      this.database.run(`
        CREATE TABLE IF NOT EXISTS ipfs_content (
          id TEXT PRIMARY KEY,
          cid TEXT NOT NULL UNIQUE,
          filename TEXT,
          size INTEGER DEFAULT 0,
          mime_type TEXT,
          pinned INTEGER DEFAULT 1,
          encrypted INTEGER DEFAULT 0,
          encryption_key TEXT,
          knowledge_id TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      this.database.run(`
        CREATE INDEX IF NOT EXISTS idx_ipfs_content_cid ON ipfs_content(cid)
      `);

      this.database.run(`
        CREATE INDEX IF NOT EXISTS idx_ipfs_content_knowledge ON ipfs_content(knowledge_id)
      `);

      this.database.run(`
        CREATE INDEX IF NOT EXISTS idx_ipfs_content_pinned ON ipfs_content(pinned)
      `);

      logger.info('[IPFS] Database tables ensured');
    } catch (error) {
      logger.error('[IPFS] Failed to create tables', { error: error.message });
    }
  }

  /**
   * Ensure the IPFS node is running before performing operations
   * @throws {Error} If node is not started
   */
  _ensureNode() {
    if (!this.node && this.mode === 'embedded') {
      throw new Error('IPFS node is not started. Call startNode() first.');
    }
  }

  /**
   * Ensure manager is initialized
   * @throws {Error} If not initialized
   */
  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error('IPFS Manager is not initialized. Call initialize() first.');
    }
  }

  /**
   * Start the IPFS node (embedded Helia or connect to external Kubo)
   */
  async startNode() {
    this._ensureInitialized();

    if (this.mode === 'embedded') {
      try {
        logger.info('[IPFS] Starting embedded Helia node...');

        // Dynamic ESM imports for Helia packages
        const { createHelia } = await import('helia');
        const { FsBlockstore } = await import('blockstore-fs');
        const { LevelDatastore } = await import('datastore-level');
        const { unixfs } = await import('@helia/unixfs');
        const { json } = await import('@helia/json');

        const blocksPath = path.join(this.config.repoPath, 'blocks');
        const dataPath = path.join(this.config.repoPath, 'data');

        fs.mkdirSync(blocksPath, { recursive: true });
        fs.mkdirSync(dataPath, { recursive: true });

        const blockstore = new FsBlockstore(blocksPath);
        const datastore = new LevelDatastore(dataPath);

        this.node = await createHelia({ blockstore, datastore });
        this.unixfs = unixfs(this.node);
        this.jsonCodec = json(this.node);

        const peerId = this.node.libp2p.peerId.toString();
        logger.info('[IPFS] Embedded Helia node started', { peerId });
        this.emit('node-started', { mode: 'embedded', peerId });
      } catch (error) {
        logger.error('[IPFS] Failed to start embedded node', { error: error.message });
        throw error;
      }
    } else {
      // External Kubo RPC mode
      logger.info('[IPFS] Using external Kubo node', {
        apiUrl: this.config.externalApiUrl,
      });
      this.emit('node-started', {
        mode: 'external',
        apiUrl: this.config.externalApiUrl,
      });
    }

    await this._updateStats();
  }

  /**
   * Stop the IPFS node
   */
  async stopNode() {
    if (this.node) {
      try {
        await this.node.stop();
        logger.info('[IPFS] Node stopped');
      } catch (error) {
        logger.error('[IPFS] Error stopping node', { error: error.message });
      }
      this.node = null;
      this.unixfs = null;
      this.jsonCodec = null;
      this.emit('node-stopped');
    }
  }

  /**
   * Add content to IPFS
   * @param {string|Buffer} content - Content to add
   * @param {Object} options - { encrypt, metadata, filename }
   * @returns {{ cid: string, size: number, encrypted: boolean, id: string }}
   */
  async addContent(content, options = {}) {
    this._ensureInitialized();
    this._ensureNode();

    const { encrypt = this.config.encryptionEnabled, metadata = {}, filename } = options;

    let data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
    const originalSize = data.length;

    // Check storage quota
    const currentUsage = this.stats.totalSize || 0;
    if (currentUsage + originalSize > this.config.storageQuotaBytes) {
      throw new Error(
        `Storage quota exceeded. Usage: ${currentUsage} bytes, Quota: ${this.config.storageQuotaBytes} bytes, Attempted: ${originalSize} bytes`
      );
    }

    let encryptionKey = null;
    let encrypted = false;

    // Optionally encrypt with AES-256-GCM
    if (encrypt) {
      const encResult = this._encrypt(data);
      data = encResult.encrypted;
      encryptionKey = encResult.key;
      encrypted = true;
      logger.info('[IPFS] Content encrypted before adding');
    }

    // Add via unixfs
    const cid = await this.unixfs.addBytes(new Uint8Array(data));
    const cidString = cid.toString();

    // Pin the content
    try {
      if (this.node.pins) {
        await this.node.pins.add(cid);
      }
    } catch (pinError) {
      logger.warn('[IPFS] Pinning not available, content added without pin', {
        error: pinError.message,
      });
    }

    // Record in database
    const id = uuidv4();
    if (this.database) {
      try {
        this.database.run(
          `INSERT INTO ipfs_content (id, cid, filename, size, pinned, encrypted, encryption_key, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, datetime('now'), datetime('now'))`,
          [
            id,
            cidString,
            filename || null,
            originalSize,
            encrypted ? 1 : 0,
            encryptionKey,
            JSON.stringify(metadata),
          ]
        );
      } catch (dbError) {
        logger.error('[IPFS] Failed to record content in database', {
          error: dbError.message,
        });
      }
    }

    await this._updateStats();

    logger.info('[IPFS] Content added', {
      cid: cidString,
      size: originalSize,
      encrypted,
      filename,
    });

    return {
      id,
      cid: cidString,
      size: originalSize,
      encrypted,
    };
  }

  /**
   * Add a file to IPFS
   * @param {string} filePath - Path to the file
   * @param {Object} options - { encrypt, metadata }
   * @returns {{ cid: string, size: number, encrypted: boolean, id: string }}
   */
  async addFile(filePath, options = {}) {
    this._ensureInitialized();

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const filename = options.filename || path.basename(filePath);

    return this.addContent(fileBuffer, {
      ...options,
      filename,
    });
  }

  /**
   * Get content from IPFS by CID
   * @param {string} cidString - The CID string
   * @param {Object} options - { decrypt }
   * @returns {{ content: Buffer, metadata: Object }}
   */
  async getContent(cidString, options = {}) {
    this._ensureInitialized();
    this._ensureNode();

    const { CID } = await import('multiformats/cid');
    const cid = CID.parse(cidString);

    // Collect all bytes from the async iterable
    const chunks = [];
    for await (const chunk of this.unixfs.cat(cid)) {
      chunks.push(chunk);
    }
    let data = Buffer.concat(chunks.map((c) => Buffer.from(c)));

    // Check database for encryption info and metadata
    let metadata = {};
    let encryptionKey = null;
    let isEncrypted = false;

    if (this.database) {
      try {
        const row = this.database.get(
          'SELECT encryption_key, encrypted, metadata FROM ipfs_content WHERE cid = ?',
          [cidString]
        );
        if (row) {
          isEncrypted = row.encrypted === 1;
          encryptionKey = row.encryption_key;
          try {
            metadata = row.metadata ? JSON.parse(row.metadata) : {};
          } catch (_e) {
            metadata = {};
          }
        }
      } catch (dbError) {
        logger.warn('[IPFS] Could not fetch content metadata from database', {
          error: dbError.message,
        });
      }
    }

    // Decrypt if needed
    if (isEncrypted && encryptionKey) {
      try {
        data = this._decrypt(data, encryptionKey);
        logger.info('[IPFS] Content decrypted successfully');
      } catch (decryptError) {
        throw new Error(`Failed to decrypt content: ${decryptError.message}`);
      }
    }

    logger.info('[IPFS] Content retrieved', { cid: cidString, size: data.length });

    return { content: data, metadata };
  }

  /**
   * Get content from IPFS and write to file
   * @param {string} cidString - The CID string
   * @param {string} outputPath - Path to write the file
   * @returns {{ path: string, size: number }}
   */
  async getFile(cidString, outputPath) {
    this._ensureInitialized();

    const { content } = await this.getContent(cidString);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(outputPath, content);

    logger.info('[IPFS] File written', { cid: cidString, outputPath, size: content.length });

    return { path: outputPath, size: content.length };
  }

  /**
   * Pin a CID in the IPFS node
   * @param {string} cidString - The CID string to pin
   * @returns {{ pinned: true, cid: string }}
   */
  async pin(cidString) {
    this._ensureInitialized();
    this._ensureNode();

    const { CID } = await import('multiformats/cid');
    const cid = CID.parse(cidString);

    try {
      if (this.node.pins) {
        await this.node.pins.add(cid);
      }
    } catch (pinError) {
      logger.warn('[IPFS] Pin API not available', { error: pinError.message });
    }

    // Update DB record
    if (this.database) {
      try {
        this.database.run(
          "UPDATE ipfs_content SET pinned = 1, updated_at = datetime('now') WHERE cid = ?",
          [cidString]
        );
      } catch (dbError) {
        logger.error('[IPFS] Failed to update pin status in database', {
          error: dbError.message,
        });
      }
    }

    await this._updateStats();

    logger.info('[IPFS] Content pinned', { cid: cidString });

    return { pinned: true, cid: cidString };
  }

  /**
   * Unpin a CID in the IPFS node
   * @param {string} cidString - The CID string to unpin
   * @returns {{ unpinned: true, cid: string }}
   */
  async unpin(cidString) {
    this._ensureInitialized();
    this._ensureNode();

    const { CID } = await import('multiformats/cid');
    const cid = CID.parse(cidString);

    try {
      if (this.node.pins) {
        await this.node.pins.rm(cid);
      }
    } catch (pinError) {
      logger.warn('[IPFS] Unpin API not available', { error: pinError.message });
    }

    // Update DB record
    if (this.database) {
      try {
        this.database.run(
          "UPDATE ipfs_content SET pinned = 0, updated_at = datetime('now') WHERE cid = ?",
          [cidString]
        );
      } catch (dbError) {
        logger.error('[IPFS] Failed to update unpin status in database', {
          error: dbError.message,
        });
      }
    }

    await this._updateStats();

    logger.info('[IPFS] Content unpinned', { cid: cidString });

    return { unpinned: true, cid: cidString };
  }

  /**
   * List pinned content from the database
   * @param {Object} options - { offset, limit, sortBy }
   * @returns {{ items: Array, total: number }}
   */
  async listPins(options = {}) {
    this._ensureInitialized();

    const { offset = 0, limit = 50, sortBy = 'created_at' } = options;

    // Validate sortBy to prevent SQL injection
    const allowedSortColumns = ['created_at', 'size', 'filename', 'cid', 'updated_at'];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';

    if (!this.database) {
      return { items: [], total: 0 };
    }

    try {
      const totalRow = this.database.get(
        'SELECT COUNT(*) as count FROM ipfs_content WHERE pinned = 1'
      );
      const total = totalRow?.count || 0;

      const rows = this.database.all(
        `SELECT id, cid, filename, size, pinned, encrypted, knowledge_id, metadata, created_at, updated_at
         FROM ipfs_content
         WHERE pinned = 1
         ORDER BY ${safeSortBy} DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );

      const items = (rows || []).map((row) => ({
        ...row,
        pinned: row.pinned === 1,
        encrypted: row.encrypted === 1,
        metadata: row.metadata ? (() => { try { return JSON.parse(row.metadata); } catch { return {}; } })() : {},
      }));

      return { items, total };
    } catch (error) {
      logger.error('[IPFS] Failed to list pins', { error: error.message });
      return { items: [], total: 0 };
    }
  }

  /**
   * Get storage statistics
   * @returns {Object} Storage stats including quota info
   */
  async getStorageStats() {
    this._ensureInitialized();
    await this._updateStats();

    return {
      totalPinned: this.stats.totalPinned,
      totalSize: this.stats.totalSize,
      peerCount: this.stats.peerCount,
      quotaBytes: this.config.storageQuotaBytes,
      usagePercent:
        this.config.storageQuotaBytes > 0
          ? (this.stats.totalSize / this.config.storageQuotaBytes) * 100
          : 0,
      mode: this.mode,
      nodeRunning: !!this.node,
      peerId: this.node?.libp2p?.peerId?.toString() || null,
    };
  }

  /**
   * Run garbage collection on the IPFS node
   * @returns {{ freedBytes: number, removedItems: number }}
   */
  async garbageCollect() {
    this._ensureInitialized();

    let freedBytes = 0;
    let removedItems = 0;

    // Run GC on Helia node if available
    if (this.node && typeof this.node.gc === 'function') {
      try {
        await this.node.gc();
        logger.info('[IPFS] Helia garbage collection completed');
      } catch (gcError) {
        logger.warn('[IPFS] Helia GC not available or failed', {
          error: gcError.message,
        });
      }
    }

    // Clean up unpinned content from DB
    if (this.database) {
      try {
        const unpinnedRows = this.database.all(
          'SELECT id, cid, size FROM ipfs_content WHERE pinned = 0'
        );

        if (unpinnedRows && unpinnedRows.length > 0) {
          for (const row of unpinnedRows) {
            freedBytes += row.size || 0;
            removedItems++;
          }

          this.database.run('DELETE FROM ipfs_content WHERE pinned = 0');
          logger.info('[IPFS] Removed unpinned content from database', {
            removedItems,
            freedBytes,
          });
        }
      } catch (dbError) {
        logger.error('[IPFS] Failed to clean up database during GC', {
          error: dbError.message,
        });
      }
    }

    await this._updateStats();

    logger.info('[IPFS] Garbage collection complete', { freedBytes, removedItems });

    return { freedBytes, removedItems };
  }

  /**
   * Set the storage quota
   * @param {number} quotaBytes - New quota in bytes
   */
  async setQuota(quotaBytes) {
    if (typeof quotaBytes !== 'number' || quotaBytes <= 0) {
      throw new Error('Quota must be a positive number');
    }

    this.config.storageQuotaBytes = quotaBytes;
    logger.info('[IPFS] Storage quota updated', { quotaBytes });
  }

  /**
   * Add content to IPFS and link it to a knowledge base item
   * @param {string} knowledgeId - Knowledge item ID
   * @param {string|Buffer} content - Content to store
   * @param {Object} metadata - Additional metadata
   * @returns {{ cid: string, size: number, encrypted: boolean, id: string }}
   */
  async addKnowledgeAttachment(knowledgeId, content, metadata = {}) {
    this._ensureInitialized();

    if (!knowledgeId) {
      throw new Error('knowledgeId is required');
    }

    const result = await this.addContent(content, {
      metadata: { ...metadata, knowledgeId },
      filename: metadata.filename || null,
      encrypt: metadata.encrypt || this.config.encryptionEnabled,
    });

    // Update the knowledge_id reference in the database
    if (this.database) {
      try {
        this.database.run(
          "UPDATE ipfs_content SET knowledge_id = ?, updated_at = datetime('now') WHERE id = ?",
          [knowledgeId, result.id]
        );
      } catch (dbError) {
        logger.error('[IPFS] Failed to link content to knowledge item', {
          error: dbError.message,
        });
      }
    }

    logger.info('[IPFS] Knowledge attachment added', {
      knowledgeId,
      cid: result.cid,
      size: result.size,
    });

    return result;
  }

  /**
   * Retrieve IPFS content linked to a knowledge item
   * @param {string} knowledgeId - Knowledge item ID
   * @param {string} cidString - The CID string
   * @returns {{ content: Buffer, metadata: Object }}
   */
  async getKnowledgeAttachment(knowledgeId, cidString) {
    this._ensureInitialized();

    if (!knowledgeId || !cidString) {
      throw new Error('Both knowledgeId and cid are required');
    }

    // Verify the CID is linked to the given knowledge item
    if (this.database) {
      const row = this.database.get(
        'SELECT id FROM ipfs_content WHERE cid = ? AND knowledge_id = ?',
        [cidString, knowledgeId]
      );
      if (!row) {
        throw new Error(
          `Content with CID ${cidString} is not linked to knowledge item ${knowledgeId}`
        );
      }
    }

    const result = await this.getContent(cidString);

    logger.info('[IPFS] Knowledge attachment retrieved', {
      knowledgeId,
      cid: cidString,
      size: result.content.length,
    });

    return result;
  }

  /**
   * Encrypt data using AES-256-GCM
   * @param {Buffer} data - Data to encrypt
   * @returns {{ encrypted: Buffer, key: string }}
   */
  _encrypt(data) {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      encrypted: Buffer.concat([iv, tag, encrypted]),
      key: key.toString('hex'),
    };
  }

  /**
   * Decrypt data using AES-256-GCM
   * @param {Buffer} data - Data to decrypt (iv + tag + ciphertext)
   * @param {string} keyHex - Hex-encoded encryption key
   * @returns {Buffer} Decrypted data
   */
  _decrypt(data, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const iv = data.subarray(0, 16);
    const tag = data.subarray(16, 32);
    const encrypted = data.subarray(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  /**
   * Update internal stats from database and node
   */
  async _updateStats() {
    if (this.database) {
      try {
        const row = this.database.get(
          'SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM ipfs_content WHERE pinned = 1'
        );
        this.stats.totalPinned = row?.count || 0;
        this.stats.totalSize = row?.totalSize || 0;
      } catch (_e) {
        /* ignore */
      }
    }

    if (this.node) {
      try {
        const peers = this.node.libp2p.getPeers();
        this.stats.peerCount = peers.length;
      } catch (_e) {
        this.stats.peerCount = 0;
      }
    }
  }

  /**
   * Get the current node status
   * @returns {Object} Node status info
   */
  getNodeStatus() {
    return {
      running: !!this.node,
      mode: this.mode,
      peerId: this.node?.libp2p?.peerId?.toString() || null,
      peerCount: this.stats.peerCount,
    };
  }

  /**
   * Set the operating mode (embedded or external)
   * @param {string} mode - 'embedded' or 'external'
   */
  async setMode(mode) {
    if (mode !== 'embedded' && mode !== 'external') {
      throw new Error("Invalid mode. Must be 'embedded' or 'external'.");
    }

    if (this.node) {
      await this.stopNode();
    }

    this.mode = mode;
    logger.info('[IPFS] Mode changed', { mode });
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

/**
 * Get the singleton IPFSManager instance
 * @returns {IPFSManager}
 */
function getIPFSManager() {
  if (!instance) {
    instance = new IPFSManager();
  }
  return instance;
}

module.exports = { IPFSManager, getIPFSManager };
