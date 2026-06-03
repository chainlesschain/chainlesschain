"use strict";

/**
 * Advanced Encryption Features Manager
 *
 * Simulated advanced cryptographic primitives including Searchable Symmetric
 * Encryption (SSE), Proxy Re-Encryption, Verifiable Computation, and Crypto
 * Agility / Key Management using Node.js built-in crypto.
 *
 * Provides encrypted search over ciphertext, delegated re-encryption for P2P
 * and RBAC, verifiable computation proofs, algorithm agility, key escrow with
 * threshold recovery, and enhanced randomness generation.
 *
 * All cryptographic operations are SIMULATED for development/testing.
 * Replace with real libraries (e.g. OpenFHE, proxy-re-enc) for production.
 *
 * @module crypto/advanced-crypto-manager
 * @version 1.0.0
 */

const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = {
  SSE: "sse",
  PROXY_RE: "proxy-re",
  VERIFIABLE: "verifiable",
  AGILITY: "agility",
  ESCROW: "escrow",
};

const DEFAULT_ALGORITHMS = [
  { name: "aes-256-gcm", type: "symmetric", keySize: 256, family: "AES" },
  {
    name: "chacha20-poly1305",
    type: "symmetric",
    keySize: 256,
    family: "ChaCha",
  },
  { name: "aes-256-cbc", type: "symmetric", keySize: 256, family: "AES" },
  { name: "rsa-4096", type: "asymmetric", keySize: 4096, family: "RSA" },
  { name: "ed25519", type: "signing", keySize: 256, family: "EdDSA" },
  { name: "x25519", type: "key-exchange", keySize: 256, family: "ECDH" },
];

// ---------------------------------------------------------------------------
// AdvancedCryptoManager
// ---------------------------------------------------------------------------

class AdvancedCryptoManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this.algorithms = new Map();
    this.escrowKeys = new Map();

    // In-memory stores for simulated state
    this._sseIndexes = new Map();
    this._reKeys = new Map();
    this._computeResults = new Map();
    this._delegations = new Map();
  }

  /**
   * Initialize the manager with a database instance.
   * Idempotent -- calling multiple times is safe.
   * @param {object} db - Database wrapper (must expose `.db` for raw access)
   */
  async initialize(db) {
    if (this.initialized) {
      return;
    }

    this.db = db;
    await this._ensureTables();

    // Register default algorithms
    for (const algo of DEFAULT_ALGORITHMS) {
      this.algorithms.set(algo.name, algo);
    }

    this.initialized = true;
    logger.info(
      "[AdvancedCryptoManager] Initialized with %d default algorithms",
      this.algorithms.size,
    );
    this.emit("initialized");
  }

  // -----------------------------------------------------------------------
  // Database setup
  // -----------------------------------------------------------------------

  async _ensureTables() {
    const raw = this.db?.db;
    if (!raw) {
      logger.warn(
        "[AdvancedCryptoManager] No database — running in memory-only mode",
      );
      return;
    }

    raw.exec(`
      CREATE TABLE IF NOT EXISTS crypto_audit_trail (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('sse', 'proxy-re', 'verifiable', 'agility', 'escrow')),
        actor_id TEXT,
        input_hash TEXT,
        output_hash TEXT,
        success INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    raw.exec(
      `CREATE INDEX IF NOT EXISTS idx_crypto_audit_operation ON crypto_audit_trail(operation)`,
    );
    raw.exec(
      `CREATE INDEX IF NOT EXISTS idx_crypto_audit_category ON crypto_audit_trail(category)`,
    );
    raw.exec(
      `CREATE INDEX IF NOT EXISTS idx_crypto_audit_actor ON crypto_audit_trail(actor_id)`,
    );

    logger.info("[AdvancedCryptoManager] Database tables ensured");
  }

  // -----------------------------------------------------------------------
  // Audit helpers
  // -----------------------------------------------------------------------

  _logAudit(
    operation,
    category,
    { actorId, inputHash, outputHash, success = 1, metadata = {} } = {},
  ) {
    const raw = this.db?.db;
    if (!raw) {
      return null;
    }
    const id = uuidv4();
    try {
      raw
        .prepare(
          `
        INSERT INTO crypto_audit_trail (id, operation, category, actor_id, input_hash, output_hash, success, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          operation,
          category,
          actorId || null,
          inputHash || null,
          outputHash || null,
          success,
          JSON.stringify(metadata),
        );
    } catch (err) {
      logger.error("[AdvancedCryptoManager] Audit log failed: %s", err.message);
    }
    return id;
  }

  _hash(data) {
    const input = typeof data === "string" ? data : JSON.stringify(data);
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  // -----------------------------------------------------------------------
  // Searchable Symmetric Encryption (SSE)
  // -----------------------------------------------------------------------

  /**
   * Create an encrypted searchable index from documents.
   * @param {Array<{id: string, content: string}>} documents
   * @returns {{ indexId: string, documentCount: number, tokenCount: number, indexSizeBytes: number }}
   */
  async sseCreateIndex(documents) {
    if (!Array.isArray(documents) || documents.length === 0) {
      throw new Error("documents must be a non-empty array");
    }

    const indexId = uuidv4();
    const indexKey = crypto.randomBytes(32);
    const tokenMap = new Map();
    let tokenCount = 0;

    for (const doc of documents) {
      const docId = doc.id || uuidv4();
      const words = (doc.content || "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const uniqueWords = [...new Set(words)];

      for (const word of uniqueWords) {
        const token = crypto
          .createHmac("sha256", indexKey)
          .update(word)
          .digest("hex");
        if (!tokenMap.has(token)) {
          tokenMap.set(token, []);
        }
        tokenMap
          .get(token)
          .push({ docId, score: words.filter((w) => w === word).length });
        tokenCount++;
      }
    }

    const indexSizeBytes = tokenCount * 64 + tokenMap.size * 32;
    this._sseIndexes.set(indexId, {
      key: indexKey,
      tokens: tokenMap,
      docCount: documents.length,
    });

    this._logAudit("sse-create-index", CATEGORIES.SSE, {
      inputHash: this._hash({ documentCount: documents.length }),
      outputHash: indexId,
      metadata: { documentCount: documents.length, tokenCount },
    });

    logger.info(
      "[AdvancedCryptoManager] SSE index created: %s (%d docs, %d tokens)",
      indexId,
      documents.length,
      tokenCount,
    );
    this.emit("sse:index-created", { indexId });

    return {
      indexId,
      documentCount: documents.length,
      tokenCount,
      indexSizeBytes,
    };
  }

  /**
   * Search an encrypted index using a trapdoor token.
   * @param {string} indexId
   * @param {string} keyword
   * @returns {{ results: Array<{docId: string, score: number}>, searchTimeMs: number, tokenMatched: boolean }}
   */
  async sseSearch(indexId, keyword) {
    const startTime = Date.now();
    const index = this._sseIndexes.get(indexId);
    if (!index) {
      throw new Error(`SSE index not found: ${indexId}`);
    }

    const trapdoor = crypto
      .createHmac("sha256", index.key)
      .update((keyword || "").toLowerCase())
      .digest("hex");
    const entries = index.tokens.get(trapdoor) || [];

    this._logAudit("sse-search", CATEGORIES.SSE, {
      inputHash: this._hash(keyword),
      outputHash: this._hash(entries),
      metadata: { indexId, resultCount: entries.length },
    });

    return {
      results: entries,
      searchTimeMs: Date.now() - startTime,
      tokenMatched: entries.length > 0,
    };
  }

  /**
   * Fuzzy search on encrypted index using n-gram tokens.
   * @param {string} indexId
   * @param {string} keyword
   * @param {number} [threshold=0.6]
   * @returns {{ results: Array, fuzzyMatches: number, threshold: number }}
   */
  async fuzzyEncryptedSearch(indexId, keyword, threshold = 0.6) {
    const index = this._sseIndexes.get(indexId);
    if (!index) {
      throw new Error(`SSE index not found: ${indexId}`);
    }

    const normalizedKeyword = (keyword || "").toLowerCase();
    const keywordNgrams = this._ngrams(normalizedKeyword, 2);
    const results = new Map();

    // Simulate fuzzy matching by checking all tokens with n-gram similarity
    for (const [token, entries] of index.tokens) {
      // Reconstruct keyword from HMAC is impossible, so we simulate
      // by computing n-gram overlap using a secondary plain-text index
      for (const entry of entries) {
        if (!results.has(entry.docId)) {
          results.set(entry.docId, {
            docId: entry.docId,
            score: 0,
            fuzzyScore: 0,
          });
        }
      }
    }

    // Use exact match + partial match simulation
    const exactTrapdoor = crypto
      .createHmac("sha256", index.key)
      .update(normalizedKeyword)
      .digest("hex");
    const exactEntries = index.tokens.get(exactTrapdoor) || [];
    for (const entry of exactEntries) {
      results.set(entry.docId, {
        docId: entry.docId,
        score: entry.score,
        fuzzyScore: 1.0,
      });
    }

    // Simulate partial matches for n-gram substrings
    for (const ngram of keywordNgrams) {
      const ngramTrapdoor = crypto
        .createHmac("sha256", index.key)
        .update(ngram)
        .digest("hex");
      const ngramEntries = index.tokens.get(ngramTrapdoor) || [];
      for (const entry of ngramEntries) {
        const existing = results.get(entry.docId) || {
          docId: entry.docId,
          score: 0,
          fuzzyScore: 0,
        };
        existing.fuzzyScore = Math.min(
          1.0,
          existing.fuzzyScore + 1 / keywordNgrams.length,
        );
        existing.score += entry.score * 0.5;
        results.set(entry.docId, existing);
      }
    }

    const filtered = [...results.values()].filter(
      (r) => r.fuzzyScore >= threshold,
    );

    this._logAudit("sse-fuzzy-search", CATEGORIES.SSE, {
      inputHash: this._hash(keyword),
      metadata: { indexId, threshold, matchCount: filtered.length },
    });

    return { results: filtered, fuzzyMatches: filtered.length, threshold };
  }

  /**
   * Simulate encrypted vector similarity search for RAG.
   * @param {string} indexId
   * @param {number[]} queryVector
   * @param {number} [topK=5]
   * @returns {{ results: Array<{docId: string, similarity: number}>, topK: number }}
   */
  async ragEncryptedSimilarity(indexId, queryVector, topK = 5) {
    const index = this._sseIndexes.get(indexId);
    if (!index) {
      throw new Error(`SSE index not found: ${indexId}`);
    }

    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      throw new Error("queryVector must be a non-empty array");
    }

    // Simulate encrypted similarity: generate deterministic scores from vector hash
    const vecHash = this._hash(queryVector);
    const allDocIds = new Set();
    for (const entries of index.tokens.values()) {
      for (const e of entries) {
        allDocIds.add(e.docId);
      }
    }

    const results = [...allDocIds].map((docId) => {
      const simHash = crypto
        .createHmac("sha256", vecHash)
        .update(docId)
        .digest();
      const similarity = (simHash.readUInt16BE(0) % 1000) / 1000;
      return { docId, similarity: parseFloat(similarity.toFixed(4)) };
    });

    results.sort((a, b) => b.similarity - a.similarity);
    const topResults = results.slice(0, topK);

    this._logAudit("rag-encrypted-similarity", CATEGORIES.SSE, {
      inputHash: this._hash(queryVector),
      metadata: { indexId, topK, resultCount: topResults.length },
    });

    return { results: topResults, topK };
  }

  // -----------------------------------------------------------------------
  // Proxy Re-Encryption
  // -----------------------------------------------------------------------

  /**
   * Generate a re-encryption key for delegating decryption.
   * @param {string} delegatorKey - Delegator's private key (hex)
   * @param {string} delegateePublicKey - Delegatee's public key (hex)
   * @returns {{ reKeyId: string, delegator: string, delegatee: string, reKey: string }}
   */
  async generateReEncryptionKey(delegatorKey, delegateePublicKey) {
    if (!delegatorKey || !delegateePublicKey) {
      throw new Error("Both delegatorKey and delegateePublicKey are required");
    }

    const reKeyId = uuidv4();
    // Simulate re-encryption key: HMAC of delegator key with delegatee pubkey
    const reKey = crypto
      .createHmac("sha256", delegatorKey)
      .update(delegateePublicKey)
      .digest("hex");
    const delegatorHash = this._hash(delegatorKey);
    const delegateeHash = this._hash(delegateePublicKey);

    this._reKeys.set(reKeyId, {
      reKey,
      delegator: delegatorHash,
      delegatee: delegateeHash,
    });

    this._logAudit("generate-re-encryption-key", CATEGORIES.PROXY_RE, {
      inputHash: delegatorHash,
      outputHash: reKeyId,
      metadata: { delegatee: delegateeHash },
    });

    logger.info(
      "[AdvancedCryptoManager] Re-encryption key generated: %s",
      reKeyId,
    );
    this.emit("proxy-re:key-generated", { reKeyId });

    return {
      reKeyId,
      delegator: delegatorHash,
      delegatee: delegateeHash,
      reKey,
    };
  }

  /**
   * Re-encrypt ciphertext using a re-encryption key.
   * @param {string} ciphertext - Original ciphertext (hex)
   * @param {string} reKeyId - Re-encryption key ID
   * @returns {{ reEncryptedCiphertext: string, originalCiphertextHash: string, reKeyId: string }}
   */
  async proxyReEncrypt(ciphertext, reKeyId) {
    if (!ciphertext) {
      throw new Error("ciphertext is required");
    }
    const reKeyEntry = this._reKeys.get(reKeyId);
    if (!reKeyEntry) {
      throw new Error(`Re-encryption key not found: ${reKeyId}`);
    }

    // Simulate re-encryption: HMAC ciphertext with re-key
    const reEncryptedCiphertext = crypto
      .createHmac("sha256", reKeyEntry.reKey)
      .update(ciphertext)
      .digest("hex");
    const originalCiphertextHash = this._hash(ciphertext);

    this._logAudit("proxy-re-encrypt", CATEGORIES.PROXY_RE, {
      inputHash: originalCiphertextHash,
      outputHash: this._hash(reEncryptedCiphertext),
      metadata: { reKeyId },
    });

    return { reEncryptedCiphertext, originalCiphertextHash, reKeyId };
  }

  /**
   * Share data via proxy re-encryption for P2P messaging.
   * @param {string} senderId
   * @param {string} receiverId
   * @param {string|object} data
   * @returns {{ shareId: string, sender: string, receiver: string, encryptedData: string }}
   */
  async p2pReEncryptedShare(senderId, receiverId, data) {
    if (!senderId || !receiverId) {
      throw new Error("senderId and receiverId are required");
    }

    const shareId = uuidv4();
    const plaintext = typeof data === "string" ? data : JSON.stringify(data);

    // Simulate: encrypt with sender key, then re-encrypt for receiver
    const senderKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", senderKey, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    const encryptedData = iv.toString("hex") + ":" + authTag + ":" + encrypted;

    this._logAudit("p2p-re-encrypted-share", CATEGORIES.PROXY_RE, {
      actorId: senderId,
      inputHash: this._hash(data),
      outputHash: shareId,
      metadata: { receiver: receiverId },
    });

    logger.info(
      "[AdvancedCryptoManager] P2P re-encrypted share: %s → %s",
      senderId,
      receiverId,
    );
    this.emit("proxy-re:p2p-share", {
      shareId,
      sender: senderId,
      receiver: receiverId,
    });

    return { shareId, sender: senderId, receiver: receiverId, encryptedData };
  }

  /**
   * Set up RBAC-based re-encryption delegation between roles.
   * @param {string} role - Source role
   * @param {string} targetRole - Target role
   * @param {string[]} permissions - Permission scopes
   * @returns {{ delegationId: string, fromRole: string, toRole: string, permissions: string[] }}
   */
  async rbacReEncryptionDelegate(role, targetRole, permissions) {
    if (!role || !targetRole) {
      throw new Error("role and targetRole are required");
    }
    const delegationId = uuidv4();
    const perms = Array.isArray(permissions) ? permissions : [];

    this._delegations.set(delegationId, {
      fromRole: role,
      toRole: targetRole,
      permissions: perms,
      createdAt: new Date().toISOString(),
    });

    this._logAudit("rbac-re-encryption-delegate", CATEGORIES.PROXY_RE, {
      inputHash: this._hash({ role, targetRole }),
      outputHash: delegationId,
      metadata: { fromRole: role, toRole: targetRole, permissions: perms },
    });

    logger.info(
      "[AdvancedCryptoManager] RBAC delegation: %s → %s",
      role,
      targetRole,
    );

    return {
      delegationId,
      fromRole: role,
      toRole: targetRole,
      permissions: perms,
    };
  }

  // -----------------------------------------------------------------------
  // Verifiable Computation
  // -----------------------------------------------------------------------

  /**
   * Execute a computation and produce a verifiable proof.
   * @param {string} program - Program/function description
   * @param {object} inputs - Computation inputs
   * @returns {{ resultId: string, output: string, proof: string, computeTimeMs: number }}
   */
  async verifiableCompute(program, inputs) {
    if (!program) {
      throw new Error("program is required");
    }
    const startTime = Date.now();
    const resultId = uuidv4();

    // Simulate computation: hash program + inputs
    const inputData = JSON.stringify({ program, inputs: inputs || {} });
    const output = crypto.createHash("sha256").update(inputData).digest("hex");
    const proof = crypto
      .createHmac("sha256", output)
      .update(resultId)
      .digest("hex");

    this._computeResults.set(resultId, {
      program,
      inputs,
      output,
      proof,
      timestamp: new Date().toISOString(),
    });

    const computeTimeMs = Date.now() - startTime;

    this._logAudit("verifiable-compute", CATEGORIES.VERIFIABLE, {
      inputHash: this._hash(inputData),
      outputHash: this._hash(output),
      metadata: { resultId, computeTimeMs },
    });

    logger.info(
      "[AdvancedCryptoManager] Verifiable computation complete: %s",
      resultId,
    );
    this.emit("verifiable:computed", { resultId });

    return { resultId, output, proof, computeTimeMs };
  }

  /**
   * Verify a previously computed result.
   * @param {string} resultId
   * @returns {{ valid: boolean, resultId: string, verificationTimeMs: number }}
   */
  async verifyComputation(resultId) {
    const startTime = Date.now();
    const result = this._computeResults.get(resultId);
    if (!result) {
      throw new Error(`Computation result not found: ${resultId}`);
    }

    // Simulate verification: recompute proof and compare
    const expectedProof = crypto
      .createHmac("sha256", result.output)
      .update(resultId)
      .digest("hex");
    const valid = expectedProof === result.proof;

    this._logAudit("verify-computation", CATEGORIES.VERIFIABLE, {
      inputHash: resultId,
      outputHash: this._hash({ valid }),
      metadata: { valid, verificationTimeMs: Date.now() - startTime },
    });

    return { valid, resultId, verificationTimeMs: Date.now() - startTime };
  }

  /**
   * Verify LLM output authenticity by producing attestation.
   * @param {string} prompt
   * @param {string} output
   * @param {string} modelId
   * @returns {{ verified: boolean, promptHash: string, outputHash: string, attestation: string }}
   */
  async llmOutputVerify(prompt, output, modelId) {
    if (!prompt || !output) {
      throw new Error("prompt and output are required");
    }

    const promptHash = this._hash(prompt);
    const outputHash = this._hash(output);
    const attestationData = JSON.stringify({
      promptHash,
      outputHash,
      modelId: modelId || "unknown",
      timestamp: Date.now(),
    });
    const attestation = crypto
      .createHmac("sha256", crypto.randomBytes(32))
      .update(attestationData)
      .digest("hex");

    // Attestation is always verified in simulation
    const verified = true;

    this._logAudit("llm-output-verify", CATEGORIES.VERIFIABLE, {
      inputHash: promptHash,
      outputHash: outputHash,
      metadata: { modelId, verified },
    });

    return { verified, promptHash, outputHash, attestation };
  }

  /**
   * Generate an audit proof for a recorded operation.
   * @param {string} operationId
   * @returns {{ proofId: string, operationId: string, proof: string, timestamp: string }}
   */
  async auditProof(operationId) {
    if (!operationId) {
      throw new Error("operationId is required");
    }

    const raw = this.db?.db;
    let record = null;
    if (raw) {
      record = raw
        .prepare("SELECT * FROM crypto_audit_trail WHERE id = ?")
        .get(operationId);
    }

    const proofId = uuidv4();
    const timestamp = new Date().toISOString();
    const proofInput = JSON.stringify({
      operationId,
      record: record || {},
      timestamp,
    });
    const proof = crypto.createHash("sha256").update(proofInput).digest("hex");

    this._logAudit("audit-proof", CATEGORIES.VERIFIABLE, {
      inputHash: operationId,
      outputHash: proofId,
      metadata: { hasRecord: !!record },
    });

    return { proofId, operationId, proof, timestamp };
  }

  // -----------------------------------------------------------------------
  // Crypto Agility & Key Management
  // -----------------------------------------------------------------------

  /**
   * Register a new cryptographic algorithm.
   * @param {string} name
   * @param {object} config - Algorithm configuration (type, keySize, family, etc.)
   * @returns {{ name: string, registered: boolean, config: object }}
   */
  async registerAlgorithm(name, config) {
    if (!name) {
      throw new Error("Algorithm name is required");
    }
    const algoConfig = { name, ...config };
    this.algorithms.set(name, algoConfig);

    this._logAudit("register-algorithm", CATEGORIES.AGILITY, {
      outputHash: this._hash(name),
      metadata: { name, config: algoConfig },
    });

    logger.info("[AdvancedCryptoManager] Algorithm registered: %s", name);
    return { name, registered: true, config: algoConfig };
  }

  /**
   * Switch algorithm for a given scope with migration steps.
   * @param {string} from - Current algorithm name
   * @param {string} to - Target algorithm name
   * @param {string} scope - Scope of the switch (e.g. 'encryption', 'signing')
   * @returns {{ switched: boolean, from: string, to: string, scope: string, migrationSteps: string[] }}
   */
  async switchAlgorithm(from, to, scope) {
    if (!from || !to) {
      throw new Error("Both 'from' and 'to' algorithms are required");
    }
    if (!this.algorithms.has(to)) {
      throw new Error(`Target algorithm not registered: ${to}`);
    }

    const migrationSteps = [
      `Validate target algorithm '${to}' support`,
      `Generate new keys for '${to}'`,
      `Re-encrypt data in scope '${scope || "default"}' from '${from}' to '${to}'`,
      `Verify re-encrypted data integrity`,
      `Update key references for scope '${scope || "default"}'`,
      `Deprecate old algorithm '${from}' keys`,
    ];

    this._logAudit("switch-algorithm", CATEGORIES.AGILITY, {
      inputHash: this._hash(from),
      outputHash: this._hash(to),
      metadata: { from, to, scope, steps: migrationSteps.length },
    });

    logger.info(
      "[AdvancedCryptoManager] Algorithm switch: %s → %s (scope: %s)",
      from,
      to,
      scope,
    );
    this.emit("agility:algorithm-switched", { from, to, scope });

    return {
      switched: true,
      from,
      to,
      scope: scope || "default",
      migrationSteps,
    };
  }

  /**
   * Set up key escrow with threshold recovery.
   * @param {string} keyId
   * @param {string[]} escrowAgents - Agent identifiers
   * @param {number} threshold - Minimum approvals required
   * @returns {{ escrowId: string, keyId: string, agentCount: number, threshold: number }}
   */
  async keyEscrowSetup(keyId, escrowAgents, threshold) {
    if (!keyId) {
      throw new Error("keyId is required");
    }
    if (!Array.isArray(escrowAgents) || escrowAgents.length === 0) {
      throw new Error("escrowAgents must be a non-empty array");
    }
    const t = threshold || Math.ceil(escrowAgents.length / 2);
    if (t > escrowAgents.length) {
      throw new Error("threshold cannot exceed number of escrow agents");
    }

    const escrowId = uuidv4();
    // Simulate key material split among agents
    const keyMaterial = crypto.randomBytes(32).toString("hex");
    const agentShares = escrowAgents.map((agent) => ({
      agent,
      share: crypto
        .createHmac("sha256", keyMaterial)
        .update(agent)
        .digest("hex"),
    }));

    this.escrowKeys.set(escrowId, {
      keyId,
      agents: escrowAgents,
      threshold: t,
      keyMaterial,
      agentShares,
      createdAt: new Date().toISOString(),
    });

    this._logAudit("key-escrow-setup", CATEGORIES.ESCROW, {
      inputHash: this._hash(keyId),
      outputHash: escrowId,
      metadata: { agentCount: escrowAgents.length, threshold: t },
    });

    logger.info(
      "[AdvancedCryptoManager] Key escrow set up: %s (%d agents, threshold %d)",
      escrowId,
      escrowAgents.length,
      t,
    );
    this.emit("escrow:setup", { escrowId, keyId });

    return { escrowId, keyId, agentCount: escrowAgents.length, threshold: t };
  }

  /**
   * Emergency key recovery via escrow agent approvals.
   * @param {string} escrowId
   * @param {string[]} agentApprovals - Approving agent identifiers
   * @returns {{ accessGranted: boolean, keyMaterial: string|null, approvalsReceived: number, threshold: number }}
   */
  async emergencyAccess(escrowId, agentApprovals) {
    const escrow = this.escrowKeys.get(escrowId);
    if (!escrow) {
      throw new Error(`Escrow not found: ${escrowId}`);
    }

    const validApprovals = (agentApprovals || []).filter((a) =>
      escrow.agents.includes(a),
    );
    const accessGranted = validApprovals.length >= escrow.threshold;

    this._logAudit("emergency-access", CATEGORIES.ESCROW, {
      inputHash: escrowId,
      outputHash: this._hash({ accessGranted }),
      success: accessGranted ? 1 : 0,
      metadata: {
        approvalsReceived: validApprovals.length,
        threshold: escrow.threshold,
      },
    });

    if (accessGranted) {
      logger.info(
        "[AdvancedCryptoManager] Emergency access granted for escrow: %s",
        escrowId,
      );
      this.emit("escrow:access-granted", { escrowId });
    } else {
      logger.warn(
        "[AdvancedCryptoManager] Emergency access denied for escrow: %s (%d/%d)",
        escrowId,
        validApprovals.length,
        escrow.threshold,
      );
      this.emit("escrow:access-denied", { escrowId });
    }

    return {
      accessGranted,
      keyMaterial: accessGranted ? escrow.keyMaterial : null,
      approvalsReceived: validApprovals.length,
      threshold: escrow.threshold,
    };
  }

  /**
   * Generate enhanced random bytes from multiple entropy sources.
   * @param {number} [length=32]
   * @param {string} [source='mixed']
   * @returns {{ random: string, length: number, sources: string[], entropyBits: number }}
   */
  async enhancedRandom(length = 32, source = "mixed") {
    const byteLen = Math.max(1, Math.min(length, 1024));
    const sources = [];

    // Source 1: Node.js crypto.randomBytes (OS CSPRNG)
    const osRandom = crypto.randomBytes(byteLen);
    sources.push("os-csprng");

    // Source 2: Timestamp-based entropy
    const timeEntropy = crypto
      .createHash("sha256")
      .update(
        Buffer.from(Date.now().toString() + process.hrtime.bigint().toString()),
      )
      .digest();
    sources.push("timestamp-hrtime");

    // Source 3: Process-based entropy
    const processEntropy = crypto
      .createHash("sha256")
      .update(
        Buffer.from(
          JSON.stringify({
            pid: process.pid,
            uptime: process.uptime(),
            memUsage: process.memoryUsage().heapUsed,
          }),
        ),
      )
      .digest();
    sources.push("process-entropy");

    // Mix all sources via XOR
    const mixed = Buffer.alloc(byteLen);
    for (let i = 0; i < byteLen; i++) {
      mixed[i] =
        osRandom[i] ^
        timeEntropy[i % timeEntropy.length] ^
        processEntropy[i % processEntropy.length];
    }

    this._logAudit("enhanced-random", CATEGORIES.AGILITY, {
      metadata: { length: byteLen, source, sources },
    });

    return {
      random: mixed.toString("hex"),
      length: byteLen,
      sources,
      entropyBits: byteLen * 8,
    };
  }

  // -----------------------------------------------------------------------
  // Statistics
  // -----------------------------------------------------------------------

  /**
   * Get aggregate counts from the audit trail.
   * @returns {{ total: number, byCategory: object, byOperation: object }}
   */
  async getStats() {
    const raw = this.db?.db;
    if (!raw) {
      return { total: 0, byCategory: {}, byOperation: {} };
    }

    const totalRow = raw
      .prepare("SELECT COUNT(*) as count FROM crypto_audit_trail")
      .get();
    const total = totalRow?.count || 0;

    const categoryRows = raw
      .prepare(
        "SELECT category, COUNT(*) as count FROM crypto_audit_trail GROUP BY category",
      )
      .all();
    const byCategory = {};
    for (const row of categoryRows) {
      byCategory[row.category] = row.count;
    }

    const operationRows = raw
      .prepare(
        "SELECT operation, COUNT(*) as count FROM crypto_audit_trail GROUP BY operation",
      )
      .all();
    const byOperation = {};
    for (const row of operationRows) {
      byOperation[row.operation] = row.count;
    }

    return { total, byCategory, byOperation };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  _ngrams(text, n = 2) {
    const grams = [];
    for (let i = 0; i <= text.length - n; i++) {
      grams.push(text.substring(i, i + n));
    }
    return grams;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance = null;

/**
 * Get or create the AdvancedCryptoManager singleton.
 * @returns {AdvancedCryptoManager}
 */
function getAdvancedCryptoManager() {
  if (!instance) {
    instance = new AdvancedCryptoManager();
  }
  return instance;
}

module.exports = { AdvancedCryptoManager, getAdvancedCryptoManager };
