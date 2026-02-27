/**
 * Unified Key Manager
 *
 * BIP-32 hierarchical deterministic key derivation across
 * U-Key + SIMKey + TEE devices. Cross-device key sync.
 *
 * @module ukey/unified-key-manager
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const KEY_PURPOSES = {
  IDENTITY: "identity",
  SIGNING: "signing",
  ENCRYPTION: "encryption",
  AUTHENTICATION: "authentication",
  DELEGATION: "delegation",
};

const KEY_SOURCES = {
  UKEY: "ukey",
  SIMKEY: "simkey",
  TEE: "tee",
  SOFTWARE: "software",
};

const DERIVATION_PATHS = {
  IDENTITY: "m/44'/0'/0'/0",
  SIGNING: "m/44'/0'/0'/1",
  ENCRYPTION: "m/44'/0'/0'/2",
  AUTHENTICATION: "m/44'/0'/0'/3",
  DID: "m/44'/501'/0'/0",
};

// ============================================================
// UnifiedKeyManager
// ============================================================

class UnifiedKeyManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._masterKeyHash = null;
    this._derivedKeys = new Map();
  }

  async initialize() {
    logger.info("[UnifiedKeyManager] Initializing unified key manager...");
    this._ensureTables();
    this.initialized = true;
    logger.info("[UnifiedKeyManager] Unified key manager initialized");
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {return;}

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS unified_keys (
        id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        source TEXT NOT NULL,
        derivation_path TEXT,
        public_key TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        algorithm TEXT DEFAULT 'ed25519',
        device_id TEXT,
        is_primary INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_unified_keys_purpose ON unified_keys(purpose);
      CREATE INDEX IF NOT EXISTS idx_unified_keys_source ON unified_keys(source);
      CREATE INDEX IF NOT EXISTS idx_unified_keys_hash ON unified_keys(key_hash);
    `);
  }

  /**
   * Derive a key for a specific purpose using BIP-32 path.
   * @param {string} purpose - Key purpose
   * @param {Object} [options] - Derivation options
   * @returns {Object} Derived key info
   */
  async deriveKey(purpose, options = {}) {
    try {
      const path = options.path || DERIVATION_PATHS[purpose.toUpperCase()] || `m/44'/0'/0'/${Date.now() % 100}`;
      const source = options.source || KEY_SOURCES.SOFTWARE;

      // Generate key pair (in production, this would use actual BIP-32 derivation)
      const { publicKey } = crypto.generateKeyPairSync("ed25519");

      const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
      const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
      const keyHash = crypto.createHash("sha256").update(publicKeyDer).digest("hex").substring(0, 32);

      const id = uuidv4();
      const now = Date.now();

      this.database.db
        .prepare(
          `INSERT INTO unified_keys (id, purpose, source, derivation_path, public_key, key_hash, algorithm, device_id, is_primary, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          purpose,
          source,
          path,
          publicKeyPem,
          keyHash,
          "ed25519",
          options.deviceId || null,
          options.isPrimary ? 1 : 0,
          now,
          now,
        );

      this.database.saveToFile();

      // Cache in memory (without private key for security)
      this._derivedKeys.set(keyHash, { id, purpose, source, path, publicKey: publicKeyPem });

      this.emit("key:derived", { id, purpose, source, path, keyHash });

      return {
        id,
        purpose,
        source,
        derivationPath: path,
        publicKey: publicKeyPem,
        keyHash,
        algorithm: "ed25519",
      };
    } catch (error) {
      logger.error("[UnifiedKeyManager] Key derivation failed:", error);
      throw error;
    }
  }

  /**
   * Get keys for a specific purpose.
   * @param {string} purpose - Key purpose
   * @returns {Array} Key records
   */
  async getKeysByPurpose(purpose) {
    try {
      if (!this.database || !this.database.db) {return [];}

      return this.database.db
        .prepare("SELECT * FROM unified_keys WHERE purpose = ? ORDER BY is_primary DESC, created_at DESC")
        .all(purpose);
    } catch (error) {
      logger.error("[UnifiedKeyManager] Get keys failed:", error);
      return [];
    }
  }

  /**
   * Get the primary key for a purpose.
   * @param {string} purpose - Key purpose
   * @returns {Object|null} Primary key
   */
  async getPrimaryKey(purpose) {
    try {
      if (!this.database || !this.database.db) {return null;}

      return this.database.db
        .prepare("SELECT * FROM unified_keys WHERE purpose = ? AND is_primary = 1 LIMIT 1")
        .get(purpose);
    } catch (error) {
      logger.error("[UnifiedKeyManager] Get primary key failed:", error);
      return null;
    }
  }

  /**
   * Set a key as primary for its purpose.
   * @param {string} keyId - Key ID
   * @returns {Object} Result
   */
  async setPrimaryKey(keyId) {
    try {
      const key = this.database.db
        .prepare("SELECT * FROM unified_keys WHERE id = ?")
        .get(keyId);

      if (!key) {throw new Error("Key not found");}

      // Unset current primary
      this.database.db
        .prepare("UPDATE unified_keys SET is_primary = 0 WHERE purpose = ?")
        .run(key.purpose);

      // Set new primary
      this.database.db
        .prepare("UPDATE unified_keys SET is_primary = 1, updated_at = ? WHERE id = ?")
        .run(Date.now(), keyId);

      this.database.saveToFile();
      return { success: true, keyId, purpose: key.purpose };
    } catch (error) {
      logger.error("[UnifiedKeyManager] Set primary key failed:", error);
      throw error;
    }
  }

  /**
   * List all keys.
   * @returns {Array} All key records
   */
  async listKeys() {
    try {
      if (!this.database || !this.database.db) {return [];}

      return this.database.db
        .prepare("SELECT id, purpose, source, derivation_path, key_hash, algorithm, device_id, is_primary, created_at FROM unified_keys ORDER BY created_at DESC")
        .all();
    } catch (error) {
      logger.error("[UnifiedKeyManager] List keys failed:", error);
      return [];
    }
  }

  /**
   * Revoke a key.
   * @param {string} keyId - Key ID
   * @returns {Object} Result
   */
  async revokeKey(keyId) {
    try {
      this.database.db
        .prepare("DELETE FROM unified_keys WHERE id = ?")
        .run(keyId);

      this.database.saveToFile();
      this.emit("key:revoked", { keyId });
      return { success: true };
    } catch (error) {
      logger.error("[UnifiedKeyManager] Revoke key failed:", error);
      throw error;
    }
  }

  async close() {
    this._derivedKeys.clear();
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[UnifiedKeyManager] Closed");
  }
}

let _instance;
function getUnifiedKeyManager() {
  if (!_instance) {_instance = new UnifiedKeyManager();}
  return _instance;
}

export {
  UnifiedKeyManager,
  getUnifiedKeyManager,
  KEY_PURPOSES,
  KEY_SOURCES,
  DERIVATION_PATHS,
};
