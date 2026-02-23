/**
 * Document Version Manager
 *
 * Manages version snapshots and rollback for collaborative documents.
 * Provides snapshot creation, version listing, diff generation,
 * and rollback capabilities.
 *
 * @module social/doc-version-manager
 * @version 0.41.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

class DocVersionManager extends EventEmitter {
  /**
   * @param {Object} database - Database manager
   * @param {Object} didManager - DID identity manager
   * @param {Object} [yjsCollabManager] - Yjs collaboration manager (optional)
   */
  constructor(database, didManager, yjsCollabManager = null) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.yjsCollabManager = yjsCollabManager;

    this.initialized = false;
  }

  /**
   * Initialize the version manager
   */
  async initialize() {
    logger.info("[DocVersionManager] Initializing...");

    try {
      await this.initializeTables();
      this.initialized = true;
      logger.info("[DocVersionManager] Initialized successfully");
    } catch (error) {
      logger.error("[DocVersionManager] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db || this.database.getDatabase();

    db.exec(`
      CREATE TABLE IF NOT EXISTS doc_versions (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        snapshot BLOB,
        description TEXT,
        creator_did TEXT NOT NULL,
        created_at INTEGER,
        UNIQUE(doc_id, version_number)
      )
    `);

    // Indexes for performance
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_doc_versions_doc
        ON doc_versions(doc_id, version_number DESC);
      CREATE INDEX IF NOT EXISTS idx_doc_versions_creator
        ON doc_versions(creator_did);
    `);

    logger.info("[DocVersionManager] Database tables initialized");
  }

  /**
   * Create a new version snapshot of a document
   * @param {Object} options - Snapshot options
   * @param {string} options.docId - Document ID
   * @param {string} [options.description] - Version description
   * @param {Buffer|Uint8Array} [options.snapshot] - Manual snapshot data
   * @returns {Object} Created version
   */
  async createSnapshot({ docId, description = "", snapshot = null }) {
    try {
      if (!docId) {
        throw new Error("Document ID is required");
      }

      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        throw new Error("User identity not available");
      }

      const db = this.database.db || this.database.getDatabase();

      // Determine next version number
      const latest = db.prepare(`
        SELECT MAX(version_number) as max_version
        FROM doc_versions
        WHERE doc_id = ?
      `).get(docId);

      const versionNumber = (latest?.max_version || 0) + 1;

      // Get snapshot data
      let snapshotData = snapshot;

      if (!snapshotData && this.yjsCollabManager) {
        // Try to capture Yjs state as snapshot
        try {
          const Y = require("yjs");
          const ydoc = this.yjsCollabManager.getDocument(docId);
          if (ydoc) {
            snapshotData = Buffer.from(Y.encodeStateAsUpdate(ydoc));
          }
        } catch (err) {
          logger.warn("[DocVersionManager] Could not capture Yjs snapshot:", err.message);
        }
      }

      const now = Date.now();
      const versionId = uuidv4();

      db.prepare(`
        INSERT INTO doc_versions (
          id, doc_id, version_number, snapshot, description, creator_did, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        versionId,
        docId,
        versionNumber,
        snapshotData ? Buffer.from(snapshotData) : null,
        description || `Version ${versionNumber}`,
        currentDid,
        now,
      );

      const version = {
        id: versionId,
        docId,
        versionNumber,
        description: description || `Version ${versionNumber}`,
        creatorDid: currentDid,
        createdAt: now,
        hasSnapshot: !!snapshotData,
      };

      this.emit("version:created", version);
      logger.info(`[DocVersionManager] Version ${versionNumber} created for doc ${docId}`);

      return { success: true, version };
    } catch (error) {
      logger.error("[DocVersionManager] Error creating snapshot:", error);
      throw error;
    }
  }

  /**
   * Rollback a document to a specific version
   * @param {Object} options - Rollback options
   * @param {string} options.docId - Document ID
   * @param {number} options.versionNumber - Version number to rollback to
   * @returns {Object} Rollback result with the snapshot data
   */
  async rollback({ docId, versionNumber }) {
    try {
      if (!docId || versionNumber === undefined || versionNumber === null) {
        throw new Error("Document ID and version number are required");
      }

      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        throw new Error("User identity not available");
      }

      const db = this.database.db || this.database.getDatabase();

      // Get the target version
      const targetVersion = db.prepare(`
        SELECT * FROM doc_versions
        WHERE doc_id = ? AND version_number = ?
      `).get(docId, versionNumber);

      if (!targetVersion) {
        throw new Error(`Version ${versionNumber} not found for document ${docId}`);
      }

      if (!targetVersion.snapshot) {
        throw new Error(`Version ${versionNumber} has no snapshot data`);
      }

      // Create a backup snapshot of the current state before rollback
      await this.createSnapshot({
        docId,
        description: `Auto-backup before rollback to version ${versionNumber}`,
      });

      // Apply the snapshot to Yjs if available
      if (this.yjsCollabManager) {
        try {
          const Y = require("yjs");
          const ydoc = this.yjsCollabManager.getDocument(docId);
          if (ydoc) {
            Y.applyUpdate(ydoc, targetVersion.snapshot, "rollback");
          }
        } catch (err) {
          logger.warn("[DocVersionManager] Could not apply Yjs rollback:", err.message);
        }
      }

      this.emit("version:rollback", {
        docId,
        versionNumber,
        restoredBy: currentDid,
      });

      logger.info(`[DocVersionManager] Document ${docId} rolled back to version ${versionNumber}`);

      return {
        success: true,
        versionNumber,
        snapshot: targetVersion.snapshot,
        description: targetVersion.description,
      };
    } catch (error) {
      logger.error("[DocVersionManager] Error during rollback:", error);
      throw error;
    }
  }

  /**
   * Get version history for a document
   * @param {Object} options - Query options
   * @param {string} options.docId - Document ID
   * @param {number} [options.limit=50] - Maximum results
   * @param {number} [options.offset=0] - Offset for pagination
   * @returns {Object} List of versions
   */
  async getVersions({ docId, limit = 50, offset = 0 }) {
    try {
      if (!docId) {
        throw new Error("Document ID is required");
      }

      const db = this.database.db || this.database.getDatabase();

      const versions = db.prepare(`
        SELECT id, doc_id, version_number, description, creator_did, created_at,
               CASE WHEN snapshot IS NOT NULL THEN 1 ELSE 0 END as has_snapshot
        FROM doc_versions
        WHERE doc_id = ?
        ORDER BY version_number DESC
        LIMIT ? OFFSET ?
      `).all(docId, limit, offset);

      const total = db.prepare(`
        SELECT COUNT(*) as count FROM doc_versions WHERE doc_id = ?
      `).get(docId);

      return {
        success: true,
        versions: versions.map((row) => ({
          id: row.id,
          docId: row.doc_id,
          versionNumber: row.version_number,
          description: row.description,
          creatorDid: row.creator_did,
          createdAt: row.created_at,
          hasSnapshot: !!row.has_snapshot,
        })),
        total: total?.count || 0,
      };
    } catch (error) {
      logger.error("[DocVersionManager] Error getting versions:", error);
      return { success: false, versions: [], total: 0, error: error.message };
    }
  }

  /**
   * Get a specific version by ID
   * @param {string} versionId - Version ID
   * @returns {Object|null} Version data (without snapshot blob for efficiency)
   */
  async getVersion(versionId) {
    try {
      if (!versionId) {
        return null;
      }

      const db = this.database.db || this.database.getDatabase();

      const row = db.prepare(`
        SELECT id, doc_id, version_number, description, creator_did, created_at,
               CASE WHEN snapshot IS NOT NULL THEN 1 ELSE 0 END as has_snapshot
        FROM doc_versions
        WHERE id = ?
      `).get(versionId);

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        docId: row.doc_id,
        versionNumber: row.version_number,
        description: row.description,
        creatorDid: row.creator_did,
        createdAt: row.created_at,
        hasSnapshot: !!row.has_snapshot,
      };
    } catch (error) {
      logger.error("[DocVersionManager] Error getting version:", error);
      return null;
    }
  }

  /**
   * Compare two versions and return a diff summary
   * @param {Object} options - Diff options
   * @param {string} options.docId - Document ID
   * @param {number} options.fromVersion - Starting version number
   * @param {number} options.toVersion - Ending version number
   * @returns {Object} Diff result
   */
  async diffVersions({ docId, fromVersion, toVersion }) {
    try {
      if (!docId || fromVersion === undefined || toVersion === undefined) {
        throw new Error("Document ID and both version numbers are required");
      }

      const db = this.database.db || this.database.getDatabase();

      const from = db.prepare(`
        SELECT * FROM doc_versions
        WHERE doc_id = ? AND version_number = ?
      `).get(docId, fromVersion);

      const to = db.prepare(`
        SELECT * FROM doc_versions
        WHERE doc_id = ? AND version_number = ?
      `).get(docId, toVersion);

      if (!from || !to) {
        throw new Error("One or both versions not found");
      }

      // Basic diff: compare snapshot sizes and metadata
      const diff = {
        docId,
        fromVersion: {
          versionNumber: from.version_number,
          description: from.description,
          creatorDid: from.creator_did,
          createdAt: from.created_at,
          snapshotSize: from.snapshot ? from.snapshot.length : 0,
        },
        toVersion: {
          versionNumber: to.version_number,
          description: to.description,
          creatorDid: to.creator_did,
          createdAt: to.created_at,
          snapshotSize: to.snapshot ? to.snapshot.length : 0,
        },
        timeDelta: to.created_at - from.created_at,
        sizeDelta: (to.snapshot ? to.snapshot.length : 0) - (from.snapshot ? from.snapshot.length : 0),
      };

      // If both have snapshots and Yjs is available, attempt content-level diff
      if (from.snapshot && to.snapshot && this.yjsCollabManager) {
        try {
          const Y = require("yjs");

          const fromDoc = new Y.Doc();
          Y.applyUpdate(fromDoc, from.snapshot);
          const fromText = fromDoc.getText("content").toString();

          const toDoc = new Y.Doc();
          Y.applyUpdate(toDoc, to.snapshot);
          const toText = toDoc.getText("content").toString();

          diff.contentDiff = {
            fromLength: fromText.length,
            toLength: toText.length,
            lengthDelta: toText.length - fromText.length,
            identical: fromText === toText,
          };

          fromDoc.destroy();
          toDoc.destroy();
        } catch (err) {
          logger.warn("[DocVersionManager] Could not compute content diff:", err.message);
        }
      }

      return { success: true, diff };
    } catch (error) {
      logger.error("[DocVersionManager] Error diffing versions:", error);
      throw error;
    }
  }

  /**
   * Get the latest version of a document
   * @param {string} docId - Document ID
   * @returns {Object|null} Latest version info
   */
  async getLatestVersion(docId) {
    try {
      if (!docId) {
        return null;
      }

      const db = this.database.db || this.database.getDatabase();

      const row = db.prepare(`
        SELECT id, doc_id, version_number, description, creator_did, created_at,
               CASE WHEN snapshot IS NOT NULL THEN 1 ELSE 0 END as has_snapshot
        FROM doc_versions
        WHERE doc_id = ?
        ORDER BY version_number DESC
        LIMIT 1
      `).get(docId);

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        docId: row.doc_id,
        versionNumber: row.version_number,
        description: row.description,
        creatorDid: row.creator_did,
        createdAt: row.created_at,
        hasSnapshot: !!row.has_snapshot,
      };
    } catch (error) {
      logger.error("[DocVersionManager] Error getting latest version:", error);
      return null;
    }
  }

  /**
   * Delete a specific version
   * @param {string} versionId - Version ID
   * @returns {Object} Result
   */
  async deleteVersion(versionId) {
    try {
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        throw new Error("User identity not available");
      }

      const db = this.database.db || this.database.getDatabase();

      const version = db.prepare(`
        SELECT * FROM doc_versions WHERE id = ?
      `).get(versionId);

      if (!version) {
        throw new Error("Version not found");
      }

      // Only creator can delete versions
      if (version.creator_did !== currentDid) {
        throw new Error("Only the version creator can delete it");
      }

      db.prepare(`DELETE FROM doc_versions WHERE id = ?`).run(versionId);

      this.emit("version:deleted", { versionId, docId: version.doc_id });
      logger.info(`[DocVersionManager] Version ${versionId} deleted`);

      return { success: true };
    } catch (error) {
      logger.error("[DocVersionManager] Error deleting version:", error);
      throw error;
    }
  }

  // ========================================
  // Helper Methods
  // ========================================

  /**
   * Get the current user's DID
   */
  _getCurrentDid() {
    try {
      const identity = this.didManager?.getCurrentIdentity?.();
      return identity?.did || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Clean up resources
   */
  async destroy() {
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[DocVersionManager] Destroyed");
  }
}

module.exports = {
  DocVersionManager,
};
