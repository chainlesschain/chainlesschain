"use strict";

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

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const {
  IPFSBoundaryError,
  resolveIPFSBoundaries,
  utf8Bytes,
  validateBoundedText,
  validateFilename,
  serializeMetadata,
  normalizeContent,
  resolveReadMaxBytes,
} = require("./ipfs-boundaries.js");
const { IPFSContentRuntime } = require("./ipfs-content-runtime.js");

// Lazy-load electron app to support test environments
let app;
let electronSafeStorage;
try {
  const electron = require("electron");
  app = electron.app;
  electronSafeStorage = electron.safeStorage;
} catch (_e) {
  app = global.app || {
    getPath: () => require("os").tmpdir(),
  };
}

const WRAPPED_DEK_PREFIX = "cc-ipfs-dek:v1:";

// ============================================================
// Constants
// ============================================================

const DEFAULT_STORAGE_QUOTA_BYTES = 1073741824; // 1GB
const DEFAULT_GATEWAY_URL = "https://ipfs.io";
const DEFAULT_EXTERNAL_API_URL = "http://127.0.0.1:5001";
const ENCRYPTION_OVERHEAD_BYTES = 32;

// ============================================================
// IPFSManager
// ============================================================

class IPFSManager extends EventEmitter {
  constructor({
    safeStorage = electronSafeStorage,
    boundaries = {},
    fileSystem = fs,
  } = {}) {
    super();
    this.node = null;
    this.unixfs = null;
    this.jsonCodec = null;
    this.database = null;
    this.safeStorage = safeStorage;
    this.fileSystem = fileSystem;
    this.boundaries = resolveIPFSBoundaries(boundaries);
    this.contentRuntime = new IPFSContentRuntime(() => this.boundaries);
    this._activeReads = this.contentRuntime.activeReads;
    this._activeWrites = this.contentRuntime.activeWrites;
    this.initialized = false;
    this.mode = "embedded";
    this.config = {
      repoPath: "",
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
  async initialize(dependencies = {}) {
    if (this.initialized) {
      logger.info("[IPFS] Manager already initialized");
      return;
    }

    this.database = dependencies.database || null;

    let configuredLimits = dependencies.boundaries;
    if (dependencies.config) {
      const { limits, ...configOverrides } = dependencies.config;
      Object.assign(this.config, configOverrides);
      if (limits !== undefined) {
        configuredLimits = limits;
      }
    }
    if (configuredLimits !== undefined) {
      this.boundaries = resolveIPFSBoundaries(configuredLimits);
    }

    // Set repo path
    const userDataPath = app?.getPath?.("userData") || ".";
    this.config.repoPath = path.join(
      userDataPath,
      ".chainlesschain",
      "ipfs-repo",
    );

    // Ensure directory exists
    this.fileSystem.mkdirSync(this.config.repoPath, { recursive: true });

    // Ensure database tables exist
    this._ensureTables();

    this.initialized = true;
    logger.info("[IPFS] Manager initialized", {
      mode: this.mode,
      repoPath: this.config.repoPath,
    });
  }

  /**
   * Create required database tables
   */
  _ensureTables() {
    if (!this.database) {
      logger.warn("[IPFS] No database available, skipping table creation");
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

      this._migrateEncryptionKeys();

      logger.info("[IPFS] Database tables ensured");
    } catch (error) {
      logger.error("[IPFS] Failed to create tables", { error: error.message });
      throw error;
    }
  }

  _wrapEncryptionKey(key) {
    if (
      !this.safeStorage ||
      typeof this.safeStorage.isEncryptionAvailable !== "function" ||
      !this.safeStorage.isEncryptionAvailable() ||
      typeof this.safeStorage.encryptString !== "function"
    ) {
      throw new Error("IPFS data-key wrapping is unavailable");
    }
    return `${WRAPPED_DEK_PREFIX}${this.safeStorage
      .encryptString(String(key))
      .toString("base64")}`;
  }

  _unwrapEncryptionKey(wrapped) {
    if (
      typeof wrapped !== "string" ||
      !wrapped.startsWith(WRAPPED_DEK_PREFIX)
    ) {
      throw new Error("IPFS data key is not wrapped");
    }
    if (
      !this.safeStorage ||
      typeof this.safeStorage.decryptString !== "function"
    ) {
      throw new Error("IPFS data-key unwrapping is unavailable");
    }
    return this.safeStorage.decryptString(
      Buffer.from(wrapped.slice(WRAPPED_DEK_PREFIX.length), "base64"),
    );
  }

  _migrateEncryptionKeys({ dryRun = false } = {}) {
    if (!this.database || typeof this.database.all !== "function") {
      return { pending: 0, migrated: 0, dryRun };
    }
    const rows =
      this.database.all(
        "SELECT cid, encryption_key FROM ipfs_content WHERE encrypted = 1",
      ) || [];
    const legacy = rows.filter(
      (row) =>
        row.encryption_key &&
        !String(row.encryption_key).startsWith(WRAPPED_DEK_PREFIX),
    );
    if (dryRun) return { pending: legacy.length, migrated: 0, dryRun: true };
    const staged = legacy.map((row) => ({
      cid: row.cid,
      wrapped: this._wrapEncryptionKey(row.encryption_key),
    }));
    if (staged.length > 0) {
      this.database.run("BEGIN IMMEDIATE TRANSACTION");
      try {
        for (const row of staged) {
          this.database.run(
            "UPDATE ipfs_content SET encryption_key = ? WHERE cid = ?",
            [row.wrapped, row.cid],
          );
        }
        this.database.run("COMMIT");
      } catch (error) {
        try {
          this.database.run("ROLLBACK");
        } catch {
          // Preserve the migration error. The database remains fail-closed.
        }
        throw error;
      }
    }
    return { pending: legacy.length, migrated: legacy.length, dryRun: false };
  }

  /**
   * Ensure the IPFS node is running before performing operations
   * @throws {Error} If node is not started
   */
  _ensureNode() {
    if (!this.node && this.mode === "embedded") {
      throw new Error("IPFS node is not started. Call startNode() first.");
    }
  }

  /**
   * Ensure manager is initialized
   * @throws {Error} If not initialized
   */
  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error(
        "IPFS Manager is not initialized. Call initialize() first.",
      );
    }
  }

  _validateBoundedText(
    value,
    label,
    { required = true, maxBytes = this.boundaries.maxIdentifierBytes } = {},
  ) {
    return validateBoundedText(this.boundaries, value, label, {
      required,
      maxBytes,
    });
  }

  _validateFilename(filename) {
    return validateFilename(this.boundaries, filename);
  }

  _serializeMetadata(metadata) {
    return serializeMetadata(this.boundaries, metadata);
  }

  _normalizeContent(content) {
    return normalizeContent(this.boundaries, content);
  }

  _resolveReadMaxBytes(requestedMaxBytes) {
    return resolveReadMaxBytes(this.boundaries, requestedMaxBytes);
  }

  _acquireWrite() {
    return this.contentRuntime.acquireWrite();
  }

  _assertWriteGeneration(token) {
    this.contentRuntime.assertWriteActive(token);
  }

  async _readFromUnixfs(cid, maxStoredBytes) {
    return this.contentRuntime.read(this.unixfs, cid, maxStoredBytes);
  }

  /**
   * Start the IPFS node (embedded Helia or connect to external Kubo)
   */
  async startNode() {
    this._ensureInitialized();

    if (this.mode === "embedded") {
      try {
        logger.info("[IPFS] Starting embedded Helia node...");

        // Dynamic ESM imports for Helia packages
        const { createHelia } = await import("helia");
        const { FsBlockstore } = await import("blockstore-fs");
        const { LevelDatastore } = await import("datastore-level");
        const { unixfs } = await import("@helia/unixfs");
        const { json } = await import("@helia/json");

        const blocksPath = path.join(this.config.repoPath, "blocks");
        const dataPath = path.join(this.config.repoPath, "data");

        this.fileSystem.mkdirSync(blocksPath, { recursive: true });
        this.fileSystem.mkdirSync(dataPath, { recursive: true });

        const blockstore = new FsBlockstore(blocksPath);
        const datastore = new LevelDatastore(dataPath);

        this.node = await createHelia({ blockstore, datastore });
        this.unixfs = unixfs(this.node);
        this.jsonCodec = json(this.node);

        const peerId = this.node.libp2p.peerId.toString();
        logger.info("[IPFS] Embedded Helia node started", { peerId });
        this.emit("node-started", { mode: "embedded", peerId });
      } catch (error) {
        logger.error("[IPFS] Failed to start embedded node", {
          error: error.message,
        });
        throw error;
      }
    } else {
      // External Kubo RPC mode
      logger.info("[IPFS] Using external Kubo node", {
        apiUrl: this.config.externalApiUrl,
      });
      this.emit("node-started", {
        mode: "external",
        apiUrl: this.config.externalApiUrl,
      });
    }

    await this._updateStats();
  }

  /**
   * Stop the IPFS node
   */
  async stopNode() {
    this.contentRuntime.stop("IPFS node stopped during read");
    if (this.node) {
      try {
        await this.node.stop();
        logger.info("[IPFS] Node stopped");
      } catch (error) {
        logger.error("[IPFS] Error stopping node", { error: error.message });
      }
      this.node = null;
      this.unixfs = null;
      this.jsonCodec = null;
      this.emit("node-stopped");
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

    const writeToken = this._acquireWrite();
    try {
      return await this._addContentAdmitted(content, options, writeToken);
    } finally {
      this.contentRuntime.releaseWrite(writeToken);
    }
  }

  async _addContentAdmitted(content, options, writeToken) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new IPFSBoundaryError(
        "INVALID_ARGUMENT",
        "options must be an object",
      );
    }

    const {
      encrypt = this.config.encryptionEnabled,
      metadata = {},
      filename,
    } = options;

    let data = this._normalizeContent(content);
    const originalSize = data.length;
    const safeFilename = this._validateFilename(filename);
    const serializedMetadata = this._serializeMetadata(metadata);

    // Check storage quota
    const currentUsage = this.stats.totalSize || 0;
    if (currentUsage + originalSize > this.config.storageQuotaBytes) {
      throw new Error(
        `Storage quota exceeded. Usage: ${currentUsage} bytes, Quota: ${this.config.storageQuotaBytes} bytes, Attempted: ${originalSize} bytes`,
      );
    }

    let encryptionKey = null;
    let wrappedEncryptionKey = null;
    let encrypted = false;

    // Optionally encrypt with AES-256-GCM
    if (encrypt) {
      const encResult = this._encrypt(data);
      data = encResult.encrypted;
      encryptionKey = encResult.key;
      wrappedEncryptionKey = this._wrapEncryptionKey(encryptionKey);
      encrypted = true;
      logger.info("[IPFS] Content encrypted before adding");
    }

    // Add via unixfs
    const cid = await this.unixfs.addBytes(new Uint8Array(data));
    this._assertWriteGeneration(writeToken);
    const cidString = cid.toString();

    // Pin the content
    try {
      if (this.node.pins) {
        await this.node.pins.add(cid);
      }
    } catch (pinError) {
      logger.warn("[IPFS] Pinning not available, content added without pin", {
        error: pinError.message,
      });
    }
    this._assertWriteGeneration(writeToken);

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
            safeFilename,
            originalSize,
            encrypted ? 1 : 0,
            wrappedEncryptionKey,
            serializedMetadata,
          ],
        );
      } catch (dbError) {
        logger.error("[IPFS] Failed to record content in database", {
          error: dbError.message,
        });
        if (encrypted) {
          throw new Error(
            `Failed to persist wrapped IPFS data key: ${dbError.message}`,
          );
        }
      }
    }

    this._assertWriteGeneration(writeToken);
    await this._updateStats();

    logger.info("[IPFS] Content added", {
      cid: cidString,
      size: originalSize,
      encrypted,
      filename: safeFilename,
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

    this._validateBoundedText(filePath, "filePath", {
      maxBytes: this.boundaries.maxPathBytes,
    });
    if (!this.fileSystem.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stat = this.fileSystem.statSync(filePath);
    if (!stat.isFile()) {
      throw new IPFSBoundaryError(
        "INVALID_ARGUMENT",
        "filePath must reference a regular file",
      );
    }
    if (stat.size > this.boundaries.maxContentBytes) {
      throw new IPFSBoundaryError(
        "PAYLOAD_TOO_LARGE",
        `file exceeds ${this.boundaries.maxContentBytes} bytes`,
        { limitBytes: this.boundaries.maxContentBytes },
      );
    }

    const fileBuffer = this.fileSystem.readFileSync(filePath);
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

    this._validateBoundedText(cidString, "cid");
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new IPFSBoundaryError(
        "INVALID_ARGUMENT",
        "options must be an object",
      );
    }
    const maxBytes = this._resolveReadMaxBytes(options.maxBytes);

    const { CID } = await import("multiformats/cid");
    const cid = CID.parse(cidString);

    // Check database for encryption info and metadata
    let metadata = {};
    let encryptionKey = null;
    let isEncrypted = false;

    if (this.database) {
      try {
        const row = this.database.get(
          `SELECT encryption_key, encrypted,
                  CASE WHEN length(CAST(metadata AS BLOB)) <= ? THEN metadata ELSE NULL END AS metadata,
                  length(CAST(metadata AS BLOB)) AS metadata_bytes
             FROM ipfs_content WHERE cid = ?`,
          [this.boundaries.maxMetadataBytes, cidString],
        );
        if (row) {
          isEncrypted = row.encrypted === 1;
          encryptionKey = row.encryption_key;
          if (row.metadata_bytes > this.boundaries.maxMetadataBytes) {
            throw new IPFSBoundaryError(
              "PAYLOAD_TOO_LARGE",
              `stored metadata exceeds ${this.boundaries.maxMetadataBytes} bytes`,
              { limitBytes: this.boundaries.maxMetadataBytes },
            );
          }
          try {
            metadata = row.metadata ? JSON.parse(row.metadata) : {};
          } catch (_e) {
            metadata = {};
          }
        }
      } catch (dbError) {
        if (dbError instanceof IPFSBoundaryError) throw dbError;
        logger.warn("[IPFS] Could not fetch content metadata from database", {
          error: dbError.message,
        });
      }
    }

    const maxStoredBytes =
      maxBytes + (isEncrypted ? ENCRYPTION_OVERHEAD_BYTES : 0);
    let data = await this._readFromUnixfs(cid, maxStoredBytes);

    // Decrypt if needed
    if (isEncrypted) {
      try {
        if (!encryptionKey) throw new Error("IPFS wrapped data key is missing");
        if (utf8Bytes(encryptionKey) > this.boundaries.maxIdentifierBytes) {
          throw new IPFSBoundaryError(
            "PAYLOAD_TOO_LARGE",
            "IPFS wrapped data key exceeds the configured limit",
            { limitBytes: this.boundaries.maxIdentifierBytes },
          );
        }
        data = this._decrypt(data, this._unwrapEncryptionKey(encryptionKey));
        if (data.length > maxBytes) {
          throw new IPFSBoundaryError(
            "PAYLOAD_TOO_LARGE",
            `decrypted content exceeds ${maxBytes} bytes`,
            { limitBytes: maxBytes },
          );
        }
        logger.info("[IPFS] Content decrypted successfully");
      } catch (decryptError) {
        if (decryptError instanceof IPFSBoundaryError) throw decryptError;
        throw new Error(`Failed to decrypt content: ${decryptError.message}`);
      }
    } else if (data.length > maxBytes) {
      throw new IPFSBoundaryError(
        "PAYLOAD_TOO_LARGE",
        `IPFS content exceeds ${maxBytes} bytes`,
        { limitBytes: maxBytes },
      );
    }

    logger.info("[IPFS] Content retrieved", {
      cid: cidString,
      size: data.length,
    });

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
    this._validateBoundedText(outputPath, "outputPath", {
      maxBytes: this.boundaries.maxPathBytes,
    });

    const { content } = await this.getContent(cidString);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    this.fileSystem.mkdirSync(outputDir, { recursive: true });

    this.fileSystem.writeFileSync(outputPath, content);

    logger.info("[IPFS] File written", {
      cid: cidString,
      outputPath,
      size: content.length,
    });

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
    this._validateBoundedText(cidString, "cid");

    const { CID } = await import("multiformats/cid");
    const cid = CID.parse(cidString);

    try {
      if (this.node.pins) {
        await this.node.pins.add(cid);
      }
    } catch (pinError) {
      logger.warn("[IPFS] Pin API not available", { error: pinError.message });
    }

    // Update DB record
    if (this.database) {
      try {
        this.database.run(
          "UPDATE ipfs_content SET pinned = 1, updated_at = datetime('now') WHERE cid = ?",
          [cidString],
        );
      } catch (dbError) {
        logger.error("[IPFS] Failed to update pin status in database", {
          error: dbError.message,
        });
      }
    }

    await this._updateStats();

    logger.info("[IPFS] Content pinned", { cid: cidString });

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
    this._validateBoundedText(cidString, "cid");

    const { CID } = await import("multiformats/cid");
    const cid = CID.parse(cidString);

    try {
      if (this.node.pins) {
        await this.node.pins.rm(cid);
      }
    } catch (pinError) {
      logger.warn("[IPFS] Unpin API not available", {
        error: pinError.message,
      });
    }

    // Update DB record
    if (this.database) {
      try {
        this.database.run(
          "UPDATE ipfs_content SET pinned = 0, updated_at = datetime('now') WHERE cid = ?",
          [cidString],
        );
      } catch (dbError) {
        logger.error("[IPFS] Failed to update unpin status in database", {
          error: dbError.message,
        });
      }
    }

    await this._updateStats();

    logger.info("[IPFS] Content unpinned", { cid: cidString });

    return { unpinned: true, cid: cidString };
  }

  /**
   * List pinned content from the database
   * @param {Object} options - { offset, limit, sortBy }
   * @returns {{ items: Array, total: number }}
   */
  async listPins(options = {}) {
    this._ensureInitialized();

    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new IPFSBoundaryError(
        "INVALID_ARGUMENT",
        "list options must be an object",
      );
    }
    const {
      offset = 0,
      limit = this.boundaries.listLimit,
      sortBy = "created_at",
    } = options;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new IPFSBoundaryError(
        "INVALID_ARGUMENT",
        "offset must be a non-negative safe integer",
      );
    }
    if (
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      limit > this.boundaries.maxListLimit
    ) {
      throw new IPFSBoundaryError(
        "INVALID_ARGUMENT",
        `limit must be between 1 and ${this.boundaries.maxListLimit}`,
        { maxLimit: this.boundaries.maxListLimit },
      );
    }

    // Validate sortBy to prevent SQL injection
    const allowedSortColumns = [
      "created_at",
      "size",
      "filename",
      "cid",
      "updated_at",
    ];
    const safeSortBy = allowedSortColumns.includes(sortBy)
      ? sortBy
      : "created_at";

    if (!this.database) {
      return { items: [], total: 0 };
    }

    try {
      const totalRow = this.database.get(
        "SELECT COUNT(*) as count FROM ipfs_content WHERE pinned = 1",
      );
      const total = totalRow?.count || 0;

      const rows = this.database.all(
        `SELECT id, cid, filename, size, pinned, encrypted, knowledge_id,
                CASE WHEN length(CAST(metadata AS BLOB)) <= ? THEN metadata ELSE NULL END AS metadata,
                length(CAST(metadata AS BLOB)) AS metadata_bytes,
                created_at, updated_at
         FROM ipfs_content
         WHERE pinned = 1
         ORDER BY ${safeSortBy} DESC
         LIMIT ? OFFSET ?`,
        [this.boundaries.maxMetadataBytes, limit, offset],
      );

      const items = (rows || []).map((row) => ({
        ...row,
        pinned: row.pinned === 1,
        encrypted: row.encrypted === 1,
        metadata: row.metadata
          ? (() => {
              try {
                return JSON.parse(row.metadata);
              } catch {
                return {};
              }
            })()
          : {},
      }));

      return { items, total };
    } catch (error) {
      logger.error("[IPFS] Failed to list pins", { error: error.message });
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
    if (this.node && typeof this.node.gc === "function") {
      try {
        await this.node.gc();
        logger.info("[IPFS] Helia garbage collection completed");
      } catch (gcError) {
        logger.warn("[IPFS] Helia GC not available or failed", {
          error: gcError.message,
        });
      }
    }

    // Clean up unpinned content from DB
    if (this.database) {
      try {
        const unpinned = this.database.get(
          `SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS totalSize
             FROM ipfs_content WHERE pinned = 0`,
        );
        removedItems = Number(unpinned?.count) || 0;
        freedBytes = Number(unpinned?.totalSize) || 0;
        if (removedItems > 0) {
          this.database.run("DELETE FROM ipfs_content WHERE pinned = 0");
          logger.info("[IPFS] Removed unpinned content from database", {
            removedItems,
            freedBytes,
          });
        }
      } catch (dbError) {
        logger.error("[IPFS] Failed to clean up database during GC", {
          error: dbError.message,
        });
      }
    }

    await this._updateStats();

    logger.info("[IPFS] Garbage collection complete", {
      freedBytes,
      removedItems,
    });

    return { freedBytes, removedItems };
  }

  /**
   * Set the storage quota
   * @param {number} quotaBytes - New quota in bytes
   */
  async setQuota(quotaBytes) {
    if (!Number.isSafeInteger(quotaBytes) || quotaBytes <= 0) {
      throw new Error("Quota must be a positive number");
    }

    this.config.storageQuotaBytes = quotaBytes;
    logger.info("[IPFS] Storage quota updated", { quotaBytes });
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

    this._validateBoundedText(knowledgeId, "knowledgeId");

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
          [knowledgeId, result.id],
        );
      } catch (dbError) {
        logger.error("[IPFS] Failed to link content to knowledge item", {
          error: dbError.message,
        });
      }
    }

    logger.info("[IPFS] Knowledge attachment added", {
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
  async getKnowledgeAttachment(knowledgeId, cidString, options = {}) {
    this._ensureInitialized();

    if (!knowledgeId || !cidString) {
      throw new Error("Both knowledgeId and cid are required");
    }
    this._validateBoundedText(knowledgeId, "knowledgeId");
    this._validateBoundedText(cidString, "cid");

    // Verify the CID is linked to the given knowledge item
    if (this.database) {
      const row = this.database.get(
        "SELECT id FROM ipfs_content WHERE cid = ? AND knowledge_id = ?",
        [cidString, knowledgeId],
      );
      if (!row) {
        throw new Error(
          `Content with CID ${cidString} is not linked to knowledge item ${knowledgeId}`,
        );
      }
    }

    const result = await this.getContent(cidString, options);

    logger.info("[IPFS] Knowledge attachment retrieved", {
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
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      encrypted: Buffer.concat([iv, tag, encrypted]),
      key: key.toString("hex"),
    };
  }

  /**
   * Decrypt data using AES-256-GCM
   * @param {Buffer} data - Data to decrypt (iv + tag + ciphertext)
   * @param {string} keyHex - Hex-encoded encryption key
   * @returns {Buffer} Decrypted data
   */
  _decrypt(data, keyHex) {
    const key = Buffer.from(keyHex, "hex");
    const iv = data.subarray(0, 16);
    const tag = data.subarray(16, 32);
    const encrypted = data.subarray(32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
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
          "SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM ipfs_content WHERE pinned = 1",
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
      activeReads: this._activeReads.size,
      activeWrites: this._activeWrites.size,
    };
  }

  /**
   * Set the operating mode (embedded or external)
   * @param {string} mode - 'embedded' or 'external'
   */
  async setMode(mode) {
    if (mode !== "embedded" && mode !== "external") {
      throw new Error("Invalid mode. Must be 'embedded' or 'external'.");
    }

    if (this.node) {
      await this.stopNode();
    }

    this.mode = mode;
    logger.info("[IPFS] Mode changed", { mode });
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
