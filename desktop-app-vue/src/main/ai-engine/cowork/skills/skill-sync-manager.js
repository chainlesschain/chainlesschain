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
const { SkillMdParser } = require("./skill-md-parser");
const {
  LOCK_FILENAME,
  canonicalJson,
  inspectSkillExecution,
  normalizeCapabilities,
  preflightSkillPath,
} = require("./skill-execution-security");

const SKILL_PACKAGE_FORMAT = "chainlesschain-skill-v2";
const MAX_SKILL_MD_BYTES = 256 * 1024;
const MAX_HANDLER_BYTES = 1024 * 1024;
const MAX_LOCK_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_PACKAGE_BYTES =
  MAX_SKILL_MD_BYTES + MAX_HANDLER_BYTES + MAX_LOCK_BYTES;

function validateSkillId(value) {
  const skillId = String(value || "");
  if (!/^[a-z][a-z0-9-]{0,127}$/.test(skillId)) {
    const error = new Error("Invalid skill package: unsafe metadata.skillId");
    error.code = "CC_SKILL_NAME_INVALID";
    throw error;
  }
  return skillId;
}

function assertBoundedText(name, value, maxBytes, { optional = false } = {}) {
  if (optional && value == null) return null;
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > maxBytes) {
    const error = new Error(`${name} exceeds the ${maxBytes}-byte limit`);
    error.code = "CC_SKILL_PACKAGE_TOO_LARGE";
    throw error;
  }
  return { value, bytes };
}

function assertBoundedJson(name, value, maxBytes) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  const serialized = JSON.stringify(value);
  assertBoundedText(name, serialized, maxBytes);
  return serialized;
}

function readStablePackageComponent(filePath, name, maxBytes) {
  const before = fs.lstatSync(filePath);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1 ||
    before.size > maxBytes
  ) {
    throw new Error(`${name} is unsafe or exceeds the export limit`);
  }
  const bytes = fs.readFileSync(filePath);
  const after = fs.lstatSync(filePath);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino ||
    bytes.length > maxBytes
  ) {
    throw new Error(`${name} changed while it was being exported`);
  }
  return bytes;
}

function writeSafePackageComponent(filePath, content) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let descriptor;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | noFollow,
      0o600,
    );
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error(`${path.basename(filePath)} import target is unsafe`);
    }
    fs.ftruncateSync(descriptor, 0);
    fs.writeFileSync(descriptor, content, { encoding: "utf8" });
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function packageChecksum(pkg) {
  const content = canonicalJson({
    format: pkg.format,
    metadata: pkg.metadata,
    body: pkg.body,
    handler: pkg.handler,
    signatureLock: pkg.signatureLock || null,
  });
  return crypto.createHash("sha256").update(content).digest("hex");
}

function isContained(root, target) {
  const relative = path.relative(root, target);
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

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
    skillId = validateSkillId(skillId);
    const skill = this.skillRegistry.getSkill(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    const definition = skill.getDefinition?.();
    if (!definition?.sourcePath || definition.sourcePath === "unknown") {
      throw new Error(
        `Skill is not backed by an exportable SKILL.md: ${skillId}`,
      );
    }
    const skillDir = path.dirname(path.resolve(definition.sourcePath));
    const preflight = preflightSkillPath(skillDir, skillDir);
    const bodyBuffer = readStablePackageComponent(
      preflight.skillMdRealPath,
      "SKILL.md",
      MAX_SKILL_MD_BYTES,
    );
    const body = bodyBuffer.toString("utf8");
    const parsedDefinition = new SkillMdParser({
      strictValidation: true,
    }).parseContent(body, preflight.skillMdRealPath);
    if (parsedDefinition.name !== skillId) {
      throw new Error("Skill identity differs from its SKILL.md name");
    }

    let handler = null;
    let signatureLock = null;
    if (parsedDefinition.handler) {
      const inspection = inspectSkillExecution(
        { ...parsedDefinition, source: skill.source || definition.source },
        { allowedRoot: preflight.skillRealPath },
      );
      const handlerBuffer = fs.readFileSync(inspection.handlerRealPath);
      const handlerDigest = crypto
        .createHash("sha256")
        .update(handlerBuffer)
        .digest("hex");
      if (
        handlerBuffer.length > MAX_HANDLER_BYTES ||
        handlerDigest !==
          inspection.componentDigests[inspection.handlerRelativePath] ||
        crypto.createHash("sha256").update(bodyBuffer).digest("hex") !==
          inspection.componentDigests["SKILL.md"]
      ) {
        throw new Error(
          "Skill components changed while they were being exported",
        );
      }
      handler = handlerBuffer.toString("utf8");
      const lockPath = path.join(preflight.skillRealPath, LOCK_FILENAME);
      if (fs.existsSync(lockPath)) {
        signatureLock = JSON.parse(
          readStablePackageComponent(
            lockPath,
            LOCK_FILENAME,
            MAX_LOCK_BYTES,
          ).toString("utf8"),
        );
      }
    }

    const metadata = {
      skillId,
      name: skill.name || skillId,
      version: parsedDefinition.version || "1.0.0",
      category: skill.category || "general",
      description: skill.description || "",
      source: skill.source || "unknown",
      executionCapabilities: parsedDefinition.executionCapabilities || [],
    };
    assertBoundedJson("skill metadata", metadata, MAX_METADATA_BYTES);

    const packageData = {
      format: SKILL_PACKAGE_FORMAT,
      metadata,
      body,
      handler,
      signatureLock,
      exportedAt: Date.now(),
      exportedFrom: this._getDeviceId(),
    };

    packageData.checksum = packageChecksum(packageData);

    this.emit("skill-exported", { skillId, checksum: packageData.checksum });
    logger.info(`[SkillSync] Exported skill: ${skillId}`);

    return packageData;
  }

  /**
   * Import a skill package into the managed layer
   * @param {Object} pkg - Skill package
   * @returns {Object} Import result
   */
  async importSkill(pkg) {
    // Validate format
    if (!pkg || pkg.format !== SKILL_PACKAGE_FORMAT) {
      throw new Error("Invalid skill package format");
    }

    if (!pkg.metadata || !pkg.metadata.skillId) {
      throw new Error("Invalid skill package: missing metadata.skillId");
    }

    assertBoundedJson("skill metadata", pkg.metadata, MAX_METADATA_BYTES);
    const skillId = validateSkillId(pkg.metadata.skillId);
    const body = assertBoundedText("SKILL.md", pkg.body, MAX_SKILL_MD_BYTES);
    const handler = assertBoundedText(
      "handler.js",
      pkg.handler,
      MAX_HANDLER_BYTES,
      { optional: true },
    );
    let signatureLockText = null;
    if (pkg.signatureLock != null) {
      assertBoundedJson(
        "skill signature lock",
        pkg.signatureLock,
        MAX_LOCK_BYTES,
      );
      signatureLockText = JSON.stringify(pkg.signatureLock, null, 2);
      assertBoundedText(LOCK_FILENAME, signatureLockText, MAX_LOCK_BYTES);
    }
    const packageBytes =
      body.bytes +
      (handler?.bytes || 0) +
      Buffer.byteLength(signatureLockText || "", "utf8");
    if (packageBytes > MAX_PACKAGE_BYTES) {
      const error = new Error("Skill package exceeds the total byte limit");
      error.code = "CC_SKILL_PACKAGE_TOO_LARGE";
      throw error;
    }

    const parser = new SkillMdParser({ strictValidation: true });
    const plannedSourcePath = path.join(this.managedDir, skillId, "SKILL.md");
    const parsedDefinition = parser.parseContent(body.value, plannedSourcePath);
    if (parsedDefinition.name !== skillId) {
      throw new Error("Skill package identity does not match SKILL.md");
    }
    if (String(pkg.metadata.version || "") !== parsedDefinition.version) {
      throw new Error("Skill package version does not match SKILL.md");
    }
    if (parsedDefinition.handler) {
      if (parsedDefinition.handler !== "./handler.js" || !handler) {
        throw new Error(
          "Executable skill packages must contain the declared ./handler.js",
        );
      }
      const capabilities = normalizeCapabilities(
        parsedDefinition.executionCapabilities,
      );
      if (!capabilities.valid) {
        throw new Error(
          `Executable skill package has an invalid capability manifest: ${capabilities.reason}`,
        );
      }
    } else if (handler) {
      throw new Error("Skill package contains an undeclared handler.js");
    }
    if (!parsedDefinition.handler && signatureLockText) {
      throw new Error(
        "Documentation-only skill package contains a signature lock",
      );
    }

    const expectedChecksum = packageChecksum(pkg);

    if (
      typeof pkg.checksum !== "string" ||
      !/^[a-f0-9]{64}$/.test(pkg.checksum) ||
      !crypto.timingSafeEqual(
        Buffer.from(pkg.checksum, "hex"),
        Buffer.from(expectedChecksum, "hex"),
      )
    ) {
      throw new Error(
        `Checksum mismatch: expected ${expectedChecksum}, got ${pkg.checksum}`,
      );
    }

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

    const managedRoot = path.resolve(this.managedDir);
    fs.mkdirSync(managedRoot, { recursive: true, mode: 0o700 });
    const managedRootRealPath = fs.realpathSync(managedRoot);
    const skillDir = path.resolve(managedRootRealPath, skillId);
    if (!isContained(managedRootRealPath, skillDir)) {
      const error = new Error("Skill import path escapes the managed root");
      error.code = "CC_SKILL_ROOT_ESCAPE";
      throw error;
    }
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true, mode: 0o700 });
    }
    const existingTarget = fs.lstatSync(skillDir);
    if (existingTarget.isSymbolicLink() || !existingTarget.isDirectory()) {
      throw new Error("Managed skill target must be a non-symlink directory");
    }
    const targetRealPath = fs.realpathSync(skillDir);
    if (!isContained(managedRootRealPath, targetRealPath)) {
      throw new Error("Managed skill target escapes the managed root");
    }

    for (const component of ["SKILL.md", "handler.js", LOCK_FILENAME]) {
      const componentPath = path.join(skillDir, component);
      if (!fs.existsSync(componentPath)) continue;
      const componentStat = fs.lstatSync(componentPath);
      if (
        componentStat.isSymbolicLink() ||
        !componentStat.isFile() ||
        componentStat.nlink !== 1
      ) {
        throw new Error(`${component} import target is unsafe`);
      }
    }

    // Write SKILL.md
    writeSafePackageComponent(path.join(skillDir, "SKILL.md"), body.value);

    // Write handler.js
    if (handler) {
      writeSafePackageComponent(
        path.join(skillDir, "handler.js"),
        handler.value,
      );
    }
    if (signatureLockText) {
      writeSafePackageComponent(
        path.join(skillDir, LOCK_FILENAME),
        signatureLockText,
      );
    }

    // An import replaces the authoritative package components. Remove stale
    // executable material that is absent from the incoming package.
    for (const [component, present] of [
      ["handler.js", Boolean(handler)],
      [LOCK_FILENAME, Boolean(signatureLockText)],
    ]) {
      const componentPath = path.join(skillDir, component);
      if (!present && fs.existsSync(componentPath)) {
        fs.unlinkSync(componentPath);
      }
    }

    const importedSourcePath = path.join(skillDir, "SKILL.md");
    preflightSkillPath(skillDir, skillDir);
    if (parsedDefinition.handler) {
      inspectSkillExecution(
        {
          ...parsedDefinition,
          source: "managed",
          sourcePath: importedSourcePath,
        },
        { allowedRoot: skillDir },
      );
    }

    let hotLoaded = false;
    if (this.skillRegistry?._loader?.loadSingleSkill) {
      const definition = await this.skillRegistry._loader.loadSingleSkill(
        skillDir,
        "managed",
        managedRootRealPath,
      );
      if (!definition) {
        throw new Error("Imported skill failed loader security validation");
      }
      hotLoaded = this.skillRegistry.hotLoadSkill(skillId, definition) === true;
    }

    this.emit("skill-imported", { skillId, from: pkg.exportedFrom });
    logger.info(`[SkillSync] Imported skill: ${skillId}`);

    return {
      skillId,
      action: "imported",
      version: pkg.metadata.version,
      hotLoaded,
      reloadRequired: !hotLoaded,
    };
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
  async resolveConflict(skillId, resolution, remotePkg = null) {
    if (resolution === "use-remote" && remotePkg) {
      return await this.importSkill(remotePkg);
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
    if (!message || !message.type) {
      return;
    }

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
  async _handleDownloadResponse(peerId, payload) {
    if (payload?.error) {
      logger.error(
        `[SkillSync] Download failed from ${peerId}: ${payload.error}`,
      );
      this.emit("download-failed", { peerId, error: payload.error });
      return;
    }

    if (payload?.package) {
      try {
        const result = await this.importSkill(payload.package);
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
    if (cmp > 0) {
      return "keep-local";
    }
    if (cmp < 0) {
      return "use-remote";
    }

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
      if (va > vb) {
        return 1;
      }
      if (va < vb) {
        return -1;
      }
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
        process.env.APPDATA || process.env.HOME || process.cwd(),
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

module.exports = {
  SkillSyncManager,
  SKILL_PACKAGE_FORMAT,
  calculateSkillPackageChecksum: packageChecksum,
};
