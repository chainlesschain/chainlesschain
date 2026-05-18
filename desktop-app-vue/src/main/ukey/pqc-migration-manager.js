/**
 * Post-Quantum Cryptography Migration Manager
 *
 * ML-KEM/ML-DSA simulation, hybrid encrypt/sign, migration plan execution:
 * - Key generation (ML-KEM-768, ML-DSA-65, hybrid modes)
 * - Hybrid encryption (classical + PQC combined)
 * - Migration plan creation and execution
 * - Key status tracking
 *
 * @module ukey/pqc-migration-manager
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const PQC_ALGORITHMS = {
  ML_KEM_768: "ML-KEM-768",
  ML_KEM_1024: "ML-KEM-1024",
  ML_DSA_65: "ML-DSA-65",
  ML_DSA_87: "ML-DSA-87",
  HYBRID_X25519_ML_KEM: "X25519-ML-KEM-768",
  HYBRID_ED25519_ML_DSA: "Ed25519-ML-DSA-65",
};

const KEY_PURPOSES = {
  ENCRYPTION: "encryption",
  SIGNING: "signing",
  KEY_EXCHANGE: "key_exchange",
};

const MIGRATION_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  ROLLED_BACK: "rolled_back",
};

// ============================================================
// PQCMigrationManager
// ============================================================

class PQCMigrationManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._keys = new Map();
    this._migrationPlans = new Map();
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS pqc_keys (
        id TEXT PRIMARY KEY,
        algorithm TEXT NOT NULL,
        purpose TEXT NOT NULL,
        public_key TEXT,
        key_size INTEGER,
        hybrid_mode INTEGER DEFAULT 0,
        classical_algorithm TEXT,
        status TEXT DEFAULT 'active',
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_pqc_keys_algorithm ON pqc_keys(algorithm);
      CREATE INDEX IF NOT EXISTS idx_pqc_keys_status ON pqc_keys(status);

      CREATE TABLE IF NOT EXISTS pqc_migration_status (
        id TEXT PRIMARY KEY,
        plan_name TEXT NOT NULL,
        source_algorithm TEXT,
        target_algorithm TEXT,
        total_keys INTEGER DEFAULT 0,
        migrated_keys INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        started_at INTEGER,
        completed_at INTEGER,
        error_message TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_pqc_migration_status ON pqc_migration_status(status);
    `);
  }

  async initialize() {
    logger.info("[PQCMigrationManager] Initializing PQC migration manager...");
    this._ensureTables();

    if (this.database && this.database.db) {
      try {
        const keys = this.database.db
          .prepare("SELECT * FROM pqc_keys WHERE status = 'active'")
          .all();
        for (const key of keys) {
          this._keys.set(key.id, {
            ...key,
            metadata: key.metadata ? JSON.parse(key.metadata) : {},
          });
        }

        const plans = this.database.db
          .prepare(
            "SELECT * FROM pqc_migration_status WHERE status != 'completed'",
          )
          .all();
        for (const plan of plans) {
          this._migrationPlans.set(plan.id, plan);
        }

        logger.info(
          `[PQCMigrationManager] Loaded ${keys.length} keys, ${plans.length} active plans`,
        );
      } catch (err) {
        logger.error("[PQCMigrationManager] Failed to load data:", err);
      }
    }

    this.initialized = true;
    logger.info("[PQCMigrationManager] PQC migration manager initialized");
  }

  /**
   * List all PQC keys
   * @param {Object} [filter] - Optional filter
   * @param {string} [filter.algorithm] - Filter by algorithm
   * @param {string} [filter.status] - Filter by status
   * @returns {Array} Keys
   */
  async listKeys(filter = {}) {
    let keys = Array.from(this._keys.values());

    if (filter.algorithm) {
      keys = keys.filter((k) => k.algorithm === filter.algorithm);
    }
    if (filter.status) {
      keys = keys.filter((k) => k.status === filter.status);
    }

    return keys;
  }

  /**
   * Generate a new PQC key
   * @param {Object} params
   * @param {string} params.algorithm - PQC algorithm
   * @param {string} params.purpose - Key purpose
   * @param {boolean} [params.hybridMode] - Enable hybrid mode
   * @param {string} [params.classicalAlgorithm] - Classical algorithm for hybrid
   * @returns {Object} Generated key record
   */
  async generateKey({
    algorithm,
    purpose,
    hybridMode = false,
    classicalAlgorithm,
  } = {}) {
    const validAlgorithms = Object.values(PQC_ALGORITHMS);
    if (!validAlgorithms.includes(algorithm)) {
      throw new Error(
        `Invalid algorithm: ${algorithm}. Must be one of: ${validAlgorithms.join(", ")}`,
      );
    }

    const validPurposes = Object.values(KEY_PURPOSES);
    if (!validPurposes.includes(purpose)) {
      throw new Error(
        `Invalid purpose: ${purpose}. Must be one of: ${validPurposes.join(", ")}`,
      );
    }

    const id = uuidv4();
    // Simulate PQC key generation with random bytes
    const keySize =
      algorithm.includes("1024") || algorithm.includes("87") ? 1024 : 768;
    const publicKey = crypto.randomBytes(keySize).toString("hex");

    const keyRecord = {
      id,
      algorithm,
      purpose,
      public_key: publicKey,
      key_size: keySize,
      hybrid_mode: hybridMode ? 1 : 0,
      classical_algorithm: hybridMode ? classicalAlgorithm || "X25519" : null,
      status: "active",
      metadata: {},
      created_at: Date.now(),
    };

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `
        INSERT INTO pqc_keys (id, algorithm, purpose, public_key, key_size, hybrid_mode, classical_algorithm, status, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          algorithm,
          purpose,
          publicKey,
          keySize,
          keyRecord.hybrid_mode,
          keyRecord.classical_algorithm,
          "active",
          "{}",
          keyRecord.created_at,
        );
    }

    this._keys.set(id, keyRecord);
    this.emit("key-generated", keyRecord);
    logger.info(`[PQCMigrationManager] Generated ${algorithm} key: ${id}`);
    return keyRecord;
  }

  /**
   * Get migration status for all plans
   * @returns {Array} Migration plans with status
   */
  async getMigrationStatus() {
    if (this.database && this.database.db) {
      try {
        return this.database.db
          .prepare(
            "SELECT * FROM pqc_migration_status ORDER BY created_at DESC",
          )
          .all();
      } catch (err) {
        logger.error(
          "[PQCMigrationManager] Failed to get migration status:",
          err,
        );
      }
    }
    return Array.from(this._migrationPlans.values());
  }

  /**
   * Execute a migration plan
   * @param {Object} params
   * @param {string} params.planName - Migration plan name
   * @param {string} params.sourceAlgorithm - Source algorithm to migrate from
   * @param {string} params.targetAlgorithm - Target PQC algorithm
   * @returns {Object} Migration result
   */
  async executeMigration({ planName, sourceAlgorithm, targetAlgorithm } = {}) {
    if (!planName) {
      throw new Error("Plan name is required");
    }
    if (!targetAlgorithm) {
      throw new Error("Target algorithm is required");
    }

    const validAlgorithms = Object.values(PQC_ALGORITHMS);
    if (!validAlgorithms.includes(targetAlgorithm)) {
      throw new Error(`Invalid target algorithm: ${targetAlgorithm}`);
    }

    const id = uuidv4();
    const now = Date.now();

    // Count keys to migrate
    const keysToMigrate = sourceAlgorithm
      ? Array.from(this._keys.values()).filter(
          (k) => k.algorithm === sourceAlgorithm && k.status === "active",
        )
      : [];
    const totalKeys = keysToMigrate.length;

    const plan = {
      id,
      plan_name: planName,
      source_algorithm: sourceAlgorithm || "classical",
      target_algorithm: targetAlgorithm,
      total_keys: totalKeys,
      migrated_keys: 0,
      status: MIGRATION_STATUS.IN_PROGRESS,
      started_at: now,
      completed_at: null,
      error_message: null,
      created_at: now,
    };

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `
        INSERT INTO pqc_migration_status (id, plan_name, source_algorithm, target_algorithm, total_keys, migrated_keys, status, started_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          planName,
          plan.source_algorithm,
          targetAlgorithm,
          totalKeys,
          0,
          plan.status,
          now,
          now,
        );
    }

    // Simulate migration of each key
    let migratedCount = 0;
    for (const key of keysToMigrate) {
      try {
        await this.generateKey({
          algorithm: targetAlgorithm,
          purpose: key.purpose,
          hybridMode: key.hybrid_mode === 1,
          classicalAlgorithm: key.classical_algorithm,
        });
        migratedCount++;
      } catch (err) {
        logger.warn(
          `[PQCMigrationManager] Failed to migrate key ${key.id}:`,
          err.message,
        );
      }
    }

    // Update plan status
    plan.migrated_keys = migratedCount;
    plan.status =
      migratedCount === totalKeys
        ? MIGRATION_STATUS.COMPLETED
        : MIGRATION_STATUS.FAILED;
    plan.completed_at = Date.now();
    if (migratedCount < totalKeys) {
      plan.error_message = `Only ${migratedCount}/${totalKeys} keys migrated`;
    }

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `
        UPDATE pqc_migration_status SET migrated_keys = ?, status = ?, completed_at = ?, error_message = ? WHERE id = ?
      `,
        )
        .run(
          migratedCount,
          plan.status,
          plan.completed_at,
          plan.error_message,
          id,
        );
    }

    this._migrationPlans.set(id, plan);
    this.emit("migration-completed", plan);
    logger.info(
      `[PQCMigrationManager] Migration ${planName}: ${migratedCount}/${totalKeys} keys migrated`,
    );
    return plan;
  }

  /**
   * Build PQC context for AI prompt injection
   * @param {string} _contextHint - Context hint
   * @param {number} _limit - Max items
   * @returns {string|null} Context string
   */
  buildPQCContext(_contextHint, _limit) {
    if (this._keys.size === 0) {
      return null;
    }

    const algorithms = new Set();
    for (const key of this._keys.values()) {
      algorithms.add(key.algorithm);
    }

    return `[PQC Status] ${this._keys.size} keys across algorithms: ${Array.from(algorithms).join(", ")}`;
  }

  async close() {
    this.removeAllListeners();
    this._keys.clear();
    this._migrationPlans.clear();
    this.initialized = false;
    logger.info("[PQCMigrationManager] Closed");
  }
}

// ============================================================
// Singleton
// ============================================================

let _instance = null;

function getPQCMigrationManager(database) {
  if (!_instance) {
    _instance = new PQCMigrationManager(database);
  }
  return _instance;
}

export {
  PQCMigrationManager,
  getPQCMigrationManager,
  PQC_ALGORITHMS,
  KEY_PURPOSES,
  MIGRATION_STATUS,
};
export default PQCMigrationManager;
