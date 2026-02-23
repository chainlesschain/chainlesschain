/**
 * Collaboration Git Integration
 * Periodic CRDT→Markdown→Git auto-commit, version snapshots,
 * per-author attribution, conflict prevention
 *
 * @module collab/collab-git-integration
 * @version 2.0.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// Default auto-commit interval (5 minutes)
const DEFAULT_COMMIT_INTERVAL = 5 * 60 * 1000;

/**
 * CollabGitIntegration
 * Bridges real-time CRDT editing with Git version control
 */
class CollabGitIntegration extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.yjsEngine - YjsCRDTEngine instance
   * @param {Object} options.sessionManager - CollabSessionManager instance
   * @param {Object} [options.gitManager] - GitManager instance
   * @param {Object} [options.gitAutoCommit] - GitAutoCommit instance
   * @param {Object} [options.conflictResolver] - SmartConflictResolver instance
   * @param {Object} options.database - DatabaseManager instance
   */
  constructor(options = {}) {
    super();
    this.yjsEngine = options.yjsEngine || null;
    this.sessionManager = options.sessionManager || null;
    this.gitManager = options.gitManager || null;
    this.gitAutoCommit = options.gitAutoCommit || null;
    this.conflictResolver = options.conflictResolver || null;
    this.db = options.database || null;

    // Auto-commit configuration
    this.config = {
      autoCommitEnabled: true,
      commitInterval: DEFAULT_COMMIT_INTERVAL,
      createVersionSnapshots: true,
      trackAttribution: true,
    };

    // Auto-commit timer per document
    this._commitTimers = new Map(); // documentId -> timer

    // Change tracking for attribution
    this._changeTracking = new Map(); // documentId -> Map<authorDid, changeCount>

    // Version counter per document
    this._versionCounters = new Map(); // documentId -> version
  }

  /**
   * Initialize Git integration
   * @param {Object} [config]
   */
  async initialize(config = {}) {
    Object.assign(this.config, config);

    // Listen for document updates from Yjs engine
    if (this.yjsEngine) {
      this.yjsEngine.on("document:update", (data) => {
        this._handleDocumentUpdate(data);
      });
    }

    // Listen for room events
    if (this.sessionManager) {
      this.sessionManager.on("room:created", (data) => {
        this._startAutoCommit(data.documentId);
      });

      this.sessionManager.on("room:left", (data) => {
        // Final commit before leaving
        this._commitDocument(data.documentId || data.roomId);
      });
    }

    logger.info("[CollabGitIntegration] Initialized");
  }

  /**
   * Start auto-commit timer for a document
   * @param {string} documentId
   */
  _startAutoCommit(documentId) {
    if (!this.config.autoCommitEnabled) {
      return;
    }
    if (this._commitTimers.has(documentId)) {
      return;
    }

    const timer = setInterval(() => {
      this._commitDocument(documentId).catch((e) => {
        logger.warn(
          `[CollabGitIntegration] Auto-commit failed for ${documentId}:`,
          e.message,
        );
      });
    }, this.config.commitInterval);

    this._commitTimers.set(documentId, timer);
    logger.info(
      `[CollabGitIntegration] Auto-commit started for ${documentId} (interval: ${this.config.commitInterval}ms)`,
    );
  }

  /**
   * Stop auto-commit for a document
   * @param {string} documentId
   */
  _stopAutoCommit(documentId) {
    const timer = this._commitTimers.get(documentId);
    if (timer) {
      clearInterval(timer);
      this._commitTimers.delete(documentId);
    }
  }

  /**
   * Handle document update for change tracking
   * @param {Object} data - { documentId, update, origin }
   */
  _handleDocumentUpdate(data) {
    const { documentId, origin } = data;

    // Track changes per author
    if (this.config.trackAttribution && origin) {
      if (!this._changeTracking.has(documentId)) {
        this._changeTracking.set(documentId, new Map());
      }

      const authorDid = typeof origin === "string" ? origin : "local";
      const tracking = this._changeTracking.get(documentId);
      tracking.set(authorDid, (tracking.get(authorDid) || 0) + 1);
    }
  }

  /**
   * Commit current document state to Git
   * @param {string} documentId
   * @returns {Promise<Object>}
   */
  async _commitDocument(documentId) {
    if (!this.yjsEngine || !this.gitManager) {
      return null;
    }

    try {
      // Get current Markdown content from Yjs
      const markdown = this.yjsEngine.getMarkdown(documentId);
      if (!markdown) {
        return null;
      }

      // Build commit message with attribution
      const attribution = this._getAttribution(documentId);
      const commitMessage = this._buildCommitMessage(documentId, attribution);

      // Write content to file in Git repo
      const repoPath =
        this.gitManager.repoPath || this.gitManager.config?.repoPath;
      if (!repoPath) {
        return null;
      }

      const fs = require("fs");
      const path = require("path");
      const filePath = path.join(repoPath, "knowledge", `${documentId}.md`);

      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, markdown, "utf8");

      // Use GitAutoCommit pattern or manual commit
      if (this.gitAutoCommit) {
        await this.gitAutoCommit.commitIfChanged?.(commitMessage);
      } else {
        const git = require("isomorphic-git");
        await git.add({
          fs,
          dir: repoPath,
          filepath: `knowledge/${documentId}.md`,
        });
        await git.commit({
          fs,
          dir: repoPath,
          message: commitMessage,
          author: {
            name: attribution.primaryAuthor?.name || "ChainlessChain Collab",
            email:
              attribution.primaryAuthor?.email || "collab@chainlesschain.com",
          },
        });
      }

      // Clear change tracking
      this._changeTracking.delete(documentId);

      const result = {
        documentId,
        commitMessage,
        timestamp: Date.now(),
      };

      this.emit("git:committed", result);
      return result;
    } catch (error) {
      logger.error(
        `[CollabGitIntegration] Commit failed for ${documentId}:`,
        error.message,
      );
      return null;
    }
  }

  /**
   * Create a version snapshot with Git tag
   * @param {string} documentId
   * @param {string} message - Snapshot message
   * @param {string} authorDid
   * @returns {Promise<Object>}
   */
  async createVersionSnapshot(documentId, message, authorDid) {
    // First commit current state
    await this._commitDocument(documentId);

    // Increment version counter
    const version = (this._versionCounters.get(documentId) || 0) + 1;
    this._versionCounters.set(documentId, version);

    // Create Git tag
    const tagName = `collab/${documentId}/v${version}`;

    if (this.gitManager) {
      try {
        const git = require("isomorphic-git");
        const fs = require("fs");
        const repoPath =
          this.gitManager.repoPath || this.gitManager.config?.repoPath;

        if (repoPath) {
          const head = await git.resolveRef({ fs, dir: repoPath, ref: "HEAD" });
          await git.tag({
            fs,
            dir: repoPath,
            ref: tagName,
            object: head,
          });
        }
      } catch (error) {
        logger.warn(`[CollabGitIntegration] Git tag failed:`, error.message);
      }
    }

    // Get Yjs state vector for snapshot
    const stateVector = this.yjsEngine?.getStateVector(documentId);
    const contentHash = require("crypto")
      .createHash("sha256")
      .update(this.yjsEngine?.getMarkdown(documentId) || "")
      .digest("hex")
      .slice(0, 16);

    // Save snapshot to database
    const snapshotId = uuidv4();
    if (this.db) {
      const roomId =
        this.sessionManager?._findRoomForDocument(documentId) || "";
      this.db.run(
        `INSERT INTO collab_version_snapshots
         (id, room_id, document_id, version, git_tag, content_hash, author_did, message, yjs_state_vector)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshotId,
          roomId,
          documentId,
          version,
          tagName,
          contentHash,
          authorDid,
          message,
          stateVector ? Buffer.from(stateVector).toString("base64") : null,
        ],
      );
    }

    const snapshot = {
      id: snapshotId,
      documentId,
      version,
      gitTag: tagName,
      contentHash,
      authorDid,
      message,
      createdAt: Date.now(),
    };

    logger.info(
      `[CollabGitIntegration] Created snapshot v${version} for ${documentId}`,
    );
    this.emit("git:snapshot-created", snapshot);

    return snapshot;
  }

  /**
   * Get version snapshots for a document
   * @param {string} documentId
   * @returns {Array}
   */
  getVersionSnapshots(documentId) {
    if (!this.db) {
      return [];
    }

    try {
      return this.db.all(
        `SELECT * FROM collab_version_snapshots WHERE document_id = ? ORDER BY version DESC`,
        [documentId],
      );
    } catch (error) {
      return [];
    }
  }

  /**
   * Restore a document to a specific version snapshot
   * @param {string} documentId
   * @param {string} snapshotId
   */
  async restoreSnapshot(documentId, snapshotId) {
    if (!this.db) {
      throw new Error("Database not available");
    }

    const snapshot = this.db.get(
      `SELECT * FROM collab_version_snapshots WHERE id = ?`,
      [snapshotId],
    );

    if (!snapshot) {
      throw new Error("Snapshot not found");
    }

    // Restore from Git tag
    if (this.gitManager && snapshot.git_tag) {
      try {
        const git = require("isomorphic-git");
        const fs = require("fs");
        const path = require("path");
        const repoPath =
          this.gitManager.repoPath || this.gitManager.config?.repoPath;

        if (repoPath) {
          const tagOid = await git.resolveRef({
            fs,
            dir: repoPath,
            ref: snapshot.git_tag,
          });
          const commit = await git.readCommit({
            fs,
            dir: repoPath,
            oid: tagOid,
          });
          const tree = await git.readTree({
            fs,
            dir: repoPath,
            oid: commit.commit.tree,
          });

          // Find the document file in the tree
          for (const entry of tree.tree) {
            if (entry.path === `${documentId}.md`) {
              const blob = await git.readBlob({
                fs,
                dir: repoPath,
                oid: entry.oid,
              });
              const content = Buffer.from(blob.blob).toString("utf8");

              // Update Yjs document
              this.yjsEngine?.setMarkdown(documentId, content);

              logger.info(
                `[CollabGitIntegration] Restored ${documentId} to v${snapshot.version}`,
              );
              this.emit("git:snapshot-restored", {
                documentId,
                version: snapshot.version,
              });
              return { success: true };
            }
          }
        }
      } catch (error) {
        logger.error(`[CollabGitIntegration] Restore failed:`, error.message);
        throw error;
      }
    }

    return { success: false, error: "Could not restore snapshot" };
  }

  // ==========================================
  // Attribution
  // ==========================================

  /**
   * Get change attribution for a document
   * @param {string} documentId
   * @returns {Object}
   */
  _getAttribution(documentId) {
    const tracking = this._changeTracking.get(documentId);
    if (!tracking || tracking.size === 0) {
      return {
        authors: [],
        primaryAuthor: null,
        totalChanges: 0,
      };
    }

    const authors = Array.from(tracking.entries())
      .map(([did, count]) => ({ did, changeCount: count }))
      .sort((a, b) => b.changeCount - a.changeCount);

    return {
      authors,
      primaryAuthor: authors[0] || null,
      totalChanges: authors.reduce((sum, a) => sum + a.changeCount, 0),
    };
  }

  /**
   * Build a commit message with attribution
   */
  _buildCommitMessage(documentId, attribution) {
    let message = `collab: auto-commit for ${documentId}`;

    if (attribution.authors.length > 0) {
      const authorList = attribution.authors
        .slice(0, 3)
        .map((a) => a.did?.slice(0, 12) || "unknown")
        .join(", ");
      message += `\n\nAuthors: ${authorList}`;
      message += `\nTotal changes: ${attribution.totalChanges}`;
    }

    return message;
  }

  /**
   * Get Git integration statistics
   */
  getStats() {
    return {
      activeDocuments: this._commitTimers.size,
      trackedDocuments: this._changeTracking.size,
      autoCommitEnabled: this.config.autoCommitEnabled,
      commitInterval: this.config.commitInterval,
    };
  }

  /**
   * Destroy and clean up
   */
  destroy() {
    for (const [docId] of this._commitTimers) {
      this._stopAutoCommit(docId);
    }
    this._commitTimers.clear();
    this._changeTracking.clear();
    this._versionCounters.clear();
    this.removeAllListeners();
    logger.info("[CollabGitIntegration] Destroyed");
  }
}

module.exports = { CollabGitIntegration };
