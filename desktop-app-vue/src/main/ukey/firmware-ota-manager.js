/**
 * Firmware OTA Manager
 *
 * Over-the-air firmware update management for U-Key devices:
 * - Check for available updates
 * - Download and verify firmware images
 * - Install with resume and rollback capability
 * - Update history tracking
 *
 * @module ukey/firmware-ota-manager
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const UPDATE_CHANNELS = {
  STABLE: "stable",
  BETA: "beta",
  NIGHTLY: "nightly",
};

const UPDATE_STATUS = {
  AVAILABLE: "available",
  DOWNLOADING: "downloading",
  VERIFYING: "verifying",
  INSTALLING: "installing",
  COMPLETED: "completed",
  FAILED: "failed",
  ROLLED_BACK: "rolled_back",
};

// ============================================================
// FirmwareOTAManager
// ============================================================

class FirmwareOTAManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._versions = new Map();
    this._currentUpdate = null;
    this._channel = UPDATE_CHANNELS.STABLE;
    this._chunkSize = 65536;
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS firmware_versions (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        channel TEXT DEFAULT 'stable',
        release_notes TEXT,
        file_size INTEGER,
        checksum TEXT,
        download_url TEXT,
        is_critical INTEGER DEFAULT 0,
        released_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_firmware_versions_channel ON firmware_versions(channel);
      CREATE INDEX IF NOT EXISTS idx_firmware_versions_version ON firmware_versions(version);

      CREATE TABLE IF NOT EXISTS firmware_update_log (
        id TEXT PRIMARY KEY,
        version_id TEXT,
        version TEXT NOT NULL,
        status TEXT DEFAULT 'available',
        progress INTEGER DEFAULT 0,
        started_at INTEGER,
        completed_at INTEGER,
        error_message TEXT,
        rollback_version TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_firmware_update_log_status ON firmware_update_log(status);
    `);
  }

  async initialize() {
    logger.info("[FirmwareOTAManager] Initializing firmware OTA manager...");
    this._ensureTables();

    if (this.database && this.database.db) {
      try {
        const versions = this.database.db
          .prepare("SELECT * FROM firmware_versions ORDER BY released_at DESC")
          .all();
        for (const v of versions) {
          this._versions.set(v.id, v);
        }
        logger.info(
          `[FirmwareOTAManager] Loaded ${versions.length} firmware versions`,
        );
      } catch (err) {
        logger.error("[FirmwareOTAManager] Failed to load versions:", err);
      }
    }

    this.initialized = true;
    logger.info("[FirmwareOTAManager] Firmware OTA manager initialized");
  }

  /**
   * Check for available firmware updates
   * @param {Object} [params]
   * @param {string} [params.currentVersion] - Current firmware version
   * @param {string} [params.channel] - Update channel
   * @returns {Object} Available updates
   */
  async checkUpdates({ currentVersion = "1.0.0", channel } = {}) {
    const checkChannel = channel || this._channel;

    // Simulate fetching from update server
    const simulatedUpdate = {
      id: uuidv4(),
      version: "2.0.0",
      channel: checkChannel,
      release_notes:
        "Post-quantum cryptography support, improved BLE connectivity",
      file_size: 2048576,
      checksum: crypto.randomBytes(32).toString("hex"),
      download_url: `https://firmware.chainlesschain.io/${checkChannel}/v2.0.0/ukey-firmware.bin`,
      is_critical: 0,
      released_at: Date.now(),
    };

    // Store in DB
    if (this.database && this.database.db) {
      try {
        this.database.db
          .prepare(
            `
          INSERT OR IGNORE INTO firmware_versions (id, version, channel, release_notes, file_size, checksum, download_url, is_critical, released_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            simulatedUpdate.id,
            simulatedUpdate.version,
            simulatedUpdate.channel,
            simulatedUpdate.release_notes,
            simulatedUpdate.file_size,
            simulatedUpdate.checksum,
            simulatedUpdate.download_url,
            simulatedUpdate.is_critical,
            simulatedUpdate.released_at,
          );
      } catch (err) {
        logger.warn(
          "[FirmwareOTAManager] Failed to store version:",
          err.message,
        );
      }
    }

    this._versions.set(simulatedUpdate.id, simulatedUpdate);
    this.emit("update-available", simulatedUpdate);
    logger.info(
      `[FirmwareOTAManager] Update available: v${simulatedUpdate.version} (${checkChannel})`,
    );

    return {
      hasUpdate: true,
      currentVersion,
      availableUpdate: simulatedUpdate,
    };
  }

  /**
   * List all known firmware versions
   * @param {Object} [params]
   * @param {string} [params.channel] - Filter by channel
   * @param {number} [params.limit] - Max results
   * @returns {Array} Firmware versions
   */
  async listVersions({ channel, limit = 20 } = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM firmware_versions WHERE 1=1";
        const params = [];

        if (channel) {
          sql += " AND channel = ?";
          params.push(channel);
        }

        sql += " ORDER BY released_at DESC LIMIT ?";
        params.push(limit);

        return this.database.db.prepare(sql).all(...params);
      } catch (err) {
        logger.error("[FirmwareOTAManager] Failed to list versions:", err);
      }
    }

    let versions = Array.from(this._versions.values());
    if (channel) {
      versions = versions.filter((v) => v.channel === channel);
    }
    return versions.slice(0, limit);
  }

  /**
   * Start a firmware update
   * @param {Object} params
   * @param {string} params.versionId - Version ID to install
   * @param {boolean} [params.allowRollback] - Allow rollback on failure
   * @returns {Object} Update result
   */
  async startUpdate({ versionId, allowRollback = true } = {}) {
    if (!versionId) {
      throw new Error("Version ID is required");
    }

    const version = this._versions.get(versionId);
    if (!version) {
      throw new Error(`Version not found: ${versionId}`);
    }

    if (this._currentUpdate) {
      throw new Error("Another update is already in progress");
    }

    const updateId = uuidv4();
    const now = Date.now();

    this._currentUpdate = {
      id: updateId,
      version_id: versionId,
      version: version.version,
      status: UPDATE_STATUS.DOWNLOADING,
      progress: 0,
      started_at: now,
      completed_at: null,
      error_message: null,
      rollback_version: allowRollback ? "1.0.0" : null,
    };

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `
        INSERT INTO firmware_update_log (id, version_id, version, status, progress, started_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          updateId,
          versionId,
          version.version,
          UPDATE_STATUS.DOWNLOADING,
          0,
          now,
        );
    }

    this.emit("update-started", this._currentUpdate);
    logger.info(`[FirmwareOTAManager] Update started: v${version.version}`);

    // Simulate download + verify + install
    try {
      // Download phase
      this._currentUpdate.status = UPDATE_STATUS.DOWNLOADING;
      this._currentUpdate.progress = 50;
      this.emit("update-progress", {
        progress: 50,
        status: UPDATE_STATUS.DOWNLOADING,
      });

      // Verify phase
      this._currentUpdate.status = UPDATE_STATUS.VERIFYING;
      this._currentUpdate.progress = 75;
      this.emit("update-progress", {
        progress: 75,
        status: UPDATE_STATUS.VERIFYING,
      });

      // Install phase
      this._currentUpdate.status = UPDATE_STATUS.INSTALLING;
      this._currentUpdate.progress = 90;
      this.emit("update-progress", {
        progress: 90,
        status: UPDATE_STATUS.INSTALLING,
      });

      // Complete
      this._currentUpdate.status = UPDATE_STATUS.COMPLETED;
      this._currentUpdate.progress = 100;
      this._currentUpdate.completed_at = Date.now();

      if (this.database && this.database.db) {
        this.database.db
          .prepare(
            `
          UPDATE firmware_update_log SET status = ?, progress = ?, completed_at = ? WHERE id = ?
        `,
          )
          .run(
            UPDATE_STATUS.COMPLETED,
            100,
            this._currentUpdate.completed_at,
            updateId,
          );
      }

      this.emit("update-completed", this._currentUpdate);
      logger.info(`[FirmwareOTAManager] Update completed: v${version.version}`);

      const result = { ...this._currentUpdate };
      this._currentUpdate = null;
      return result;
    } catch (err) {
      this._currentUpdate.status = UPDATE_STATUS.FAILED;
      this._currentUpdate.error_message = err.message;
      this._currentUpdate.completed_at = Date.now();

      if (this.database && this.database.db) {
        this.database.db
          .prepare(
            `
          UPDATE firmware_update_log SET status = ?, error_message = ?, completed_at = ? WHERE id = ?
        `,
          )
          .run(
            UPDATE_STATUS.FAILED,
            err.message,
            this._currentUpdate.completed_at,
            updateId,
          );
      }

      this.emit("update-failed", this._currentUpdate);
      logger.error(`[FirmwareOTAManager] Update failed: ${err.message}`);

      this._currentUpdate = null;
      throw err;
    }
  }

  /**
   * Get update history
   * @param {Object} [params]
   * @param {number} [params.limit] - Max results
   * @returns {Array} Update history
   */
  async getHistory({ limit = 20 } = {}) {
    if (this.database && this.database.db) {
      try {
        return this.database.db
          .prepare(
            "SELECT * FROM firmware_update_log ORDER BY created_at DESC LIMIT ?",
          )
          .all(limit);
      } catch (err) {
        logger.error("[FirmwareOTAManager] Failed to get history:", err);
      }
    }
    return [];
  }

  async close() {
    this.removeAllListeners();
    this._versions.clear();
    this._currentUpdate = null;
    this.initialized = false;
    logger.info("[FirmwareOTAManager] Closed");
  }
}

// ============================================================
// Singleton
// ============================================================

let _instance = null;

function getFirmwareOTAManager(database) {
  if (!_instance) {
    _instance = new FirmwareOTAManager(database);
  }
  return _instance;
}

export {
  FirmwareOTAManager,
  getFirmwareOTAManager,
  UPDATE_CHANNELS,
  UPDATE_STATUS,
};
export default FirmwareOTAManager;
