"use strict";

/**
 * Zero-Knowledge Proofs Manager
 *
 * Simulated ZK proof primitives (zk-SNARK, zk-STARK, Bulletproofs, PLONK)
 * using Node.js built-in crypto (SHA-256, HMAC, randomBytes).
 * Provides proof generation, verification, privacy-preserving proofs,
 * ZK-Rollup batching, and audit tooling.
 *
 * All cryptographic operations are SIMULATED for development/testing.
 * Replace with real ZK libraries (e.g. snarkjs, circom) for production.
 *
 * @module crypto/zero-knowledge-manager
 * @version 1.0.0
 */

const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROOF_TYPES = {
  SNARK: "zk-snark",
  STARK: "zk-stark",
  BULLETPROOF: "bulletproof",
  PLONK: "plonk",
  AGE: "age-proof",
  BALANCE: "balance-proof",
  SSO: "sso-privacy",
  ROLLUP: "zk-rollup",
  FILE_INTEGRITY: "file-integrity",
  QUERY_PRIVACY: "query-privacy",
  SYNC_VERIFICATION: "sync-verification",
};

const ZK_SYSTEMS = {
  snark: {
    name: "Groth16 zk-SNARK",
    provingTime: 2400,
    verifyTime: 8,
    proofSize: 128,
    setupRequired: true,
  },
  stark: {
    name: "zk-STARK",
    provingTime: 4800,
    verifyTime: 50,
    proofSize: 45000,
    setupRequired: false,
  },
  bulletproofs: {
    name: "Bulletproofs",
    provingTime: 3200,
    verifyTime: 1100,
    proofSize: 672,
    setupRequired: false,
  },
  plonk: {
    name: "PLONK",
    provingTime: 3600,
    verifyTime: 12,
    proofSize: 384,
    setupRequired: true,
  },
};

// ---------------------------------------------------------------------------
// ZeroKnowledgeManager
// ---------------------------------------------------------------------------

class ZeroKnowledgeManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialize the manager with a database instance.
   * Idempotent — calling multiple times is safe.
   * @param {object} db - Database wrapper (must expose `.db` for raw access)
   */
  async initialize(db) {
    if (this.initialized) {
      return;
    }

    this.db = db;
    await this._ensureTables();
    this.initialized = true;
    logger.info("[ZeroKnowledgeManager] Initialized");
    this.emit("initialized");
  }

  // -----------------------------------------------------------------------
  // Database setup
  // -----------------------------------------------------------------------

  async _ensureTables() {
    const raw = this.db?.db;
    if (!raw) {
      logger.warn(
        "[ZeroKnowledgeManager] No database — running in memory-only mode",
      );
      return;
    }

    raw.exec(`
      CREATE TABLE IF NOT EXISTS zk_proofs (
        id TEXT PRIMARY KEY,
        proof_type TEXT NOT NULL,
        prover_id TEXT,
        proof_data TEXT NOT NULL,
        public_inputs TEXT DEFAULT '{}',
        verification_key TEXT,
        verified INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT
      )
    `);

    raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_zk_proofs_type ON zk_proofs(proof_type)
    `);

    raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_zk_proofs_prover ON zk_proofs(prover_id)
    `);

    raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_zk_proofs_verified ON zk_proofs(verified)
    `);

    logger.info("[ZeroKnowledgeManager] Database tables ensured");
  }

  // -----------------------------------------------------------------------
  // Core ZK proof generation & verification
  // -----------------------------------------------------------------------

  /**
   * Generate a simulated ZK-SNARK proof.
   * @param {string} statement - The statement to prove
   * @param {string} witness - The private witness (secret input)
   * @param {object} [options]
   * @param {string} [options.proverId] - Prover identifier
   * @param {string} [options.proofType='zk-snark'] - Type of ZK proof
   * @param {string} [options.expiresAt] - Expiration datetime
   * @returns {{ proofId: string, proof: string, publicInputs: object, provingTimeMs: number, proofSize: number }}
   */
  async generateZKProof(statement, witness, options = {}) {
    if (!statement || !witness) {
      throw new Error("statement and witness are required");
    }

    const startTime = Date.now();
    const proofId = uuidv4();
    const proofType = options.proofType || PROOF_TYPES.SNARK;
    const proverId = options.proverId || null;

    // Simulate proof: HMAC of statement + witness
    const proofKey = crypto.randomBytes(32);
    const proof = crypto
      .createHmac("sha256", proofKey)
      .update(`${statement}:${witness}`)
      .digest("hex");

    // Generate verification key from proof key
    const verificationKey = crypto
      .createHash("sha256")
      .update(proofKey)
      .digest("hex");

    // Public inputs: commitment to the statement (not the witness)
    const statementCommitment = crypto
      .createHash("sha256")
      .update(statement)
      .digest("hex");

    const publicInputs = {
      statementHash: statementCommitment,
      proofSystem: proofType,
      timestamp: new Date().toISOString(),
    };

    // Simulate proving time jitter
    const provingTimeMs =
      Date.now() - startTime + Math.floor(Math.random() * 50);
    const proofSize = proof.length;

    // Store in DB
    this._storeProof({
      id: proofId,
      proofType,
      proverId,
      proofData: proof,
      publicInputs,
      verificationKey,
      metadata: { proofSize, provingTimeMs },
      expiresAt: options.expiresAt || null,
    });

    logger.info(
      `[ZeroKnowledgeManager] Generated ${proofType} proof ${proofId}`,
    );
    this.emit("proof:generated", { proofId, proofType });

    return {
      proofId,
      proof,
      publicInputs,
      provingTimeMs,
      proofSize,
    };
  }

  /**
   * Verify a ZK proof by ID.
   * @param {string} proofId - The proof ID to verify
   * @returns {{ valid: boolean, verificationTimeMs: number, proofType: string }}
   */
  async verifyZKProof(proofId) {
    if (!proofId) {
      throw new Error("proofId is required");
    }

    const startTime = Date.now();
    const raw = this.db?.db;

    if (!raw) {
      throw new Error("Database not available for verification");
    }

    const row = raw
      .prepare("SELECT * FROM zk_proofs WHERE id = ?")
      .get(proofId);

    if (!row) {
      throw new Error(`Proof not found: ${proofId}`);
    }

    // Simulate verification: check that proof_data and verification_key are present
    const valid = !!(row.proof_data && row.verification_key);

    // Check expiration
    if (row.expires_at) {
      const expiresAt = new Date(row.expires_at);
      if (expiresAt < new Date()) {
        logger.warn(`[ZeroKnowledgeManager] Proof ${proofId} has expired`);
        return {
          valid: false,
          verificationTimeMs: Date.now() - startTime,
          proofType: row.proof_type,
        };
      }
    }

    // Update verified flag
    if (valid) {
      raw
        .prepare("UPDATE zk_proofs SET verified = 1 WHERE id = ?")
        .run(proofId);
    }

    const verificationTimeMs =
      Date.now() - startTime + Math.floor(Math.random() * 5);

    logger.info(
      `[ZeroKnowledgeManager] Verified proof ${proofId}: valid=${valid}`,
    );
    this.emit("proof:verified", { proofId, valid });

    return {
      valid,
      verificationTimeMs,
      proofType: row.proof_type,
    };
  }

  // -----------------------------------------------------------------------
  // Privacy-preserving proofs
  // -----------------------------------------------------------------------

  /**
   * Create a ZK proof that age >= minimumAge without revealing birthDate.
   * @param {string} birthDate - ISO date string (e.g. '1990-01-15')
   * @param {number} minimumAge - Minimum age to prove
   * @returns {{ proofId: string, proof: string, claim: string, verified: boolean }}
   */
  async createAgeProof(birthDate, minimumAge) {
    if (!birthDate || minimumAge == null) {
      throw new Error("birthDate and minimumAge are required");
    }

    const birth = new Date(birthDate);
    const now = new Date();
    const age = Math.floor(
      (now.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
    );

    const meetsRequirement = age >= minimumAge;
    const claim = `age >= ${minimumAge}`;

    // Statement is the claim; witness is the actual birthdate
    const statement = `age_proof:${minimumAge}:${meetsRequirement}`;
    const witness = birthDate;

    const result = await this.generateZKProof(statement, witness, {
      proofType: PROOF_TYPES.AGE,
    });

    logger.info(
      `[ZeroKnowledgeManager] Age proof: claim="${claim}", meets=${meetsRequirement}`,
    );
    this.emit("proof:age", {
      proofId: result.proofId,
      claim,
      meetsRequirement,
    });

    return {
      proofId: result.proofId,
      proof: result.proof,
      claim,
      verified: meetsRequirement,
    };
  }

  /**
   * Prove balance >= minimum without revealing exact balance.
   * @param {number} balance - Actual balance (private)
   * @param {number} minimumBalance - Minimum balance to prove
   * @returns {{ proofId: string, proof: string, claim: string, verified: boolean }}
   */
  async createBalanceProof(balance, minimumBalance) {
    if (balance == null || minimumBalance == null) {
      throw new Error("balance and minimumBalance are required");
    }

    const meetsRequirement = balance >= minimumBalance;
    const claim = `balance >= ${minimumBalance}`;

    // Statement is the claim; witness is the actual balance
    const statement = `balance_proof:${minimumBalance}:${meetsRequirement}`;
    const witness = String(balance);

    const result = await this.generateZKProof(statement, witness, {
      proofType: PROOF_TYPES.BALANCE,
    });

    logger.info(
      `[ZeroKnowledgeManager] Balance proof: claim="${claim}", meets=${meetsRequirement}`,
    );
    this.emit("proof:balance", {
      proofId: result.proofId,
      claim,
      meetsRequirement,
    });

    return {
      proofId: result.proofId,
      proof: result.proof,
      claim,
      verified: meetsRequirement,
    };
  }

  /**
   * Selective disclosure for SSO: hash non-disclosed attributes.
   * @param {object} attributes - All SSO attributes (e.g. { name, email, age, country })
   * @param {string[]} disclosedFields - Fields to reveal (e.g. ['name', 'country'])
   * @returns {{ proofId: string, proof: string, disclosedAttributes: object, hiddenCount: number }}
   */
  async ssoPrivacyProof(attributes, disclosedFields) {
    if (!attributes || !disclosedFields) {
      throw new Error("attributes and disclosedFields are required");
    }

    const allKeys = Object.keys(attributes);
    const disclosedAttributes = {};
    const hiddenAttributes = {};

    for (const key of allKeys) {
      if (disclosedFields.includes(key)) {
        disclosedAttributes[key] = attributes[key];
      } else {
        // Hash hidden attributes
        hiddenAttributes[key] = crypto
          .createHash("sha256")
          .update(String(attributes[key]))
          .digest("hex");
      }
    }

    const hiddenCount = Object.keys(hiddenAttributes).length;

    // Statement includes disclosed fields; witness includes hidden values
    const statement = `sso_disclosure:${disclosedFields.sort().join(",")}`;
    const witness = JSON.stringify(attributes);

    const result = await this.generateZKProof(statement, witness, {
      proofType: PROOF_TYPES.SSO,
    });

    logger.info(
      `[ZeroKnowledgeManager] SSO privacy proof: ${disclosedFields.length} disclosed, ${hiddenCount} hidden`,
    );
    this.emit("proof:sso", {
      proofId: result.proofId,
      disclosedFields,
      hiddenCount,
    });

    return {
      proofId: result.proofId,
      proof: result.proof,
      disclosedAttributes,
      hiddenCount,
    };
  }

  // -----------------------------------------------------------------------
  // ZK-Rollup batching
  // -----------------------------------------------------------------------

  /**
   * Batch transactions into a ZK-Rollup.
   * Computes merkle root from transaction hashes.
   * @param {object[]} transactions - Array of transaction objects
   * @returns {{ batchId: string, merkleRoot: string, txCount: number, proof: string, compressionRatio: number }}
   */
  async createZKRollupBatch(transactions) {
    if (!Array.isArray(transactions) || transactions.length === 0) {
      throw new Error("transactions must be a non-empty array");
    }

    const batchId = uuidv4();
    const txCount = transactions.length;

    // Compute individual transaction hashes
    const txHashes = transactions.map((tx) =>
      crypto.createHash("sha256").update(JSON.stringify(tx)).digest("hex"),
    );

    // Build a simple merkle root from tx hashes
    const merkleRoot = this._computeMerkleRoot(txHashes);

    // Simulated proof of the entire batch
    const statement = `rollup_batch:${batchId}:${merkleRoot}`;
    const witness = JSON.stringify(txHashes);

    const result = await this.generateZKProof(statement, witness, {
      proofType: PROOF_TYPES.ROLLUP,
    });

    // Estimate compression ratio: batch proof vs individual tx data
    const originalSize = JSON.stringify(transactions).length;
    const proofSize = result.proof.length + merkleRoot.length;
    const compressionRatio = parseFloat(
      (originalSize / Math.max(proofSize, 1)).toFixed(2),
    );

    // Store batch metadata
    this._updateProofMetadata(result.proofId, {
      batchId,
      merkleRoot,
      txCount,
      compressionRatio,
      txHashes,
    });

    logger.info(
      `[ZeroKnowledgeManager] ZK-Rollup batch ${batchId}: ${txCount} txs, compression=${compressionRatio}x`,
    );
    this.emit("rollup:batched", { batchId, txCount, merkleRoot });

    return {
      batchId,
      merkleRoot,
      txCount,
      proof: result.proof,
      compressionRatio,
    };
  }

  /**
   * Verify a ZK-Rollup batch.
   * @param {string} batchId - The batch ID to verify
   * @returns {{ valid: boolean, batchId: string, txCount: number, verificationTimeMs: number }}
   */
  async verifyZKRollupBatch(batchId) {
    if (!batchId) {
      throw new Error("batchId is required");
    }

    const startTime = Date.now();
    const raw = this.db?.db;

    if (!raw) {
      throw new Error("Database not available for verification");
    }

    const row = raw
      .prepare(
        "SELECT * FROM zk_proofs WHERE proof_type = ? AND metadata LIKE ?",
      )
      .get(PROOF_TYPES.ROLLUP, `%${batchId}%`);

    if (!row) {
      throw new Error(`Rollup batch not found: ${batchId}`);
    }

    const metadata = this._parseJSON(row.metadata);
    const valid = !!(
      row.proof_data &&
      row.verification_key &&
      metadata.merkleRoot
    );

    if (valid) {
      raw.prepare("UPDATE zk_proofs SET verified = 1 WHERE id = ?").run(row.id);
    }

    const verificationTimeMs =
      Date.now() - startTime + Math.floor(Math.random() * 5);

    logger.info(
      `[ZeroKnowledgeManager] Verified rollup batch ${batchId}: valid=${valid}`,
    );
    this.emit("rollup:verified", { batchId, valid });

    return {
      valid,
      batchId,
      txCount: metadata.txCount || 0,
      verificationTimeMs,
    };
  }

  // -----------------------------------------------------------------------
  // Audit & integrity proofs
  // -----------------------------------------------------------------------

  /**
   * Create an audit key for selective ZK verification.
   * @param {string} scope - Audit scope (e.g. 'financial', 'compliance')
   * @param {string[]} permissions - Allowed verification types
   * @returns {{ keyId: string, scope: string, permissions: string[], publicKey: string }}
   */
  async createAuditKey(scope, permissions) {
    if (!scope || !Array.isArray(permissions)) {
      throw new Error("scope and permissions array are required");
    }

    const keyId = uuidv4();
    const keyPair = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    // Store as a proof record for auditing
    this._storeProof({
      id: keyId,
      proofType: "audit-key",
      proverId: scope,
      proofData: crypto.randomBytes(32).toString("hex"),
      publicInputs: { scope, permissions },
      verificationKey: keyPair.publicKey,
      metadata: { keyType: "audit", createdAt: new Date().toISOString() },
      expiresAt: null,
    });

    logger.info(
      `[ZeroKnowledgeManager] Created audit key ${keyId} for scope="${scope}"`,
    );
    this.emit("audit:key-created", { keyId, scope, permissions });

    return {
      keyId,
      scope,
      permissions,
      publicKey: keyPair.publicKey,
    };
  }

  /**
   * Create a file integrity proof without revealing file content.
   * @param {string} filePath - Path to the file
   * @param {string} fileHash - SHA-256 hash of the file content
   * @returns {{ proofId: string, proof: string, fileHashCommitment: string }}
   */
  async createFileIntegrityProof(filePath, fileHash) {
    if (!filePath || !fileHash) {
      throw new Error("filePath and fileHash are required");
    }

    // Create a commitment to the file hash (not the file itself)
    const salt = crypto.randomBytes(16).toString("hex");
    const fileHashCommitment = crypto
      .createHash("sha256")
      .update(`${fileHash}:${salt}`)
      .digest("hex");

    const statement = `file_integrity:${fileHashCommitment}`;
    const witness = `${filePath}:${fileHash}:${salt}`;

    const result = await this.generateZKProof(statement, witness, {
      proofType: PROOF_TYPES.FILE_INTEGRITY,
    });

    this._updateProofMetadata(result.proofId, {
      filePath,
      fileHashCommitment,
      salt,
    });

    logger.info(
      `[ZeroKnowledgeManager] File integrity proof for ${filePath}: ${result.proofId}`,
    );
    this.emit("proof:file-integrity", { proofId: result.proofId, filePath });

    return {
      proofId: result.proofId,
      proof: result.proof,
      fileHashCommitment,
    };
  }

  /**
   * Prove query result correctness without revealing the query itself.
   * @param {string} query - The private query
   * @param {string} resultHash - Hash of the query result
   * @returns {{ proofId: string, proof: string, queryCommitment: string }}
   */
  async createQueryPrivacyProof(query, resultHash) {
    if (!query || !resultHash) {
      throw new Error("query and resultHash are required");
    }

    // Commitment to the query without revealing it
    const querySalt = crypto.randomBytes(16).toString("hex");
    const queryCommitment = crypto
      .createHash("sha256")
      .update(`${query}:${querySalt}`)
      .digest("hex");

    const statement = `query_privacy:${queryCommitment}:${resultHash}`;
    const witness = `${query}:${querySalt}`;

    const result = await this.generateZKProof(statement, witness, {
      proofType: PROOF_TYPES.QUERY_PRIVACY,
    });

    this._updateProofMetadata(result.proofId, {
      queryCommitment,
      resultHash,
    });

    logger.info(
      `[ZeroKnowledgeManager] Query privacy proof: ${result.proofId}`,
    );
    this.emit("proof:query-privacy", { proofId: result.proofId });

    return {
      proofId: result.proofId,
      proof: result.proof,
      queryCommitment,
    };
  }

  /**
   * Prove sync state matches without revealing data.
   * @param {string} localState - Local state representation (private)
   * @param {string} remoteStateHash - Hash of the remote state
   * @returns {{ proofId: string, proof: string, stateCommitment: string }}
   */
  async createSyncVerificationProof(localState, remoteStateHash) {
    if (!localState || !remoteStateHash) {
      throw new Error("localState and remoteStateHash are required");
    }

    // Compute local state hash and compare
    const localStateHash = crypto
      .createHash("sha256")
      .update(localState)
      .digest("hex");

    const stateCommitment = crypto
      .createHash("sha256")
      .update(`${localStateHash}:${remoteStateHash}`)
      .digest("hex");

    const statement = `sync_verification:${stateCommitment}`;
    const witness = localState;

    const result = await this.generateZKProof(statement, witness, {
      proofType: PROOF_TYPES.SYNC_VERIFICATION,
    });

    this._updateProofMetadata(result.proofId, {
      stateCommitment,
      statesMatch: localStateHash === remoteStateHash,
    });

    logger.info(
      `[ZeroKnowledgeManager] Sync verification proof: ${result.proofId}, match=${localStateHash === remoteStateHash}`,
    );
    this.emit("proof:sync-verification", {
      proofId: result.proofId,
      statesMatch: localStateHash === remoteStateHash,
    });

    return {
      proofId: result.proofId,
      proof: result.proof,
      stateCommitment,
    };
  }

  // -----------------------------------------------------------------------
  // Benchmarking
  // -----------------------------------------------------------------------

  /**
   * Return simulated benchmark results for different ZK systems.
   * @returns {{ snark: object, stark: object, bulletproofs: object, plonk: object }}
   */
  async benchmarkSystems() {
    const results = {};

    for (const [key, system] of Object.entries(ZK_SYSTEMS)) {
      // Add realistic jitter to simulated timings
      const provingJitter = Math.floor(Math.random() * 200) - 100;
      const verifyJitter = Math.floor(Math.random() * 5) - 2;

      results[key] = {
        name: system.name,
        provingTime: Math.max(1, system.provingTime + provingJitter),
        verifyTime: Math.max(1, system.verifyTime + verifyJitter),
        proofSize: system.proofSize,
        setupRequired: system.setupRequired,
      };
    }

    logger.info(
      "[ZeroKnowledgeManager] Benchmark completed for all ZK systems",
    );
    this.emit("benchmark:completed", results);

    return results;
  }

  // -----------------------------------------------------------------------
  // Statistics
  // -----------------------------------------------------------------------

  /**
   * Return aggregate counts from the proof store.
   * @returns {{ total: number, verified: number, unverified: number, byType: object }}
   */
  async getStats() {
    const raw = this.db?.db;
    const stats = {
      total: 0,
      verified: 0,
      unverified: 0,
      byType: {},
    };

    if (!raw) {
      return stats;
    }

    const totalRow = raw.prepare("SELECT COUNT(*) as cnt FROM zk_proofs").get();
    stats.total = totalRow?.cnt || 0;

    const verifiedRow = raw
      .prepare("SELECT COUNT(*) as cnt FROM zk_proofs WHERE verified = 1")
      .get();
    stats.verified = verifiedRow?.cnt || 0;
    stats.unverified = stats.total - stats.verified;

    const typeRows = raw
      .prepare(
        "SELECT proof_type, COUNT(*) as cnt FROM zk_proofs GROUP BY proof_type",
      )
      .all();

    for (const row of typeRows) {
      stats.byType[row.proof_type] = row.cnt;
    }

    return stats;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Persist a proof record to the database (if available).
   * @private
   */
  _storeProof({
    id,
    proofType,
    proverId,
    proofData,
    publicInputs,
    verificationKey,
    metadata,
    expiresAt,
  }) {
    const raw = this.db?.db;
    if (!raw) {
      return;
    }

    try {
      raw
        .prepare(
          `INSERT INTO zk_proofs (id, proof_type, prover_id, proof_data, public_inputs, verification_key, metadata, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          proofType,
          proverId || null,
          proofData,
          JSON.stringify(publicInputs || {}),
          verificationKey || null,
          JSON.stringify(metadata || {}),
          expiresAt || null,
        );
    } catch (err) {
      logger.error(`[ZeroKnowledgeManager] Failed to store proof ${id}:`, err);
    }
  }

  /**
   * Update metadata on an existing proof record.
   * @private
   */
  _updateProofMetadata(proofId, additionalMetadata) {
    const raw = this.db?.db;
    if (!raw) {
      return;
    }

    try {
      const row = raw
        .prepare("SELECT metadata FROM zk_proofs WHERE id = ?")
        .get(proofId);

      if (!row) {
        return;
      }

      const existing = this._parseJSON(row.metadata);
      const merged = { ...existing, ...additionalMetadata };

      raw
        .prepare("UPDATE zk_proofs SET metadata = ? WHERE id = ?")
        .run(JSON.stringify(merged), proofId);
    } catch (err) {
      logger.error(
        `[ZeroKnowledgeManager] Failed to update metadata for ${proofId}:`,
        err,
      );
    }
  }

  /**
   * Compute a simple merkle root from an array of hex hashes.
   * @private
   */
  _computeMerkleRoot(hashes) {
    if (hashes.length === 0) {
      return crypto.createHash("sha256").update("empty").digest("hex");
    }

    let level = [...hashes];

    while (level.length > 1) {
      const nextLevel = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        const combined = crypto
          .createHash("sha256")
          .update(left + right)
          .digest("hex");
        nextLevel.push(combined);
      }
      level = nextLevel;
    }

    return level[0];
  }

  /**
   * Safely parse a JSON string.
   * @private
   */
  _parseJSON(str) {
    if (!str) {
      return {};
    }
    if (typeof str === "object") {
      return str;
    }
    try {
      return JSON.parse(str);
    } catch {
      return {};
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance = null;

/**
 * Get or create the ZeroKnowledgeManager singleton.
 * @returns {ZeroKnowledgeManager}
 */
function getZeroKnowledgeManager() {
  if (!instance) {
    instance = new ZeroKnowledgeManager();
  }
  return instance;
}

module.exports = { ZeroKnowledgeManager, getZeroKnowledgeManager };
