/**
 * Differential Sync Manager
 * Orchestrates optimal transfer strategy selection
 * Barrel exports for all diff-sync modules
 *
 * @module git/diff-sync
 * @version 1.1.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { PackfileOptimizer } = require("./packfile-optimizer");
const { FileDiffEngine } = require("./file-diff-engine");
const {
  DbDiffTracker,
  GCounter,
  PNCounter,
  ORSet,
} = require("./db-diff-tracker");

// Transfer strategies
const STRATEGY = {
  FULL: "full", // Full object transfer
  THIN_PACK: "thin-pack", // Git thin packfile
  RSYNC_DELTA: "rsync-delta", // rsync-style block diff
  CRDT_MERGE: "crdt-merge", // CRDT automatic merge
};

// File type heuristics
const BINARY_EXTENSIONS = new Set([
  ".db",
  ".db.enc",
  ".sqlite",
  ".sqlite3",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
]);

/**
 * DiffSyncManager - Selects optimal transfer strategy
 */
class DiffSyncManager extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.database - DatabaseManager instance
   * @param {string} options.nodeId - Local node identifier
   * @param {Object} [options.packfileOptions] - PackfileOptimizer options
   * @param {Object} [options.fileDiffOptions] - FileDiffEngine options
   * @param {Object} [options.dbTrackerOptions] - DbDiffTracker options
   */
  constructor(options = {}) {
    super();

    this.packfileOptimizer = new PackfileOptimizer(
      options.packfileOptions || {},
    );
    this.fileDiffEngine = new FileDiffEngine(options.fileDiffOptions || {});
    this.dbDiffTracker = new DbDiffTracker({
      database: options.database,
      nodeId: options.nodeId,
      trackedTables: options.trackedTables || [],
      ...(options.dbTrackerOptions || {}),
    });

    // Configuration
    this.config = {
      thinPackEnabled: true,
      rsyncForBinary: true,
      crdtEnabled: true,
      compressionAlgorithm: "zstd",
      compressionLevel: 3,
      maxDeltaChainDepth: 10,
      blockSize: 4096,
    };

    // Stats
    this._stats = {
      syncsPerformed: 0,
      strategiesUsed: {},
      totalBytesSaved: 0,
    };
  }

  /**
   * Initialize all diff-sync subsystems
   * @param {Object} [config] - Override config
   */
  async initialize(config = {}) {
    Object.assign(this.config, config);

    await this.dbDiffTracker.initialize();

    logger.info("[DiffSyncManager] Initialized");
  }

  /**
   * Select the optimal transfer strategy for a given file/data
   *
   * @param {Object} options
   * @param {string} options.filePath - File path
   * @param {number} options.fileSize - File size in bytes
   * @param {string} options.fileType - File extension
   * @param {boolean} options.isDatabase - Whether it's a database file
   * @returns {string} Strategy from STRATEGY enum
   */
  selectStrategy(options) {
    const { filePath, fileSize, fileType, isDatabase } = options;

    // Database files use CRDT merge for tracked fields
    if (isDatabase && this.config.crdtEnabled) {
      return STRATEGY.CRDT_MERGE;
    }

    // Large binary files use rsync delta
    if (fileSize > 1024 * 1024 && this.config.rsyncForBinary) {
      const ext = fileType || this._getExtension(filePath);
      if (BINARY_EXTENSIONS.has(ext)) {
        return STRATEGY.RSYNC_DELTA;
      }
    }

    // Git objects use thin packfile
    if (this.config.thinPackEnabled) {
      return STRATEGY.THIN_PACK;
    }

    // Default: full transfer
    return STRATEGY.FULL;
  }

  /**
   * Perform differential sync for a file
   *
   * @param {Object} options
   * @param {string} options.filePath
   * @param {Buffer} options.localData
   * @param {Buffer} [options.remoteData] - Remote data (for rsync)
   * @param {Function} [options.readObject] - Git object reader
   * @param {string[]} [options.wantOids] - Git objects needed
   * @param {string[]} [options.haveOids] - Git objects available
   * @returns {Promise<Object>} Sync result
   */
  async sync(options) {
    const strategy = this.selectStrategy({
      filePath: options.filePath,
      fileSize: options.localData?.length || 0,
      fileType: this._getExtension(options.filePath),
      isDatabase: options.isDatabase || false,
    });

    this._stats.syncsPerformed++;
    this._stats.strategiesUsed[strategy] =
      (this._stats.strategiesUsed[strategy] || 0) + 1;

    logger.info(
      `[DiffSyncManager] Using strategy: ${strategy} for ${options.filePath}`,
    );

    switch (strategy) {
      case STRATEGY.THIN_PACK:
        return this._syncViaThinPack(options);

      case STRATEGY.RSYNC_DELTA:
        return this._syncViaRsyncDelta(options);

      case STRATEGY.CRDT_MERGE:
        return this._syncViaCRDT(options);

      default:
        return this._syncFull(options);
    }
  }

  /**
   * Sync using thin packfile
   */
  async _syncViaThinPack(options) {
    const { wantOids, haveOids, readObject } = options;

    if (!wantOids || !readObject) {
      return this._syncFull(options);
    }

    const chunks = [];
    for await (const chunk of this.packfileOptimizer.generateThinPackfile({
      wantOids,
      haveOids: haveOids || [],
      readObject,
    })) {
      chunks.push(chunk);
    }

    const packfile = Buffer.concat(chunks);
    const stats = this.packfileOptimizer.getStats();

    return {
      strategy: STRATEGY.THIN_PACK,
      data: packfile,
      stats,
    };
  }

  /**
   * Sync using rsync-style delta
   */
  async _syncViaRsyncDelta(options) {
    const { localData, remoteData } = options;

    if (!localData || !remoteData) {
      return this._syncFull(options);
    }

    const result = this.fileDiffEngine.diffAndCompress(remoteData, localData);

    this._stats.totalBytesSaved +=
      localData.length - result.compressedDelta.length;

    return {
      strategy: STRATEGY.RSYNC_DELTA,
      data: result.compressedDelta,
      stats: result.stats,
    };
  }

  /**
   * Sync using CRDT merge
   */
  async _syncViaCRDT(options) {
    const localState = this.dbDiffTracker.getCRDTState();
    return {
      strategy: STRATEGY.CRDT_MERGE,
      state: localState,
      changes: this.dbDiffTracker.getChangesSince(options.sinceVersion || 0),
    };
  }

  /**
   * Full file transfer (no optimization)
   */
  async _syncFull(options) {
    return {
      strategy: STRATEGY.FULL,
      data: options.localData,
      stats: {
        originalSize: options.localData?.length || 0,
        transferSize: options.localData?.length || 0,
        compressionRatio: 0,
      },
    };
  }

  /**
   * Compact the database change log
   */
  async compactChangelog() {
    return this.dbDiffTracker.compactChangelog();
  }

  /**
   * Get extension from file path
   */
  _getExtension(filePath) {
    if (!filePath) {
      return "";
    }
    const match = filePath.match(/(\.[^.]+)$/);
    return match ? match[1].toLowerCase() : "";
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this._stats,
      packfile: this.packfileOptimizer.getStats(),
      fileDiff: this.fileDiffEngine.getStats(),
      dbTracker: this.dbDiffTracker.getStats(),
    };
  }

  /**
   * Update configuration
   * @param {Object} newConfig
   */
  setConfig(newConfig) {
    Object.assign(this.config, newConfig);
  }

  /**
   * Destroy and clean up
   */
  destroy() {
    this.packfileOptimizer.clearCache();
    this.dbDiffTracker.destroy();
    this.removeAllListeners();
    logger.info("[DiffSyncManager] Destroyed");
  }
}

module.exports = {
  // Main manager
  DiffSyncManager,

  // Sub-modules
  PackfileOptimizer,
  FileDiffEngine,
  DbDiffTracker,

  // CRDTs
  GCounter,
  PNCounter,
  ORSet,

  // Constants
  STRATEGY,
};
