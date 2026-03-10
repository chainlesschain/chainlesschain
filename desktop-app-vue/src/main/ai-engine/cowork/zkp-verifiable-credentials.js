/**
 * ZKP Verifiable Credentials
 *
 * Implements zero-knowledge proof based verifiable credentials with
 * BBS+ signature scheme simulation for selective disclosure and
 * privacy-preserving credential presentations.
 *
 * Key features:
 * - Issue credentials with BBS+ simulated proofs
 * - Selective disclosure of credential claims
 * - Zero-knowledge presentation verification
 * - Revocation registry for instant invalidation
 * - Automatic expiration cleanup
 * - DB persistence + in-memory cache
 *
 * @module ai-engine/cowork/zkp-verifiable-credentials
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const crypto = require("crypto");

// ============================================================
// Constants
// ============================================================

const CREDENTIAL_STATUS = {
  ACTIVE: "active",
  REVOKED: "revoked",
  EXPIRED: "expired",
  SUSPENDED: "suspended",
};

const CREDENTIAL_TYPE = {
  IDENTITY: "identity",
  MEMBERSHIP: "membership",
  QUALIFICATION: "qualification",
  ACCESS: "access",
  CUSTOM: "custom",
};

const DISCLOSURE_TYPE = {
  FULL: "full",
  SELECTIVE: "selective",
  ZERO_KNOWLEDGE: "zero_knowledge",
};

const DEFAULT_CONFIG = {
  defaultProofScheme: "bbs_plus",
  credentialExpiryMs: 31536000000, // 1 year
  maxCredentialsInMemory: 5000,
  cleanupIntervalMs: 600000,
  enableRevocationCheck: true,
};

// ============================================================
// ZKPVerifiableCredentials Class
// ============================================================

class ZKPVerifiableCredentials extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this.config = { ...DEFAULT_CONFIG };

    // In-memory caches
    this._credentials = new Map(); // credentialId → credential
    this._revocationSet = new Set(); // Set of revoked credential IDs

    // Dependencies
    this._zkpEngine = null;
    this._agentCredentialManager = null;

    // Stats
    this._presentationCount = 0;
    this._cleanupTimer = null;
  }

  /**
   * Initialize with database and optional dependencies
   * @param {Object} db - Database manager (better-sqlite3 compatible)
   * @param {Object} deps - Optional dependencies { zkpEngine, agentCredentialManager }
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._zkpEngine = deps.zkpEngine || null;
    this._agentCredentialManager = deps.agentCredentialManager || null;

    this._ensureTables();
    this._loadCredentials();
    this._loadRevocations();
    this._startCleanupTimer();

    this.initialized = true;
    logger.info(
      `[ZKP VC] Initialized with ${this._credentials.size} credentials ` +
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
        CREATE TABLE IF NOT EXISTS zkp_verifiable_credentials (
          id TEXT PRIMARY KEY,
          credential_type TEXT NOT NULL,
          issuer_did TEXT NOT NULL,
          subject_did TEXT NOT NULL,
          claims TEXT NOT NULL,
          disclosed_claims TEXT DEFAULT '[]',
          proof TEXT NOT NULL,
          proof_scheme TEXT DEFAULT 'bbs_plus',
          revocation_id TEXT,
          status TEXT DEFAULT 'active',
          expires_at TEXT,
          issued_at TEXT DEFAULT (datetime('now')),
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS zkp_revocation_registry (
          id TEXT PRIMARY KEY,
          credential_id TEXT NOT NULL,
          revoked_by TEXT NOT NULL,
          reason TEXT,
          revoked_at TEXT DEFAULT (datetime('now'))
        );
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[ZKP VC] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Cache Management
  // ============================================================

  _loadCredentials() {
    if (!this.db) {
      return;
    }
    try {
      const rows = this.db
        .prepare("SELECT * FROM zkp_verifiable_credentials")
        .all();

      for (const row of rows) {
        const cred = {
          id: row.id,
          type: row.credential_type,
          issuerDid: row.issuer_did,
          subjectDid: row.subject_did,
          claims: JSON.parse(row.claims || "{}"),
          disclosedClaims: JSON.parse(row.disclosed_claims || "[]"),
          proof: JSON.parse(row.proof || "{}"),
          proofScheme: row.proof_scheme,
          revocationId: row.revocation_id,
          status: row.status,
          expiresAt: row.expires_at,
          issuedAt: row.issued_at,
          createdAt: row.created_at,
        };
        this._credentials.set(cred.id, cred);
      }
    } catch (e) {
      logger.warn("[ZKP VC] Credential load error:", e.message);
    }
  }

  _loadRevocations() {
    if (!this.db) {
      return;
    }
    try {
      const rows = this.db
        .prepare("SELECT credential_id FROM zkp_revocation_registry")
        .all();

      for (const row of rows) {
        this._revocationSet.add(row.credential_id);
      }
    } catch (e) {
      logger.warn("[ZKP VC] Revocation load error:", e.message);
    }
  }

  // ============================================================
  // Credential Issuance
  // ============================================================

  /**
   * Issue a new verifiable credential
   * @param {Object} options - Credential options
   * @returns {Object} The issued credential
   */
  issueCredential(options = {}) {
    const {
      type = CREDENTIAL_TYPE.CUSTOM,
      issuerDid,
      subjectDid,
      claims = {},
      expiresAt,
      proofScheme = this.config.defaultProofScheme,
    } = options;

    if (!issuerDid || !subjectDid) {
      throw new Error("issuerDid and subjectDid are required");
    }

    const id = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const revocationId = crypto.randomUUID();

    const proof = {
      scheme: proofScheme,
      signature: this._hash(
        issuerDid + subjectDid + JSON.stringify(claims) + nonce,
      ),
      nonce,
      issuerPublicKey: this._hash(issuerDid + "pub"),
    };

    const now = new Date().toISOString();
    const credential = {
      id,
      type,
      issuerDid,
      subjectDid,
      claims,
      disclosedClaims: [],
      proof,
      proofScheme,
      revocationId,
      status: CREDENTIAL_STATUS.ACTIVE,
      expiresAt:
        expiresAt ||
        new Date(Date.now() + this.config.credentialExpiryMs).toISOString(),
      issuedAt: now,
      createdAt: now,
    };

    this._credentials.set(id, credential);
    this._persistCredential(credential);

    this.emit("credential:issued", {
      credentialId: id,
      type,
      issuerDid,
      subjectDid,
    });

    logger.info(
      `[ZKP VC] Credential issued: ${id} (${type}) from ${issuerDid} to ${subjectDid}`,
    );

    return credential;
  }

  // ============================================================
  // Presentation & Selective Disclosure
  // ============================================================

  /**
   * Create a verifiable presentation from a credential
   * @param {string} credentialId - The credential ID
   * @param {string[]} disclosedClaimKeys - Keys to disclose (empty = full)
   * @param {Object} options - Additional options
   * @returns {Object} The verifiable presentation
   */
  createPresentation(credentialId, disclosedClaimKeys = [], options = {}) {
    const credential = this._credentials.get(credentialId);
    if (!credential) {
      throw new Error(`Credential not found: ${credentialId}`);
    }

    if (credential.status === CREDENTIAL_STATUS.REVOKED) {
      throw new Error(`Credential is revoked: ${credentialId}`);
    }

    if (credential.expiresAt && new Date(credential.expiresAt) < new Date()) {
      throw new Error(`Credential is expired: ${credentialId}`);
    }

    let disclosedClaims = { ...credential.claims };
    let disclosureType = DISCLOSURE_TYPE.FULL;

    if (disclosedClaimKeys.length > 0) {
      disclosedClaims = {};
      for (const key of disclosedClaimKeys) {
        if (key in credential.claims) {
          disclosedClaims[key] = credential.claims[key];
        }
      }
      disclosureType = DISCLOSURE_TYPE.SELECTIVE;
    }

    const presentationNonce = crypto.randomUUID();
    const derivedProof = {
      scheme: credential.proof.scheme,
      derivedSignature: this._hash(
        credential.proof.signature +
          presentationNonce +
          JSON.stringify(disclosedClaims),
      ),
      nonce: presentationNonce,
      originalNonce: credential.proof.nonce,
      issuerPublicKey: credential.proof.issuerPublicKey,
      disclosureType,
    };

    const presentation = {
      id: crypto.randomUUID(),
      credentialId,
      disclosedClaims,
      proof: derivedProof,
      presentedAt: new Date().toISOString(),
    };

    this._presentationCount++;

    this.emit("presentation:created", {
      presentationId: presentation.id,
      credentialId,
      disclosureType,
      disclosedKeys: Object.keys(disclosedClaims),
    });

    logger.info(
      `[ZKP VC] Presentation created: ${presentation.id} (${disclosureType}) for credential ${credentialId}`,
    );

    return presentation;
  }

  /**
   * Selective disclosure — return credential copy with only specified claims
   * @param {string} credentialId - The credential ID
   * @param {string[]} claimKeys - Keys to disclose
   * @returns {Object} Credential copy with selective disclosure
   */
  selectiveDisclose(credentialId, claimKeys) {
    const credential = this._credentials.get(credentialId);
    if (!credential) {
      throw new Error(`Credential not found: ${credentialId}`);
    }

    const disclosedClaims = {};
    for (const key of claimKeys) {
      if (key in credential.claims) {
        disclosedClaims[key] = credential.claims[key];
      }
    }

    const nonce = crypto.randomUUID();
    const derivedProof = {
      scheme: credential.proof.scheme,
      derivedSignature: this._hash(
        credential.proof.signature + nonce + JSON.stringify(disclosedClaims),
      ),
      nonce,
      originalNonce: credential.proof.nonce,
      issuerPublicKey: credential.proof.issuerPublicKey,
      disclosureType: DISCLOSURE_TYPE.SELECTIVE,
    };

    return {
      ...credential,
      claims: disclosedClaims,
      disclosedClaims: claimKeys,
      proof: derivedProof,
    };
  }

  // ============================================================
  // Verification
  // ============================================================

  /**
   * Verify a verifiable presentation
   * @param {Object} presentation - The presentation to verify
   * @returns {Object} Verification result { valid, credential, reason }
   */
  verifyPresentation(presentation) {
    if (!presentation || !presentation.credentialId) {
      return { valid: false, credential: null, reason: "Invalid presentation" };
    }

    const credential = this._credentials.get(presentation.credentialId);
    if (!credential) {
      return {
        valid: false,
        credential: null,
        reason: "Credential not found",
      };
    }

    // Check revocation
    if (
      this.config.enableRevocationCheck &&
      this._revocationSet.has(presentation.credentialId)
    ) {
      return {
        valid: false,
        credential,
        reason: "Credential has been revoked",
      };
    }

    if (credential.status === CREDENTIAL_STATUS.REVOKED) {
      return {
        valid: false,
        credential,
        reason: "Credential has been revoked",
      };
    }

    // Check expiration
    if (credential.expiresAt && new Date(credential.expiresAt) < new Date()) {
      return {
        valid: false,
        credential,
        reason: "Credential has expired",
      };
    }

    // Verify proof structure
    if (
      !presentation.proof ||
      !presentation.proof.derivedSignature ||
      !presentation.proof.nonce
    ) {
      return { valid: false, credential, reason: "Invalid proof structure" };
    }

    // Verify derived signature
    const expectedSignature = this._hash(
      credential.proof.signature +
        presentation.proof.nonce +
        JSON.stringify(presentation.disclosedClaims),
    );

    if (presentation.proof.derivedSignature !== expectedSignature) {
      return { valid: false, credential, reason: "Proof verification failed" };
    }

    this.emit("presentation:verified", {
      presentationId: presentation.id,
      credentialId: presentation.credentialId,
      valid: true,
    });

    logger.info(
      `[ZKP VC] Presentation verified: ${presentation.id} for credential ${presentation.credentialId}`,
    );

    return { valid: true, credential, reason: null };
  }

  // ============================================================
  // Revocation
  // ============================================================

  /**
   * Revoke a credential
   * @param {string} credentialId - The credential ID to revoke
   * @param {string} revokedBy - DID of the revoker
   * @param {string} reason - Revocation reason
   */
  revokeCredential(credentialId, revokedBy, reason = "") {
    const credential = this._credentials.get(credentialId);
    if (!credential) {
      throw new Error(`Credential not found: ${credentialId}`);
    }

    if (credential.status === CREDENTIAL_STATUS.REVOKED) {
      throw new Error(`Credential already revoked: ${credentialId}`);
    }

    // Update credential status
    credential.status = CREDENTIAL_STATUS.REVOKED;
    this._revocationSet.add(credentialId);
    this._updateCredentialStatus(credentialId, CREDENTIAL_STATUS.REVOKED);

    // Add revocation entry
    const revocation = {
      id: crypto.randomUUID(),
      credentialId,
      revokedBy,
      reason,
      revokedAt: new Date().toISOString(),
    };
    this._persistRevocation(revocation);

    this.emit("credential:revoked", {
      credentialId,
      revokedBy,
      reason,
    });

    logger.info(`[ZKP VC] Credential revoked: ${credentialId} by ${revokedBy}`);
  }

  // ============================================================
  // Query
  // ============================================================

  /**
   * List credentials with optional filter
   * @param {Object} filter - Filter options { type, issuerDid, subjectDid, status }
   * @returns {Array} Matching credentials
   */
  listCredentials(filter = {}) {
    let results = Array.from(this._credentials.values());

    if (filter.type) {
      results = results.filter((c) => c.type === filter.type);
    }
    if (filter.issuerDid) {
      results = results.filter((c) => c.issuerDid === filter.issuerDid);
    }
    if (filter.subjectDid) {
      results = results.filter((c) => c.subjectDid === filter.subjectDid);
    }
    if (filter.status) {
      results = results.filter((c) => c.status === filter.status);
    }

    return results;
  }

  /**
   * Get statistics
   * @returns {Object} Stats object
   */
  getStats() {
    const allCredentials = Array.from(this._credentials.values());
    const byType = {};

    for (const cred of allCredentials) {
      byType[cred.type] = (byType[cred.type] || 0) + 1;
    }

    return {
      totalCredentials: this._credentials.size,
      activeCredentials: allCredentials.filter(
        (c) => c.status === CREDENTIAL_STATUS.ACTIVE,
      ).length,
      revokedCredentials: this._revocationSet.size,
      byType,
      totalRevocations: this._revocationSet.size,
      totalPresentations: this._presentationCount,
    };
  }

  // ============================================================
  // Configuration
  // ============================================================

  /**
   * Update configuration
   * @param {Object} updates - Config updates to merge
   */
  configure(updates) {
    this.config = { ...this.config, ...updates };
    logger.info("[ZKP VC] Configuration updated");
  }

  /**
   * Get current configuration
   * @returns {Object} Current config
   */
  getConfig() {
    return { ...this.config };
  }

  // ============================================================
  // Cleanup & Destroy
  // ============================================================

  /**
   * Clean up resources
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._credentials.clear();
    this._revocationSet.clear();
    this._presentationCount = 0;
    this.initialized = false;
    this.db = null;
    logger.info("[ZKP VC] Destroyed");
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  _persistCredential(cred) {
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO zkp_verifiable_credentials
           (id, credential_type, issuer_did, subject_did, claims, disclosed_claims,
            proof, proof_scheme, revocation_id, status, expires_at, issued_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          cred.id,
          cred.type,
          cred.issuerDid,
          cred.subjectDid,
          JSON.stringify(cred.claims),
          JSON.stringify(cred.disclosedClaims),
          JSON.stringify(cred.proof),
          cred.proofScheme,
          cred.revocationId,
          cred.status,
          cred.expiresAt,
          cred.issuedAt,
          cred.createdAt,
        );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[ZKP VC] Persist credential error:", e.message);
    }
  }

  _persistRevocation(rev) {
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          `INSERT INTO zkp_revocation_registry
           (id, credential_id, revoked_by, reason, revoked_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          rev.id,
          rev.credentialId,
          rev.revokedBy,
          rev.reason,
          rev.revokedAt,
        );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[ZKP VC] Persist revocation error:", e.message);
    }
  }

  _updateCredentialStatus(id, status) {
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          "UPDATE zkp_verifiable_credentials SET status = ? WHERE id = ?",
        )
        .run(status, id);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[ZKP VC] Update credential status error:", e.message);
    }
  }

  _hash(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  _startCleanupTimer() {
    this._cleanupTimer = setInterval(() => {
      this._cleanupExpiredCredentials();
    }, this.config.cleanupIntervalMs);

    // Don't keep process alive for cleanup
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  _cleanupExpiredCredentials() {
    const now = new Date();
    let cleaned = 0;

    for (const [id, cred] of this._credentials) {
      if (
        cred.status === CREDENTIAL_STATUS.ACTIVE &&
        cred.expiresAt &&
        new Date(cred.expiresAt) < now
      ) {
        cred.status = CREDENTIAL_STATUS.EXPIRED;
        this._updateCredentialStatus(id, CREDENTIAL_STATUS.EXPIRED);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`[ZKP VC] Cleaned up ${cleaned} expired credentials`);
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getZKPVerifiableCredentials() {
  if (!instance) {
    instance = new ZKPVerifiableCredentials();
  }
  return instance;
}

module.exports = {
  ZKPVerifiableCredentials,
  getZKPVerifiableCredentials,
  CREDENTIAL_STATUS,
  CREDENTIAL_TYPE,
  DISCLOSURE_TYPE,
};
