/**
 * Agent DID (Decentralized Identifier) Manager — v4.0
 *
 * Creates and manages W3C DID-compliant decentralized identifiers for
 * autonomous agents in the ChainlessChain network.  Each agent receives
 * a `did:chainless:{uuid}` identifier bound to an Ed25519 key pair,
 * enabling verifiable identity, capability delegation, and cross-org
 * authentication.
 *
 * Key features:
 * - Ed25519-simulated key pair generation via Node crypto
 * - DID document resolution (W3C DID Core v1.0 structure)
 * - Capability-based access control per agent
 * - Challenge-response authentication (sign / verify)
 * - Credential binding (links to AgentCredentialManager)
 * - Status lifecycle: active → suspended ↔ active → revoked (terminal)
 *
 * @module ai-engine/cowork/agent-did
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

// ============================================================
// Constants
// ============================================================

const DID_STATUS = {
  ACTIVE: "active",
  REVOKED: "revoked",
  SUSPENDED: "suspended",
};

const DID_METHOD = "did:chainless";

const DEFAULT_CAPABILITIES = ["agent:communicate", "agent:discover"];

const DEFAULT_CONFIG = {
  keyAlgorithm: "ed25519",
  defaultCapabilities: [...DEFAULT_CAPABILITIES],
  maxDIDsPerOrganization: 1000,
  challengeExpiryMs: 300000, // 5 minutes
  autoSuspendOnFailedAuth: 5,
};

// ============================================================
// AgentDID Class
// ============================================================

class AgentDID extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this.config = { ...DEFAULT_CONFIG };

    // In-memory caches
    this._didCache = new Map(); // did string → record
    this._pendingChallenges = new Map(); // challengeId → { did, challenge, createdAt }
    this._failedAuthCounts = new Map(); // did → count

    // Statistics
    this.stats = {
      totalDIDs: 0,
      activeDIDs: 0,
      revokedDIDs: 0,
      suspendedDIDs: 0,
      challengesIssued: 0,
      challengesVerified: 0,
      challengesFailed: 0,
    };
  }

  /**
   * Initialize with database and optional dependencies
   * @param {Object} db - Database manager (better-sqlite3 compatible)
   * @param {Object} deps - Optional dependencies
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this.credentialManager = deps.credentialManager || null;

    this._ensureTables();
    this._loadCacheFromDB();
    this._startChallengeCleanup();

    this.initialized = true;
    logger.info(
      `[AgentDID] Initialized with ${this.stats.totalDIDs} DIDs (${this.stats.activeDIDs} active)`,
    );
  }

  // ============================================================
  // Table Setup
  // ============================================================

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS agent_dids (
          id TEXT PRIMARY KEY,
          did TEXT UNIQUE NOT NULL,
          display_name TEXT,
          capabilities TEXT DEFAULT '[]',
          public_key TEXT NOT NULL,
          private_key_encrypted TEXT NOT NULL,
          organization TEXT,
          status TEXT DEFAULT 'active',
          credential_ids TEXT DEFAULT '[]',
          metadata TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_agent_dids_did ON agent_dids(did);
        CREATE INDEX IF NOT EXISTS idx_agent_dids_status ON agent_dids(status);
        CREATE INDEX IF NOT EXISTS idx_agent_dids_org ON agent_dids(organization);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[AgentDID] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Cache Management
  // ============================================================

  _loadCacheFromDB() {
    if (!this.db) {
      return;
    }
    try {
      const rows = this.db.prepare("SELECT * FROM agent_dids").all();

      let active = 0;
      let revoked = 0;
      let suspended = 0;

      for (const row of rows) {
        const record = this._rowToRecord(row);
        this._didCache.set(record.did, record);

        if (record.status === DID_STATUS.ACTIVE) {
          active++;
        } else if (record.status === DID_STATUS.REVOKED) {
          revoked++;
        } else if (record.status === DID_STATUS.SUSPENDED) {
          suspended++;
        }
      }

      this.stats.totalDIDs = rows.length;
      this.stats.activeDIDs = active;
      this.stats.revokedDIDs = revoked;
      this.stats.suspendedDIDs = suspended;
    } catch (e) {
      logger.warn("[AgentDID] Cache load error:", e.message);
    }
  }

  // ============================================================
  // DID Creation
  // ============================================================

  /**
   * Create a new DID for an agent
   * @param {Object} options - { displayName, capabilities, organization, metadata }
   * @returns {Object} Created DID record (public fields only)
   */
  createDID(options = {}) {
    const id = uuidv4();
    const didId = uuidv4().replace(/-/g, "");
    const did = `${DID_METHOD}:${didId}`;
    const now = new Date().toISOString();

    // Generate key pair (Ed25519 simulation via crypto)
    const { publicKey, privateKey } = this._generateKeyPair();

    // Encrypt private key for storage
    const privateKeyEncrypted = this._encryptPrivateKey(privateKey);

    // Merge capabilities
    const capabilities = Array.isArray(options.capabilities)
      ? [
          ...new Set([
            ...this.config.defaultCapabilities,
            ...options.capabilities,
          ]),
        ]
      : [...this.config.defaultCapabilities];

    // Check organization limits
    if (options.organization) {
      const orgCount = this._countByOrganization(options.organization);
      if (orgCount >= this.config.maxDIDsPerOrganization) {
        throw new Error(
          `Organization "${options.organization}" has reached the maximum DID limit (${this.config.maxDIDsPerOrganization})`,
        );
      }
    }

    const record = {
      id,
      did,
      displayName: options.displayName || `Agent-${didId.slice(0, 8)}`,
      capabilities,
      publicKey,
      privateKeyEncrypted,
      organization: options.organization || null,
      status: DID_STATUS.ACTIVE,
      credentialIds: [],
      metadata: options.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    // Persist to DB
    this._persistDID(record);

    // Update cache
    this._didCache.set(did, record);
    this.stats.totalDIDs++;
    this.stats.activeDIDs++;

    this.emit("did:created", {
      did,
      displayName: record.displayName,
      organization: record.organization,
    });
    logger.info(`[AgentDID] Created DID: ${did} (${record.displayName})`);

    return this._toPublicRecord(record);
  }

  /**
   * Create a DID with specific capabilities for a role
   * @param {string} role - Role name (e.g., "coordinator", "worker", "reviewer")
   * @param {Object} options - Additional options
   * @returns {Object} Created DID record
   */
  createDIDForRole(role, options = {}) {
    const roleCapabilities = {
      coordinator: [
        "agent:communicate",
        "agent:discover",
        "agent:delegate",
        "agent:orchestrate",
        "task:assign",
        "task:review",
      ],
      worker: [
        "agent:communicate",
        "agent:discover",
        "task:execute",
        "task:report",
      ],
      reviewer: [
        "agent:communicate",
        "agent:discover",
        "task:review",
        "task:approve",
        "task:reject",
      ],
      observer: ["agent:communicate", "agent:discover", "task:read"],
      admin: [
        "agent:communicate",
        "agent:discover",
        "agent:delegate",
        "agent:orchestrate",
        "agent:manage",
        "task:assign",
        "task:execute",
        "task:review",
        "task:approve",
        "task:reject",
        "did:manage",
      ],
    };

    const caps = roleCapabilities[role] || DEFAULT_CAPABILITIES;
    return this.createDID({
      ...options,
      displayName: options.displayName || `${role}-${uuidv4().slice(0, 8)}`,
      capabilities: [...caps, ...(options.capabilities || [])],
      metadata: { ...options.metadata, role },
    });
  }

  // ============================================================
  // DID Resolution
  // ============================================================

  /**
   * Resolve a DID to its document
   * @param {string} did - DID string (did:chainless:...)
   * @returns {Object|null} DID document (W3C DID Core structure) or null
   */
  resolveDID(did) {
    if (!did || typeof did !== "string") {
      return null;
    }

    // Check cache first
    const cached = this._didCache.get(did);
    if (cached) {
      return this._buildDIDDocument(cached);
    }

    // Fallback to DB
    try {
      const row = this.db
        .prepare("SELECT * FROM agent_dids WHERE did = ?")
        .get(did);
      if (!row) {
        return null;
      }
      const record = this._rowToRecord(row);
      this._didCache.set(did, record);
      return this._buildDIDDocument(record);
    } catch (e) {
      logger.error("[AgentDID] resolveDID error:", e.message);
      return null;
    }
  }

  /**
   * Build a W3C-style DID Document
   * @param {Object} record - Internal record
   * @returns {Object} DID Document
   */
  _buildDIDDocument(record) {
    return {
      "@context": ["https://www.w3.org/ns/did/v1"],
      id: record.did,
      controller: record.did,
      verificationMethod: [
        {
          id: `${record.did}#keys-1`,
          type: "Ed25519VerificationKey2020",
          controller: record.did,
          publicKeyBase64: record.publicKey,
        },
      ],
      authentication: [`${record.did}#keys-1`],
      assertionMethod: [`${record.did}#keys-1`],
      service: [
        {
          id: `${record.did}#agent-service`,
          type: "AgentService",
          serviceEndpoint: {
            capabilities: record.capabilities,
            organization: record.organization,
            displayName: record.displayName,
          },
        },
      ],
      metadata: {
        status: record.status,
        created: record.createdAt,
        updated: record.updatedAt,
        credentialIds: record.credentialIds,
      },
    };
  }

  // ============================================================
  // DID Queries
  // ============================================================

  /**
   * Get all DIDs with optional filter
   * @param {Object} filter - { status, organization, capability, limit, offset }
   * @returns {Array} Matching DID records (public fields)
   */
  getAllDIDs(filter = {}) {
    try {
      let query = "SELECT * FROM agent_dids WHERE 1=1";
      const params = [];

      if (filter.status) {
        query += " AND status = ?";
        params.push(filter.status);
      }
      if (filter.organization) {
        query += " AND organization = ?";
        params.push(filter.organization);
      }

      query += " ORDER BY created_at DESC";

      if (filter.limit) {
        query += " LIMIT ?";
        params.push(filter.limit);
      }
      if (filter.offset) {
        query += " OFFSET ?";
        params.push(filter.offset);
      }

      const rows = this.db.prepare(query).all(...params);
      let results = rows.map((row) =>
        this._toPublicRecord(this._rowToRecord(row)),
      );

      // Post-filter by capability (JSON array search)
      if (filter.capability) {
        results = results.filter((r) =>
          r.capabilities.includes(filter.capability),
        );
      }

      return results;
    } catch (e) {
      logger.error("[AgentDID] getAllDIDs error:", e.message);
      return [];
    }
  }

  /**
   * Get a DID record by its string
   * @param {string} did - DID string
   * @returns {Object|null} Public record or null
   */
  getDID(did) {
    const cached = this._didCache.get(did);
    if (cached) {
      return this._toPublicRecord(cached);
    }

    try {
      const row = this.db
        .prepare("SELECT * FROM agent_dids WHERE did = ?")
        .get(did);
      if (!row) {
        return null;
      }
      const record = this._rowToRecord(row);
      this._didCache.set(did, record);
      return this._toPublicRecord(record);
    } catch (e) {
      logger.error("[AgentDID] getDID error:", e.message);
      return null;
    }
  }

  // ============================================================
  // DID Lifecycle
  // ============================================================

  /**
   * Revoke a DID (terminal state)
   * @param {string} did - DID to revoke
   * @param {string} reason - Optional revocation reason
   * @returns {Object} Updated record
   */
  revokeDID(did, reason = "") {
    const record = this._didCache.get(did);
    if (!record) {
      throw new Error(`DID not found: ${did}`);
    }
    if (record.status === DID_STATUS.REVOKED) {
      throw new Error(`DID already revoked: ${did}`);
    }

    const previousStatus = record.status;
    record.status = DID_STATUS.REVOKED;
    record.updatedAt = new Date().toISOString();
    record.metadata = {
      ...record.metadata,
      revokedAt: record.updatedAt,
      revocationReason: reason,
      previousStatus,
    };

    this._updateDIDInDB(record);
    this._didCache.set(did, record);

    // Update stats
    if (previousStatus === DID_STATUS.ACTIVE) {
      this.stats.activeDIDs--;
    }
    if (previousStatus === DID_STATUS.SUSPENDED) {
      this.stats.suspendedDIDs--;
    }
    this.stats.revokedDIDs++;

    this.emit("did:revoked", { did, reason });
    logger.info(`[AgentDID] Revoked DID: ${did} (reason: ${reason || "none"})`);

    return this._toPublicRecord(record);
  }

  /**
   * Suspend a DID (can be reactivated)
   * @param {string} did - DID to suspend
   * @param {string} reason - Optional suspension reason
   * @returns {Object} Updated record
   */
  suspendDID(did, reason = "") {
    const record = this._didCache.get(did);
    if (!record) {
      throw new Error(`DID not found: ${did}`);
    }
    if (record.status !== DID_STATUS.ACTIVE) {
      throw new Error(
        `Can only suspend active DIDs. Current status: ${record.status}`,
      );
    }

    record.status = DID_STATUS.SUSPENDED;
    record.updatedAt = new Date().toISOString();
    record.metadata = {
      ...record.metadata,
      suspendedAt: record.updatedAt,
      suspensionReason: reason,
    };

    this._updateDIDInDB(record);
    this._didCache.set(did, record);

    this.stats.activeDIDs--;
    this.stats.suspendedDIDs++;

    this.emit("did:suspended", { did, reason });
    logger.info(`[AgentDID] Suspended DID: ${did}`);

    return this._toPublicRecord(record);
  }

  /**
   * Reactivate a suspended DID
   * @param {string} did - DID to reactivate
   * @returns {Object} Updated record
   */
  reactivateDID(did) {
    const record = this._didCache.get(did);
    if (!record) {
      throw new Error(`DID not found: ${did}`);
    }
    if (record.status !== DID_STATUS.SUSPENDED) {
      throw new Error(
        `Can only reactivate suspended DIDs. Current status: ${record.status}`,
      );
    }

    record.status = DID_STATUS.ACTIVE;
    record.updatedAt = new Date().toISOString();
    delete record.metadata.suspendedAt;
    delete record.metadata.suspensionReason;

    this._updateDIDInDB(record);
    this._didCache.set(did, record);

    this.stats.suspendedDIDs--;
    this.stats.activeDIDs++;

    // Reset failed auth count
    this._failedAuthCounts.delete(did);

    this.emit("did:reactivated", { did });
    logger.info(`[AgentDID] Reactivated DID: ${did}`);

    return this._toPublicRecord(record);
  }

  // ============================================================
  // Capabilities
  // ============================================================

  /**
   * Get capabilities for a DID
   * @param {string} did - DID string
   * @returns {Array} List of capability strings
   */
  getCapabilities(did) {
    const record = this._didCache.get(did);
    if (!record) {
      return [];
    }
    return [...record.capabilities];
  }

  /**
   * Add capabilities to a DID
   * @param {string} did - DID string
   * @param {Array} capabilities - Capabilities to add
   * @returns {Object} Updated record
   */
  addCapabilities(did, capabilities) {
    const record = this._didCache.get(did);
    if (!record) {
      throw new Error(`DID not found: ${did}`);
    }
    if (record.status !== DID_STATUS.ACTIVE) {
      throw new Error(`Cannot modify capabilities of ${record.status} DID`);
    }

    const newCaps = [...new Set([...record.capabilities, ...capabilities])];
    record.capabilities = newCaps;
    record.updatedAt = new Date().toISOString();

    this._updateDIDInDB(record);
    this._didCache.set(did, record);

    this.emit("did:capabilities-updated", { did, capabilities: newCaps });
    logger.info(
      `[AgentDID] Updated capabilities for ${did}: +${capabilities.length}`,
    );

    return this._toPublicRecord(record);
  }

  /**
   * Remove capabilities from a DID
   * @param {string} did - DID string
   * @param {Array} capabilities - Capabilities to remove
   * @returns {Object} Updated record
   */
  removeCapabilities(did, capabilities) {
    const record = this._didCache.get(did);
    if (!record) {
      throw new Error(`DID not found: ${did}`);
    }
    if (record.status !== DID_STATUS.ACTIVE) {
      throw new Error(`Cannot modify capabilities of ${record.status} DID`);
    }

    const removeSet = new Set(capabilities);
    record.capabilities = record.capabilities.filter((c) => !removeSet.has(c));
    record.updatedAt = new Date().toISOString();

    this._updateDIDInDB(record);
    this._didCache.set(did, record);

    this.emit("did:capabilities-updated", {
      did,
      capabilities: record.capabilities,
    });
    logger.info(
      `[AgentDID] Removed capabilities from ${did}: -${capabilities.length}`,
    );

    return this._toPublicRecord(record);
  }

  /**
   * Check if a DID has a specific capability
   * @param {string} did - DID string
   * @param {string} capability - Capability to check
   * @returns {boolean} True if the DID has the capability
   */
  hasCapability(did, capability) {
    const record = this._didCache.get(did);
    if (!record || record.status !== DID_STATUS.ACTIVE) {
      return false;
    }
    return record.capabilities.includes(capability);
  }

  // ============================================================
  // Challenge-Response Authentication
  // ============================================================

  /**
   * Sign a challenge with the DID's private key
   * @param {string} did - DID string
   * @param {string} challenge - Challenge string to sign
   * @returns {Object} { challengeId, signature, algorithm }
   */
  signChallenge(did, challenge) {
    const record = this._didCache.get(did);
    if (!record) {
      throw new Error(`DID not found: ${did}`);
    }
    if (record.status !== DID_STATUS.ACTIVE) {
      throw new Error(`Cannot sign with ${record.status} DID`);
    }

    const challengeId = uuidv4();
    const privateKey = this._decryptPrivateKey(record.privateKeyEncrypted);

    // Sign the challenge using HMAC-SHA256 (Ed25519 simulation)
    const signature = crypto
      .createHmac("sha256", privateKey)
      .update(challenge)
      .digest("hex");

    // Store pending challenge for verification
    this._pendingChallenges.set(challengeId, {
      did,
      challenge,
      signature,
      createdAt: Date.now(),
    });

    this.stats.challengesIssued++;
    this.emit("did:challenge-signed", { did, challengeId });

    return {
      challengeId,
      signature,
      algorithm: "hmac-sha256",
      did,
    };
  }

  /**
   * Verify a signature against a challenge
   * @param {string} did - DID string
   * @param {string} challenge - Original challenge
   * @param {string} signature - Signature to verify
   * @returns {Object} { valid, did, reason }
   */
  verifySignature(did, challenge, signature) {
    const record = this._didCache.get(did);
    if (!record) {
      return { valid: false, did, reason: "DID not found" };
    }
    if (record.status !== DID_STATUS.ACTIVE) {
      return { valid: false, did, reason: `DID is ${record.status}` };
    }

    // Reconstruct expected signature using the stored private key
    const privateKey = this._decryptPrivateKey(record.privateKeyEncrypted);
    const expectedSignature = crypto
      .createHmac("sha256", privateKey)
      .update(challenge)
      .digest("hex");

    const valid = expectedSignature === signature;

    if (valid) {
      this.stats.challengesVerified++;
      this._failedAuthCounts.delete(did);
      this.emit("did:auth-success", { did });
    } else {
      this.stats.challengesFailed++;
      const failCount = (this._failedAuthCounts.get(did) || 0) + 1;
      this._failedAuthCounts.set(did, failCount);

      // Auto-suspend on excessive failures
      if (failCount >= this.config.autoSuspendOnFailedAuth) {
        try {
          this.suspendDID(
            did,
            `Auto-suspended after ${failCount} failed auth attempts`,
          );
        } catch (e) {
          logger.warn("[AgentDID] Auto-suspend failed:", e.message);
        }
      }

      this.emit("did:auth-failed", { did, failCount });
    }

    return {
      valid,
      did,
      reason: valid ? "Signature verified" : "Signature mismatch",
    };
  }

  // ============================================================
  // Credential Binding
  // ============================================================

  /**
   * Bind a credential ID to a DID
   * @param {string} did - DID string
   * @param {string} credentialId - Credential ID to bind
   * @returns {Object} Updated record
   */
  bindCredential(did, credentialId) {
    const record = this._didCache.get(did);
    if (!record) {
      throw new Error(`DID not found: ${did}`);
    }

    if (!record.credentialIds.includes(credentialId)) {
      record.credentialIds.push(credentialId);
      record.updatedAt = new Date().toISOString();
      this._updateDIDInDB(record);
      this._didCache.set(did, record);
    }

    this.emit("did:credential-bound", { did, credentialId });
    return this._toPublicRecord(record);
  }

  /**
   * Unbind a credential ID from a DID
   * @param {string} did - DID string
   * @param {string} credentialId - Credential ID to unbind
   * @returns {Object} Updated record
   */
  unbindCredential(did, credentialId) {
    const record = this._didCache.get(did);
    if (!record) {
      throw new Error(`DID not found: ${did}`);
    }

    record.credentialIds = record.credentialIds.filter(
      (id) => id !== credentialId,
    );
    record.updatedAt = new Date().toISOString();
    this._updateDIDInDB(record);
    this._didCache.set(did, record);

    this.emit("did:credential-unbound", { did, credentialId });
    return this._toPublicRecord(record);
  }

  // ============================================================
  // Statistics & Configuration
  // ============================================================

  /**
   * Get module statistics
   * @returns {Object} Stats
   */
  getStats() {
    return {
      ...this.stats,
      cachedDIDs: this._didCache.size,
      pendingChallenges: this._pendingChallenges.size,
    };
  }

  /**
   * Get current configuration
   * @returns {Object} Config (copy)
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration overrides
   * @returns {Object} Updated config
   */
  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // Internal Helpers — Crypto
  // ============================================================

  /**
   * Generate an Ed25519-simulated key pair using Node crypto
   * @returns {{ publicKey: string, privateKey: string }}
   */
  _generateKeyPair() {
    // Use crypto.generateKeyPairSync if available (Node 12+),
    // fallback to random bytes for simulation
    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
        publicKeyEncoding: { type: "spki", format: "der" },
        privateKeyEncoding: { type: "pkcs8", format: "der" },
      });
      return {
        publicKey: publicKey.toString("base64"),
        privateKey: privateKey.toString("base64"),
      };
    } catch {
      // Fallback: random bytes (simulation mode)
      const pub = crypto.randomBytes(32).toString("base64");
      const priv = crypto.randomBytes(64).toString("base64");
      return { publicKey: pub, privateKey: priv };
    }
  }

  /**
   * Encrypt a private key for storage (symmetric, deterministic key from DID_METHOD)
   * @param {string} privateKey - Base64 private key
   * @returns {string} Encrypted hex string
   */
  _encryptPrivateKey(privateKey) {
    try {
      const key = crypto
        .createHash("sha256")
        .update(DID_METHOD + ":storage-key")
        .digest();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
      let encrypted = cipher.update(privateKey, "utf8", "hex");
      encrypted += cipher.final("hex");
      return iv.toString("hex") + ":" + encrypted;
    } catch (e) {
      logger.warn("[AgentDID] Encryption fallback:", e.message);
      // Fallback: base64 encode (not secure, simulation only)
      return Buffer.from(privateKey).toString("base64");
    }
  }

  /**
   * Decrypt a private key from storage
   * @param {string} encrypted - Encrypted hex string
   * @returns {string} Decrypted private key
   */
  _decryptPrivateKey(encrypted) {
    try {
      if (encrypted.includes(":")) {
        const [ivHex, data] = encrypted.split(":");
        const key = crypto
          .createHash("sha256")
          .update(DID_METHOD + ":storage-key")
          .digest();
        const iv = Buffer.from(ivHex, "hex");
        const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
        let decrypted = decipher.update(data, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
      }
      // Fallback: base64 decode
      return Buffer.from(encrypted, "base64").toString("utf8");
    } catch (e) {
      logger.warn("[AgentDID] Decryption fallback:", e.message);
      return encrypted;
    }
  }

  // ============================================================
  // Internal Helpers — DB Persistence
  // ============================================================

  _persistDID(record) {
    if (!this.db) {
      return;
    }
    try {
      this.db.run(
        `INSERT OR REPLACE INTO agent_dids
         (id, did, display_name, capabilities, public_key, private_key_encrypted,
          organization, status, credential_ids, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.did,
          record.displayName,
          JSON.stringify(record.capabilities),
          record.publicKey,
          record.privateKeyEncrypted,
          record.organization,
          record.status,
          JSON.stringify(record.credentialIds),
          JSON.stringify(record.metadata),
          record.createdAt,
          record.updatedAt,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[AgentDID] Persist error:", e.message);
    }
  }

  _updateDIDInDB(record) {
    if (!this.db) {
      return;
    }
    try {
      this.db.run(
        `UPDATE agent_dids SET
          display_name = ?, capabilities = ?, status = ?,
          credential_ids = ?, metadata = ?, updated_at = ?
         WHERE did = ?`,
        [
          record.displayName,
          JSON.stringify(record.capabilities),
          record.status,
          JSON.stringify(record.credentialIds),
          JSON.stringify(record.metadata),
          record.updatedAt,
          record.did,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[AgentDID] Update error:", e.message);
    }
  }

  _countByOrganization(organization) {
    try {
      const row = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM agent_dids WHERE organization = ?",
        )
        .get(organization);
      return row ? row.count : 0;
    } catch {
      return 0;
    }
  }

  // ============================================================
  // Internal Helpers — Record Transforms
  // ============================================================

  _rowToRecord(row) {
    return {
      id: row.id,
      did: row.did,
      displayName: row.display_name,
      capabilities: safeParseJSON(row.capabilities, []),
      publicKey: row.public_key,
      privateKeyEncrypted: row.private_key_encrypted,
      organization: row.organization,
      status: row.status,
      credentialIds: safeParseJSON(row.credential_ids, []),
      metadata: safeParseJSON(row.metadata, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Strip private fields from a record before returning to caller
   * @param {Object} record - Internal record
   * @returns {Object} Public record
   */
  _toPublicRecord(record) {
    return {
      id: record.id,
      did: record.did,
      displayName: record.displayName,
      capabilities: record.capabilities,
      publicKey: record.publicKey,
      organization: record.organization,
      status: record.status,
      credentialIds: record.credentialIds,
      metadata: record.metadata,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  // ============================================================
  // Internal Helpers — Cleanup
  // ============================================================

  _startChallengeCleanup() {
    // Clean expired challenges every 60 seconds
    this._cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, challenge] of this._pendingChallenges.entries()) {
        if (now - challenge.createdAt > this.config.challengeExpiryMs) {
          this._pendingChallenges.delete(id);
        }
      }
    }, 60000);

    // Allow the process to exit without waiting for this timer
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
  }

  /**
   * Destroy the instance and release resources
   */
  destroy() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    this._didCache.clear();
    this._pendingChallenges.clear();
    this._failedAuthCounts.clear();
    this.initialized = false;
    logger.info("[AgentDID] Destroyed");
  }
}

// ============================================================
// Utility
// ============================================================

function safeParseJSON(str, fallback = []) {
  if (!str) {
    return fallback;
  }
  if (typeof str === "object") {
    return str;
  }
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getAgentDID() {
  if (!instance) {
    instance = new AgentDID();
  }
  return instance;
}

module.exports = {
  AgentDID,
  getAgentDID,
  DID_STATUS,
};
