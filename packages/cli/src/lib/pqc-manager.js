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
  // FIPS 205 — SLH-DSA (Stateless Hash-Based Signatures).
  // Suffix s = small-signature/slow-sign, f = fast-sign/large-signature.
  SLH_DSA_128S: "SLH-DSA-128s",
  SLH_DSA_128F: "SLH-DSA-128f",
  SLH_DSA_192S: "SLH-DSA-192s",
  SLH_DSA_192F: "SLH-DSA-192f",
  SLH_DSA_256S: "SLH-DSA-256s",
  SLH_DSA_256F: "SLH-DSA-256f",
  HYBRID_X25519_ML_KEM: "HYBRID-X25519-ML-KEM",
  HYBRID_ED25519_ML_DSA: "HYBRID-ED25519-ML-DSA",
  HYBRID_ED25519_SLH_DSA: "HYBRID-ED25519-SLH-DSA",
};

/**
 * Per-algorithm spec lookup. Sizes follow NIST FIPS 203 / 204 / 205.
 * - keySize: security-category label in bits (mirrors legacy 768/1024 semantics
 *   for ML-* and uses 128/192/256 for SLH-DSA).
 * - publicKeyBytes: public-key length in bytes (used for placeholder key bytes).
 * - signatureBytes: signature length in bytes (null for KEM / hybrid-KEM rows).
 * - family: "ml-kem" | "ml-dsa" | "slh-dsa" | "hybrid".
 */
const ALGORITHM_SPECS = {
  "ML-KEM-768": {
    keySize: 768,
    publicKeyBytes: 1184,
    signatureBytes: null,
    family: "ml-kem",
  },
  "ML-KEM-1024": {
    keySize: 1024,
    publicKeyBytes: 1568,
    signatureBytes: null,
    family: "ml-kem",
  },
  "ML-DSA-65": {
    keySize: 768,
    publicKeyBytes: 1952,
    signatureBytes: 3309,
    family: "ml-dsa",
  },
  "ML-DSA-87": {
    keySize: 1024,
    publicKeyBytes: 2592,
    signatureBytes: 4627,
    family: "ml-dsa",
  },
  "SLH-DSA-128s": {
    keySize: 128,
    publicKeyBytes: 32,
    signatureBytes: 7856,
    family: "slh-dsa",
  },
  "SLH-DSA-128f": {
    keySize: 128,
    publicKeyBytes: 32,
    signatureBytes: 17088,
    family: "slh-dsa",
  },
  "SLH-DSA-192s": {
    keySize: 192,
    publicKeyBytes: 48,
    signatureBytes: 16224,
    family: "slh-dsa",
  },
  "SLH-DSA-192f": {
    keySize: 192,
    publicKeyBytes: 48,
    signatureBytes: 35664,
    family: "slh-dsa",
  },
  "SLH-DSA-256s": {
    keySize: 256,
    publicKeyBytes: 64,
    signatureBytes: 29792,
    family: "slh-dsa",
  },
  "SLH-DSA-256f": {
    keySize: 256,
    publicKeyBytes: 64,
    signatureBytes: 49856,
    family: "slh-dsa",
  },
  "HYBRID-X25519-ML-KEM": {
    keySize: 768,
    publicKeyBytes: 1216,
    signatureBytes: null,
    family: "hybrid",
  },
  "HYBRID-ED25519-ML-DSA": {
    keySize: 768,
    publicKeyBytes: 1984,
    signatureBytes: 3373,
    family: "hybrid",
  },
  "HYBRID-ED25519-SLH-DSA": {
    keySize: 128,
    publicKeyBytes: 64,
    signatureBytes: 7920,
    family: "hybrid",
  },
};

function _defaultPurposeFor(algorithm) {
  const spec = ALGORITHM_SPECS[algorithm];
  if (!spec) return KEY_PURPOSES.ENCRYPTION;
  if (spec.family === "ml-kem") return KEY_PURPOSES.KEY_EXCHANGE;
  if (spec.family === "ml-dsa" || spec.family === "slh-dsa")
    return KEY_PURPOSES.SIGNING;
  return KEY_PURPOSES.ENCRYPTION;
}

function _classicalPartner(algorithm) {
  if (!algorithm.startsWith("HYBRID")) return null;
  if (algorithm.includes("X25519")) return "X25519";
  return "Ed25519";
}

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
    throw new Error(
      `Invalid algorithm: ${algorithm}. Valid: ${validAlgorithms.join(", ")}`,
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const spec = ALGORITHM_SPECS[algorithm];
  const keySize = spec.keySize;
  const publicKey = crypto.randomBytes(spec.publicKeyBytes).toString("hex");
  const isHybrid = algorithm.startsWith("HYBRID");
  const classicalAlgorithm = _classicalPartner(algorithm);

  const key = {
    id,
    algorithm,
    family: spec.family,
    purpose: purpose || _defaultPurposeFor(algorithm),
    publicKey,
    keySize,
    publicKeyBytes: spec.publicKeyBytes,
    signatureBytes: spec.signatureBytes,
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

/* ── Algorithm catalog helpers ─────────────────────────────── */

export { PQC_ALGORITHMS, KEY_PURPOSES, MIGRATION_STATUS };

export function listAlgorithms(filter = {}) {
  const entries = Object.entries(ALGORITHM_SPECS).map(([name, spec]) => ({
    algorithm: name,
    ...spec,
  }));
  if (filter.family) {
    return entries.filter((e) => e.family === filter.family);
  }
  return entries;
}

export function algorithmSpec(algorithm) {
  const spec = ALGORITHM_SPECS[algorithm];
  return spec ? { algorithm, ...spec } : null;
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _keys.clear();
  _migrations.clear();
}
