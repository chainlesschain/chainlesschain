"use strict";

/**
 * Homomorphic Encryption Manager
 *
 * Simulated HE primitives (Paillier, BFV, CKKS, TFHE) using Node.js
 * built-in crypto (SHA-256, randomBytes, BigInt arithmetic).
 * Provides key generation, encrypt/decrypt, homomorphic operations,
 * encrypted SQL queries, privacy-preserving ML inference, and
 * multi-agent secure computation.
 *
 * All cryptographic operations are SIMULATED for development/testing.
 * Replace with real HE libraries (e.g. node-seal, tfhe-rs) for production.
 *
 * @module crypto/homomorphic-manager
 * @version 1.0.0
 */

const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HE_SCHEMES = {
  PAILLIER: "paillier",
  BFV: "bfv",
  CKKS: "ckks",
  TFHE: "tfhe",
};

const TFHE_GATES = ["AND", "OR", "XOR", "NAND", "NOT"];

const TIERING_STRATEGIES = {
  AUTO: "auto",
  PHE_FIRST: "phe-first",
  FHE_ALWAYS: "fhe-always",
};

const ANALYSIS_OPERATIONS = ["sum", "avg", "count", "min", "max"];

// ---------------------------------------------------------------------------
// HomomorphicManager
// ---------------------------------------------------------------------------

class HomomorphicManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this.gpuAcceleration = false;
    this.tieringStrategy = TIERING_STRATEGIES.AUTO;
    this.tfheContexts = new Map();
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
    logger.info("[HomomorphicManager] Initialized");
    this.emit("initialized");
  }

  // -----------------------------------------------------------------------
  // Database setup
  // -----------------------------------------------------------------------

  async _ensureTables() {
    const raw = this.db?.db;
    if (!raw) {
      logger.warn(
        "[HomomorphicManager] No database — running in memory-only mode",
      );
      return;
    }

    raw.exec(`
      CREATE TABLE IF NOT EXISTS he_computations (
        id TEXT PRIMARY KEY,
        scheme TEXT NOT NULL CHECK(scheme IN ('paillier', 'bfv', 'ckks', 'tfhe')),
        operation TEXT NOT NULL,
        input_count INTEGER DEFAULT 0,
        result_encrypted TEXT,
        metadata TEXT DEFAULT '{}',
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_he_comp_scheme ON he_computations(scheme)
    `);

    raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_he_comp_operation ON he_computations(operation)
    `);

    logger.info("[HomomorphicManager] Database tables ensured");
  }

  // -----------------------------------------------------------------------
  // Paillier cryptosystem (simulated)
  // -----------------------------------------------------------------------

  /**
   * Generate a simulated Paillier key pair.
   * Uses random BigInts to simulate n, g, lambda, mu parameters.
   * @param {number} [bitLength=2048] - Key bit length
   * @returns {{ publicKey: { n: string, g: string }, privateKey: { lambda: string, mu: string }, bitLength: number }}
   */
  async paillierKeyGen(bitLength = 2048) {
    const startTime = Date.now();

    // Simulate large prime generation with random bytes
    const byteLen = Math.ceil(bitLength / 8);
    const p = BigInt("0x" + crypto.randomBytes(byteLen / 2).toString("hex"));
    const q = BigInt("0x" + crypto.randomBytes(byteLen / 2).toString("hex"));

    // n = p * q (simulated RSA modulus)
    const n = p * q;
    // g = n + 1 (standard Paillier choice)
    const g = n + 1n;
    // lambda = lcm(p-1, q-1) simulated
    const pMinus1 = p - 1n;
    const qMinus1 = q - 1n;
    const lambda = (pMinus1 * qMinus1) / this._bigIntGcd(pMinus1, qMinus1);
    // mu = modular inverse of L(g^lambda mod n^2) mod n (simulated)
    const mu = BigInt("0x" + crypto.randomBytes(byteLen / 2).toString("hex"));

    const durationMs = Date.now() - startTime;

    const result = {
      publicKey: { n: n.toString(), g: g.toString() },
      privateKey: { lambda: lambda.toString(), mu: mu.toString() },
      bitLength,
    };

    this._storeComputation({
      scheme: HE_SCHEMES.PAILLIER,
      operation: "keygen",
      inputCount: 0,
      resultEncrypted: crypto
        .createHash("sha256")
        .update(n.toString())
        .digest("hex"),
      metadata: { bitLength, durationMs },
      durationMs,
    });

    logger.info(
      `[HomomorphicManager] Paillier keygen: ${bitLength}-bit in ${durationMs}ms`,
    );
    this.emit("paillier:keygen", { bitLength, durationMs });

    return result;
  }

  /**
   * Simulate Paillier encryption.
   * @param {number|string} plaintext - Value to encrypt
   * @param {object} publicKey - Public key { n, g }
   * @returns {{ ciphertext: string, scheme: string }}
   */
  async paillierEncrypt(plaintext, publicKey) {
    if (plaintext == null || !publicKey) {
      throw new Error("plaintext and publicKey are required");
    }

    const startTime = Date.now();
    const m = BigInt(plaintext);
    const n = BigInt(publicKey.n);

    // Simulated encryption: c = g^m * r^n mod n^2
    // Use hash-based simulation for deterministic-looking ciphertext
    const r = BigInt("0x" + crypto.randomBytes(32).toString("hex"));
    const nSquared = n * n;

    // Simplified simulation: combine message and randomness
    const combined = ((m + 1n) * r) % (nSquared > 0n ? nSquared : 1n);
    const ciphertext = combined.toString();

    const durationMs = Date.now() - startTime;

    this._storeComputation({
      scheme: HE_SCHEMES.PAILLIER,
      operation: "encrypt",
      inputCount: 1,
      resultEncrypted: crypto
        .createHash("sha256")
        .update(ciphertext)
        .digest("hex"),
      metadata: { durationMs },
      durationMs,
    });

    logger.info("[HomomorphicManager] Paillier encrypt completed");
    this.emit("paillier:encrypt", { scheme: HE_SCHEMES.PAILLIER });

    return { ciphertext, scheme: HE_SCHEMES.PAILLIER };
  }

  /**
   * Simulate Paillier decryption.
   * @param {string} ciphertext - Encrypted value
   * @param {object} privateKey - Private key { lambda, mu }
   * @returns {{ plaintext: string, scheme: string }}
   */
  async paillierDecrypt(ciphertext, privateKey) {
    if (!ciphertext || !privateKey) {
      throw new Error("ciphertext and privateKey are required");
    }

    const startTime = Date.now();

    // Simulated decryption: extract a deterministic value from ciphertext
    const c = BigInt(ciphertext);
    const lambda = BigInt(privateKey.lambda);
    const mu = BigInt(privateKey.mu);

    // Simulated: hash the ciphertext with keys to produce a "decrypted" value
    const hash = crypto
      .createHash("sha256")
      .update(`${c}:${lambda}:${mu}`)
      .digest("hex");

    // Use first 8 hex chars as a numeric plaintext
    const plaintext = parseInt(hash.substring(0, 8), 16).toString();
    const durationMs = Date.now() - startTime;

    this._storeComputation({
      scheme: HE_SCHEMES.PAILLIER,
      operation: "decrypt",
      inputCount: 1,
      resultEncrypted: null,
      metadata: { durationMs },
      durationMs,
    });

    logger.info("[HomomorphicManager] Paillier decrypt completed");
    this.emit("paillier:decrypt", { scheme: HE_SCHEMES.PAILLIER });

    return { plaintext, scheme: HE_SCHEMES.PAILLIER };
  }

  /**
   * Simulate Paillier homomorphic addition on two ciphertexts.
   * In real Paillier: E(a) * E(b) mod n^2 = E(a + b)
   * @param {string} ciphertext1 - First encrypted value
   * @param {string} ciphertext2 - Second encrypted value
   * @param {object} publicKey - Public key { n, g }
   * @returns {{ result: string, operation: string }}
   */
  async paillierAdd(ciphertext1, ciphertext2, publicKey) {
    if (!ciphertext1 || !ciphertext2 || !publicKey) {
      throw new Error("ciphertext1, ciphertext2, and publicKey are required");
    }

    const startTime = Date.now();
    const c1 = BigInt(ciphertext1);
    const c2 = BigInt(ciphertext2);
    const n = BigInt(publicKey.n);
    const nSquared = n * n;

    // Simulated homomorphic addition: c1 * c2 mod n^2
    const resultBig = (c1 * c2) % (nSquared > 0n ? nSquared : 1n);
    const result = resultBig.toString();
    const durationMs = Date.now() - startTime;

    this._storeComputation({
      scheme: HE_SCHEMES.PAILLIER,
      operation: "add",
      inputCount: 2,
      resultEncrypted: crypto.createHash("sha256").update(result).digest("hex"),
      metadata: { durationMs },
      durationMs,
    });

    logger.info("[HomomorphicManager] Paillier homomorphic add completed");
    this.emit("paillier:add", { operation: "add", durationMs });

    return { result, operation: "add" };
  }

  /**
   * Simulate Paillier homomorphic scalar multiplication.
   * In real Paillier: E(a)^k mod n^2 = E(a * k)
   * @param {string} ciphertext - Encrypted value
   * @param {number|string} scalar - Scalar multiplier
   * @param {object} publicKey - Public key { n, g }
   * @returns {{ result: string, operation: string }}
   */
  async paillierScalarMultiply(ciphertext, scalar, publicKey) {
    if (!ciphertext || scalar == null || !publicKey) {
      throw new Error("ciphertext, scalar, and publicKey are required");
    }

    const startTime = Date.now();
    const c = BigInt(ciphertext);
    const k = BigInt(scalar);
    const n = BigInt(publicKey.n);
    const nSquared = n * n;

    // Simulated scalar multiply: c^k mod n^2
    const modulus = nSquared > 0n ? nSquared : 1n;
    const resultBig = this._bigIntModPow(c, k, modulus);
    const result = resultBig.toString();
    const durationMs = Date.now() - startTime;

    this._storeComputation({
      scheme: HE_SCHEMES.PAILLIER,
      operation: "scalar_multiply",
      inputCount: 1,
      resultEncrypted: crypto.createHash("sha256").update(result).digest("hex"),
      metadata: { scalar: scalar.toString(), durationMs },
      durationMs,
    });

    logger.info("[HomomorphicManager] Paillier scalar multiply completed");
    this.emit("paillier:scalar_multiply", {
      operation: "scalar_multiply",
      durationMs,
    });

    return { result, operation: "scalar_multiply" };
  }

  // -----------------------------------------------------------------------
  // TFHE (simulated)
  // -----------------------------------------------------------------------

  /**
   * Initialize a simulated TFHE context.
   * @param {number} [securityParam=128] - Security parameter in bits
   * @returns {{ contextId: string, securityParam: number, bootstrapKeySize: number }}
   */
  async tfheInit(securityParam = 128) {
    const startTime = Date.now();
    const contextId = uuidv4();

    // Simulated bootstrap key size (bytes) scales with security parameter
    const bootstrapKeySize = securityParam * securityParam * 8;

    this.tfheContexts.set(contextId, {
      securityParam,
      bootstrapKeySize,
      createdAt: new Date().toISOString(),
      secret: crypto.randomBytes(securityParam / 8).toString("hex"),
    });

    const durationMs = Date.now() - startTime;

    this._storeComputation({
      scheme: HE_SCHEMES.TFHE,
      operation: "init",
      inputCount: 0,
      resultEncrypted: null,
      metadata: { contextId, securityParam, bootstrapKeySize, durationMs },
      durationMs,
    });

    logger.info(
      `[HomomorphicManager] TFHE context ${contextId} initialized: ${securityParam}-bit security`,
    );
    this.emit("tfhe:init", { contextId, securityParam });

    return { contextId, securityParam, bootstrapKeySize };
  }

  /**
   * Simulate TFHE gate evaluation (AND, OR, XOR, NAND, NOT).
   * @param {string} gate - Gate type (AND/OR/XOR/NAND/NOT)
   * @param {string} input1 - First encrypted bit
   * @param {string} input2 - Second encrypted bit (ignored for NOT)
   * @param {string} contextId - TFHE context ID
   * @returns {{ result: string, gate: string, evaluationTimeMs: number }}
   */
  async tfheEvalGate(gate, input1, input2, contextId) {
    if (!gate || !input1 || !contextId) {
      throw new Error("gate, input1, and contextId are required");
    }

    const gateUpper = gate.toUpperCase();
    if (!TFHE_GATES.includes(gateUpper)) {
      throw new Error(
        `Unsupported gate: ${gate}. Supported: ${TFHE_GATES.join(", ")}`,
      );
    }

    if (gateUpper !== "NOT" && !input2) {
      throw new Error("input2 is required for binary gates");
    }

    const ctx = this.tfheContexts.get(contextId);
    if (!ctx) {
      throw new Error(`TFHE context not found: ${contextId}`);
    }

    const startTime = Date.now();

    // Simulate gate evaluation: hash inputs with context secret
    const gateInput = gateUpper === "NOT" ? input1 : `${input1}:${input2}`;
    const result = crypto
      .createHmac("sha256", ctx.secret)
      .update(`${gateUpper}:${gateInput}`)
      .digest("hex");

    // Simulated evaluation time with bootstrapping overhead
    const baseTime = gateUpper === "NOT" ? 5 : 12;
    const evaluationTimeMs =
      Date.now() - startTime + baseTime + Math.floor(Math.random() * 3);

    this._storeComputation({
      scheme: HE_SCHEMES.TFHE,
      operation: `gate_${gateUpper.toLowerCase()}`,
      inputCount: gateUpper === "NOT" ? 1 : 2,
      resultEncrypted: result,
      metadata: { gate: gateUpper, contextId, evaluationTimeMs },
      durationMs: evaluationTimeMs,
    });

    logger.info(
      `[HomomorphicManager] TFHE ${gateUpper} gate evaluated in ${evaluationTimeMs}ms`,
    );
    this.emit("tfhe:gate", { gate: gateUpper, contextId, evaluationTimeMs });

    return { result, gate: gateUpper, evaluationTimeMs };
  }

  // -----------------------------------------------------------------------
  // Encrypted SQL query (simulated BFV)
  // -----------------------------------------------------------------------

  /**
   * Simulate executing an SQL query on encrypted data using BFV scheme.
   * @param {string} query - SQL query string
   * @param {object[]} encryptedData - Array of encrypted records
   * @returns {{ resultCount: number, queryTimeMs: number, scheme: string }}
   */
  async encryptedSQLQuery(query, encryptedData) {
    if (!query || !encryptedData) {
      throw new Error("query and encryptedData are required");
    }

    const startTime = Date.now();
    const records = Array.isArray(encryptedData)
      ? encryptedData
      : [encryptedData];

    // Simulate encrypted query processing
    // Result count is derived from query hash to be deterministic
    const queryHash = crypto.createHash("sha256").update(query).digest("hex");
    const hashNum = parseInt(queryHash.substring(0, 8), 16);
    const resultCount = Math.min(
      hashNum % (records.length + 1),
      records.length,
    );

    const queryTimeMs =
      Date.now() - startTime + 15 + Math.floor(Math.random() * 10);

    this._storeComputation({
      scheme: HE_SCHEMES.BFV,
      operation: "sql_query",
      inputCount: records.length,
      resultEncrypted: queryHash,
      metadata: { query, resultCount, queryTimeMs },
      durationMs: queryTimeMs,
    });

    logger.info(
      `[HomomorphicManager] Encrypted SQL query: ${resultCount} results in ${queryTimeMs}ms`,
    );
    this.emit("bfv:query", { resultCount, queryTimeMs });

    return { resultCount, queryTimeMs, scheme: HE_SCHEMES.BFV };
  }

  // -----------------------------------------------------------------------
  // AI privacy inference (simulated CKKS)
  // -----------------------------------------------------------------------

  /**
   * Simulate ML inference on encrypted data using CKKS scheme.
   * @param {string} modelId - Model identifier
   * @param {object} encryptedInput - Encrypted input data
   * @returns {{ encryptedOutput: string, inferenceTimeMs: number, modelId: string }}
   */
  async aiPrivacyInference(modelId, encryptedInput) {
    if (!modelId || !encryptedInput) {
      throw new Error("modelId and encryptedInput are required");
    }

    const startTime = Date.now();

    // Simulate inference: hash model ID + encrypted input
    const inputStr =
      typeof encryptedInput === "string"
        ? encryptedInput
        : JSON.stringify(encryptedInput);

    const encryptedOutput = crypto
      .createHmac("sha256", modelId)
      .update(inputStr)
      .digest("hex");

    // Simulated inference time scales with input complexity
    const baseLatency = 50 + Math.floor(Math.random() * 30);
    const inferenceTimeMs = Date.now() - startTime + baseLatency;

    this._storeComputation({
      scheme: HE_SCHEMES.CKKS,
      operation: "ai_inference",
      inputCount: 1,
      resultEncrypted: encryptedOutput,
      metadata: { modelId, inferenceTimeMs },
      durationMs: inferenceTimeMs,
    });

    logger.info(
      `[HomomorphicManager] AI privacy inference on model ${modelId}: ${inferenceTimeMs}ms`,
    );
    this.emit("ckks:inference", { modelId, inferenceTimeMs });

    return { encryptedOutput, inferenceTimeMs, modelId };
  }

  // -----------------------------------------------------------------------
  // Encrypted search
  // -----------------------------------------------------------------------

  /**
   * Simulate search over encrypted data (encrypted index lookup).
   * @param {string} searchTerm - Search query (will be encrypted before matching)
   * @param {object[]} encryptedIndex - Array of encrypted index entries
   * @returns {{ matchCount: number, searchTimeMs: number }}
   */
  async encryptedSearch(searchTerm, encryptedIndex) {
    if (!searchTerm || !encryptedIndex) {
      throw new Error("searchTerm and encryptedIndex are required");
    }

    const startTime = Date.now();
    const index = Array.isArray(encryptedIndex)
      ? encryptedIndex
      : [encryptedIndex];

    // Simulate encrypted search: hash the search term and match against index
    const termHash = crypto
      .createHash("sha256")
      .update(searchTerm)
      .digest("hex");
    const termNum = parseInt(termHash.substring(0, 8), 16);
    const matchCount = Math.min(termNum % (index.length + 1), index.length);

    const searchTimeMs =
      Date.now() - startTime + 8 + Math.floor(Math.random() * 5);

    this._storeComputation({
      scheme: HE_SCHEMES.BFV,
      operation: "encrypted_search",
      inputCount: index.length,
      resultEncrypted: termHash,
      metadata: { matchCount, searchTimeMs },
      durationMs: searchTimeMs,
    });

    logger.info(
      `[HomomorphicManager] Encrypted search: ${matchCount} matches in ${searchTimeMs}ms`,
    );
    this.emit("he:search", { matchCount, searchTimeMs });

    return { matchCount, searchTimeMs };
  }

  // -----------------------------------------------------------------------
  // Encrypted data analysis
  // -----------------------------------------------------------------------

  /**
   * Simulate analytics on encrypted dataset (sum, avg, count, min, max).
   * @param {object[]} dataset - Array of encrypted data records
   * @param {string} operation - Analysis operation (sum/avg/count/min/max)
   * @returns {{ result: string, operation: string, recordCount: number }}
   */
  async encryptedDataAnalysis(dataset, operation) {
    if (!dataset || !operation) {
      throw new Error("dataset and operation are required");
    }

    const op = operation.toLowerCase();
    if (!ANALYSIS_OPERATIONS.includes(op)) {
      throw new Error(
        `Unsupported operation: ${operation}. Supported: ${ANALYSIS_OPERATIONS.join(", ")}`,
      );
    }

    const startTime = Date.now();
    const records = Array.isArray(dataset) ? dataset : [dataset];
    const recordCount = records.length;

    // Simulate encrypted computation: produce deterministic encrypted result
    const dataHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(records))
      .digest("hex");

    const opHash = crypto
      .createHmac("sha256", op)
      .update(dataHash)
      .digest("hex");

    // Derive a simulated numeric result from the hash
    const hashNum = parseInt(opHash.substring(0, 12), 16);
    let result;

    switch (op) {
      case "count":
        result = recordCount.toString();
        break;
      case "sum":
        result = (hashNum % (recordCount * 1000)).toString();
        break;
      case "avg":
        result = (
          (hashNum % (recordCount * 1000)) /
          Math.max(recordCount, 1)
        ).toFixed(2);
        break;
      case "min":
        result = (hashNum % 100).toString();
        break;
      case "max":
        result = ((hashNum % 100) + recordCount * 10).toString();
        break;
      default:
        result = "0";
    }

    const durationMs =
      Date.now() - startTime + 10 + Math.floor(Math.random() * 8);

    this._storeComputation({
      scheme: HE_SCHEMES.BFV,
      operation: `analysis_${op}`,
      inputCount: recordCount,
      resultEncrypted: opHash,
      metadata: { operation: op, recordCount, result, durationMs },
      durationMs,
    });

    logger.info(
      `[HomomorphicManager] Encrypted ${op} on ${recordCount} records completed`,
    );
    this.emit("he:analysis", { operation: op, recordCount });

    return { result, operation: op, recordCount };
  }

  // -----------------------------------------------------------------------
  // Multi-agent secure computation
  // -----------------------------------------------------------------------

  /**
   * Simulate multi-agent homomorphic computation.
   * Each agent contributes encrypted input; result is computed without decrypting.
   * @param {object[]} agents - Array of { id, encryptedInput } objects
   * @param {object} computation - { type, params } describing the computation
   * @returns {{ result: string, participantCount: number, roundTrips: number }}
   */
  async multiAgentSecureCompute(agents, computation) {
    if (!Array.isArray(agents) || agents.length === 0 || !computation) {
      throw new Error("agents (non-empty array) and computation are required");
    }

    const startTime = Date.now();
    const participantCount = agents.length;

    // Simulate multi-round protocol
    // Round trips scale with participant count
    const roundTrips = Math.ceil(Math.log2(participantCount)) + 1;

    // Combine all agent inputs via hash chain
    let aggregate = crypto.randomBytes(32).toString("hex");
    for (const agent of agents) {
      const input =
        typeof agent.encryptedInput === "string"
          ? agent.encryptedInput
          : JSON.stringify(agent.encryptedInput || agent.id);

      aggregate = crypto
        .createHash("sha256")
        .update(`${aggregate}:${input}`)
        .digest("hex");
    }

    // Apply computation type
    const compType = computation.type || "aggregate";
    const result = crypto
      .createHmac("sha256", compType)
      .update(aggregate)
      .digest("hex");

    const durationMs = Date.now() - startTime + roundTrips * 5;

    this._storeComputation({
      scheme: HE_SCHEMES.BFV,
      operation: "multi_agent_compute",
      inputCount: participantCount,
      resultEncrypted: result,
      metadata: {
        participantCount,
        roundTrips,
        computationType: compType,
        agentIds: agents.map((a) => a.id),
        durationMs,
      },
      durationMs,
    });

    logger.info(
      `[HomomorphicManager] Multi-agent compute: ${participantCount} agents, ${roundTrips} rounds`,
    );
    this.emit("he:multi-agent", { participantCount, roundTrips });

    return { result, participantCount, roundTrips };
  }

  // -----------------------------------------------------------------------
  // Encrypted backup verification
  // -----------------------------------------------------------------------

  /**
   * Verify backup integrity without decrypting the backup data.
   * Uses SHA-256 hash comparison on encrypted representation.
   * @param {string} backupId - Backup identifier
   * @param {string} expectedHash - Expected integrity hash
   * @returns {{ verified: boolean, backupId: string, integrityScore: number }}
   */
  async encryptedBackupVerify(backupId, expectedHash) {
    if (!backupId || !expectedHash) {
      throw new Error("backupId and expectedHash are required");
    }

    const startTime = Date.now();

    // Simulate backup verification: compute hash of backup ID and compare
    const computedHash = crypto
      .createHash("sha256")
      .update(backupId)
      .digest("hex");

    // Determine how many characters match for an integrity score
    let matchingChars = 0;
    const minLen = Math.min(computedHash.length, expectedHash.length);
    for (let i = 0; i < minLen; i++) {
      if (computedHash[i] === expectedHash[i]) {
        matchingChars++;
      }
    }

    const integrityScore = parseFloat((matchingChars / minLen).toFixed(4));
    const verified = expectedHash === computedHash;
    const durationMs = Date.now() - startTime;

    this._storeComputation({
      scheme: HE_SCHEMES.BFV,
      operation: "backup_verify",
      inputCount: 1,
      resultEncrypted: computedHash,
      metadata: { backupId, verified, integrityScore, durationMs },
      durationMs,
    });

    logger.info(
      `[HomomorphicManager] Backup verify ${backupId}: verified=${verified}, score=${integrityScore}`,
    );
    this.emit("he:backup-verify", { backupId, verified, integrityScore });

    return { verified, backupId, integrityScore };
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /**
   * Configure GPU acceleration flag for HE operations.
   * @param {boolean} enabled - Whether to enable GPU acceleration
   * @returns {{ enabled: boolean, estimatedSpeedup: number }}
   */
  setGPUAcceleration(enabled) {
    this.gpuAcceleration = !!enabled;
    const estimatedSpeedup = enabled ? 10.5 : 1.0;

    logger.info(
      `[HomomorphicManager] GPU acceleration ${enabled ? "enabled" : "disabled"}: ~${estimatedSpeedup}x speedup`,
    );
    this.emit("config:gpu", {
      enabled: this.gpuAcceleration,
      estimatedSpeedup,
    });

    return { enabled: this.gpuAcceleration, estimatedSpeedup };
  }

  /**
   * Set PHE/FHE tiering strategy.
   * @param {string} strategy - 'auto', 'phe-first', or 'fhe-always'
   * @returns {{ strategy: string, description: string }}
   */
  setTieringStrategy(strategy) {
    const s = String(strategy).toLowerCase();
    const descriptions = {
      auto: "Automatically select PHE or FHE based on operation complexity",
      "phe-first":
        "Prefer Partially Homomorphic Encryption; fallback to FHE when needed",
      "fhe-always":
        "Always use Fully Homomorphic Encryption for maximum capability",
    };

    if (!descriptions[s]) {
      throw new Error(
        `Unsupported tiering strategy: ${strategy}. Supported: ${Object.keys(descriptions).join(", ")}`,
      );
    }

    this.tieringStrategy = s;
    const description = descriptions[s];

    logger.info(`[HomomorphicManager] Tiering strategy set to '${s}'`);
    this.emit("config:tiering", { strategy: s, description });

    return { strategy: s, description };
  }

  // -----------------------------------------------------------------------
  // Statistics
  // -----------------------------------------------------------------------

  /**
   * Return aggregate counts from the computation store.
   * @returns {{ total: number, byScheme: object, byOperation: object, avgDurationMs: number }}
   */
  async getStats() {
    const raw = this.db?.db;
    const stats = {
      total: 0,
      byScheme: {},
      byOperation: {},
      avgDurationMs: 0,
    };

    if (!raw) {
      return stats;
    }

    const totalRow = raw
      .prepare("SELECT COUNT(*) as cnt FROM he_computations")
      .get();
    stats.total = totalRow?.cnt || 0;

    const schemeRows = raw
      .prepare(
        "SELECT scheme, COUNT(*) as cnt FROM he_computations GROUP BY scheme",
      )
      .all();

    for (const row of schemeRows) {
      stats.byScheme[row.scheme] = row.cnt;
    }

    const opRows = raw
      .prepare(
        "SELECT operation, COUNT(*) as cnt FROM he_computations GROUP BY operation",
      )
      .all();

    for (const row of opRows) {
      stats.byOperation[row.operation] = row.cnt;
    }

    const avgRow = raw
      .prepare("SELECT AVG(duration_ms) as avg_ms FROM he_computations")
      .get();
    stats.avgDurationMs = parseFloat((avgRow?.avg_ms || 0).toFixed(2));

    return stats;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Persist a computation record to the database (if available).
   * @private
   */
  _storeComputation({
    scheme,
    operation,
    inputCount,
    resultEncrypted,
    metadata,
    durationMs,
  }) {
    const raw = this.db?.db;
    if (!raw) {
      return;
    }

    const id = uuidv4();

    try {
      raw
        .prepare(
          `INSERT INTO he_computations (id, scheme, operation, input_count, result_encrypted, metadata, duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          scheme,
          operation,
          inputCount || 0,
          resultEncrypted || null,
          JSON.stringify(metadata || {}),
          durationMs || 0,
        );
    } catch (err) {
      logger.error(
        `[HomomorphicManager] Failed to store computation ${id}:`,
        err,
      );
    }
  }

  /**
   * Compute GCD of two BigInt values.
   * @private
   */
  _bigIntGcd(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b > 0n) {
      const t = b;
      b = a % b;
      a = t;
    }
    return a;
  }

  /**
   * Modular exponentiation for BigInt: base^exp mod mod.
   * @private
   */
  _bigIntModPow(base, exp, mod) {
    if (mod === 1n) {
      return 0n;
    }
    let result = 1n;
    base = ((base % mod) + mod) % mod;
    while (exp > 0n) {
      if (exp % 2n === 1n) {
        result = (result * base) % mod;
      }
      exp = exp / 2n;
      base = (base * base) % mod;
    }
    return result;
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
 * Get or create the HomomorphicManager singleton.
 * @returns {HomomorphicManager}
 */
function getHomomorphicManager() {
  if (!instance) {
    instance = new HomomorphicManager();
  }
  return instance;
}

module.exports = { HomomorphicManager, getHomomorphicManager };
