"use strict";

/**
 * Post-Quantum Cryptography Manager
 *
 * Simulated PQC primitives (Kyber KEM, Dilithium, SPHINCS+) using
 * Node.js built-in crypto (HKDF, SHA-256, AES-256-GCM, randomBytes).
 * Provides hybrid key-exchange (X25519 + Kyber) and migration tooling.
 *
 * All cryptographic operations are SIMULATED for development/testing.
 * Replace with real PQC libraries (e.g. liboqs bindings) for production.
 *
 * @module crypto/post-quantum-manager
 * @version 1.0.0
 */

const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KYBER_LEVELS = {
  512: { pkBytes: 800, skBytes: 1632, ctBytes: 768 },
  768: { pkBytes: 1184, skBytes: 2400, ctBytes: 1088 },
  1024: { pkBytes: 1568, skBytes: 3168, ctBytes: 1568 },
};

const DILITHIUM_LEVELS = {
  2: { pkBytes: 1312, skBytes: 2528, sigBytes: 2420 },
  3: { pkBytes: 1952, skBytes: 4000, sigBytes: 3293 },
  5: { pkBytes: 2592, skBytes: 4864, sigBytes: 4595 },
};

const SPHINCS_VARIANTS = {
  "shake-128f": { pkBytes: 32, skBytes: 64, sigBytes: 17088 },
  "shake-128s": { pkBytes: 32, skBytes: 64, sigBytes: 7856 },
  "shake-256f": { pkBytes: 64, skBytes: 128, sigBytes: 49856 },
  "shake-256s": { pkBytes: 64, skBytes: 128, sigBytes: 29792 },
  "sha2-128f": { pkBytes: 32, skBytes: 64, sigBytes: 17088 },
  "sha2-128s": { pkBytes: 32, skBytes: 64, sigBytes: 7856 },
  "sha2-256f": { pkBytes: 64, skBytes: 128, sigBytes: 49856 },
  "sha2-256s": { pkBytes: 64, skBytes: 128, sigBytes: 29792 },
};

// ---------------------------------------------------------------------------
// PostQuantumManager
// ---------------------------------------------------------------------------

class PostQuantumManager extends EventEmitter {
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
    logger.info("[PostQuantumManager] Initialized");
    this.emit("initialized");
  }

  // -----------------------------------------------------------------------
  // Database setup
  // -----------------------------------------------------------------------

  async _ensureTables() {
    const raw = this.db?.db;
    if (!raw) {
      logger.warn(
        "[PostQuantumManager] No database — running in memory-only mode",
      );
      return;
    }

    raw.exec(`
      CREATE TABLE IF NOT EXISTS pq_key_pairs (
        id TEXT PRIMARY KEY,
        algorithm TEXT NOT NULL,
        security_level TEXT,
        public_key TEXT NOT NULL,
        private_key TEXT,
        key_type TEXT DEFAULT 'pqc' CHECK(key_type IN ('pqc', 'hybrid', 'classical')),
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT
      )
    `);

    raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_pq_keys_algo ON pq_key_pairs(algorithm)
    `);

    raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_pq_keys_type ON pq_key_pairs(key_type)
    `);

    logger.info("[PostQuantumManager] Database tables ensured");
  }

  // -----------------------------------------------------------------------
  // Kyber KEM (simulated)
  // -----------------------------------------------------------------------

  /**
   * Generate a simulated Kyber KEM key pair.
   * @param {number} securityLevel - 512 | 768 | 1024
   * @returns {{ id: string, publicKey: string, securityLevel: number, algorithm: string }}
   */
  async generateKyberKeyPair(securityLevel = 768) {
    const params = KYBER_LEVELS[securityLevel];
    if (!params) {
      throw new Error(
        `Invalid Kyber security level: ${securityLevel}. Must be one of: 512, 768, 1024`,
      );
    }

    const id = uuidv4();
    const publicKey = crypto.randomBytes(params.pkBytes).toString("hex");
    const privateKey = crypto.randomBytes(params.skBytes).toString("hex");

    this._storeKeyPair({
      id,
      algorithm: `kyber-${securityLevel}`,
      securityLevel: String(securityLevel),
      publicKey,
      privateKey,
      keyType: "pqc",
      metadata: { purpose: "kem" },
    });

    logger.info(
      `[PostQuantumManager] Generated Kyber-${securityLevel} key pair ${id}`,
    );
    this.emit("keypair:generated", { id, algorithm: `kyber-${securityLevel}` });

    return {
      id,
      publicKey,
      securityLevel,
      algorithm: `kyber-${securityLevel}`,
    };
  }

  /**
   * Simulate KEM encapsulation against a Kyber public key.
   * @param {string} publicKeyHex - Recipient public key (hex)
   * @returns {{ ciphertext: string, sharedSecret: string }}
   */
  async encapsulate(publicKeyHex) {
    if (!publicKeyHex || typeof publicKeyHex !== "string") {
      throw new Error("publicKeyHex is required");
    }

    // Simulated ciphertext — random bytes sized to Kyber-768 default
    const ciphertext = crypto.randomBytes(1088).toString("hex");

    // Derive a shared secret from the public key material
    const sharedSecret = crypto
      .createHmac("sha256", Buffer.from(publicKeyHex, "hex").subarray(0, 32))
      .update(Buffer.from(ciphertext, "hex").subarray(0, 32))
      .digest("hex");

    logger.info("[PostQuantumManager] KEM encapsulation completed");
    this.emit("kem:encapsulated");

    return { ciphertext, sharedSecret };
  }

  /**
   * Simulate KEM decapsulation.
   * @param {string} ciphertextHex - Ciphertext from encapsulate() (hex)
   * @param {string} privateKeyHex - Recipient private key (hex)
   * @returns {{ sharedSecret: string }}
   */
  async decapsulate(ciphertextHex, privateKeyHex) {
    if (!ciphertextHex || !privateKeyHex) {
      throw new Error("ciphertextHex and privateKeyHex are required");
    }

    const sharedSecret = crypto
      .createHmac("sha256", Buffer.from(privateKeyHex, "hex").subarray(0, 32))
      .update(Buffer.from(ciphertextHex, "hex").subarray(0, 32))
      .digest("hex");

    logger.info("[PostQuantumManager] KEM decapsulation completed");
    this.emit("kem:decapsulated");

    return { sharedSecret };
  }

  // -----------------------------------------------------------------------
  // Dilithium signatures (simulated)
  // -----------------------------------------------------------------------

  /**
   * Generate a simulated Dilithium signing key pair.
   * @param {number} securityLevel - 2 | 3 | 5
   * @returns {{ id: string, publicKey: string, securityLevel: number, algorithm: string }}
   */
  async generateDilithiumKeyPair(securityLevel = 3) {
    const params = DILITHIUM_LEVELS[securityLevel];
    if (!params) {
      throw new Error(
        `Invalid Dilithium security level: ${securityLevel}. Must be one of: 2, 3, 5`,
      );
    }

    const id = uuidv4();
    const publicKey = crypto.randomBytes(params.pkBytes).toString("hex");
    const privateKey = crypto.randomBytes(params.skBytes).toString("hex");

    this._storeKeyPair({
      id,
      algorithm: `dilithium-${securityLevel}`,
      securityLevel: String(securityLevel),
      publicKey,
      privateKey,
      keyType: "pqc",
      metadata: { purpose: "signature" },
    });

    logger.info(
      `[PostQuantumManager] Generated Dilithium-${securityLevel} key pair ${id}`,
    );
    this.emit("keypair:generated", {
      id,
      algorithm: `dilithium-${securityLevel}`,
    });

    return {
      id,
      publicKey,
      securityLevel,
      algorithm: `dilithium-${securityLevel}`,
    };
  }

  /**
   * Simulate Dilithium signing.
   * @param {string|Buffer} message - Message to sign
   * @param {string} privateKeyHex - Private key (hex)
   * @returns {{ signature: string, algorithm: string }}
   */
  async dilithiumSign(message, privateKeyHex) {
    if (!message || !privateKeyHex) {
      throw new Error("message and privateKeyHex are required");
    }

    const msgBuf = Buffer.isBuffer(message)
      ? message
      : Buffer.from(message, "utf8");
    const signature = crypto
      .createHmac("sha256", Buffer.from(privateKeyHex, "hex").subarray(0, 32))
      .update(msgBuf)
      .digest("hex");

    logger.info("[PostQuantumManager] Dilithium signature created");
    this.emit("signature:created", { algorithm: "dilithium" });

    return { signature, algorithm: "dilithium" };
  }

  /**
   * Simulate Dilithium verification.
   * @param {string|Buffer} message - Original message
   * @param {string} signature - Signature to verify (hex)
   * @param {string} publicKeyHex - Signer public key (hex)
   * @returns {{ valid: boolean, algorithm: string }}
   */
  async dilithiumVerify(message, signature, publicKeyHex) {
    if (!message || !signature || !publicKeyHex) {
      throw new Error("message, signature, and publicKeyHex are required");
    }

    // Simulated — always returns true for non-empty inputs
    logger.info("[PostQuantumManager] Dilithium signature verified");
    this.emit("signature:verified", { algorithm: "dilithium", valid: true });

    return { valid: true, algorithm: "dilithium" };
  }

  // -----------------------------------------------------------------------
  // SPHINCS+ signatures (simulated)
  // -----------------------------------------------------------------------

  /**
   * Generate a simulated SPHINCS+ signing key pair.
   * @param {string} variant - e.g. 'shake-256f', 'sha2-128s'
   * @returns {{ id: string, publicKey: string, variant: string, algorithm: string }}
   */
  async generateSphincsPlusKeyPair(variant = "shake-256f") {
    const params = SPHINCS_VARIANTS[variant];
    if (!params) {
      throw new Error(
        `Invalid SPHINCS+ variant: ${variant}. Supported: ${Object.keys(SPHINCS_VARIANTS).join(", ")}`,
      );
    }

    const id = uuidv4();
    const publicKey = crypto.randomBytes(params.pkBytes).toString("hex");
    const privateKey = crypto.randomBytes(params.skBytes).toString("hex");

    this._storeKeyPair({
      id,
      algorithm: `sphincs-plus-${variant}`,
      securityLevel: variant,
      publicKey,
      privateKey,
      keyType: "pqc",
      metadata: { purpose: "signature", variant },
    });

    logger.info(
      `[PostQuantumManager] Generated SPHINCS+-${variant} key pair ${id}`,
    );
    this.emit("keypair:generated", {
      id,
      algorithm: `sphincs-plus-${variant}`,
    });

    return {
      id,
      publicKey,
      variant,
      algorithm: `sphincs-plus-${variant}`,
    };
  }

  /**
   * Simulate SPHINCS+ signing.
   * @param {string|Buffer} message - Message to sign
   * @param {string} privateKeyHex - Private key (hex)
   * @returns {{ signature: string, algorithm: string }}
   */
  async sphincsPlusSign(message, privateKeyHex) {
    if (!message || !privateKeyHex) {
      throw new Error("message and privateKeyHex are required");
    }

    const msgBuf = Buffer.isBuffer(message)
      ? message
      : Buffer.from(message, "utf8");
    const signature = crypto
      .createHmac("sha256", Buffer.from(privateKeyHex, "hex").subarray(0, 32))
      .update(msgBuf)
      .digest("hex");

    logger.info("[PostQuantumManager] SPHINCS+ signature created");
    this.emit("signature:created", { algorithm: "sphincs-plus" });

    return { signature, algorithm: "sphincs-plus" };
  }

  /**
   * Simulate SPHINCS+ verification.
   * @param {string|Buffer} message - Original message
   * @param {string} signature - Signature to verify (hex)
   * @param {string} publicKeyHex - Signer public key (hex)
   * @returns {{ valid: boolean, algorithm: string }}
   */
  async sphincsPlusVerify(message, signature, publicKeyHex) {
    if (!message || !signature || !publicKeyHex) {
      throw new Error("message, signature, and publicKeyHex are required");
    }

    logger.info("[PostQuantumManager] SPHINCS+ signature verified");
    this.emit("signature:verified", { algorithm: "sphincs-plus", valid: true });

    return { valid: true, algorithm: "sphincs-plus" };
  }

  // -----------------------------------------------------------------------
  // Hybrid key exchange (X25519 + Kyber, simulated)
  // -----------------------------------------------------------------------

  /**
   * Simulate a hybrid key exchange combining classical X25519 with Kyber KEM.
   * Uses HKDF to merge both shared secrets.
   * @param {string} localPrivateHex - Local private key material (hex)
   * @param {string} remotePublicHex - Remote public key material (hex)
   * @returns {{ sharedSecret: string, classical: string, pqc: string }}
   */
  async hybridKeyExchange(localPrivateHex, remotePublicHex) {
    if (!localPrivateHex || !remotePublicHex) {
      throw new Error("localPrivateHex and remotePublicHex are required");
    }

    // Simulate X25519 shared secret
    const classical = crypto
      .createHmac("sha256", Buffer.from(localPrivateHex, "hex").subarray(0, 32))
      .update(Buffer.from(remotePublicHex, "hex").subarray(0, 32))
      .digest("hex");

    // Simulate Kyber shared secret
    const pqc = crypto
      .createHmac("sha256", Buffer.from(remotePublicHex, "hex").subarray(0, 32))
      .update(Buffer.from(localPrivateHex, "hex").subarray(0, 32))
      .digest("hex");

    // Combine via HKDF
    const ikm = Buffer.concat([
      Buffer.from(classical, "hex"),
      Buffer.from(pqc, "hex"),
    ]);
    const salt = Buffer.alloc(32, 0); // fixed salt for determinism in simulation
    const info = Buffer.from("chainlesschain-hybrid-kex-v1", "utf8");
    const derivedKey = crypto.hkdfSync("sha256", ikm, salt, info, 32);
    const sharedSecret = Buffer.from(derivedKey).toString("hex");

    logger.info(
      "[PostQuantumManager] Hybrid key exchange completed (X25519 + Kyber)",
    );
    this.emit("hybrid:exchanged");

    return { sharedSecret, classical, pqc };
  }

  // -----------------------------------------------------------------------
  // Audit & migration tooling
  // -----------------------------------------------------------------------

  /**
   * Scan stored keys and classify them by type.
   * @returns {{ totalKeys: number, classicalKeys: number, pqcKeys: number, hybridKeys: number, recommendations: string[] }}
   */
  async auditScan() {
    const raw = this.db?.db;
    const result = {
      totalKeys: 0,
      classicalKeys: 0,
      pqcKeys: 0,
      hybridKeys: 0,
      recommendations: [],
    };

    if (!raw) {
      result.recommendations.push(
        "No database connected — unable to audit stored keys",
      );
      return result;
    }

    const rows = raw
      .prepare(
        `SELECT key_type, COUNT(*) as cnt FROM pq_key_pairs GROUP BY key_type`,
      )
      .all();

    for (const row of rows) {
      const count = row.cnt || 0;
      result.totalKeys += count;
      if (row.key_type === "classical") {
        result.classicalKeys += count;
      } else if (row.key_type === "pqc") {
        result.pqcKeys += count;
      } else if (row.key_type === "hybrid") {
        result.hybridKeys += count;
      }
    }

    // Build recommendations
    if (result.classicalKeys > 0) {
      result.recommendations.push(
        `${result.classicalKeys} classical key(s) found — consider migrating to PQC or hybrid`,
      );
    }
    if (result.pqcKeys === 0 && result.hybridKeys === 0) {
      result.recommendations.push(
        "No post-quantum keys detected — generate Kyber/Dilithium keys to future-proof",
      );
    }
    if (result.hybridKeys > 0 && result.classicalKeys === 0) {
      result.recommendations.push(
        "All keys are hybrid or PQC — good post-quantum readiness",
      );
    }
    if (result.totalKeys === 0) {
      result.recommendations.push(
        "Key store is empty — generate initial key pairs",
      );
    }

    logger.info(
      `[PostQuantumManager] Audit scan: ${result.totalKeys} total, ${result.pqcKeys} PQC, ${result.hybridKeys} hybrid, ${result.classicalKeys} classical`,
    );
    this.emit("audit:completed", result);

    return result;
  }

  /**
   * Generate a migration plan for transitioning classical keys to PQC.
   * @param {object} [options]
   * @param {string} [options.targetAlgorithm='kyber-768'] - Target PQC algorithm
   * @param {boolean} [options.includeHybrid=true] - Use hybrid mode during transition
   * @param {number} [options.batchSize=50] - Keys per batch
   * @returns {{ steps: object[], estimatedTime: string, affectedKeys: number }}
   */
  async migrationWizard(options = {}) {
    const {
      targetAlgorithm = "kyber-768",
      includeHybrid = true,
      batchSize = 50,
    } = options;

    const audit = await this.auditScan();
    const affectedKeys = audit.classicalKeys;

    const steps = [];

    steps.push({
      order: 1,
      action: "audit",
      description: "Scan all key stores and classify key types",
      status: "completed",
      details: {
        totalKeys: audit.totalKeys,
        classicalKeys: audit.classicalKeys,
      },
    });

    if (affectedKeys > 0 && includeHybrid) {
      steps.push({
        order: 2,
        action: "generate-hybrid-pairs",
        description: `Generate hybrid key pairs (classical + ${targetAlgorithm}) for ${affectedKeys} key(s)`,
        status: "pending",
        batchSize,
      });

      steps.push({
        order: 3,
        action: "dual-mode-transition",
        description:
          "Run dual-mode (classical + PQC) to validate interoperability",
        status: "pending",
      });
    }

    steps.push({
      order: steps.length + 1,
      action: "generate-pqc-replacements",
      description: `Generate pure ${targetAlgorithm} replacements`,
      status: "pending",
    });

    steps.push({
      order: steps.length + 1,
      action: "revoke-classical",
      description: "Revoke and archive classical keys",
      status: "pending",
    });

    steps.push({
      order: steps.length + 1,
      action: "verify",
      description: "Run verification audit to confirm full PQC migration",
      status: "pending",
    });

    const batches = Math.max(1, Math.ceil(affectedKeys / batchSize));
    const estimatedTime = `${batches * 2}–${batches * 5} minutes`;

    logger.info(
      `[PostQuantumManager] Migration plan: ${steps.length} steps, ${affectedKeys} affected keys`,
    );
    this.emit("migration:planned", { steps: steps.length, affectedKeys });

    return { steps, estimatedTime, affectedKeys };
  }

  /**
   * Configure hybrid fallback mode settings.
   * @param {object} [options]
   * @param {string} [options.mode='hybrid'] - 'pqc-only' | 'hybrid' | 'classical-fallback'
   * @param {string} [options.classicalAlgorithm='x25519'] - Classical algorithm
   * @param {string} [options.pqcAlgorithm='kyber-768'] - PQC algorithm
   * @returns {{ mode: string, classical: object, pqc: object }}
   */
  async hybridFallback(options = {}) {
    const {
      mode = "hybrid",
      classicalAlgorithm = "x25519",
      pqcAlgorithm = "kyber-768",
    } = options;

    const validModes = ["pqc-only", "hybrid", "classical-fallback"];
    if (!validModes.includes(mode)) {
      throw new Error(
        `Invalid mode: ${mode}. Must be one of: ${validModes.join(", ")}`,
      );
    }

    const config = {
      mode,
      classical: {
        algorithm: classicalAlgorithm,
        enabled: mode !== "pqc-only",
        role: mode === "classical-fallback" ? "primary" : "secondary",
      },
      pqc: {
        algorithm: pqcAlgorithm,
        enabled: mode !== "classical-fallback",
        role: mode === "classical-fallback" ? "secondary" : "primary",
      },
    };

    logger.info(
      `[PostQuantumManager] Hybrid fallback configured: mode=${mode}`,
    );
    this.emit("hybrid:configured", config);

    return config;
  }

  // -----------------------------------------------------------------------
  // Statistics
  // -----------------------------------------------------------------------

  /**
   * Return aggregate counts from the key store.
   * @returns {{ total: number, byAlgorithm: object, byType: object }}
   */
  async getStats() {
    const raw = this.db?.db;
    const stats = {
      total: 0,
      byAlgorithm: {},
      byType: {},
    };

    if (!raw) {
      return stats;
    }

    const algoRows = raw
      .prepare(
        `SELECT algorithm, COUNT(*) as cnt FROM pq_key_pairs GROUP BY algorithm`,
      )
      .all();

    for (const row of algoRows) {
      stats.byAlgorithm[row.algorithm] = row.cnt;
      stats.total += row.cnt;
    }

    const typeRows = raw
      .prepare(
        `SELECT key_type, COUNT(*) as cnt FROM pq_key_pairs GROUP BY key_type`,
      )
      .all();

    for (const row of typeRows) {
      stats.byType[row.key_type] = row.cnt;
    }

    return stats;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Persist a key pair to the database (if available).
   * @private
   */
  _storeKeyPair({
    id,
    algorithm,
    securityLevel,
    publicKey,
    privateKey,
    keyType,
    metadata,
  }) {
    const raw = this.db?.db;
    if (!raw) {
      return;
    }

    try {
      raw
        .prepare(
          `INSERT INTO pq_key_pairs (id, algorithm, security_level, public_key, private_key, key_type, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          algorithm,
          securityLevel || null,
          publicKey,
          privateKey || null,
          keyType || "pqc",
          JSON.stringify(metadata || {}),
        );
    } catch (err) {
      logger.error(`[PostQuantumManager] Failed to store key pair ${id}:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance = null;

/**
 * Get or create the PostQuantumManager singleton.
 * @returns {PostQuantumManager}
 */
function getPostQuantumManager() {
  if (!instance) {
    instance = new PostQuantumManager();
  }
  return instance;
}

module.exports = { PostQuantumManager, getPostQuantumManager };
