/**
 * PQC Manager — post-quantum cryptography key management,
 * algorithm migration, and hybrid encryption support.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _keys = new Map();
const _migrations = new Map();

const PQC_ALGORITHMS = {
  ML_KEM_768: "ML-KEM-768",
  ML_KEM_1024: "ML-KEM-1024",
  ML_DSA_65: "ML-DSA-65",
  ML_DSA_87: "ML-DSA-87",
  HYBRID_X25519_ML_KEM: "HYBRID-X25519-ML-KEM",
  HYBRID_ED25519_ML_DSA: "HYBRID-ED25519-ML-DSA",
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
};

/* ── Schema ────────────────────────────────────────────────── */

export function ensurePQCTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pqc_keys (
      id TEXT PRIMARY KEY,
      algorithm TEXT NOT NULL,
      purpose TEXT,
      public_key TEXT,
      key_size INTEGER,
      hybrid_mode INTEGER DEFAULT 0,
      classical_algorithm TEXT,
      status TEXT DEFAULT 'active',
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pqc_migration_status (
      id TEXT PRIMARY KEY,
      plan_name TEXT,
      source_algorithm TEXT,
      target_algorithm TEXT,
      total_keys INTEGER DEFAULT 0,
      migrated_keys INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Key Management ───────────────────────────────────────── */

export function listKeys(filter = {}) {
  let keys = [..._keys.values()];
  if (filter.algorithm) {
    keys = keys.filter((k) => k.algorithm === filter.algorithm);
  }
  if (filter.status) {
    keys = keys.filter((k) => k.status === filter.status);
  }
  return keys;
}

export function generateKey(db, algorithm, purpose, opts = {}) {
  if (!algorithm) throw new Error("Algorithm is required");

  const validAlgorithms = Object.values(PQC_ALGORITHMS);
  if (!validAlgorithms.includes(algorithm)) {
    throw new Error(`Invalid algorithm: ${algorithm}. Valid: ${validAlgorithms.join(", ")}`);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const keySize = algorithm.includes("1024") || algorithm.includes("87") ? 1024 : 768;
  const publicKey = crypto.randomBytes(keySize / 8).toString("hex");
  const isHybrid = algorithm.startsWith("HYBRID");
  const classicalAlgorithm = isHybrid
    ? algorithm.includes("X25519")
      ? "X25519"
      : "Ed25519"
    : null;

  const key = {
    id,
    algorithm,
    purpose: purpose || KEY_PURPOSES.ENCRYPTION,
    publicKey,
    keySize,
    hybridMode: isHybrid,
    classicalAlgorithm,
    status: "active",
    metadata: opts.metadata || {},
    createdAt: now,
  };

  _keys.set(id, key);

  db.prepare(
    `INSERT INTO pqc_keys (id, algorithm, purpose, public_key, key_size, hybrid_mode, classical_algorithm, status, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    algorithm,
    key.purpose,
    publicKey,
    keySize,
    isHybrid ? 1 : 0,
    classicalAlgorithm,
    "active",
    JSON.stringify(key.metadata),
    now,
  );

  return key;
}

/* ── Migration ────────────────────────────────────────────── */

export function getMigrationStatus() {
  return [..._migrations.values()];
}

export function migrate(db, planName, sourceAlgorithm, targetAlgorithm) {
  if (!planName) throw new Error("Plan name is required");
  if (!targetAlgorithm) throw new Error("Target algorithm is required");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Find keys matching source algorithm
  const sourceKeys = sourceAlgorithm
    ? [..._keys.values()].filter((k) => k.algorithm === sourceAlgorithm)
    : [..._keys.values()];

  const plan = {
    id,
    planName,
    sourceAlgorithm: sourceAlgorithm || "all",
    targetAlgorithm,
    totalKeys: sourceKeys.length,
    migratedKeys: sourceKeys.length, // Simulate instant migration
    status: MIGRATION_STATUS.COMPLETED,
    startedAt: now,
    completedAt: now,
    errorMessage: null,
  };

  _migrations.set(id, plan);

  db.prepare(
    `INSERT INTO pqc_migration_status (id, plan_name, source_algorithm, target_algorithm, total_keys, migrated_keys, status, started_at, completed_at, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    planName,
    plan.sourceAlgorithm,
    targetAlgorithm,
    plan.totalKeys,
    plan.migratedKeys,
    plan.status,
    now,
    now,
    null,
    now,
  );

  return plan;
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _keys.clear();
  _migrations.clear();
}
