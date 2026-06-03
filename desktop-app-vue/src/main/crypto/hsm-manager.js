"use strict";

/**
 * HSM Integration Manager
 *
 * Simulated Hardware Security Module (HSM) integration supporting
 * key lifecycle management, signing, encryption, key rotation,
 * backup/restore, cluster HA, batch operations, and compliance auditing.
 *
 * Backends: Thales Luna, AWS CloudHSM, Azure Dedicated HSM, Chinese GM/T 0028.
 *
 * All cryptographic operations are SIMULATED using Node.js built-in crypto.
 * Replace with real HSM SDK bindings (e.g. PKCS#11, KMIP) for production.
 *
 * @module crypto/hsm-manager
 * @version 1.0.0
 */

const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BACKENDS = {
  luna: {
    vendor: "Thales",
    model: "Luna Network HSM 7",
    fips: "140-3 Level 3",
    capabilities: [
      "sign",
      "verify",
      "encrypt",
      "decrypt",
      "keygen",
      "wrap",
      "unwrap",
    ],
  },
  cloudhsm: {
    vendor: "AWS",
    model: "CloudHSM",
    fips: "140-2 Level 3",
    capabilities: ["sign", "verify", "encrypt", "decrypt", "keygen", "wrap"],
  },
  "azure-hsm": {
    vendor: "Microsoft",
    model: "Azure Dedicated HSM",
    fips: "140-2 Level 3",
    capabilities: ["sign", "verify", "encrypt", "decrypt", "keygen"],
  },
  guomi: {
    vendor: "Chinese National",
    model: "GM/T 0028 HSM",
    standard: "GM/T 0028",
    capabilities: [
      "sign",
      "verify",
      "encrypt",
      "decrypt",
      "keygen",
      "sm2",
      "sm4",
    ],
  },
};

const COMPLIANCE_STANDARDS = [
  {
    name: "FIPS 140-3",
    status: "compliant",
    details:
      "Level 3 validated — tamper-evident, identity-based authentication",
  },
  {
    name: "CC EAL4+",
    status: "compliant",
    details: "Common Criteria Evaluation Assurance Level 4+",
  },
  {
    name: "GM/T 0028",
    status: "compliant",
    details: "Chinese national standard for cryptographic modules",
  },
  {
    name: "PCI HSM",
    status: "compliant",
    details: "PCI PIN Transaction Security — HSM requirements met",
  },
];

// ---------------------------------------------------------------------------
// HSMManager
// ---------------------------------------------------------------------------

class HSMManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this.backends = new Map();
    this.activeBackend = null;
    this.keyStore = new Map();
    this.cluster = null;
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

    // Register default HSM backends
    for (const [name, config] of Object.entries(DEFAULT_BACKENDS)) {
      this.backends.set(name, { ...config });
    }

    // Select luna as default active backend
    this.activeBackend = "luna";

    this.initialized = true;
    logger.info("[HSMManager] Initialized with default backends");
    this.emit("initialized");
  }

  // -----------------------------------------------------------------------
  // Database setup
  // -----------------------------------------------------------------------

  async _ensureTables() {
    const raw = this.db?.db;
    if (!raw) {
      logger.warn("[HSMManager] No database — running in memory-only mode");
      return;
    }

    raw.exec(`
      CREATE TABLE IF NOT EXISTS hsm_key_lifecycle (
        id TEXT PRIMARY KEY,
        key_alias TEXT NOT NULL,
        backend TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        key_type TEXT DEFAULT 'symmetric' CHECK(key_type IN ('symmetric', 'asymmetric', 'hmac')),
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'rotated', 'destroyed', 'backed_up', 'restored')),
        version INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        rotated_at TEXT,
        destroyed_at TEXT
      )
    `);

    raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_hsm_keys_alias ON hsm_key_lifecycle(key_alias)
    `);

    raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_hsm_keys_backend ON hsm_key_lifecycle(backend)
    `);

    raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_hsm_keys_status ON hsm_key_lifecycle(status)
    `);

    logger.info("[HSMManager] Database tables ensured");
  }

  // -----------------------------------------------------------------------
  // Backend management
  // -----------------------------------------------------------------------

  /**
   * Register an HSM backend.
   * @param {string} name - Backend identifier (e.g. 'luna', 'cloudhsm')
   * @param {object} config - Backend configuration
   * @returns {{ name: string, registered: boolean, capabilities: string[] }}
   */
  registerBackend(name, config) {
    if (!name || !config) {
      throw new Error("name and config are required");
    }

    const capabilities = config.capabilities || [
      "sign",
      "verify",
      "encrypt",
      "decrypt",
      "keygen",
    ];
    this.backends.set(name, { ...config, capabilities });

    logger.info(
      `[HSMManager] Registered backend: ${name} (${config.vendor || "custom"})`,
    );
    this.emit("backend:registered", { name });

    return { name, registered: true, capabilities };
  }

  /**
   * Select the active HSM backend.
   * @param {string} name - Backend identifier
   * @returns {{ selected: string, status: string }}
   */
  selectBackend(name) {
    if (!this.backends.has(name)) {
      throw new Error(`Backend not found: ${name}`);
    }

    this.activeBackend = name;
    logger.info(`[HSMManager] Active backend set to: ${name}`);
    this.emit("backend:selected", { name });

    return { selected: name, status: "ready" };
  }

  // -----------------------------------------------------------------------
  // Key generation
  // -----------------------------------------------------------------------

  /**
   * Generate a key in the active HSM backend (simulated).
   * @param {string} alias - Key alias
   * @param {string} algorithm - Algorithm (e.g. 'aes-256-gcm', 'rsa-2048', 'ec-p256', 'hmac-sha256')
   * @param {object} [options]
   * @param {string} [options.keyType] - 'symmetric', 'asymmetric', or 'hmac'
   * @returns {{ keyId: string, alias: string, algorithm: string, backend: string }}
   */
  async generateKey(alias, algorithm, options = {}) {
    if (!alias || !algorithm) {
      throw new Error("alias and algorithm are required");
    }

    if (!this.activeBackend) {
      throw new Error("No active backend selected");
    }

    const keyId = uuidv4();
    let keyMaterial;
    let keyType = options.keyType || "symmetric";

    // Simulate key generation based on algorithm
    if (algorithm.startsWith("rsa") || algorithm.startsWith("ec")) {
      keyType = "asymmetric";
      const algoConfig = algorithm.startsWith("rsa")
        ? {
            type: "rsa",
            modulusLength: parseInt(algorithm.split("-")[1]) || 2048,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
          }
        : {
            type: "ec",
            namedCurve: algorithm.includes("384") ? "P-384" : "P-256",
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
          };

      const keyPair = crypto.generateKeyPairSync(algoConfig.type, algoConfig);
      keyMaterial = {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
      };
    } else if (algorithm.startsWith("hmac")) {
      keyType = "hmac";
      keyMaterial = { secret: crypto.randomBytes(32) };
    } else {
      // Symmetric key (AES, etc.)
      const keySize = algorithm.includes("128") ? 16 : 32;
      keyMaterial = { secret: crypto.randomBytes(keySize) };
    }

    // Store key material in memory
    this.keyStore.set(alias, {
      keyId,
      alias,
      algorithm,
      keyType,
      backend: this.activeBackend,
      material: keyMaterial,
      version: 1,
      createdAt: new Date().toISOString(),
    });

    // Persist lifecycle record to DB
    this._storeKeyRecord({
      id: keyId,
      keyAlias: alias,
      backend: this.activeBackend,
      algorithm,
      keyType,
      version: 1,
      metadata: { generatedBy: "hsm-manager", options },
    });

    logger.info(
      `[HSMManager] Generated ${keyType} key "${alias}" (${algorithm}) on ${this.activeBackend}`,
    );
    this.emit("key:generated", {
      keyId,
      alias,
      algorithm,
      backend: this.activeBackend,
    });

    return { keyId, alias, algorithm, backend: this.activeBackend };
  }

  // -----------------------------------------------------------------------
  // Signing & verification
  // -----------------------------------------------------------------------

  /**
   * Sign data using a key from the HSM.
   * @param {string} keyAlias - Key alias
   * @param {string|Buffer} data - Data to sign
   * @returns {{ signature: string, algorithm: string, backend: string }}
   */
  async sign(keyAlias, data) {
    if (!keyAlias || data == null) {
      throw new Error("keyAlias and data are required");
    }

    const keyEntry = this.keyStore.get(keyAlias);
    if (!keyEntry) {
      throw new Error(`Key not found: ${keyAlias}`);
    }

    let signature;
    const algorithm = keyEntry.algorithm;

    if (keyEntry.keyType === "asymmetric") {
      const signer = crypto.createSign("SHA256");
      signer.update(typeof data === "string" ? data : data.toString());
      signature = signer.sign(keyEntry.material.privateKey, "hex");
    } else if (keyEntry.keyType === "hmac") {
      signature = crypto
        .createHmac("sha256", keyEntry.material.secret)
        .update(typeof data === "string" ? data : data.toString())
        .digest("hex");
    } else {
      // Symmetric: use HMAC as a MAC
      signature = crypto
        .createHmac("sha256", keyEntry.material.secret)
        .update(typeof data === "string" ? data : data.toString())
        .digest("hex");
    }

    logger.info(
      `[HSMManager] Signed data with key "${keyAlias}" on ${keyEntry.backend}`,
    );
    this.emit("key:signed", { alias: keyAlias, algorithm });

    return { signature, algorithm, backend: keyEntry.backend };
  }

  /**
   * Verify a signature using a key from the HSM.
   * @param {string} keyAlias - Key alias
   * @param {string|Buffer} data - Original data
   * @param {string} signature - Signature to verify (hex)
   * @returns {{ valid: boolean, algorithm: string }}
   */
  async verify(keyAlias, data, signature) {
    if (!keyAlias || data == null || !signature) {
      throw new Error("keyAlias, data, and signature are required");
    }

    const keyEntry = this.keyStore.get(keyAlias);
    if (!keyEntry) {
      throw new Error(`Key not found: ${keyAlias}`);
    }

    let valid;
    const algorithm = keyEntry.algorithm;

    if (keyEntry.keyType === "asymmetric") {
      const verifier = crypto.createVerify("SHA256");
      verifier.update(typeof data === "string" ? data : data.toString());
      valid = verifier.verify(keyEntry.material.publicKey, signature, "hex");
    } else {
      // HMAC / symmetric: recompute and compare
      const expected = crypto
        .createHmac("sha256", keyEntry.material.secret)
        .update(typeof data === "string" ? data : data.toString())
        .digest("hex");
      valid = crypto.timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(signature, "hex"),
      );
    }

    logger.info(
      `[HSMManager] Verified signature for key "${keyAlias}": valid=${valid}`,
    );
    this.emit("key:verified", { alias: keyAlias, valid });

    return { valid, algorithm };
  }

  // -----------------------------------------------------------------------
  // Encryption & decryption
  // -----------------------------------------------------------------------

  /**
   * Encrypt data using an HSM key.
   * @param {string} keyAlias - Key alias
   * @param {string|Buffer} plaintext - Data to encrypt
   * @returns {{ ciphertext: string, iv: string, algorithm: string }}
   */
  async encrypt(keyAlias, plaintext) {
    if (!keyAlias || plaintext == null) {
      throw new Error("keyAlias and plaintext are required");
    }

    const keyEntry = this.keyStore.get(keyAlias);
    if (!keyEntry) {
      throw new Error(`Key not found: ${keyAlias}`);
    }

    const iv = crypto.randomBytes(16);
    let key = keyEntry.material.secret;

    // For asymmetric keys, derive a symmetric key from the private key
    if (keyEntry.keyType === "asymmetric") {
      key = crypto
        .createHash("sha256")
        .update(keyEntry.material.privateKey)
        .digest();
    }

    // Ensure key is 32 bytes for AES-256
    if (key.length < 32) {
      key = crypto.createHash("sha256").update(key).digest();
    }

    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      key.subarray(0, 32),
      iv,
    );
    let encrypted = cipher.update(
      typeof plaintext === "string" ? plaintext : plaintext.toString(),
      "utf8",
      "hex",
    );
    encrypted += cipher.final("hex");

    logger.info(`[HSMManager] Encrypted data with key "${keyAlias}"`);
    this.emit("key:encrypted", { alias: keyAlias });

    return {
      ciphertext: encrypted,
      iv: iv.toString("hex"),
      algorithm: keyEntry.algorithm,
    };
  }

  /**
   * Decrypt data using an HSM key.
   * @param {string} keyAlias - Key alias
   * @param {string} ciphertext - Encrypted data (hex)
   * @param {string} iv - Initialization vector (hex)
   * @returns {{ plaintext: string, algorithm: string }}
   */
  async decrypt(keyAlias, ciphertext, iv) {
    if (!keyAlias || !ciphertext || !iv) {
      throw new Error("keyAlias, ciphertext, and iv are required");
    }

    const keyEntry = this.keyStore.get(keyAlias);
    if (!keyEntry) {
      throw new Error(`Key not found: ${keyAlias}`);
    }

    let key = keyEntry.material.secret;

    if (keyEntry.keyType === "asymmetric") {
      key = crypto
        .createHash("sha256")
        .update(keyEntry.material.privateKey)
        .digest();
    }

    if (key.length < 32) {
      key = crypto.createHash("sha256").update(key).digest();
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      key.subarray(0, 32),
      Buffer.from(iv, "hex"),
    );
    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");

    logger.info(`[HSMManager] Decrypted data with key "${keyAlias}"`);
    this.emit("key:decrypted", { alias: keyAlias });

    return { plaintext: decrypted, algorithm: keyEntry.algorithm };
  }

  // -----------------------------------------------------------------------
  // Key rotation
  // -----------------------------------------------------------------------

  /**
   * Rotate a key: generate a new version, mark the old as rotated.
   * @param {string} keyAlias - Key alias to rotate
   * @returns {{ keyId: string, alias: string, version: number, previousVersion: number }}
   */
  async rotateKey(keyAlias) {
    if (!keyAlias) {
      throw new Error("keyAlias is required");
    }

    const keyEntry = this.keyStore.get(keyAlias);
    if (!keyEntry) {
      throw new Error(`Key not found: ${keyAlias}`);
    }

    const previousVersion = keyEntry.version;
    const newVersion = previousVersion + 1;

    // Mark old key record as rotated in DB
    this._updateKeyStatus(keyAlias, "rotated", {
      rotatedAt: new Date().toISOString(),
    });

    // Generate fresh key material
    const newKeyId = uuidv4();
    let newMaterial;

    if (keyEntry.keyType === "asymmetric") {
      const algoConfig = keyEntry.algorithm.startsWith("rsa")
        ? {
            type: "rsa",
            modulusLength: parseInt(keyEntry.algorithm.split("-")[1]) || 2048,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
          }
        : {
            type: "ec",
            namedCurve: keyEntry.algorithm.includes("384") ? "P-384" : "P-256",
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
          };

      const keyPair = crypto.generateKeyPairSync(algoConfig.type, algoConfig);
      newMaterial = {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
      };
    } else {
      const keySize = keyEntry.algorithm.includes("128") ? 16 : 32;
      newMaterial = { secret: crypto.randomBytes(keySize) };
    }

    // Update in-memory store
    this.keyStore.set(keyAlias, {
      ...keyEntry,
      keyId: newKeyId,
      material: newMaterial,
      version: newVersion,
      rotatedAt: new Date().toISOString(),
    });

    // Store new key record in DB
    this._storeKeyRecord({
      id: newKeyId,
      keyAlias,
      backend: keyEntry.backend,
      algorithm: keyEntry.algorithm,
      keyType: keyEntry.keyType,
      version: newVersion,
      metadata: { rotatedFrom: keyEntry.keyId, previousVersion },
    });

    logger.info(
      `[HSMManager] Rotated key "${keyAlias}" v${previousVersion} → v${newVersion}`,
    );
    this.emit("key:rotated", {
      alias: keyAlias,
      version: newVersion,
      previousVersion,
    });

    return {
      keyId: newKeyId,
      alias: keyAlias,
      version: newVersion,
      previousVersion,
    };
  }

  // -----------------------------------------------------------------------
  // Key destruction
  // -----------------------------------------------------------------------

  /**
   * Mark a key as destroyed.
   * @param {string} keyAlias - Key alias to destroy
   * @returns {{ alias: string, destroyed: boolean }}
   */
  async destroyKey(keyAlias) {
    if (!keyAlias) {
      throw new Error("keyAlias is required");
    }

    const keyEntry = this.keyStore.get(keyAlias);
    if (!keyEntry) {
      throw new Error(`Key not found: ${keyAlias}`);
    }

    // Overwrite key material with zeros before deletion
    if (keyEntry.material.secret) {
      keyEntry.material.secret.fill(0);
    }
    this.keyStore.delete(keyAlias);

    // Update DB status
    this._updateKeyStatus(keyAlias, "destroyed", {
      destroyedAt: new Date().toISOString(),
    });

    logger.info(`[HSMManager] Destroyed key "${keyAlias}"`);
    this.emit("key:destroyed", { alias: keyAlias });

    return { alias: keyAlias, destroyed: true };
  }

  // -----------------------------------------------------------------------
  // Backup & restore
  // -----------------------------------------------------------------------

  /**
   * Create an encrypted backup of a key.
   * @param {string} keyAlias - Key alias to back up
   * @returns {{ backupId: string, alias: string, backupData: string, encryptedSize: number }}
   */
  async backupKey(keyAlias) {
    if (!keyAlias) {
      throw new Error("keyAlias is required");
    }

    const keyEntry = this.keyStore.get(keyAlias);
    if (!keyEntry) {
      throw new Error(`Key not found: ${keyAlias}`);
    }

    const backupId = uuidv4();

    // Serialize key material
    const serialized = JSON.stringify({
      keyId: keyEntry.keyId,
      alias: keyEntry.alias,
      algorithm: keyEntry.algorithm,
      keyType: keyEntry.keyType,
      backend: keyEntry.backend,
      version: keyEntry.version,
      material: {
        secret: keyEntry.material.secret
          ? keyEntry.material.secret.toString("hex")
          : undefined,
        publicKey: keyEntry.material.publicKey || undefined,
        privateKey: keyEntry.material.privateKey || undefined,
      },
    });

    // Encrypt the backup with a random wrapping key
    const wrapKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", wrapKey, iv);
    let encrypted = cipher.update(serialized, "utf8", "hex");
    encrypted += cipher.final("hex");

    const backupData = JSON.stringify({
      backupId,
      iv: iv.toString("hex"),
      wrapKey: wrapKey.toString("hex"),
      payload: encrypted,
    });

    // Update DB status
    this._updateKeyStatus(keyAlias, "backed_up");

    logger.info(`[HSMManager] Backed up key "${keyAlias}" as ${backupId}`);
    this.emit("key:backed-up", { alias: keyAlias, backupId });

    return {
      backupId,
      alias: keyAlias,
      backupData,
      encryptedSize: encrypted.length,
    };
  }

  /**
   * Restore a key from an encrypted backup.
   * @param {string} backupId - Backup identifier
   * @param {string} backupData - Encrypted backup data (JSON string)
   * @returns {{ keyId: string, alias: string, restored: boolean }}
   */
  async restoreKey(backupId, backupData) {
    if (!backupId || !backupData) {
      throw new Error("backupId and backupData are required");
    }

    let parsed;
    try {
      parsed = JSON.parse(backupData);
    } catch {
      throw new Error("Invalid backup data format");
    }

    // Decrypt the backup
    const wrapKey = Buffer.from(parsed.wrapKey, "hex");
    const iv = Buffer.from(parsed.iv, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", wrapKey, iv);
    let decrypted = decipher.update(parsed.payload, "hex", "utf8");
    decrypted += decipher.final("utf8");

    const keyData = JSON.parse(decrypted);
    const newKeyId = uuidv4();

    // Reconstruct key material
    const material = {};
    if (keyData.material.secret) {
      material.secret = Buffer.from(keyData.material.secret, "hex");
    }
    if (keyData.material.publicKey) {
      material.publicKey = keyData.material.publicKey;
    }
    if (keyData.material.privateKey) {
      material.privateKey = keyData.material.privateKey;
    }

    // Store restored key in memory
    this.keyStore.set(keyData.alias, {
      keyId: newKeyId,
      alias: keyData.alias,
      algorithm: keyData.algorithm,
      keyType: keyData.keyType,
      backend: keyData.backend,
      material,
      version: keyData.version,
      restoredAt: new Date().toISOString(),
    });

    // Store lifecycle record
    this._storeKeyRecord({
      id: newKeyId,
      keyAlias: keyData.alias,
      backend: keyData.backend,
      algorithm: keyData.algorithm,
      keyType: keyData.keyType,
      version: keyData.version,
      status: "restored",
      metadata: { restoredFrom: backupId },
    });

    logger.info(
      `[HSMManager] Restored key "${keyData.alias}" from backup ${backupId}`,
    );
    this.emit("key:restored", { alias: keyData.alias, backupId });

    return { keyId: newKeyId, alias: keyData.alias, restored: true };
  }

  // -----------------------------------------------------------------------
  // Cluster management
  // -----------------------------------------------------------------------

  /**
   * Configure an HSM cluster for high availability.
   * @param {object[]} nodes - Array of node configs [{id, host, port}]
   * @returns {{ clusterId: string, nodeCount: number, status: string, replicationFactor: number }}
   */
  configureCluster(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      throw new Error("nodes must be a non-empty array");
    }

    const clusterId = uuidv4();
    const replicationFactor = Math.min(nodes.length, 3);

    this.cluster = {
      clusterId,
      nodes: nodes.map((node) => ({
        id: node.id || uuidv4(),
        host: node.host || "localhost",
        port: node.port || 9223,
        status: "healthy",
        joinedAt: new Date().toISOString(),
      })),
      replicationFactor,
      configuredAt: new Date().toISOString(),
    };

    logger.info(
      `[HSMManager] Cluster ${clusterId} configured with ${nodes.length} nodes`,
    );
    this.emit("cluster:configured", { clusterId, nodeCount: nodes.length });

    return {
      clusterId,
      nodeCount: nodes.length,
      status: "configured",
      replicationFactor,
    };
  }

  /**
   * Return simulated cluster health status.
   * @returns {{ nodes: object[], healthy: boolean, quorum: boolean }}
   */
  getClusterStatus() {
    if (!this.cluster) {
      return { nodes: [], healthy: false, quorum: false };
    }

    const nodes = this.cluster.nodes.map((node) => ({
      id: node.id,
      status: node.status,
      latencyMs: Math.floor(Math.random() * 10) + 1,
    }));

    const healthyCount = nodes.filter((n) => n.status === "healthy").length;
    const quorum = healthyCount > nodes.length / 2;

    return { nodes, healthy: healthyCount === nodes.length, quorum };
  }

  // -----------------------------------------------------------------------
  // Batch operations
  // -----------------------------------------------------------------------

  /**
   * Encrypt multiple items using a single key.
   * @param {string} keyAlias - Key alias
   * @param {Array<{id: string, data: string}>} items - Items to encrypt
   * @returns {{ results: object[], totalItems: number, successCount: number }}
   */
  async batchEncrypt(keyAlias, items) {
    if (!keyAlias || !Array.isArray(items)) {
      throw new Error("keyAlias and items array are required");
    }

    const results = [];
    let successCount = 0;

    for (const item of items) {
      try {
        const encrypted = await this.encrypt(keyAlias, item.data);
        results.push({
          id: item.id,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
        });
        successCount++;
      } catch (err) {
        results.push({ id: item.id, error: err.message });
      }
    }

    logger.info(
      `[HSMManager] Batch encrypt: ${successCount}/${items.length} succeeded`,
    );
    this.emit("batch:encrypted", {
      alias: keyAlias,
      totalItems: items.length,
      successCount,
    });

    return { results, totalItems: items.length, successCount };
  }

  // -----------------------------------------------------------------------
  // Compliance
  // -----------------------------------------------------------------------

  /**
   * Return compliance status for major HSM standards.
   * @returns {{ standards: object[], overallCompliant: boolean }}
   */
  getComplianceStatus() {
    const standards = COMPLIANCE_STANDARDS.map((s) => ({ ...s }));
    const overallCompliant = standards.every((s) => s.status === "compliant");

    return { standards, overallCompliant };
  }

  // -----------------------------------------------------------------------
  // Statistics
  // -----------------------------------------------------------------------

  /**
   * Return aggregate key counts from the database.
   * @returns {{ total: number, active: number, rotated: number, destroyed: number, backedUp: number, restored: number, byBackend: object, byAlgorithm: object }}
   */
  async getStats() {
    const raw = this.db?.db;
    const stats = {
      total: 0,
      active: 0,
      rotated: 0,
      destroyed: 0,
      backedUp: 0,
      restored: 0,
      byBackend: {},
      byAlgorithm: {},
    };

    if (!raw) {
      return stats;
    }

    try {
      const totalRow = raw
        .prepare("SELECT COUNT(*) as cnt FROM hsm_key_lifecycle")
        .get();
      stats.total = totalRow?.cnt || 0;

      const statusRows = raw
        .prepare(
          "SELECT status, COUNT(*) as cnt FROM hsm_key_lifecycle GROUP BY status",
        )
        .all();

      for (const row of statusRows) {
        switch (row.status) {
          case "active":
            stats.active = row.cnt;
            break;
          case "rotated":
            stats.rotated = row.cnt;
            break;
          case "destroyed":
            stats.destroyed = row.cnt;
            break;
          case "backed_up":
            stats.backedUp = row.cnt;
            break;
          case "restored":
            stats.restored = row.cnt;
            break;
        }
      }

      const backendRows = raw
        .prepare(
          "SELECT backend, COUNT(*) as cnt FROM hsm_key_lifecycle GROUP BY backend",
        )
        .all();

      for (const row of backendRows) {
        stats.byBackend[row.backend] = row.cnt;
      }

      const algoRows = raw
        .prepare(
          "SELECT algorithm, COUNT(*) as cnt FROM hsm_key_lifecycle GROUP BY algorithm",
        )
        .all();

      for (const row of algoRows) {
        stats.byAlgorithm[row.algorithm] = row.cnt;
      }
    } catch (err) {
      logger.error("[HSMManager] Failed to get stats:", err);
    }

    return stats;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Persist a key lifecycle record to the database.
   * @private
   */
  _storeKeyRecord({
    id,
    keyAlias,
    backend,
    algorithm,
    keyType,
    version,
    status,
    metadata,
  }) {
    const raw = this.db?.db;
    if (!raw) {
      return;
    }

    try {
      raw
        .prepare(
          `INSERT INTO hsm_key_lifecycle (id, key_alias, backend, algorithm, key_type, status, version, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          keyAlias,
          backend,
          algorithm,
          keyType || "symmetric",
          status || "active",
          version || 1,
          JSON.stringify(metadata || {}),
        );
    } catch (err) {
      logger.error(`[HSMManager] Failed to store key record ${id}:`, err);
    }
  }

  /**
   * Update a key's status in the database.
   * @private
   */
  _updateKeyStatus(keyAlias, status, extra = {}) {
    const raw = this.db?.db;
    if (!raw) {
      return;
    }

    try {
      const updates = [`status = '${status}'`];
      if (extra.rotatedAt) {
        updates.push(`rotated_at = '${extra.rotatedAt}'`);
      }
      if (extra.destroyedAt) {
        updates.push(`destroyed_at = '${extra.destroyedAt}'`);
      }

      raw
        .prepare(
          `UPDATE hsm_key_lifecycle SET ${updates.join(", ")} WHERE key_alias = ? AND status = 'active'`,
        )
        .run(keyAlias);
    } catch (err) {
      logger.error(
        `[HSMManager] Failed to update key status for "${keyAlias}":`,
        err,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance = null;

/**
 * Get or create the HSMManager singleton.
 * @returns {HSMManager}
 */
function getHSMManager() {
  if (!instance) {
    instance = new HSMManager();
  }
  return instance;
}

module.exports = { HSMManager, getHSMManager };
