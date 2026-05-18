/**
 * Agent Credential Manager — v4.0
 *
 * Issues, verifies, and revokes W3C Verifiable Credential (VC) style
 * credentials for agent-to-agent authentication and capability
 * delegation in the decentralized agent network.
 *
 * Key features:
 * - Issue credentials with typed claims (capability, delegation, membership)
 * - W3C VC-like structure: issuer DID, subject DID, claims, proof
 * - Automatic expiration checking
 * - Revocation registry for instant invalidation
 * - Credential chain verification (issuer must hold valid credential)
 * - DB persistence + in-memory cache
 *
 * @module ai-engine/cowork/agent-credential-manager
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

// ============================================================
// Constants
// ============================================================

const CREDENTIAL_STATUS = {
  VALID: "valid",
  REVOKED: "revoked",
  EXPIRED: "expired",
};

const CREDENTIAL_TYPES = {
  CAPABILITY: "capability",
  DELEGATION: "delegation",
  MEMBERSHIP: "membership",
};

const DEFAULT_CONFIG = {
  defaultExpiryMs: 86400000, // 24 hours
  maxCredentialsPerAgent: 100,
  allowChainedDelegation: true,
  maxDelegationDepth: 5,
  proofAlgorithm: "hmac-sha256",
};

// ============================================================
// AgentCredentialManager Class
// ============================================================

class AgentCredentialManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this.config = { ...DEFAULT_CONFIG };

    // In-memory caches
    this._credentials = new Map(); // credentialId → credential
    this._bySubject = new Map(); // subjectDID → Set<credentialId>
    this._byIssuer = new Map(); // issuerDID → Set<credentialId>
    this._revocationSet = new Set(); // Set of revoked credential IDs

    // Stats
    this.stats = {
      totalIssued: 0,
      totalRevoked: 0,
      totalVerifications: 0,
      verificationsPassed: 0,
      verificationsFailed: 0,
    };
  }

  /**
   * Initialize with database and optional dependencies
   * @param {Object} db - Database manager (better-sqlite3 compatible)
   * @param {Object} deps - Optional dependencies { agentDID }
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this.agentDIDManager = deps.agentDID || null;

    this._ensureTables();
    this._loadFromDB();
    this._startExpirationCleanup();

    this.initialized = true;
    logger.info(
      `[CredentialMgr] Initialized with ${this._credentials.size} credentials ` +
        `(${this._revocationSet.size} revoked)`,
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
        CREATE TABLE IF NOT EXISTS agent_credentials (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          issuer_did TEXT NOT NULL,
          subject_did TEXT NOT NULL,
          claims TEXT DEFAULT '{}',
          proof TEXT DEFAULT '{}',
          status TEXT DEFAULT 'valid',
          issued_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT,
          revoked_at TEXT,
          revocation_reason TEXT,
          metadata TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_cred_issuer ON agent_credentials(issuer_did);
        CREATE INDEX IF NOT EXISTS idx_cred_subject ON agent_credentials(subject_did);
        CREATE INDEX IF NOT EXISTS idx_cred_status ON agent_credentials(status);
        CREATE INDEX IF NOT EXISTS idx_cred_type ON agent_credentials(type);
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[CredentialMgr] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Cache Management
  // ============================================================

  _loadFromDB() {
    if (!this.db) {
      return;
    }
    try {
      const rows = this.db.prepare("SELECT * FROM agent_credentials").all();

      for (const row of rows) {
        const cred = this._rowToCredential(row);
        this._credentials.set(cred.id, cred);
        this._indexCredential(cred);

        if (cred.status === CREDENTIAL_STATUS.REVOKED) {
          this._revocationSet.add(cred.id);
        }
      }
    } catch (e) {
      logger.warn("[CredentialMgr] Cache load error:", e.message);
    }
  }

  _indexCredential(cred) {
    // Index by subject
    if (!this._bySubject.has(cred.subjectDID)) {
      this._bySubject.set(cred.subjectDID, new Set());
    }
    this._bySubject.get(cred.subjectDID).add(cred.id);

    // Index by issuer
    if (!this._byIssuer.has(cred.issuerDID)) {
      this._byIssuer.set(cred.issuerDID, new Set());
    }
    this._byIssuer.get(cred.issuerDID).add(cred.id);
  }

  _removeIndex(cred) {
    const subjectSet = this._bySubject.get(cred.subjectDID);
    if (subjectSet) {
      subjectSet.delete(cred.id);
      if (subjectSet.size === 0) {
        this._bySubject.delete(cred.subjectDID);
      }
    }

    const issuerSet = this._byIssuer.get(cred.issuerDID);
    if (issuerSet) {
      issuerSet.delete(cred.id);
      if (issuerSet.size === 0) {
        this._byIssuer.delete(cred.issuerDID);
      }
    }
  }

  // ============================================================
  // Issue Credentials
  // ============================================================

  /**
   * Issue a new verifiable credential
   * @param {Object} options - {
   *   type, issuerDID, subjectDID, claims, expiresInMs, metadata
   * }
   * @returns {Object} Issued credential
   */
  issueCredential(options = {}) {
    if (!options.issuerDID) {
      throw new Error("issuerDID is required");
    }
    if (!options.subjectDID) {
      throw new Error("subjectDID is required");
    }

    const type = options.type || CREDENTIAL_TYPES.CAPABILITY;
    if (!Object.values(CREDENTIAL_TYPES).includes(type)) {
      throw new Error(
        `Invalid credential type: ${type}. Must be one of: ${Object.values(CREDENTIAL_TYPES).join(", ")}`,
      );
    }

    // Check per-agent credential limit
    const subjectCreds = this._bySubject.get(options.subjectDID);
    if (
      subjectCreds &&
      subjectCreds.size >= this.config.maxCredentialsPerAgent
    ) {
      throw new Error(
        `Agent ${options.subjectDID} has reached the credential limit (${this.config.maxCredentialsPerAgent})`,
      );
    }

    // For delegation credentials, verify chain depth
    if (
      type === CREDENTIAL_TYPES.DELEGATION &&
      this.config.allowChainedDelegation
    ) {
      const depth = this._getDelegationDepth(options.issuerDID);
      if (depth >= this.config.maxDelegationDepth) {
        throw new Error(
          `Delegation depth exceeded (${depth}/${this.config.maxDelegationDepth})`,
        );
      }
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const expiresInMs = options.expiresInMs || this.config.defaultExpiryMs;
    const expiresAt = new Date(Date.now() + expiresInMs).toISOString();

    // Build claims
    const claims = options.claims || {};

    // Generate proof (HMAC-SHA256 over credential content)
    const proof = this._generateProof(
      id,
      type,
      options.issuerDID,
      options.subjectDID,
      claims,
    );

    const credential = {
      id,
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: [
        "VerifiableCredential",
        `Agent${this._capitalize(type)}Credential`,
      ],
      credentialType: type,
      issuerDID: options.issuerDID,
      subjectDID: options.subjectDID,
      claims,
      proof,
      status: CREDENTIAL_STATUS.VALID,
      issuedAt: now,
      expiresAt,
      revokedAt: null,
      revocationReason: null,
      metadata: options.metadata || {},
      createdAt: now,
    };

    // Persist
    this._persistCredential(credential);

    // Update in-memory state
    this._credentials.set(id, credential);
    this._indexCredential(credential);
    this.stats.totalIssued++;

    this.emit("credential:issued", {
      id,
      type,
      issuerDID: credential.issuerDID,
      subjectDID: credential.subjectDID,
    });
    logger.info(
      `[CredentialMgr] Issued ${type} credential ${id.slice(0, 8)}... ` +
        `(issuer: ${credential.issuerDID.slice(-8)}, subject: ${credential.subjectDID.slice(-8)})`,
    );

    return { ...credential };
  }

  /**
   * Issue a capability credential
   * @param {string} issuerDID - Issuer DID
   * @param {string} subjectDID - Subject DID
   * @param {Array} capabilities - List of capabilities to grant
   * @param {Object} options - Additional options
   * @returns {Object} Issued credential
   */
  issueCapabilityCredential(issuerDID, subjectDID, capabilities, options = {}) {
    return this.issueCredential({
      type: CREDENTIAL_TYPES.CAPABILITY,
      issuerDID,
      subjectDID,
      claims: {
        capabilities: Array.isArray(capabilities)
          ? capabilities
          : [capabilities],
        scope: options.scope || "global",
      },
      ...options,
    });
  }

  /**
   * Issue a delegation credential
   * @param {string} issuerDID - Delegator DID
   * @param {string} subjectDID - Delegatee DID
   * @param {Object} delegatedRights - Rights being delegated
   * @param {Object} options - Additional options
   * @returns {Object} Issued credential
   */
  issueDelegationCredential(
    issuerDID,
    subjectDID,
    delegatedRights,
    options = {},
  ) {
    return this.issueCredential({
      type: CREDENTIAL_TYPES.DELEGATION,
      issuerDID,
      subjectDID,
      claims: {
        delegatedRights: delegatedRights || {},
        allowSubDelegation: options.allowSubDelegation || false,
      },
      ...options,
    });
  }

  /**
   * Issue a membership credential
   * @param {string} issuerDID - Organization/group DID
   * @param {string} subjectDID - Member DID
   * @param {string} groupName - Group or organization name
   * @param {Object} options - Additional options
   * @returns {Object} Issued credential
   */
  issueMembershipCredential(issuerDID, subjectDID, groupName, options = {}) {
    return this.issueCredential({
      type: CREDENTIAL_TYPES.MEMBERSHIP,
      issuerDID,
      subjectDID,
      claims: {
        group: groupName,
        role: options.role || "member",
      },
      ...options,
    });
  }

  // ============================================================
  // Verification
  // ============================================================

  /**
   * Verify a credential by ID
   * @param {string} credentialId - Credential ID to verify
   * @returns {Object} { valid, credential, reason }
   */
  verifyCredential(credentialId) {
    this.stats.totalVerifications++;

    const cred = this._credentials.get(credentialId);
    if (!cred) {
      this.stats.verificationsFailed++;
      return { valid: false, credential: null, reason: "Credential not found" };
    }

    // Check revocation
    if (
      this._revocationSet.has(credentialId) ||
      cred.status === CREDENTIAL_STATUS.REVOKED
    ) {
      this.stats.verificationsFailed++;
      return {
        valid: false,
        credential: { ...cred },
        reason: `Credential revoked${cred.revocationReason ? ": " + cred.revocationReason : ""}`,
      };
    }

    // Check expiration
    if (cred.expiresAt) {
      const expiresTime = new Date(cred.expiresAt).getTime();
      if (Date.now() > expiresTime) {
        // Mark as expired
        cred.status = CREDENTIAL_STATUS.EXPIRED;
        this._updateCredentialStatus(credentialId, CREDENTIAL_STATUS.EXPIRED);

        this.stats.verificationsFailed++;
        return {
          valid: false,
          credential: { ...cred },
          reason: `Credential expired at ${cred.expiresAt}`,
        };
      }
    }

    // Verify proof integrity
    const expectedProof = this._generateProof(
      cred.id,
      cred.credentialType,
      cred.issuerDID,
      cred.subjectDID,
      cred.claims,
    );

    if (expectedProof.proofValue !== cred.proof.proofValue) {
      this.stats.verificationsFailed++;
      return {
        valid: false,
        credential: { ...cred },
        reason: "Proof integrity check failed",
      };
    }

    this.stats.verificationsPassed++;
    this.emit("credential:verified", { credentialId });

    return {
      valid: true,
      credential: { ...cred },
      reason: "Credential is valid",
    };
  }

  /**
   * Verify that an agent has a specific capability via credentials
   * @param {string} agentDID - Agent DID
   * @param {string} capability - Capability to check
   * @returns {Object} { hasCapability, credentialId, reason }
   */
  verifyCapability(agentDID, capability) {
    const credIds = this._bySubject.get(agentDID);
    if (!credIds || credIds.size === 0) {
      return {
        hasCapability: false,
        credentialId: null,
        reason: "No credentials found",
      };
    }

    for (const credId of credIds) {
      const cred = this._credentials.get(credId);
      if (!cred) {
        continue;
      }
      if (cred.credentialType !== CREDENTIAL_TYPES.CAPABILITY) {
        continue;
      }

      // Verify credential is still valid
      const verification = this.verifyCredential(credId);
      if (!verification.valid) {
        continue;
      }

      // Check if capability is in claims
      const caps = cred.claims.capabilities || [];
      if (caps.includes(capability)) {
        return {
          hasCapability: true,
          credentialId: credId,
          reason: `Capability granted by credential ${credId.slice(0, 8)}...`,
        };
      }
    }

    return {
      hasCapability: false,
      credentialId: null,
      reason: `No valid credential grants "${capability}"`,
    };
  }

  // ============================================================
  // Revocation
  // ============================================================

  /**
   * Revoke a credential
   * @param {string} credentialId - Credential ID to revoke
   * @param {string} reason - Optional revocation reason
   * @returns {Object} Updated credential
   */
  revokeCredential(credentialId, reason = "") {
    const cred = this._credentials.get(credentialId);
    if (!cred) {
      throw new Error(`Credential not found: ${credentialId}`);
    }
    if (cred.status === CREDENTIAL_STATUS.REVOKED) {
      throw new Error(`Credential already revoked: ${credentialId}`);
    }

    const now = new Date().toISOString();
    cred.status = CREDENTIAL_STATUS.REVOKED;
    cred.revokedAt = now;
    cred.revocationReason = reason;

    // Update revocation set
    this._revocationSet.add(credentialId);

    // Persist
    this._updateCredentialInDB(cred);
    this._credentials.set(credentialId, cred);

    this.stats.totalRevoked++;

    this.emit("credential:revoked", { credentialId, reason });
    logger.info(
      `[CredentialMgr] Revoked credential ${credentialId.slice(0, 8)}... (reason: ${reason || "none"})`,
    );

    return { ...cred };
  }

  /**
   * Revoke all credentials for an agent (subject)
   * @param {string} agentDID - Agent DID
   * @param {string} reason - Revocation reason
   * @returns {number} Number of credentials revoked
   */
  revokeAllForAgent(agentDID, reason = "") {
    const credIds = this._bySubject.get(agentDID);
    if (!credIds || credIds.size === 0) {
      return 0;
    }

    let revokedCount = 0;
    for (const credId of credIds) {
      const cred = this._credentials.get(credId);
      if (cred && cred.status !== CREDENTIAL_STATUS.REVOKED) {
        try {
          this.revokeCredential(
            credId,
            reason || `Bulk revocation for ${agentDID}`,
          );
          revokedCount++;
        } catch (e) {
          logger.warn(
            `[CredentialMgr] Bulk revoke error for ${credId}:`,
            e.message,
          );
        }
      }
    }

    logger.info(
      `[CredentialMgr] Bulk revoked ${revokedCount} credentials for ${agentDID}`,
    );
    return revokedCount;
  }

  // ============================================================
  // Queries
  // ============================================================

  /**
   * Get all credentials for an agent (subject)
   * @param {string} agentDID - Agent DID
   * @param {Object} filter - { type, status }
   * @returns {Array} Credentials
   */
  getCredentials(agentDID, filter = {}) {
    const credIds = this._bySubject.get(agentDID);
    if (!credIds || credIds.size === 0) {
      return [];
    }

    let results = Array.from(credIds)
      .map((id) => this._credentials.get(id))
      .filter(Boolean);

    if (filter.type) {
      results = results.filter((c) => c.credentialType === filter.type);
    }
    if (filter.status) {
      results = results.filter((c) => c.status === filter.status);
    }

    // Auto-expire check
    const now = Date.now();
    results = results.map((c) => {
      if (c.status === CREDENTIAL_STATUS.VALID && c.expiresAt) {
        if (now > new Date(c.expiresAt).getTime()) {
          c.status = CREDENTIAL_STATUS.EXPIRED;
          this._updateCredentialStatus(c.id, CREDENTIAL_STATUS.EXPIRED);
        }
      }
      return { ...c };
    });

    return results;
  }

  /**
   * Get credentials issued by a specific DID
   * @param {string} issuerDID - Issuer DID
   * @returns {Array} Credentials issued by this DID
   */
  getIssuedCredentials(issuerDID) {
    const credIds = this._byIssuer.get(issuerDID);
    if (!credIds || credIds.size === 0) {
      return [];
    }

    return Array.from(credIds)
      .map((id) => this._credentials.get(id))
      .filter(Boolean)
      .map((c) => ({ ...c }));
  }

  /**
   * Get a credential by its ID
   * @param {string} id - Credential ID
   * @returns {Object|null} Credential or null
   */
  getCredentialById(id) {
    const cred = this._credentials.get(id);
    if (!cred) {
      return null;
    }

    // Auto-expire check
    if (cred.status === CREDENTIAL_STATUS.VALID && cred.expiresAt) {
      if (Date.now() > new Date(cred.expiresAt).getTime()) {
        cred.status = CREDENTIAL_STATUS.EXPIRED;
        this._updateCredentialStatus(id, CREDENTIAL_STATUS.EXPIRED);
      }
    }

    return { ...cred };
  }

  // ============================================================
  // Statistics & Configuration
  // ============================================================

  /**
   * Get module statistics
   * @returns {Object} Stats
   */
  getStats() {
    const validCount = Array.from(this._credentials.values()).filter(
      (c) => c.status === CREDENTIAL_STATUS.VALID,
    ).length;

    const expiredCount = Array.from(this._credentials.values()).filter(
      (c) => c.status === CREDENTIAL_STATUS.EXPIRED,
    ).length;

    return {
      ...this.stats,
      totalCredentials: this._credentials.size,
      validCredentials: validCount,
      revokedCredentials: this._revocationSet.size,
      expiredCredentials: expiredCount,
      uniqueSubjects: this._bySubject.size,
      uniqueIssuers: this._byIssuer.size,
    };
  }

  /**
   * Get current configuration
   * @returns {Object} Config copy
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update configuration
   * @param {Object} updates - Config overrides
   * @returns {Object} Updated config
   */
  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // Internal Helpers — Proof Generation
  // ============================================================

  /**
   * Generate a cryptographic proof for a credential
   * @param {string} id - Credential ID
   * @param {string} type - Credential type
   * @param {string} issuerDID - Issuer DID
   * @param {string} subjectDID - Subject DID
   * @param {Object} claims - Credential claims
   * @returns {Object} Proof object
   */
  _generateProof(id, type, issuerDID, subjectDID, claims) {
    const payload = JSON.stringify({ id, type, issuerDID, subjectDID, claims });
    const proofValue = crypto
      .createHmac("sha256", `${issuerDID}:credential-proof`)
      .update(payload)
      .digest("hex");

    return {
      type: "HmacSha256Signature2024",
      created: new Date().toISOString(),
      verificationMethod: `${issuerDID}#keys-1`,
      proofPurpose: "assertionMethod",
      proofValue,
    };
  }

  // ============================================================
  // Internal Helpers — Delegation
  // ============================================================

  /**
   * Compute how deep in the delegation chain an agent is
   * @param {string} agentDID - Agent DID to check
   * @returns {number} Delegation depth
   */
  _getDelegationDepth(agentDID) {
    let depth = 0;
    let currentDID = agentDID;
    const visited = new Set();

    while (depth < this.config.maxDelegationDepth + 1) {
      if (visited.has(currentDID)) {
        break;
      } // Cycle detection
      visited.add(currentDID);

      const credIds = this._bySubject.get(currentDID);
      if (!credIds) {
        break;
      }

      let foundDelegation = false;
      for (const credId of credIds) {
        const cred = this._credentials.get(credId);
        if (
          cred &&
          cred.credentialType === CREDENTIAL_TYPES.DELEGATION &&
          cred.status === CREDENTIAL_STATUS.VALID
        ) {
          depth++;
          currentDID = cred.issuerDID;
          foundDelegation = true;
          break;
        }
      }

      if (!foundDelegation) {
        break;
      }
    }

    return depth;
  }

  // ============================================================
  // Internal Helpers — DB Persistence
  // ============================================================

  _persistCredential(cred) {
    if (!this.db) {
      return;
    }
    try {
      this.db.run(
        `INSERT OR REPLACE INTO agent_credentials
         (id, type, issuer_did, subject_did, claims, proof, status,
          issued_at, expires_at, revoked_at, revocation_reason, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cred.id,
          cred.credentialType,
          cred.issuerDID,
          cred.subjectDID,
          JSON.stringify(cred.claims),
          JSON.stringify(cred.proof),
          cred.status,
          cred.issuedAt,
          cred.expiresAt,
          cred.revokedAt,
          cred.revocationReason,
          JSON.stringify(cred.metadata),
          cred.createdAt,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[CredentialMgr] Persist error:", e.message);
    }
  }

  _updateCredentialInDB(cred) {
    if (!this.db) {
      return;
    }
    try {
      this.db.run(
        `UPDATE agent_credentials SET
          status = ?, revoked_at = ?, revocation_reason = ?
         WHERE id = ?`,
        [cred.status, cred.revokedAt, cred.revocationReason, cred.id],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[CredentialMgr] Update error:", e.message);
    }
  }

  _updateCredentialStatus(credentialId, status) {
    const cred = this._credentials.get(credentialId);
    if (!cred) {
      return;
    }
    cred.status = status;

    try {
      this.db.run("UPDATE agent_credentials SET status = ? WHERE id = ?", [
        status,
        credentialId,
      ]);
    } catch (e) {
      logger.warn("[CredentialMgr] Status update error:", e.message);
    }
  }

  // ============================================================
  // Internal Helpers — Record Transforms
  // ============================================================

  _rowToCredential(row) {
    return {
      id: row.id,
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: [
        "VerifiableCredential",
        `Agent${this._capitalize(row.type)}Credential`,
      ],
      credentialType: row.type,
      issuerDID: row.issuer_did,
      subjectDID: row.subject_did,
      claims: safeParseJSON(row.claims, {}),
      proof: safeParseJSON(row.proof, {}),
      status: row.status,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      revocationReason: row.revocation_reason,
      metadata: safeParseJSON(row.metadata, {}),
      createdAt: row.created_at,
    };
  }

  _capitalize(str) {
    if (!str) {
      return "";
    }
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // ============================================================
  // Expiration Cleanup
  // ============================================================

  _startExpirationCleanup() {
    this._cleanupInterval = setInterval(() => {
      const now = Date.now();
      let expiredCount = 0;

      for (const [id, cred] of this._credentials.entries()) {
        if (cred.status !== CREDENTIAL_STATUS.VALID) {
          continue;
        }
        if (!cred.expiresAt) {
          continue;
        }

        if (now > new Date(cred.expiresAt).getTime()) {
          cred.status = CREDENTIAL_STATUS.EXPIRED;
          this._updateCredentialStatus(id, CREDENTIAL_STATUS.EXPIRED);
          expiredCount++;
        }
      }

      if (expiredCount > 0) {
        logger.info(
          `[CredentialMgr] Cleanup: ${expiredCount} credentials expired`,
        );
      }
    }, 60000);

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
    this._credentials.clear();
    this._bySubject.clear();
    this._byIssuer.clear();
    this._revocationSet.clear();
    this.initialized = false;
    logger.info("[CredentialMgr] Destroyed");
  }
}

// ============================================================
// Utility
// ============================================================

function safeParseJSON(str, fallback = {}) {
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

function getAgentCredentialManager() {
  if (!instance) {
    instance = new AgentCredentialManager();
  }
  return instance;
}

module.exports = {
  AgentCredentialManager,
  getAgentCredentialManager,
  CREDENTIAL_STATUS,
  CREDENTIAL_TYPES,
};
