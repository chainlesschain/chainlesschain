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

/* ─────────────────────────────────────────────────────────────────────────
 * V2 in-memory governance layer (independent of SQLite pqc_keys)
 * ───────────────────────────────────────────────────────────────────────── */

export const KEY_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  ARCHIVED: "archived",
});

export const MIGRATION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const KEY_TERMINAL_V2 = new Set([KEY_MATURITY_V2.ARCHIVED]);
const MIGRATION_TERMINAL_V2 = new Set([
  MIGRATION_LIFECYCLE_V2.COMPLETED,
  MIGRATION_LIFECYCLE_V2.FAILED,
  MIGRATION_LIFECYCLE_V2.CANCELLED,
]);

const KEY_TRANSITIONS_V2 = new Map([
  [
    KEY_MATURITY_V2.PENDING,
    new Set([KEY_MATURITY_V2.ACTIVE, KEY_MATURITY_V2.ARCHIVED]),
  ],
  [
    KEY_MATURITY_V2.ACTIVE,
    new Set([KEY_MATURITY_V2.DEPRECATED, KEY_MATURITY_V2.ARCHIVED]),
  ],
  [
    KEY_MATURITY_V2.DEPRECATED,
    new Set([KEY_MATURITY_V2.ACTIVE, KEY_MATURITY_V2.ARCHIVED]),
  ],
]);

const MIGRATION_TRANSITIONS_V2 = new Map([
  [
    MIGRATION_LIFECYCLE_V2.QUEUED,
    new Set([MIGRATION_LIFECYCLE_V2.RUNNING, MIGRATION_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    MIGRATION_LIFECYCLE_V2.RUNNING,
    new Set([
      MIGRATION_LIFECYCLE_V2.COMPLETED,
      MIGRATION_LIFECYCLE_V2.FAILED,
      MIGRATION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
]);

export const PQC_DEFAULT_MAX_ACTIVE_KEYS_PER_OWNER = 16;
export const PQC_DEFAULT_MAX_PENDING_MIGRATIONS_PER_KEY = 8;
export const PQC_DEFAULT_KEY_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const PQC_DEFAULT_MIGRATION_STUCK_MS = 10 * 60 * 1000;

let _maxActiveKeysPerOwnerV2 = PQC_DEFAULT_MAX_ACTIVE_KEYS_PER_OWNER;
let _maxPendingMigrationsPerKeyV2 = PQC_DEFAULT_MAX_PENDING_MIGRATIONS_PER_KEY;
let _keyIdleMsV2 = PQC_DEFAULT_KEY_IDLE_MS;
let _migrationStuckMsV2 = PQC_DEFAULT_MIGRATION_STUCK_MS;

const _keysV2 = new Map();
const _migrationsV2 = new Map();

function _posIntPqcV2(n, label) {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return Math.floor(n);
}

export function getMaxActiveKeysPerOwnerV2() {
  return _maxActiveKeysPerOwnerV2;
}

export function setMaxActiveKeysPerOwnerV2(n) {
  _maxActiveKeysPerOwnerV2 = _posIntPqcV2(n, "maxActiveKeysPerOwner");
  return _maxActiveKeysPerOwnerV2;
}

export function getMaxPendingMigrationsPerKeyV2() {
  return _maxPendingMigrationsPerKeyV2;
}

export function setMaxPendingMigrationsPerKeyV2(n) {
  _maxPendingMigrationsPerKeyV2 = _posIntPqcV2(n, "maxPendingMigrationsPerKey");
  return _maxPendingMigrationsPerKeyV2;
}

export function getKeyIdleMsV2() {
  return _keyIdleMsV2;
}

export function setKeyIdleMsV2(ms) {
  _keyIdleMsV2 = _posIntPqcV2(ms, "keyIdleMs");
  return _keyIdleMsV2;
}

export function getMigrationStuckMsV2() {
  return _migrationStuckMsV2;
}

export function setMigrationStuckMsV2(ms) {
  _migrationStuckMsV2 = _posIntPqcV2(ms, "migrationStuckMs");
  return _migrationStuckMsV2;
}

export function getActiveKeyCountV2(ownerId) {
  let n = 0;
  for (const k of _keysV2.values()) {
    if (k.status !== KEY_MATURITY_V2.ACTIVE) continue;
    if (ownerId && k.ownerId !== ownerId) continue;
    n++;
  }
  return n;
}

export function getPendingMigrationCountV2(keyId) {
  let n = 0;
  for (const m of _migrationsV2.values()) {
    if (
      m.status !== MIGRATION_LIFECYCLE_V2.QUEUED &&
      m.status !== MIGRATION_LIFECYCLE_V2.RUNNING
    )
      continue;
    if (keyId && m.keyId !== keyId) continue;
    n++;
  }
  return n;
}

function _cloneKeyV2(k) {
  return { ...k, metadata: { ...k.metadata } };
}

function _cloneMigrationV2(m) {
  return { ...m, metadata: { ...m.metadata } };
}

export function registerKeyV2(
  id,
  { ownerId, algorithm, purpose, metadata } = {},
) {
  if (!id || typeof id !== "string") throw new Error("key id required");
  if (!ownerId || typeof ownerId !== "string")
    throw new Error("ownerId required");
  if (!algorithm || typeof algorithm !== "string")
    throw new Error("algorithm required");
  if (_keysV2.has(id)) throw new Error(`key ${id} already exists`);
  const now = Date.now();
  const key = {
    id,
    ownerId,
    algorithm,
    purpose: purpose || "general",
    status: KEY_MATURITY_V2.PENDING,
    createdAt: now,
    activatedAt: null,
    archivedAt: null,
    lastSeenAt: now,
    metadata: metadata ? { ...metadata } : {},
  };
  _keysV2.set(id, key);
  return _cloneKeyV2(key);
}

export function getKeyV2(id) {
  const k = _keysV2.get(id);
  return k ? _cloneKeyV2(k) : null;
}

export function listKeysV2({ ownerId, status, algorithm } = {}) {
  const out = [];
  for (const k of _keysV2.values()) {
    if (ownerId && k.ownerId !== ownerId) continue;
    if (status && k.status !== status) continue;
    if (algorithm && k.algorithm !== algorithm) continue;
    out.push(_cloneKeyV2(k));
  }
  return out;
}

export function setKeyStatusV2(id, next) {
  const k = _keysV2.get(id);
  if (!k) throw new Error(`unknown key ${id}`);
  if (KEY_TERMINAL_V2.has(k.status)) {
    throw new Error(`key ${id} is terminal (${k.status})`);
  }
  const allowed = KEY_TRANSITIONS_V2.get(k.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid key transition ${k.status} -> ${next}`);
  }
  if (next === KEY_MATURITY_V2.ACTIVE && k.status === KEY_MATURITY_V2.PENDING) {
    const owned = getActiveKeyCountV2(k.ownerId);
    if (owned >= _maxActiveKeysPerOwnerV2) {
      throw new Error(
        `owner ${k.ownerId} active key cap reached (${_maxActiveKeysPerOwnerV2})`,
      );
    }
  }
  const now = Date.now();
  k.status = next;
  if (next === KEY_MATURITY_V2.ACTIVE && !k.activatedAt) k.activatedAt = now;
  if (next === KEY_MATURITY_V2.ARCHIVED && !k.archivedAt) k.archivedAt = now;
  k.lastSeenAt = now;
  return _cloneKeyV2(k);
}

export function activateKeyV2(id) {
  return setKeyStatusV2(id, KEY_MATURITY_V2.ACTIVE);
}

export function deprecateKeyV2(id) {
  return setKeyStatusV2(id, KEY_MATURITY_V2.DEPRECATED);
}

export function archiveKeyV2(id) {
  return setKeyStatusV2(id, KEY_MATURITY_V2.ARCHIVED);
}

export function touchKeyV2(id) {
  const k = _keysV2.get(id);
  if (!k) throw new Error(`unknown key ${id}`);
  k.lastSeenAt = Date.now();
  return _cloneKeyV2(k);
}

export function createMigrationV2(
  id,
  { keyId, targetAlgorithm, metadata } = {},
) {
  if (!id || typeof id !== "string") throw new Error("migration id required");
  if (!keyId || typeof keyId !== "string") throw new Error("keyId required");
  if (!targetAlgorithm || typeof targetAlgorithm !== "string") {
    throw new Error("targetAlgorithm required");
  }
  if (_migrationsV2.has(id)) throw new Error(`migration ${id} already exists`);
  const k = _keysV2.get(keyId);
  if (!k) throw new Error(`unknown key ${keyId}`);
  const pending = getPendingMigrationCountV2(keyId);
  if (pending >= _maxPendingMigrationsPerKeyV2) {
    throw new Error(
      `key ${keyId} pending migration cap reached (${_maxPendingMigrationsPerKeyV2})`,
    );
  }
  const now = Date.now();
  const job = {
    id,
    keyId,
    sourceAlgorithm: k.algorithm,
    targetAlgorithm,
    status: MIGRATION_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    startedAt: null,
    settledAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _migrationsV2.set(id, job);
  return _cloneMigrationV2(job);
}

export function getMigrationV2(id) {
  const m = _migrationsV2.get(id);
  return m ? _cloneMigrationV2(m) : null;
}

export function listMigrationsV2({ keyId, status } = {}) {
  const out = [];
  for (const m of _migrationsV2.values()) {
    if (keyId && m.keyId !== keyId) continue;
    if (status && m.status !== status) continue;
    out.push(_cloneMigrationV2(m));
  }
  return out;
}

export function setMigrationStatusV2(id, next) {
  const m = _migrationsV2.get(id);
  if (!m) throw new Error(`unknown migration ${id}`);
  if (MIGRATION_TERMINAL_V2.has(m.status)) {
    throw new Error(`migration ${id} is terminal (${m.status})`);
  }
  const allowed = MIGRATION_TRANSITIONS_V2.get(m.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid migration transition ${m.status} -> ${next}`);
  }
  const now = Date.now();
  m.status = next;
  if (next === MIGRATION_LIFECYCLE_V2.RUNNING && !m.startedAt)
    m.startedAt = now;
  if (MIGRATION_TERMINAL_V2.has(next) && !m.settledAt) m.settledAt = now;
  return _cloneMigrationV2(m);
}

export function startMigrationV2(id) {
  return setMigrationStatusV2(id, MIGRATION_LIFECYCLE_V2.RUNNING);
}

export function completeMigrationV2(id) {
  return setMigrationStatusV2(id, MIGRATION_LIFECYCLE_V2.COMPLETED);
}

export function failMigrationV2(id) {
  return setMigrationStatusV2(id, MIGRATION_LIFECYCLE_V2.FAILED);
}

export function cancelMigrationV2(id) {
  return setMigrationStatusV2(id, MIGRATION_LIFECYCLE_V2.CANCELLED);
}

export function autoDeprecateIdleKeysV2({ now = Date.now() } = {}) {
  const out = [];
  for (const k of _keysV2.values()) {
    if (k.status !== KEY_MATURITY_V2.ACTIVE) continue;
    if (now - k.lastSeenAt < _keyIdleMsV2) continue;
    k.status = KEY_MATURITY_V2.DEPRECATED;
    k.lastSeenAt = now;
    out.push(_cloneKeyV2(k));
  }
  return out;
}

export function autoFailStuckMigrationsV2({ now = Date.now() } = {}) {
  const out = [];
  for (const m of _migrationsV2.values()) {
    if (m.status !== MIGRATION_LIFECYCLE_V2.RUNNING) continue;
    if (!m.startedAt || now - m.startedAt < _migrationStuckMsV2) continue;
    m.status = MIGRATION_LIFECYCLE_V2.FAILED;
    m.settledAt = now;
    out.push(_cloneMigrationV2(m));
  }
  return out;
}

export function getPqcManagerStatsV2() {
  const keysByStatus = {};
  for (const s of Object.values(KEY_MATURITY_V2)) keysByStatus[s] = 0;
  for (const k of _keysV2.values()) keysByStatus[k.status]++;
  const migrationsByStatus = {};
  for (const s of Object.values(MIGRATION_LIFECYCLE_V2))
    migrationsByStatus[s] = 0;
  for (const m of _migrationsV2.values()) migrationsByStatus[m.status]++;
  return {
    totalKeysV2: _keysV2.size,
    totalMigrationsV2: _migrationsV2.size,
    maxActiveKeysPerOwner: _maxActiveKeysPerOwnerV2,
    maxPendingMigrationsPerKey: _maxPendingMigrationsPerKeyV2,
    keyIdleMs: _keyIdleMsV2,
    migrationStuckMs: _migrationStuckMsV2,
    keysByStatus,
    migrationsByStatus,
  };
}

export function _resetStatePqcManagerV2() {
  _keysV2.clear();
  _migrationsV2.clear();
  _maxActiveKeysPerOwnerV2 = PQC_DEFAULT_MAX_ACTIVE_KEYS_PER_OWNER;
  _maxPendingMigrationsPerKeyV2 = PQC_DEFAULT_MAX_PENDING_MIGRATIONS_PER_KEY;
  _keyIdleMsV2 = PQC_DEFAULT_KEY_IDLE_MS;
  _migrationStuckMsV2 = PQC_DEFAULT_MIGRATION_STUCK_MS;
}
