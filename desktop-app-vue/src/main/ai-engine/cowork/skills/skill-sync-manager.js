/**
 * SkillSyncManager - Cross-device skill synchronization and migration
 *
 * Features:
 * - Export skills as transferable packages with checksum verification
 * - Import skill packages into the managed layer
 * - P2P sync via DataChannel messages (skill-catalog-*, skill-download-*)
 * - Conflict resolution: higher version wins; same version → newer timestamp wins
 *
 * @module ai-engine/cowork/skills/skill-sync-manager
 * @version 1.0.0
 */

const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { logger } = require("../../../utils/logger.js");

const SKILL_PACKAGE_FORMAT = "chainlesschain-skill-v1";

class SkillSyncManager extends EventEmitter {
  /**
   * @param {Object} options
   * @param {import('./skill-registry').SkillRegistry} options.skillRegistry
   * @param {Object} [options.mobileBridge] - MobileBridge instance for P2P sync
   * @param {string} [options.managedDir] - Path to managed skills directory
   */
  constructor(options = {}) {
    super();

    this.skillRegistry = options.skillRegistry;
    this.mobileBridge = options.mobileBridge || null;
    this.managedDir = options.managedDir || this._resolveManagedDir();

    // Sync state
    this.syncStatus = new Map(); // peerId -> { lastSync, skillCount }
    this._messageHandler = null;

    logger.info("[SkillSync] Initialized", { managedDir: this.managedDir });
  }

  /**
   * Export a skill as a transferable package
   * @param {string} skillId - Skill ID to export
   * @returns {Object} Skill package
   */
  exportSkill(skillId) {
    const skill = this.skillRegistry.getSkill(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    // Get skill definition (metadata + body)
    const definition = this.skillRegistry.getSkillDefinition(skillId);
    const metadata = {
      skillId: skill.skillId || skillId,
      name: skill.name || skillId,
      version: skill.version || "1.0.0",
      category: skill.category || "general",
      description: skill.description || "",
      source: skill.source || "unknown",
    };

    // Try to read handler.js if available
    let handler = null;
    const skillSources = this.skillRegistry.getSkillSources();
    if (skillSources) {
      for (const layer of ["workspace", "managed", "bundled"]) {
        const handlerPath = path.join(
          skillSources[layer] || "",
          skillId,
          "handler.js",
        );
        if (fs.existsSync(handlerPath)) {
          handler = fs.readFileSync(handlerPath, "utf-8");
          break;
        }
      }
    }

    // Try to read SKILL.md
    let body = null;
    if (definition && definition.rawContent) {
      body = definition.rawContent;
    } else if (skillSources) {
      for (const layer of ["workspace", "managed", "bundled"]) {
        const mdPath = path.join(
          skillSources[layer] || "",
          skillId,
          "SKILL.md",
        );
        if (fs.existsSync(mdPath)) {
          body = fs.readFileSync(mdPath, "utf-8");
          break;
        }
      }
    }

    const packageData = {
      format: SKILL_PACKAGE_FORMAT,
      metadata,
      body,
      handler,
      exportedAt: Date.now(),
      exportedFrom: this._getDeviceId(),
    };

    // Generate checksum
    const content = JSON.stringify({
      metadata: packageData.metadata,
      body: packageData.body,
      handler: packageData.handler,
    });
    packageData.checksum = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");

    this.emit("skill-exported", { skillId, checksum: packageData.checksum });
    logger.info(`[SkillSync] Exported skill: ${skillId}`);

    return packageData;
  }

  /**
   * Import a skill package into the managed layer
   * @param {Object} pkg - Skill package
   * @returns {Object} Import result
   */
  importSkill(pkg) {
    // Validate format
    if (!pkg || pkg.format !== SKILL_PACKAGE_FORMAT) {
      throw new Error("Invalid skill package format");
    }

    if (!pkg.metadata || !pkg.metadata.skillId) {
      throw new Error("Invalid skill package: missing metadata.skillId");
    }

    // Validate checksum
    const content = JSON.stringify({
      metadata: pkg.metadata,
      body: pkg.body,
      handler: pkg.handler,
    });
    const expectedChecksum = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");

    if (pkg.checksum !== expectedChecksum) {
      throw new Error(
        `Checksum mismatch: expected ${expectedChecksum}, got ${pkg.checksum}`,
      );
    }

    const skillId = pkg.metadata.skillId;

    // Check for conflicts
    const existing = this.skillRegistry.getSkill(skillId);
    if (existing) {
      const resolution = this._resolveConflict(existing, pkg.metadata);
      if (resolution === "keep-local") {
        logger.info(
          `[SkillSync] Keeping local version of ${skillId} (conflict resolved)`,
        );
        return { skillId, action: "skipped", reason: "local-version-newer" };
      }
    }

    // Write to managed directory
    const skillDir = path.join(this.managedDir, skillId);
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }

    // Write SKILL.md
    if (pkg.body) {
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), pkg.body, "utf-8");
    }

    // Write handler.js
    if (pkg.handler) {
      fs.writeFileSync(
        path.join(skillDir, "handler.js"),
        pkg.handler,
        "utf-8",
      );
    }

    // Hot-load into registry
    const definition = {
      skillId,
      name: pkg.metadata.name,
      version: pkg.metadata.version,
      category: pkg.metadata.category,
      description: pkg.metadata.description,
      source: "managed",
    };

    this.skillRegistry.hotLoadSkill(skillId, definition);

    this.emit("skill-imported", { skillId, from: pkg.exportedFrom });
    logger.info(`[SkillSync] Imported skill: ${skillId}`);

    return { skillId, action: "imported", version: pkg.metadata.version };
  }

  /**
   * Get local skill catalog for sync
   * @returns {Object[]} Catalog of local skills
   */
  getCatalog() {
    const skills = this.skillRegistry.getAllSkills
      ? this.skillRegistry.getAllSkills()
      : [];

    return skills.map((skill) => ({
      skillId: skill.skillId || skill.id,
      name: skill.name,
      version: skill.version || "1.0.0",
      category: skill.category || "general",
      source: skill.source || "unknown",
      updatedAt: skill.updatedAt || skill.createdAt || 0,
    }));
  }

  /**
   * Start listening for P2P skill sync messages
   */
  startP2PSync() {
    if (!this.mobileBridge) {
      logger.warn("[SkillSync] No MobileBridge available, P2P sync disabled");
      return;
    }

    this._messageHandler = ({ mobilePeerId, message }) => {
      this._handleP2PMessage(mobilePeerId, message);
    };
    this.mobileBridge.on("message-from-mobile", this._messageHandler);

    logger.info("[SkillSync] P2P sync started");
  }

  /**
   * Stop listening for P2P messages
   */
  stopP2PSync() {
    if (this._messageHandler && this.mobileBridge) {
      this.mobileBridge.off("message-from-mobile", this._messageHandler);
      this._messageHandler = null;
    }
    logger.info("[SkillSync] P2P sync stopped");
  }

  /**
   * Request skill catalog from a peer
   * @param {string} peerId
   */
  async requestPeerCatalog(peerId) {
    if (!this.mobileBridge) {
      throw new Error("MobileBridge not available");
    }
    await this.mobileBridge.sendToPeer(peerId, {
      type: "skill-catalog-request",
      payload: { requestedAt: Date.now() },
    });
  }

  /**
   * Download a skill from a peer
   * @param {string} peerId
   * @param {string} skillId
   */
  async downloadFromPeer(peerId, skillId) {
    if (!this.mobileBridge) {
      throw new Error("MobileBridge not available");
    }
    await this.mobileBridge.sendToPeer(peerId, {
      type: "skill-download-request",
      payload: { skillId },
    });
  }

  /**
   * Broadcast local catalog to all connected peers
   */
  async broadcastCatalog() {
    if (!this.mobileBridge) {
      throw new Error("MobileBridge not available");
    }

    const catalog = this.getCatalog();
    const peers = this.mobileBridge.getConnectedPeers
      ? this.mobileBridge.getConnectedPeers()
      : [];

    for (const peerId of peers) {
      try {
        await this.mobileBridge.sendToPeer(peerId, {
          type: "skill-catalog-response",
          payload: { catalog, deviceId: this._getDeviceId() },
        });
      } catch (err) {
        logger.warn(
          `[SkillSync] Failed to broadcast catalog to ${peerId}: ${err.message}`,
        );
      }
    }

    return { peersNotified: peers.length, skillCount: catalog.length };
  }

  /**
   * Manually resolve a conflict
   * @param {string} skillId
   * @param {'keep-local'|'use-remote'} resolution
   * @param {Object} [remotePkg] - Remote package if resolution is use-remote
   */
  resolveConflict(skillId, resolution, remotePkg = null) {
    if (resolution === "use-remote" && remotePkg) {
      return this.importSkill(remotePkg);
    }
    return { skillId, action: "kept-local" };
  }

  /**
   * Get sync status for all peers
   */
  getSyncStatus() {
    return {
      managedDir: this.managedDir,
      p2pEnabled: !!this.mobileBridge,
      peers: Object.fromEntries(this.syncStatus),
    };
  }

  // ===================================
  // Private Methods
  // ===================================

  /**
   * Handle incoming P2P skill sync messages
   * @private
   */
  _handleP2PMessage(peerId, message) {
    if (!message || !message.type) {return;}

    switch (message.type) {
      case "skill-catalog-request":
        this._handleCatalogRequest(peerId);
        break;

      case "skill-catalog-response":
        this._handleCatalogResponse(peerId, message.payload);
        break;

      case "skill-download-request":
        this._handleDownloadRequest(peerId, message.payload);
        break;

      case "skill-download-response":
        this._handleDownloadResponse(peerId, message.payload);
        break;

      case "skill-sync-notification":
        this._handleSyncNotification(peerId, message.payload);
        break;
    }
  }

  /**
   * @private
   */
  async _handleCatalogRequest(peerId) {
    logger.info(`[SkillSync] Catalog requested by peer: ${peerId}`);
    const catalog = this.getCatalog();
    try {
      await this.mobileBridge.sendToPeer(peerId, {
        type: "skill-catalog-response",
        payload: { catalog, deviceId: this._getDeviceId() },
      });
    } catch (err) {
      logger.error(
        `[SkillSync] Failed to send catalog to ${peerId}: ${err.message}`,
      );
    }
  }

  /**
   * @private
   */
  _handleCatalogResponse(peerId, payload) {
    logger.info(
      `[SkillSync] Received catalog from peer ${peerId}: ${payload?.catalog?.length || 0} skills`,
    );
    this.syncStatus.set(peerId, {
      lastSync: Date.now(),
      skillCount: payload?.catalog?.length || 0,
    });
    this.emit("peer-catalog-received", {
      peerId,
      catalog: payload?.catalog || [],
      deviceId: payload?.deviceId,
    });
  }

  /**
   * @private
   */
  async _handleDownloadRequest(peerId, payload) {
    const { skillId } = payload || {};
    logger.info(
      `[SkillSync] Download requested by ${peerId} for skill: ${skillId}`,
    );

    try {
      const pkg = this.exportSkill(skillId);
      await this.mobileBridge.sendToPeer(peerId, {
        type: "skill-download-response",
        payload: { package: pkg },
      });
    } catch (err) {
      logger.error(
        `[SkillSync] Failed to send skill ${skillId} to ${peerId}: ${err.message}`,
      );
      await this.mobileBridge.sendToPeer(peerId, {
        type: "skill-download-response",
        payload: { error: err.message, skillId },
      });
    }
  }

  /**
   * @private
   */
  _handleDownloadResponse(peerId, payload) {
    if (payload?.error) {
      logger.error(
        `[SkillSync] Download failed from ${peerId}: ${payload.error}`,
      );
      this.emit("download-failed", { peerId, error: payload.error });
      return;
    }

    if (payload?.package) {
      try {
        const result = this.importSkill(payload.package);
        this.emit("skill-downloaded", { peerId, result });
      } catch (err) {
        logger.error(
          `[SkillSync] Import failed from ${peerId}: ${err.message}`,
        );
        this.emit("download-failed", { peerId, error: err.message });
      }
    }
  }

  /**
   * @private
   */
  _handleSyncNotification(peerId, payload) {
    logger.info(
      `[SkillSync] Sync notification from ${peerId}: ${payload?.action} ${payload?.skillId}`,
    );
    this.emit("sync-notification", { peerId, ...payload });
  }

  /**
   * Resolve version conflict between local and remote skill
   * @private
   * @returns {'keep-local'|'use-remote'}
   */
  _resolveConflict(localSkill, remoteMeta) {
    const localVersion = localSkill.version || "0.0.0";
    const remoteVersion = remoteMeta.version || "0.0.0";

    const cmp = this._compareVersions(localVersion, remoteVersion);
    if (cmp > 0) {return "keep-local";}
    if (cmp < 0) {return "use-remote";}

    // Same version → compare timestamps
    const localTime = localSkill.updatedAt || localSkill.createdAt || 0;
    const remoteTime = remoteMeta.updatedAt || remoteMeta.exportedAt || 0;
    return remoteTime > localTime ? "use-remote" : "keep-local";
  }

  /**
   * Compare semver strings
   * @private
   * @returns {number} -1, 0, or 1
   */
  _compareVersions(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const va = pa[i] || 0;
      const vb = pb[i] || 0;
      if (va > vb) {return 1;}
      if (va < vb) {return -1;}
    }
    return 0;
  }

  /**
   * Resolve managed skills directory
   * @private
   */
  _resolveManagedDir() {
    try {
      const { app } = require("electron");
      return path.join(app.getPath("userData"), "skills");
    } catch {
      return path.join(
        process.env.APPDATA ||
          process.env.HOME ||
          process.cwd(),
        ".chainlesschain",
        "skills",
      );
    }
  }

  /**
   * Get a simple device identifier
   * @private
   */
  _getDeviceId() {
    const os = require("os");
    return `${os.hostname()}-${os.platform()}`;
  }
}

module.exports = { SkillSyncManager };
