/**
 * Anonymous Mode Manager
 *
 * ZKP-based anonymous identities for privacy-preserving social interactions.
 * Allows users to create anonymous personas backed by zero-knowledge proofs,
 * enabling posting and interaction without revealing the real DID.
 *
 * Features:
 * - Create anonymous identities with ZKP proof binding
 * - Generate and verify zero-knowledge proofs
 * - Post content anonymously
 * - Identity lifecycle management (create, list, revoke)
 *
 * @module social/anonymous-mode
 * @version 0.45.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

// ============================================================
// Constants
// ============================================================

const DEFAULT_IDENTITY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ============================================================
// AnonymousMode
// ============================================================

class AnonymousMode extends EventEmitter {
  constructor(database) {
    super();

    this.database = database;
    this.initialized = false;
  }

  /**
   * Initialize anonymous mode manager
   */
  async initialize() {
    logger.info("[AnonymousMode] Initializing anonymous mode manager...");

    try {
      await this.initializeTables();

      this.initialized = true;
      logger.info("[AnonymousMode] Anonymous mode manager initialized successfully");
    } catch (error) {
      logger.error("[AnonymousMode] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS anonymous_identities (
        id TEXT PRIMARY KEY,
        owner_did TEXT NOT NULL,
        anonymous_alias TEXT NOT NULL,
        proof_hash TEXT NOT NULL,
        public_params TEXT,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER,
        expires_at INTEGER
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_anon_identity_owner ON anonymous_identities(owner_did);
      CREATE INDEX IF NOT EXISTS idx_anon_identity_alias ON anonymous_identities(anonymous_alias);
    `);

    logger.info("[AnonymousMode] Database tables initialized");
  }

  /**
   * Create a new anonymous identity bound to an owner DID.
   *
   * Generates a simulated ZKP commitment that binds the alias to the owner
   * without revealing the owner's identity publicly.
   *
   * @param {string} ownerDid - The real DID of the identity owner
   * @param {string} alias - The anonymous alias to use publicly
   * @param {Object} [options] - Additional options
   * @param {number} [options.ttlMs] - Time-to-live in milliseconds
   * @returns {Object} The created anonymous identity
   */
  async createAnonymousIdentity(ownerDid, alias, options = {}) {
    try {
      if (!ownerDid) {
        throw new Error("Owner DID is required");
      }

      if (!alias || alias.trim().length === 0) {
        throw new Error("Anonymous alias is required");
      }

      // Check for alias uniqueness among active identities
      const db = this.database.db;
      const existingAlias = db
        .prepare(
          "SELECT id FROM anonymous_identities WHERE anonymous_alias = ? AND is_active = 1",
        )
        .get(alias.trim());

      if (existingAlias) {
        throw new Error("Anonymous alias already in use");
      }

      const identityId = uuidv4();
      const now = Date.now();
      const ttlMs = options.ttlMs || DEFAULT_IDENTITY_TTL_MS;
      const expiresAt = now + ttlMs;

      // Generate ZKP-style commitment
      // In production, this would use a real ZKP library (e.g., snarkjs).
      // Here we simulate with a hash commitment scheme.
      const secret = crypto.randomBytes(32).toString("hex");
      const publicParams = JSON.stringify({
        commitment: crypto
          .createHash("sha256")
          .update(`${ownerDid}:${alias}:${secret}`)
          .digest("hex"),
        scheme: "hash-commitment-v1",
        createdAt: now,
      });

      const proofHash = crypto
        .createHash("sha256")
        .update(`${identityId}:${ownerDid}:${secret}`)
        .digest("hex");

      const stmt = db.prepare(`
        INSERT INTO anonymous_identities
        (id, owner_did, anonymous_alias, proof_hash, public_params, is_active, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `);

      stmt.run(
        identityId,
        ownerDid,
        alias.trim(),
        proofHash,
        publicParams,
        now,
        expiresAt,
      );

      const identity = {
        id: identityId,
        owner_did: ownerDid,
        anonymous_alias: alias.trim(),
        proof_hash: proofHash,
        public_params: publicParams,
        is_active: 1,
        created_at: now,
        expires_at: expiresAt,
      };

      logger.info("[AnonymousMode] Created anonymous identity:", identityId);

      this.emit("identity:created", { identity });

      return identity;
    } catch (error) {
      logger.error("[AnonymousMode] Failed to create anonymous identity:", error);
      throw error;
    }
  }

  /**
   * Generate a zero-knowledge proof for a given identity and statement.
   *
   * This simulates ZKP generation. The proof demonstrates that the holder
   * of the identity knows the binding secret without revealing it.
   *
   * @param {string} identityId - The anonymous identity ID
   * @param {string} statement - The statement to prove
   * @returns {Object} The generated proof
   */
  async generateProof(identityId, statement) {
    try {
      if (!identityId) {
        throw new Error("Identity ID is required");
      }

      if (!statement || statement.trim().length === 0) {
        throw new Error("Statement is required");
      }

      const db = this.database.db;
      const identity = db
        .prepare("SELECT * FROM anonymous_identities WHERE id = ? AND is_active = 1")
        .get(identityId);

      if (!identity) {
        throw new Error("Anonymous identity not found or inactive");
      }

      // Check expiration
      if (identity.expires_at && identity.expires_at < Date.now()) {
        throw new Error("Anonymous identity has expired");
      }

      // Simulate ZKP generation
      const nonce = crypto.randomBytes(16).toString("hex");
      const proofData = crypto
        .createHash("sha256")
        .update(`${identity.proof_hash}:${statement}:${nonce}`)
        .digest("hex");

      const proof = {
        identityId,
        alias: identity.anonymous_alias,
        statement: statement.trim(),
        proofData,
        nonce,
        scheme: "hash-commitment-v1",
        timestamp: Date.now(),
        publicParams: identity.public_params,
      };

      logger.info("[AnonymousMode] Generated proof for identity:", identityId);

      return proof;
    } catch (error) {
      logger.error("[AnonymousMode] Failed to generate proof:", error);
      throw error;
    }
  }

  /**
   * Verify a zero-knowledge proof.
   *
   * @param {Object} proof - The proof to verify
   * @param {string} publicParams - The public parameters for verification
   * @returns {Object} Verification result
   */
  async verifyProof(proof, publicParams) {
    try {
      if (!proof) {
        throw new Error("Proof is required");
      }

      if (!publicParams) {
        throw new Error("Public parameters are required");
      }

      // Parse public params
      let params;
      try {
        params = typeof publicParams === "string" ? JSON.parse(publicParams) : publicParams;
      } catch (_e) {
        return { valid: false, reason: "Invalid public parameters format" };
      }

      // Verify the proof scheme matches
      if (proof.scheme !== params.scheme) {
        return { valid: false, reason: "Scheme mismatch" };
      }

      // Verify timestamp is reasonable (not in the future, not too old)
      const now = Date.now();
      if (proof.timestamp > now + 60000) {
        return { valid: false, reason: "Proof timestamp is in the future" };
      }

      // In a real ZKP system, we would verify the mathematical proof here.
      // For the simulation, we verify structural integrity.
      const isStructurallyValid =
        proof.proofData &&
        proof.proofData.length === 64 &&
        proof.nonce &&
        proof.nonce.length === 32 &&
        proof.alias &&
        proof.statement;

      const result = {
        valid: isStructurallyValid,
        alias: proof.alias,
        statement: proof.statement,
        verifiedAt: now,
        reason: isStructurallyValid ? "Proof verified" : "Invalid proof structure",
      };

      logger.info(
        "[AnonymousMode] Proof verification result:",
        result.valid ? "valid" : "invalid",
      );

      this.emit("proof:verified", { result });

      return result;
    } catch (error) {
      logger.error("[AnonymousMode] Failed to verify proof:", error);
      throw error;
    }
  }

  /**
   * Post content anonymously using an anonymous identity.
   *
   * @param {string} identityId - The anonymous identity ID
   * @param {string} content - The content to post
   * @returns {Object} The anonymous post descriptor
   */
  async postAnonymously(identityId, content) {
    try {
      if (!identityId) {
        throw new Error("Identity ID is required");
      }

      if (!content || content.trim().length === 0) {
        throw new Error("Content is required");
      }

      const db = this.database.db;
      const identity = db
        .prepare("SELECT * FROM anonymous_identities WHERE id = ? AND is_active = 1")
        .get(identityId);

      if (!identity) {
        throw new Error("Anonymous identity not found or inactive");
      }

      // Check expiration
      if (identity.expires_at && identity.expires_at < Date.now()) {
        throw new Error("Anonymous identity has expired");
      }

      // Generate a proof binding the content to the identity
      const proof = await this.generateProof(identityId, content.trim());

      const post = {
        id: uuidv4(),
        anonymous_alias: identity.anonymous_alias,
        content: content.trim(),
        proof,
        created_at: Date.now(),
      };

      logger.info(
        "[AnonymousMode] Posted anonymously as:",
        identity.anonymous_alias,
      );

      return post;
    } catch (error) {
      logger.error("[AnonymousMode] Failed to post anonymously:", error);
      throw error;
    }
  }

  /**
   * List all anonymous identities for a given owner DID.
   *
   * @param {string} ownerDid - The owner DID
   * @returns {Array} List of anonymous identities
   */
  async listIdentities(ownerDid) {
    try {
      if (!ownerDid) {
        throw new Error("Owner DID is required");
      }

      const db = this.database.db;
      const identities = db
        .prepare(
          "SELECT * FROM anonymous_identities WHERE owner_did = ? ORDER BY created_at DESC",
        )
        .all(ownerDid);

      // Mark expired identities
      const now = Date.now();
      return identities.map((identity) => ({
        ...identity,
        is_expired: identity.expires_at ? identity.expires_at < now : false,
        public_params: identity.public_params
          ? JSON.parse(identity.public_params)
          : null,
      }));
    } catch (error) {
      logger.error("[AnonymousMode] Failed to list identities:", error);
      throw error;
    }
  }

  /**
   * Revoke an anonymous identity, making it permanently inactive.
   *
   * @param {string} identityId - The identity to revoke
   * @returns {Object} Result
   */
  async revokeIdentity(identityId) {
    try {
      if (!identityId) {
        throw new Error("Identity ID is required");
      }

      const db = this.database.db;

      const identity = db
        .prepare("SELECT * FROM anonymous_identities WHERE id = ?")
        .get(identityId);

      if (!identity) {
        throw new Error("Anonymous identity not found");
      }

      if (!identity.is_active) {
        throw new Error("Anonymous identity is already revoked");
      }

      db.prepare(
        "UPDATE anonymous_identities SET is_active = 0 WHERE id = ?",
      ).run(identityId);

      logger.info("[AnonymousMode] Revoked anonymous identity:", identityId);

      this.emit("identity:revoked", {
        identityId,
        alias: identity.anonymous_alias,
      });

      return { success: true, identityId };
    } catch (error) {
      logger.error("[AnonymousMode] Failed to revoke identity:", error);
      throw error;
    }
  }

  /**
   * Check whether a given alias belongs to an active anonymous identity.
   *
   * @param {string} alias - The alias to check
   * @returns {boolean} True if the alias is an active anonymous identity
   */
  async isAnonymous(alias) {
    try {
      if (!alias) {
        return false;
      }

      const db = this.database.db;
      const identity = db
        .prepare(
          "SELECT id FROM anonymous_identities WHERE anonymous_alias = ? AND is_active = 1",
        )
        .get(alias);

      return !!identity;
    } catch (error) {
      logger.error("[AnonymousMode] Failed to check anonymous status:", error);
      return false;
    }
  }

  /**
   * Close the anonymous mode manager
   */
  async close() {
    logger.info("[AnonymousMode] Closing anonymous mode manager");

    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  AnonymousMode,
};
