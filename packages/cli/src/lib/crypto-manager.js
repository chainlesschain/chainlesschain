/**
 * Crypto Manager — file encryption/decryption using AES-256-GCM.
 * Uses Node.js built-in crypto module, no external dependencies.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;
const MAGIC_HEADER = Buffer.from("CCLC01"); // ChainLessChain v01

/**
 * Derive a key from a password using PBKDF2.
 */
export function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    "sha512",
  );
}

/**
 * Encrypt a buffer with AES-256-GCM.
 * Returns: MAGIC(6) + SALT(32) + IV(12) + TAG(16) + CIPHERTEXT
 */
export function encryptBuffer(plaintext, password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([MAGIC_HEADER, salt, iv, tag, encrypted]);
}

/**
 * Decrypt a buffer encrypted with encryptBuffer.
 */
export function decryptBuffer(data, password) {
  // Validate magic header
  if (
    data.length <
    MAGIC_HEADER.length + SALT_LENGTH + IV_LENGTH + TAG_LENGTH
  ) {
    throw new Error("Invalid encrypted data: too short");
  }

  const magic = data.subarray(0, MAGIC_HEADER.length);
  if (!magic.equals(MAGIC_HEADER)) {
    throw new Error(
      "Invalid encrypted data: bad header (not a ChainlessChain encrypted file)",
    );
  }

  let offset = MAGIC_HEADER.length;
  const salt = data.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;
  const iv = data.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;
  const tag = data.subarray(offset, offset + TAG_LENGTH);
  offset += TAG_LENGTH;
  const ciphertext = data.subarray(offset);

  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (_err) {
    throw new Error("Decryption failed: wrong password or corrupted data");
  }
}

/**
 * Encrypt a file to a .enc output file.
 */
export function encryptFile(inputPath, password, outputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  const plaintext = fs.readFileSync(inputPath);
  const encrypted = encryptBuffer(plaintext, password);

  const outPath = outputPath || `${inputPath}.enc`;
  fs.writeFileSync(outPath, encrypted);

  return {
    inputPath,
    outputPath: outPath,
    originalSize: plaintext.length,
    encryptedSize: encrypted.length,
  };
}

/**
 * Decrypt a .enc file.
 */
export function decryptFile(inputPath, password, outputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  const data = fs.readFileSync(inputPath);
  const plaintext = decryptBuffer(data, password);

  // Default output: remove .enc extension, or add .dec
  const outPath =
    outputPath ||
    (inputPath.endsWith(".enc") ? inputPath.slice(0, -4) : `${inputPath}.dec`);

  fs.writeFileSync(outPath, plaintext);

  return {
    inputPath,
    outputPath: outPath,
    encryptedSize: data.length,
    decryptedSize: plaintext.length,
  };
}

/**
 * Check if a file is encrypted with our format.
 */
export function isEncryptedFile(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(MAGIC_HEADER.length);
    fs.readSync(fd, buf, 0, MAGIC_HEADER.length, 0);
    fs.closeSync(fd);
    return buf.equals(MAGIC_HEADER);
  } catch (_err) {
    return false;
  }
}

/**
 * Generate a random encryption key (hex string).
 */
export function generateKey() {
  return crypto.randomBytes(KEY_LENGTH).toString("hex");
}

/**
 * Hash a password for storage (SHA-256 + salt).
 * Returns { hash, salt } as hex strings.
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .createHash("sha256")
    .update(password + salt)
    .digest("hex");
  return { hash, salt };
}

/**
 * Verify a password against a stored hash+salt.
 */
export function verifyPassword(password, hash, salt) {
  const computed = crypto
    .createHash("sha256")
    .update(password + salt)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(computed, "hex"),
    Buffer.from(hash, "hex"),
  );
}

/**
 * Ensure crypto metadata table exists.
 */
export function ensureCryptoTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crypto_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Set database encryption status.
 */
export function setDbEncryptionStatus(
  db,
  encrypted,
  passwordHash,
  passwordSalt,
) {
  ensureCryptoTable(db);
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO crypto_metadata (key, value) VALUES (?, ?)",
  );
  stmt.run("db_encrypted", encrypted ? "true" : "false");
  if (passwordHash) {
    stmt.run("db_password_hash", passwordHash);
    stmt.run("db_password_salt", passwordSalt);
  }
}

/**
 * Get database encryption status.
 */
export function getDbEncryptionStatus(db) {
  ensureCryptoTable(db);
  const row = db
    .prepare("SELECT value FROM crypto_metadata WHERE key = ?")
    .get("db_encrypted");
  return row?.value === "true";
}

/**
 * Get file info for encrypted file.
 */
export function getEncryptedFileInfo(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  const encrypted = isEncryptedFile(filePath);

  return {
    path: path.resolve(filePath),
    size: stats.size,
    encrypted,
    extension: path.extname(filePath),
    modified: stats.mtime.toISOString(),
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * V2 in-memory governance layer (independent of file/buffer crypto helpers)
 * ───────────────────────────────────────────────────────────────────────── */

export const KEY_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  ROTATED: "rotated",
  RETIRED: "retired",
});

export const CRYPTO_JOB_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const KEY_TERMINAL_V2 = new Set([KEY_MATURITY_V2.RETIRED]);
const JOB_TERMINAL_V2 = new Set([
  CRYPTO_JOB_LIFECYCLE_V2.COMPLETED,
  CRYPTO_JOB_LIFECYCLE_V2.FAILED,
  CRYPTO_JOB_LIFECYCLE_V2.CANCELLED,
]);

const KEY_TRANSITIONS_V2 = new Map([
  [
    KEY_MATURITY_V2.PENDING,
    new Set([KEY_MATURITY_V2.ACTIVE, KEY_MATURITY_V2.RETIRED]),
  ],
  [
    KEY_MATURITY_V2.ACTIVE,
    new Set([KEY_MATURITY_V2.ROTATED, KEY_MATURITY_V2.RETIRED]),
  ],
  [
    KEY_MATURITY_V2.ROTATED,
    new Set([KEY_MATURITY_V2.ACTIVE, KEY_MATURITY_V2.RETIRED]),
  ],
]);

const JOB_TRANSITIONS_V2 = new Map([
  [
    CRYPTO_JOB_LIFECYCLE_V2.QUEUED,
    new Set([
      CRYPTO_JOB_LIFECYCLE_V2.RUNNING,
      CRYPTO_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CRYPTO_JOB_LIFECYCLE_V2.RUNNING,
    new Set([
      CRYPTO_JOB_LIFECYCLE_V2.COMPLETED,
      CRYPTO_JOB_LIFECYCLE_V2.FAILED,
      CRYPTO_JOB_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
]);

export const CRYPTO_DEFAULT_MAX_ACTIVE_KEYS_PER_OWNER = 12;
export const CRYPTO_DEFAULT_MAX_PENDING_JOBS_PER_KEY = 16;
export const CRYPTO_DEFAULT_KEY_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
export const CRYPTO_DEFAULT_JOB_STUCK_MS = 5 * 60 * 1000;

let _maxActiveKeysPerOwnerV2 = CRYPTO_DEFAULT_MAX_ACTIVE_KEYS_PER_OWNER;
let _maxPendingJobsPerKeyV2 = CRYPTO_DEFAULT_MAX_PENDING_JOBS_PER_KEY;
let _keyIdleMsV2 = CRYPTO_DEFAULT_KEY_IDLE_MS;
let _jobStuckMsV2 = CRYPTO_DEFAULT_JOB_STUCK_MS;

const _keysV2 = new Map();
const _jobsV2 = new Map();

function _posIntCryptoV2(n, label) {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return Math.floor(n);
}

export function getMaxActiveKeysPerOwnerV2() {
  return _maxActiveKeysPerOwnerV2;
}
export function setMaxActiveKeysPerOwnerV2(n) {
  _maxActiveKeysPerOwnerV2 = _posIntCryptoV2(n, "maxActiveKeysPerOwner");
  return _maxActiveKeysPerOwnerV2;
}
export function getMaxPendingJobsPerKeyV2() {
  return _maxPendingJobsPerKeyV2;
}
export function setMaxPendingJobsPerKeyV2(n) {
  _maxPendingJobsPerKeyV2 = _posIntCryptoV2(n, "maxPendingJobsPerKey");
  return _maxPendingJobsPerKeyV2;
}
export function getKeyIdleMsV2() {
  return _keyIdleMsV2;
}
export function setKeyIdleMsV2(ms) {
  _keyIdleMsV2 = _posIntCryptoV2(ms, "keyIdleMs");
  return _keyIdleMsV2;
}
export function getJobStuckMsV2() {
  return _jobStuckMsV2;
}
export function setJobStuckMsV2(ms) {
  _jobStuckMsV2 = _posIntCryptoV2(ms, "jobStuckMs");
  return _jobStuckMsV2;
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

export function getPendingJobCountV2(keyId) {
  let n = 0;
  for (const j of _jobsV2.values()) {
    if (
      j.status !== CRYPTO_JOB_LIFECYCLE_V2.QUEUED &&
      j.status !== CRYPTO_JOB_LIFECYCLE_V2.RUNNING
    )
      continue;
    if (keyId && j.keyId !== keyId) continue;
    n++;
  }
  return n;
}

function _cloneKeyCryptoV2(k) {
  return { ...k, metadata: { ...k.metadata } };
}
function _cloneJobCryptoV2(j) {
  return { ...j, metadata: { ...j.metadata } };
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
    purpose: purpose || "encryption",
    status: KEY_MATURITY_V2.PENDING,
    createdAt: now,
    activatedAt: null,
    retiredAt: null,
    lastSeenAt: now,
    metadata: metadata ? { ...metadata } : {},
  };
  _keysV2.set(id, key);
  return _cloneKeyCryptoV2(key);
}

export function getKeyV2(id) {
  const k = _keysV2.get(id);
  return k ? _cloneKeyCryptoV2(k) : null;
}

export function listKeysV2({ ownerId, status, algorithm } = {}) {
  const out = [];
  for (const k of _keysV2.values()) {
    if (ownerId && k.ownerId !== ownerId) continue;
    if (status && k.status !== status) continue;
    if (algorithm && k.algorithm !== algorithm) continue;
    out.push(_cloneKeyCryptoV2(k));
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
  if (next === KEY_MATURITY_V2.RETIRED && !k.retiredAt) k.retiredAt = now;
  k.lastSeenAt = now;
  return _cloneKeyCryptoV2(k);
}

export function activateKeyV2(id) {
  return setKeyStatusV2(id, KEY_MATURITY_V2.ACTIVE);
}
export function rotateKeyV2(id) {
  return setKeyStatusV2(id, KEY_MATURITY_V2.ROTATED);
}
export function retireKeyV2(id) {
  return setKeyStatusV2(id, KEY_MATURITY_V2.RETIRED);
}

export function touchKeyV2(id) {
  const k = _keysV2.get(id);
  if (!k) throw new Error(`unknown key ${id}`);
  k.lastSeenAt = Date.now();
  return _cloneKeyCryptoV2(k);
}

export function createJobV2(id, { keyId, kind, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("job id required");
  if (!keyId || typeof keyId !== "string") throw new Error("keyId required");
  if (_jobsV2.has(id)) throw new Error(`job ${id} already exists`);
  if (!_keysV2.has(keyId)) throw new Error(`unknown key ${keyId}`);
  const pending = getPendingJobCountV2(keyId);
  if (pending >= _maxPendingJobsPerKeyV2) {
    throw new Error(
      `key ${keyId} pending job cap reached (${_maxPendingJobsPerKeyV2})`,
    );
  }
  const now = Date.now();
  const job = {
    id,
    keyId,
    kind: kind || "encrypt",
    status: CRYPTO_JOB_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    startedAt: null,
    settledAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _jobsV2.set(id, job);
  return _cloneJobCryptoV2(job);
}

export function getJobV2(id) {
  const j = _jobsV2.get(id);
  return j ? _cloneJobCryptoV2(j) : null;
}

export function listJobsV2({ keyId, status, kind } = {}) {
  const out = [];
  for (const j of _jobsV2.values()) {
    if (keyId && j.keyId !== keyId) continue;
    if (status && j.status !== status) continue;
    if (kind && j.kind !== kind) continue;
    out.push(_cloneJobCryptoV2(j));
  }
  return out;
}

export function setJobStatusV2(id, next) {
  const j = _jobsV2.get(id);
  if (!j) throw new Error(`unknown job ${id}`);
  if (JOB_TERMINAL_V2.has(j.status)) {
    throw new Error(`job ${id} is terminal (${j.status})`);
  }
  const allowed = JOB_TRANSITIONS_V2.get(j.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid job transition ${j.status} -> ${next}`);
  }
  const now = Date.now();
  j.status = next;
  if (next === CRYPTO_JOB_LIFECYCLE_V2.RUNNING && !j.startedAt)
    j.startedAt = now;
  if (JOB_TERMINAL_V2.has(next) && !j.settledAt) j.settledAt = now;
  return _cloneJobCryptoV2(j);
}

export function startJobV2(id) {
  return setJobStatusV2(id, CRYPTO_JOB_LIFECYCLE_V2.RUNNING);
}
export function completeJobV2(id) {
  return setJobStatusV2(id, CRYPTO_JOB_LIFECYCLE_V2.COMPLETED);
}
export function failJobV2(id) {
  return setJobStatusV2(id, CRYPTO_JOB_LIFECYCLE_V2.FAILED);
}
export function cancelJobV2(id) {
  return setJobStatusV2(id, CRYPTO_JOB_LIFECYCLE_V2.CANCELLED);
}

export function autoRotateIdleKeysV2({ now = Date.now() } = {}) {
  const out = [];
  for (const k of _keysV2.values()) {
    if (k.status !== KEY_MATURITY_V2.ACTIVE) continue;
    if (now - k.lastSeenAt < _keyIdleMsV2) continue;
    k.status = KEY_MATURITY_V2.ROTATED;
    k.lastSeenAt = now;
    out.push(_cloneKeyCryptoV2(k));
  }
  return out;
}

export function autoFailStuckJobsV2({ now = Date.now() } = {}) {
  const out = [];
  for (const j of _jobsV2.values()) {
    if (j.status !== CRYPTO_JOB_LIFECYCLE_V2.RUNNING) continue;
    if (!j.startedAt || now - j.startedAt < _jobStuckMsV2) continue;
    j.status = CRYPTO_JOB_LIFECYCLE_V2.FAILED;
    j.settledAt = now;
    out.push(_cloneJobCryptoV2(j));
  }
  return out;
}

export function getCryptoManagerStatsV2() {
  const keysByStatus = {};
  for (const s of Object.values(KEY_MATURITY_V2)) keysByStatus[s] = 0;
  for (const k of _keysV2.values()) keysByStatus[k.status]++;
  const jobsByStatus = {};
  for (const s of Object.values(CRYPTO_JOB_LIFECYCLE_V2)) jobsByStatus[s] = 0;
  for (const j of _jobsV2.values()) jobsByStatus[j.status]++;
  return {
    totalKeysV2: _keysV2.size,
    totalJobsV2: _jobsV2.size,
    maxActiveKeysPerOwner: _maxActiveKeysPerOwnerV2,
    maxPendingJobsPerKey: _maxPendingJobsPerKeyV2,
    keyIdleMs: _keyIdleMsV2,
    jobStuckMs: _jobStuckMsV2,
    keysByStatus,
    jobsByStatus,
  };
}

export function _resetStateCryptoManagerV2() {
  _keysV2.clear();
  _jobsV2.clear();
  _maxActiveKeysPerOwnerV2 = CRYPTO_DEFAULT_MAX_ACTIVE_KEYS_PER_OWNER;
  _maxPendingJobsPerKeyV2 = CRYPTO_DEFAULT_MAX_PENDING_JOBS_PER_KEY;
  _keyIdleMsV2 = CRYPTO_DEFAULT_KEY_IDLE_MS;
  _jobStuckMsV2 = CRYPTO_DEFAULT_JOB_STUCK_MS;
}

// === Iter28 V2 governance overlay: Crygov ===
export const CRYGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const CRYGOV_ENCRYPT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  ENCRYPTING: "encrypting",
  ENCRYPTED: "encrypted",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _crygovPTrans = new Map([
  [
    CRYGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CRYGOV_PROFILE_MATURITY_V2.ACTIVE,
      CRYGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CRYGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CRYGOV_PROFILE_MATURITY_V2.STALE,
      CRYGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CRYGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      CRYGOV_PROFILE_MATURITY_V2.ACTIVE,
      CRYGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CRYGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _crygovPTerminal = new Set([CRYGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _crygovJTrans = new Map([
  [
    CRYGOV_ENCRYPT_LIFECYCLE_V2.QUEUED,
    new Set([
      CRYGOV_ENCRYPT_LIFECYCLE_V2.ENCRYPTING,
      CRYGOV_ENCRYPT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CRYGOV_ENCRYPT_LIFECYCLE_V2.ENCRYPTING,
    new Set([
      CRYGOV_ENCRYPT_LIFECYCLE_V2.ENCRYPTED,
      CRYGOV_ENCRYPT_LIFECYCLE_V2.FAILED,
      CRYGOV_ENCRYPT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CRYGOV_ENCRYPT_LIFECYCLE_V2.ENCRYPTED, new Set()],
  [CRYGOV_ENCRYPT_LIFECYCLE_V2.FAILED, new Set()],
  [CRYGOV_ENCRYPT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _crygovPsV2 = new Map();
const _crygovJsV2 = new Map();
let _crygovMaxActive = 8,
  _crygovMaxPending = 20,
  _crygovIdleMs = 2592000000,
  _crygovStuckMs = 60 * 1000;
function _crygovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _crygovCheckP(from, to) {
  const a = _crygovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid crygov profile transition ${from} → ${to}`);
}
function _crygovCheckJ(from, to) {
  const a = _crygovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid crygov encrypt transition ${from} → ${to}`);
}
function _crygovCountActive(owner) {
  let c = 0;
  for (const p of _crygovPsV2.values())
    if (p.owner === owner && p.status === CRYGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _crygovCountPending(profileId) {
  let c = 0;
  for (const j of _crygovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CRYGOV_ENCRYPT_LIFECYCLE_V2.QUEUED ||
        j.status === CRYGOV_ENCRYPT_LIFECYCLE_V2.ENCRYPTING)
    )
      c++;
  return c;
}
export function setMaxActiveCryProfilesPerOwnerV2(n) {
  _crygovMaxActive = _crygovPos(n, "maxActiveCryProfilesPerOwner");
}
export function getMaxActiveCryProfilesPerOwnerV2() {
  return _crygovMaxActive;
}
export function setMaxPendingCryEncryptsPerProfileV2(n) {
  _crygovMaxPending = _crygovPos(n, "maxPendingCryEncryptsPerProfile");
}
export function getMaxPendingCryEncryptsPerProfileV2() {
  return _crygovMaxPending;
}
export function setCryProfileIdleMsV2(n) {
  _crygovIdleMs = _crygovPos(n, "crygovProfileIdleMs");
}
export function getCryProfileIdleMsV2() {
  return _crygovIdleMs;
}
export function setCryEncryptStuckMsV2(n) {
  _crygovStuckMs = _crygovPos(n, "crygovEncryptStuckMs");
}
export function getCryEncryptStuckMsV2() {
  return _crygovStuckMs;
}
export function _resetStateCrygovV2() {
  _crygovPsV2.clear();
  _crygovJsV2.clear();
  _crygovMaxActive = 8;
  _crygovMaxPending = 20;
  _crygovIdleMs = 2592000000;
  _crygovStuckMs = 60 * 1000;
}
export function registerCryProfileV2({ id, owner, provider, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_crygovPsV2.has(id))
    throw new Error(`crygov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    provider: provider || "default",
    status: CRYGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _crygovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCryProfileV2(id) {
  const p = _crygovPsV2.get(id);
  if (!p) throw new Error(`crygov profile ${id} not found`);
  const isInitial = p.status === CRYGOV_PROFILE_MATURITY_V2.PENDING;
  _crygovCheckP(p.status, CRYGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _crygovCountActive(p.owner) >= _crygovMaxActive)
    throw new Error(`max active crygov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CRYGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleCryProfileV2(id) {
  const p = _crygovPsV2.get(id);
  if (!p) throw new Error(`crygov profile ${id} not found`);
  _crygovCheckP(p.status, CRYGOV_PROFILE_MATURITY_V2.STALE);
  p.status = CRYGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCryProfileV2(id) {
  const p = _crygovPsV2.get(id);
  if (!p) throw new Error(`crygov profile ${id} not found`);
  _crygovCheckP(p.status, CRYGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CRYGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCryProfileV2(id) {
  const p = _crygovPsV2.get(id);
  if (!p) throw new Error(`crygov profile ${id} not found`);
  if (_crygovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal crygov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCryProfileV2(id) {
  const p = _crygovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCryProfilesV2() {
  return [..._crygovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCryEncryptV2({ id, profileId, keyId, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_crygovJsV2.has(id))
    throw new Error(`crygov encrypt ${id} already exists`);
  if (!_crygovPsV2.has(profileId))
    throw new Error(`crygov profile ${profileId} not found`);
  if (_crygovCountPending(profileId) >= _crygovMaxPending)
    throw new Error(
      `max pending crygov encrypts for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    keyId: keyId || "",
    status: CRYGOV_ENCRYPT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _crygovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function encryptingCryEncryptV2(id) {
  const j = _crygovJsV2.get(id);
  if (!j) throw new Error(`crygov encrypt ${id} not found`);
  _crygovCheckJ(j.status, CRYGOV_ENCRYPT_LIFECYCLE_V2.ENCRYPTING);
  const now = Date.now();
  j.status = CRYGOV_ENCRYPT_LIFECYCLE_V2.ENCRYPTING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeEncryptCryV2(id) {
  const j = _crygovJsV2.get(id);
  if (!j) throw new Error(`crygov encrypt ${id} not found`);
  _crygovCheckJ(j.status, CRYGOV_ENCRYPT_LIFECYCLE_V2.ENCRYPTED);
  const now = Date.now();
  j.status = CRYGOV_ENCRYPT_LIFECYCLE_V2.ENCRYPTED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCryEncryptV2(id, reason) {
  const j = _crygovJsV2.get(id);
  if (!j) throw new Error(`crygov encrypt ${id} not found`);
  _crygovCheckJ(j.status, CRYGOV_ENCRYPT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CRYGOV_ENCRYPT_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCryEncryptV2(id, reason) {
  const j = _crygovJsV2.get(id);
  if (!j) throw new Error(`crygov encrypt ${id} not found`);
  _crygovCheckJ(j.status, CRYGOV_ENCRYPT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CRYGOV_ENCRYPT_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCryEncryptV2(id) {
  const j = _crygovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCryEncryptsV2() {
  return [..._crygovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleCryProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _crygovPsV2.values())
    if (
      p.status === CRYGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _crygovIdleMs
    ) {
      p.status = CRYGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCryEncryptsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _crygovJsV2.values())
    if (
      j.status === CRYGOV_ENCRYPT_LIFECYCLE_V2.ENCRYPTING &&
      j.startedAt != null &&
      t - j.startedAt >= _crygovStuckMs
    ) {
      j.status = CRYGOV_ENCRYPT_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCrygovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CRYGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _crygovPsV2.values()) profilesByStatus[p.status]++;
  const encryptsByStatus = {};
  for (const v of Object.values(CRYGOV_ENCRYPT_LIFECYCLE_V2))
    encryptsByStatus[v] = 0;
  for (const j of _crygovJsV2.values()) encryptsByStatus[j.status]++;
  return {
    totalCryProfilesV2: _crygovPsV2.size,
    totalCryEncryptsV2: _crygovJsV2.size,
    maxActiveCryProfilesPerOwner: _crygovMaxActive,
    maxPendingCryEncryptsPerProfile: _crygovMaxPending,
    crygovProfileIdleMs: _crygovIdleMs,
    crygovEncryptStuckMs: _crygovStuckMs,
    profilesByStatus,
    encryptsByStatus,
  };
}
