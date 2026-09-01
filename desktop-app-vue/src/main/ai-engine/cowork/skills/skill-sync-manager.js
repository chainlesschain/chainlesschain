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
const MAX_EXPORTED_FROM_BYTES = 256;
const MAX_EXPORT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CANDIDATE_RECORD_SCHEMA = "chainlesschain.skill-sync-candidate/v1";
const CANDIDATE_RECORD_VERSION = 1;
const CANDIDATE_RECEIPT_KEYS = new Set([
  "schema",
  "version",
  "candidateId",
  "status",
  "persisted",
  "skillId",
  "sourceDigest",
  "derivationMode",
  "trust",
  "quarantined",
]);
const CANDIDATE_RECORD_KEYS = new Set([
  ...CANDIDATE_RECEIPT_KEYS,
  "sourceEvidence",
  "package",
]);
const SOURCE_EVIDENCE_KEYS = new Set(["ref", "digest"]);
const CANDIDATE_PACKAGE_KEYS = new Set([
  "format",
  "metadata",
  "body",
  "handler",
  "signatureLock",
  "checksum",
  "exportedAt",
  "exportedFrom",
]);
const CANDIDATE_DERIVATION_MODE = "manual-import";
const CANDIDATE_TRUST = "untrusted";

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
  if (optional && value == null) {
    return null;
  }
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

function syncError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertOwnDataFields(value, fields, name, { exact = false } = {}) {
  if (!isPlainObject(value)) {
    throw syncError(
      "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
      `${name} must be a plain object`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== "string") ||
    (exact &&
      (ownKeys.length !== fields.size ||
        ownKeys.some((key) => !fields.has(key))))
  ) {
    throw syncError(
      "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
      `${name} has an invalid schema`,
    );
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw syncError(
        "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
        `${name}.${field} must be an enumerable own data property`,
      );
    }
  }
}

function cloneJsonObject(value, serialized) {
  return JSON.parse(serialized || JSON.stringify(value));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

function normalizeExportedAt(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > Date.now() + MAX_EXPORT_CLOCK_SKEW_MS
  ) {
    throw syncError(
      "CC_SKILL_SYNC_SOURCE_INVALID",
      "Invalid skill package: exportedAt must be a bounded timestamp",
    );
  }
  return value;
}

function normalizeExportedFrom(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > MAX_EXPORTED_FROM_BYTES ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint < 0x20 || codePoint === 0x7f;
    })
  ) {
    throw syncError(
      "CC_SKILL_SYNC_SOURCE_INVALID",
      "Invalid skill package: exportedFrom is not a bounded device identifier",
    );
  }
  return value;
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

function packageEnvelopeDigest(pkg) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(
      canonicalJson({
        format: pkg.format,
        metadata: pkg.metadata,
        body: pkg.body,
        handler: pkg.handler,
        signatureLock: pkg.signatureLock || null,
        checksum: pkg.checksum,
        exportedAt: pkg.exportedAt ?? null,
        exportedFrom: pkg.exportedFrom ?? null,
      }),
    )
    .digest("hex")}`;
}

function validateCandidateReceipt(receipt, expected) {
  assertOwnDataFields(
    receipt,
    CANDIDATE_RECEIPT_KEYS,
    "candidate create receipt",
    { exact: true },
  );
  if (
    typeof receipt.candidateId !== "string" ||
    !DIGEST_PATTERN.test(receipt.candidateId)
  ) {
    throw syncError(
      "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
      "candidate create receipt has an invalid candidateId",
    );
  }
  for (const [field, value] of Object.entries(expected)) {
    if (receipt[field] !== value) {
      throw syncError(
        "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
        `candidate create receipt is not bound to ${field}`,
      );
    }
  }
  return receipt.candidateId;
}

function validateCandidateReadback(record, receipt, createRequest) {
  assertOwnDataFields(record, CANDIDATE_RECORD_KEYS, "candidate readback", {
    exact: true,
  });
  for (const field of CANDIDATE_RECEIPT_KEYS) {
    if (record[field] !== receipt[field]) {
      throw syncError(
        "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
        `candidate readback is not bound to ${field}`,
      );
    }
  }
  assertOwnDataFields(
    record.package,
    CANDIDATE_PACKAGE_KEYS,
    "candidate readback package",
    { exact: true },
  );
  assertOwnDataFields(
    record.sourceEvidence,
    SOURCE_EVIDENCE_KEYS,
    "candidate readback source evidence",
    { exact: true },
  );
  const readbackDigest = packageEnvelopeDigest(record.package);
  if (
    readbackDigest !== receipt.sourceDigest ||
    canonicalJson(record.package) !== canonicalJson(createRequest.package) ||
    canonicalJson(record.sourceEvidence) !==
      canonicalJson(createRequest.sourceEvidence)
  ) {
    throw syncError(
      "CC_SKILL_SYNC_CANDIDATE_PERSISTENCE_FAILED",
      "candidate readback package does not match its canonical source digest",
    );
  }
}

class SkillSyncManager extends EventEmitter {
  /**
   * @param {Object} options
   * @param {import('./skill-registry').SkillRegistry} options.skillRegistry
   * @param {Object} [options.mobileBridge] - MobileBridge instance for P2P sync
   * @param {string} [options.managedDir] - Path to managed skills directory
   * @param {{create: Function, read: Function}} [options.candidateStore]
   * Host-owned durable candidate-only store. It has no active-layer authority.
   */
  constructor(options = {}) {
    super();

    this.skillRegistry = options.skillRegistry;
    this.mobileBridge = options.mobileBridge || null;
    this.managedDir = options.managedDir || this._resolveManagedDir();
    this.candidateStore =
      options.candidateStore &&
      typeof options.candidateStore.create === "function" &&
      typeof options.candidateStore.read === "function"
        ? options.candidateStore
        : null;

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
   * Validate an imported package and persist it through the host-owned
   * candidate boundary. Sync peers and IPC callers never receive active-layer
   * write authority from this class.
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

    const metadataText = assertBoundedJson(
      "skill metadata",
      pkg.metadata,
      MAX_METADATA_BYTES,
    );
    const normalizedMetadata = cloneJsonObject(pkg.metadata, metadataText);
    const skillId = validateSkillId(normalizedMetadata.skillId);
    const exportedAt = normalizeExportedAt(pkg.exportedAt);
    const exportedFrom = normalizeExportedFrom(pkg.exportedFrom);
    const body = assertBoundedText("SKILL.md", pkg.body, MAX_SKILL_MD_BYTES);
    const handler = assertBoundedText(
      "handler.js",
      pkg.handler,
      MAX_HANDLER_BYTES,
      { optional: true },
    );
    let signatureLockText = null;
    let normalizedSignatureLock = null;
    if (pkg.signatureLock != null) {
      const serializedSignatureLock = assertBoundedJson(
        "skill signature lock",
        pkg.signatureLock,
        MAX_LOCK_BYTES,
      );
      normalizedSignatureLock = cloneJsonObject(
        pkg.signatureLock,
        serializedSignatureLock,
      );
      signatureLockText = JSON.stringify(normalizedSignatureLock, null, 2);
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
    if (String(normalizedMetadata.version || "") !== parsedDefinition.version) {
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

    const expectedChecksum = packageChecksum({
      format: SKILL_PACKAGE_FORMAT,
      metadata: normalizedMetadata,
      body: body.value,
      handler: handler?.value || null,
      signatureLock: normalizedSignatureLock,
    });

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
      const resolution = this._resolveConflict(existing, {
        metadata: normalizedMetadata,
        exportedAt,
      });
      if (resolution === "keep-local") {
        logger.info(
          `[SkillSync] Keeping local version of ${skillId} (conflict resolved)`,
        );
        return {
          skillId,
          action: "skipped",
          reason: "local-version-newer",
          candidateOnly: true,
          persisted: false,
          activeMutation: false,
          hotLoaded: false,
          reloadRequired: false,
        };
      }
    }

    if (!this.candidateStore) {
      const error = new Error(
        "Skill sync candidate store is unavailable; active import is denied",
      );
      error.code = "CC_SKILL_SYNC_CANDIDATE_STORE_UNAVAILABLE";
      throw error;
    }

    const candidatePackage = deepFreeze({
      format: SKILL_PACKAGE_FORMAT,
      metadata: normalizedMetadata,
      body: body.value,
      handler: handler?.value || null,
      signatureLock: normalizedSignatureLock,
      checksum: expectedChecksum,
      exportedAt,
      exportedFrom,
    });
    const sourceDigest = packageEnvelopeDigest(candidatePackage);
    const expectedReceipt = Object.freeze({
      schema: CANDIDATE_RECORD_SCHEMA,
      version: CANDIDATE_RECORD_VERSION,
      status: "draft",
      persisted: true,
      skillId,
      sourceDigest,
      derivationMode: CANDIDATE_DERIVATION_MODE,
      trust: CANDIDATE_TRUST,
      quarantined: true,
    });
    const createRequest = deepFreeze({
      ...expectedReceipt,
      sourceEvidence: {
        ref: `skill-sync://${encodeURIComponent(exportedFrom)}/${skillId}`,
        digest: sourceDigest,
      },
      package: candidatePackage,
    });
    const receipt = await this.candidateStore.create(createRequest);
    const candidateId = validateCandidateReceipt(receipt, expectedReceipt);
    const readback = await this.candidateStore.read(candidateId);
    validateCandidateReadback(readback, receipt, createRequest);

    this.emit("skill-candidate-staged", {
      skillId,
      candidateId,
      from: exportedFrom,
      trust: CANDIDATE_TRUST,
      quarantined: true,
    });
    logger.info(`[SkillSync] Staged skill candidate: ${skillId}`);

    return {
      skillId,
      action: "candidate-staged",
      version: normalizedMetadata.version,
      candidateId,
      sourceDigest,
      candidateOnly: true,
      persisted: true,
      trust: CANDIDATE_TRUST,
      quarantined: true,
      activeMutation: false,
      hotLoaded: false,
      reloadRequired: false,
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
    const normalizedSkillId = validateSkillId(skillId);
    if (resolution !== "keep-local" && resolution !== "use-remote") {
      throw syncError(
        "CC_SKILL_SYNC_CONFLICT_RESOLUTION_INVALID",
        "resolution must be keep-local or use-remote",
      );
    }
    if (resolution === "use-remote") {
      if (!remotePkg || !remotePkg.metadata) {
        throw syncError(
          "CC_SKILL_SYNC_CONFLICT_PACKAGE_REQUIRED",
          "use-remote requires a remote skill package",
        );
      }
      const remoteSkillId = validateSkillId(remotePkg.metadata.skillId);
      if (remoteSkillId !== normalizedSkillId) {
        throw syncError(
          "CC_SKILL_SYNC_CONFLICT_IDENTITY_MISMATCH",
          "remote package identity does not match the conflict skillId",
        );
      }
      return await this.importSkill(remotePkg);
    }
    return {
      skillId: normalizedSkillId,
      action: "kept-local",
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
    };
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
        if (result.action === "candidate-staged") {
          this.emit("skill-download-candidate-staged", { peerId, result });
        } else if (result.action === "skipped") {
          this.emit("skill-download-skipped", { peerId, result });
        } else {
          throw syncError(
            "CC_SKILL_SYNC_IMPORT_RESULT_INVALID",
            "Skill download produced an unsupported import outcome",
          );
        }
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
  _resolveConflict(localSkill, remotePkg) {
    const localVersion = localSkill.version || "0.0.0";
    const remoteVersion = remotePkg.metadata.version || "0.0.0";

    const cmp = this._compareVersions(localVersion, remoteVersion);
    if (cmp > 0) {
      return "keep-local";
    }
    if (cmp < 0) {
      return "use-remote";
    }

    // Same version → compare timestamps
    const localTime = localSkill.updatedAt || localSkill.createdAt || 0;
    const remoteTime = remotePkg.exportedAt;
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
