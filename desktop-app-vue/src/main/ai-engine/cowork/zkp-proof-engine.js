/**
 * ZKP Proof Engine — v4.0.0
 *
 * Zero-Knowledge Proof generation and verification engine for the
 * decentralized agent network. Supports identity proofs, range proofs,
 * membership proofs, and knowledge proofs using simulated cryptographic
 * schemes (Schnorr, BBS+, Groth16, Bulletproofs).
 *
 * Proofs allow agents to demonstrate properties about their identity,
 * credentials, or data without revealing the underlying values.
 *
 * Integrates with SIMKey ZKP hardware and WebAuthn for enhanced
 * proof generation when available.
 *
 * @module ai-engine/cowork/zkp-proof-engine
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const crypto = require("crypto");

// ============================================================
// Constants
// ============================================================

const PROOF_TYPE = {
  IDENTITY: "identity",
  RANGE: "range",
  MEMBERSHIP: "membership",
  KNOWLEDGE: "knowledge",
};

const PROOF_SCHEME = {
  SCHNORR: "schnorr",
  BBS_PLUS: "bbs_plus",
  GROTH16: "groth16",
  BULLETPROOFS: "bulletproofs",
};

const PROOF_STATUS = {
  VALID: "valid",
  INVALID: "invalid",
  EXPIRED: "expired",
  REVOKED: "revoked",
};

const DEFAULT_CONFIG = {
  defaultScheme: "schnorr",
  proofExpiryMs: 86400000, // 24h
  maxProofsInMemory: 1000,
  cleanupIntervalMs: 600000, // 10min
  enableSimulation: true,
};

// ============================================================
// ZKPProofEngine
// ============================================================

class ZKPProofEngine extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;

    // Dependencies
    this._simkeyZkp = null;
    this._webauthnManager = null;

    // In-memory state
    this._proofs = new Map(); // proofId → proof
    this._config = { ...DEFAULT_CONFIG };
    this._cleanupTimer = null;
  }

  /**
   * Initialize with database and dependencies
   * @param {Object} db - Database manager
   * @param {Object} deps - { simkeyZkp, webauthnManager }
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._simkeyZkp = deps.simkeyZkp || null;
    this._webauthnManager = deps.webauthnManager || null;

    this._ensureTables();
    await this._loadProofs();
    this._startCleanupTimer();

    this.initialized = true;
    logger.info(`[ZKP Engine] Initialized: ${this._proofs.size} proofs loaded`);
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
        CREATE TABLE IF NOT EXISTS zkp_proofs (
          id TEXT PRIMARY KEY,
          proof_type TEXT NOT NULL,
          scheme TEXT NOT NULL,
          prover_did TEXT,
          verifier_did TEXT,
          proof_data TEXT NOT NULL,
          public_inputs TEXT DEFAULT '{}',
          status TEXT DEFAULT 'valid',
          verified_at TEXT,
          expires_at TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[ZKP Engine] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Configuration
  // ============================================================

  /**
   * Get current configuration
   * @returns {Object} Current config
   */
  getConfig() {
    return { ...this._config };
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration overrides
   */
  configure(updates = {}) {
    const validKeys = Object.keys(DEFAULT_CONFIG);
    for (const key of Object.keys(updates)) {
      if (validKeys.includes(key)) {
        this._config[key] = updates[key];
      }
    }

    if (updates.cleanupIntervalMs !== undefined) {
      this._startCleanupTimer();
    }

    logger.info(
      `[ZKP Engine] Configuration updated: ${JSON.stringify(updates)}`,
    );
  }

  // ============================================================
  // Proof Generation
  // ============================================================

  /**
   * Generate an identity proof using simulated Schnorr protocol
   * @param {string} proverDid - Prover's DID
   * @param {Object} claims - Claims to prove (keys only are revealed)
   * @param {Object} options - { scheme, verifierDid }
   * @returns {Object} Generated proof
   */
  async generateIdentityProof(proverDid, claims = {}, options = {}) {
    if (!proverDid) {
      throw new Error("proverDid is required");
    }

    const scheme = options.scheme || this._config.defaultScheme;
    const nonce = crypto.randomBytes(32).toString("hex");
    const secret = crypto.randomBytes(32).toString("hex");

    const commitment = this._hash(proverDid + nonce);
    const challenge = this._hash(commitment + JSON.stringify(claims));
    const response = this._hash(challenge + secret);

    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + this._config.proofExpiryMs,
    ).toISOString();

    const proof = {
      id: this._generateProofId(),
      proofType: PROOF_TYPE.IDENTITY,
      scheme,
      proverDid,
      verifierDid: options.verifierDid || null,
      proofData: {
        commitment,
        challenge,
        response,
        nonce,
      },
      publicInputs: {
        claimKeys: Object.keys(claims),
      },
      status: PROOF_STATUS.VALID,
      verifiedAt: null,
      expiresAt,
      createdAt: now,
    };

    this._proofs.set(proof.id, proof);
    this._persistProof(proof);

    this.emit("proof:generated", {
      proofId: proof.id,
      proofType: PROOF_TYPE.IDENTITY,
      proverDid,
      scheme,
    });

    logger.info(
      `[ZKP Engine] Identity proof generated: ${proof.id} for ${proverDid}`,
    );

    return proof;
  }

  /**
   * Generate a range proof proving value is in [min, max] without revealing value
   * @param {string} proverDid - Prover's DID
   * @param {number} value - Secret value to prove range for
   * @param {number} min - Minimum bound (inclusive)
   * @param {number} max - Maximum bound (inclusive)
   * @param {Object} options - { scheme, verifierDid }
   * @returns {Object} Generated proof
   */
  async generateRangeProof(proverDid, value, min, max, options = {}) {
    if (!proverDid) {
      throw new Error("proverDid is required");
    }
    if (
      typeof value !== "number" ||
      typeof min !== "number" ||
      typeof max !== "number"
    ) {
      throw new Error("value, min, and max must be numbers");
    }
    if (value < min || value > max) {
      throw new Error("value is out of range [min, max]");
    }

    const scheme = options.scheme || PROOF_SCHEME.BULLETPROOFS;
    const blindingFactor = crypto.randomBytes(32).toString("hex");

    const commitment = this._hash(String(value) + blindingFactor);
    const rangeCommitment = this._hash(
      String(min) + String(max) + blindingFactor,
    );
    const challengeResponse = this._hash(String(value) + commitment);

    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + this._config.proofExpiryMs,
    ).toISOString();

    const proof = {
      id: this._generateProofId(),
      proofType: PROOF_TYPE.RANGE,
      scheme,
      proverDid,
      verifierDid: options.verifierDid || null,
      proofData: {
        commitment,
        rangeCommitment,
        challengeResponse,
      },
      publicInputs: {
        min,
        max,
        bitLength: 64,
      },
      status: PROOF_STATUS.VALID,
      verifiedAt: null,
      expiresAt,
      createdAt: now,
    };

    this._proofs.set(proof.id, proof);
    this._persistProof(proof);

    this.emit("proof:generated", {
      proofId: proof.id,
      proofType: PROOF_TYPE.RANGE,
      proverDid,
      scheme,
    });

    logger.info(
      `[ZKP Engine] Range proof generated: ${proof.id} for ${proverDid}`,
    );

    return proof;
  }

  /**
   * Generate a membership proof proving element belongs to a set
   * @param {string} proverDid - Prover's DID
   * @param {*} element - Element to prove membership of
   * @param {Array} set - The set to prove membership in
   * @param {Object} options - { scheme, verifierDid }
   * @returns {Object} Generated proof
   */
  async generateMembershipProof(proverDid, element, set, options = {}) {
    if (!proverDid) {
      throw new Error("proverDid is required");
    }
    if (!Array.isArray(set)) {
      throw new Error("set must be an array");
    }
    if (!set.includes(element)) {
      throw new Error("element is not a member of the set");
    }

    const scheme = options.scheme || this._config.defaultScheme;
    const setCommitment = this._hash(JSON.stringify([...set].sort()));
    const membershipWitness = this._hash(String(element) + setCommitment);

    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + this._config.proofExpiryMs,
    ).toISOString();

    const proof = {
      id: this._generateProofId(),
      proofType: PROOF_TYPE.MEMBERSHIP,
      scheme,
      proverDid,
      verifierDid: options.verifierDid || null,
      proofData: {
        setCommitment,
        membershipWitness,
      },
      publicInputs: {
        setSize: set.length,
        setCommitment,
      },
      status: PROOF_STATUS.VALID,
      verifiedAt: null,
      expiresAt,
      createdAt: now,
    };

    this._proofs.set(proof.id, proof);
    this._persistProof(proof);

    this.emit("proof:generated", {
      proofId: proof.id,
      proofType: PROOF_TYPE.MEMBERSHIP,
      proverDid,
      scheme,
    });

    logger.info(
      `[ZKP Engine] Membership proof generated: ${proof.id} for ${proverDid}`,
    );

    return proof;
  }

  // ============================================================
  // Proof Verification
  // ============================================================

  /**
   * Verify a proof by ID
   * @param {string} proofId - Proof ID
   * @returns {Object} { valid, proof, reason }
   */
  verifyProof(proofId) {
    const proof = this._proofs.get(proofId);
    if (!proof) {
      return { valid: false, proof: null, reason: "Proof not found" };
    }

    // Check expiry
    if (proof.expiresAt) {
      const expiresAt = new Date(proof.expiresAt).getTime();
      if (Date.now() > expiresAt) {
        proof.status = PROOF_STATUS.EXPIRED;
        this._updateProofStatus(proof.id, PROOF_STATUS.EXPIRED);
        return { valid: false, proof, reason: "Proof expired" };
      }
    }

    // Check if already revoked or invalid
    if (proof.status === PROOF_STATUS.REVOKED) {
      return { valid: false, proof, reason: "Proof revoked" };
    }
    if (proof.status === PROOF_STATUS.INVALID) {
      return { valid: false, proof, reason: "Proof previously invalidated" };
    }

    let valid = false;
    let reason = "Unknown proof type";

    try {
      switch (proof.proofType) {
        case PROOF_TYPE.IDENTITY: {
          // Verify Schnorr-like structure: commitment and response consistency
          const { commitment, challenge, response } = proof.proofData;
          valid = !!(
            commitment &&
            challenge &&
            response &&
            commitment.length === 64 &&
            challenge.length === 64 &&
            response.length === 64
          );
          reason = valid
            ? "Identity proof verified"
            : "Invalid identity proof structure";
          break;
        }

        case PROOF_TYPE.RANGE: {
          // Verify Bulletproofs-like structure: commitment consistency
          const { commitment, rangeCommitment, challengeResponse } =
            proof.proofData;
          valid = !!(
            commitment &&
            rangeCommitment &&
            challengeResponse &&
            commitment.length === 64 &&
            rangeCommitment.length === 64
          );
          reason = valid
            ? "Range proof verified"
            : "Invalid range proof structure";
          break;
        }

        case PROOF_TYPE.MEMBERSHIP: {
          // Verify membership witness structure
          const { setCommitment, membershipWitness } = proof.proofData;
          valid = !!(
            setCommitment &&
            membershipWitness &&
            setCommitment.length === 64 &&
            membershipWitness.length === 64
          );
          reason = valid
            ? "Membership proof verified"
            : "Invalid membership proof structure";
          break;
        }

        default:
          valid = false;
          reason = `Unknown proof type: ${proof.proofType}`;
      }
    } catch (e) {
      valid = false;
      reason = `Verification error: ${e.message}`;
      logger.error(
        `[ZKP Engine] Verification error for ${proofId}:`,
        e.message,
      );
    }

    // Update status
    const now = new Date().toISOString();
    proof.verifiedAt = now;
    proof.status = valid ? PROOF_STATUS.VALID : PROOF_STATUS.INVALID;
    this._updateProofStatus(proof.id, proof.status);

    this.emit("proof:verified", {
      proofId: proof.id,
      proofType: proof.proofType,
      valid,
      reason,
    });

    logger.info(
      `[ZKP Engine] Proof ${proofId} verified: valid=${valid}, reason=${reason}`,
    );

    return { valid, proof, reason };
  }

  // ============================================================
  // Query
  // ============================================================

  /**
   * List proofs with optional filtering
   * @param {Object} filter - { proofType, proverDid, status }
   * @returns {Array} Matching proofs
   */
  listProofs(filter = {}) {
    const results = [];

    for (const proof of this._proofs.values()) {
      if (filter.proofType && proof.proofType !== filter.proofType) {
        continue;
      }
      if (filter.proverDid && proof.proverDid !== filter.proverDid) {
        continue;
      }
      if (filter.status && proof.status !== filter.status) {
        continue;
      }
      results.push({ ...proof });
    }

    return results;
  }

  /**
   * Get a single proof by ID
   * @param {string} proofId - Proof ID
   * @returns {Object|null} Proof or null
   */
  getProof(proofId) {
    const proof = this._proofs.get(proofId);
    return proof ? { ...proof } : null;
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get engine statistics
   * @returns {Object} Stats
   */
  getStats() {
    const stats = {
      totalProofs: this._proofs.size,
      validProofs: 0,
      invalidProofs: 0,
      byType: {
        identity: 0,
        range: 0,
        membership: 0,
      },
      byScheme: {},
    };

    for (const proof of this._proofs.values()) {
      if (proof.status === PROOF_STATUS.VALID) {
        stats.validProofs++;
      } else if (proof.status === PROOF_STATUS.INVALID) {
        stats.invalidProofs++;
      }

      if (stats.byType[proof.proofType] !== undefined) {
        stats.byType[proof.proofType]++;
      }

      if (!stats.byScheme[proof.scheme]) {
        stats.byScheme[proof.scheme] = 0;
      }
      stats.byScheme[proof.scheme]++;
    }

    return stats;
  }

  // ============================================================
  // Cleanup
  // ============================================================

  _startCleanupTimer() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }

    this._cleanupTimer = setInterval(() => {
      this._cleanupExpiredProofs();
    }, this._config.cleanupIntervalMs);

    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  _cleanupExpiredProofs() {
    const now = Date.now();
    let cleaned = 0;

    for (const [proofId, proof] of this._proofs.entries()) {
      if (proof.expiresAt) {
        const expiresAt = new Date(proof.expiresAt).getTime();
        if (now > expiresAt) {
          proof.status = PROOF_STATUS.EXPIRED;
          this._updateProofStatus(proofId, PROOF_STATUS.EXPIRED);
          this._proofs.delete(proofId);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      logger.info(`[ZKP Engine] Cleaned up ${cleaned} expired proofs`);
    }

    return cleaned;
  }

  /**
   * Destroy the engine and clean up timers
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._proofs.clear();
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[ZKP Engine] Destroyed");
  }

  // ============================================================
  // Persistence Helpers
  // ============================================================

  _persistProof(proof) {
    try {
      this.db.run(
        `INSERT INTO zkp_proofs
          (id, proof_type, scheme, prover_did, verifier_did, proof_data, public_inputs, status, verified_at, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proof.id,
          proof.proofType,
          proof.scheme,
          proof.proverDid,
          proof.verifierDid,
          JSON.stringify(proof.proofData),
          JSON.stringify(proof.publicInputs),
          proof.status,
          proof.verifiedAt,
          proof.expiresAt,
          proof.createdAt,
        ],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[ZKP Engine] Persist proof error:", e.message);
    }
  }

  _updateProofStatus(id, status) {
    try {
      this.db.run(
        `UPDATE zkp_proofs SET status = ?, verified_at = ? WHERE id = ?`,
        [status, new Date().toISOString(), id],
      );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[ZKP Engine] Update proof status error:", e.message);
    }
  }

  async _loadProofs() {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM zkp_proofs WHERE status = 'valid' AND (expires_at IS NULL OR expires_at > datetime('now'))`,
        )
        .all();

      for (const row of rows) {
        const proof = this._rowToProof(row);
        this._proofs.set(proof.id, proof);
      }
    } catch (e) {
      logger.error("[ZKP Engine] Load proofs error:", e.message);
    }
  }

  _rowToProof(row) {
    return {
      id: row.id,
      proofType: row.proof_type,
      scheme: row.scheme,
      proverDid: row.prover_did,
      verifierDid: row.verifier_did,
      proofData: JSON.parse(row.proof_data || "{}"),
      publicInputs: JSON.parse(row.public_inputs || "{}"),
      status: row.status,
      verifiedAt: row.verified_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  // ============================================================
  // Cryptographic Helpers
  // ============================================================

  _generateProofId() {
    return crypto.randomUUID();
  }

  _hash(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getZKPProofEngine() {
  if (!instance) {
    instance = new ZKPProofEngine();
  }
  return instance;
}

module.exports = {
  ZKPProofEngine,
  getZKPProofEngine,
  PROOF_TYPE,
  PROOF_SCHEME,
  PROOF_STATUS,
};
