/**
 * DID Manager — Decentralized Identity management for CLI.
 * Ed25519 key generation, DID document creation, signing, and verification.
 * Uses Node.js built-in crypto module (no external dependencies).
 */

import crypto from "crypto";

/**
 * Ensure DID tables exist.
 */
export function ensureDIDTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS did_identities (
      did TEXT PRIMARY KEY,
      display_name TEXT,
      public_key TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      did_document TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Generate an Ed25519 keypair.
 * Returns { publicKey, secretKey } as hex strings.
 */
export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKey: publicKey.toString("hex"),
    secretKey: privateKey.toString("hex"),
  };
}

/**
 * Generate a DID from a public key.
 * Format: did:chainless:<base64url-of-sha256-of-pubkey>
 */
export function generateDID(publicKeyHex) {
  const hash = crypto
    .createHash("sha256")
    .update(Buffer.from(publicKeyHex, "hex"))
    .digest();
  const id = hash.toString("base64url").slice(0, 32);
  return `did:chainless:${id}`;
}

/**
 * Create a DID Document (W3C DID Core spec subset).
 */
export function createDIDDocument(did, publicKeyHex, displayName) {
  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    controller: did,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: "Ed25519VerificationKey2020",
        controller: did,
        publicKeyHex: publicKeyHex,
      },
    ],
    authentication: [`${did}#key-1`],
    assertionMethod: [`${did}#key-1`],
    service: displayName
      ? [
          {
            id: `${did}#profile`,
            type: "ProfileService",
            serviceEndpoint: { name: displayName },
          },
        ]
      : [],
    created: new Date().toISOString(),
  };
}

/**
 * Create a new DID identity and store in DB.
 */
export function createIdentity(db, displayName) {
  ensureDIDTables(db);

  const keys = generateKeyPair();
  const did = generateDID(keys.publicKey);
  const doc = createDIDDocument(did, keys.publicKey, displayName);

  // If no identities exist, this becomes the default
  const count = db.prepare("SELECT COUNT(*) as c FROM did_identities").get().c;
  const isDefault = count === 0 ? 1 : 0;

  db.prepare(
    `INSERT INTO did_identities (did, display_name, public_key, secret_key, did_document, is_default)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    did,
    displayName || null,
    keys.publicKey,
    keys.secretKey,
    JSON.stringify(doc),
    isDefault,
  );

  return {
    did,
    displayName,
    publicKey: keys.publicKey,
    document: doc,
    isDefault: isDefault === 1,
  };
}

/**
 * Get identity by DID or prefix.
 */
export function getIdentity(db, didOrPrefix) {
  ensureDIDTables(db);
  return db
    .prepare("SELECT * FROM did_identities WHERE did LIKE ?")
    .get(`${didOrPrefix}%`);
}

/**
 * Get all identities.
 */
export function getAllIdentities(db) {
  ensureDIDTables(db);
  return db
    .prepare(
      "SELECT * FROM did_identities ORDER BY is_default DESC, created_at DESC",
    )
    .all();
}

/**
 * Get the default identity.
 */
export function getDefaultIdentity(db) {
  ensureDIDTables(db);
  return db.prepare("SELECT * FROM did_identities WHERE is_default = 1").get();
}

/**
 * Set an identity as the default.
 */
export function setDefaultIdentity(db, did) {
  ensureDIDTables(db);
  const identity = getIdentity(db, did);
  if (!identity) return false;

  db.prepare("UPDATE did_identities SET is_default = ? WHERE did LIKE ?").run(
    0,
    "%",
  );
  db.prepare("UPDATE did_identities SET is_default = ? WHERE did = ?").run(
    1,
    identity.did,
  );
  return true;
}

/**
 * Delete an identity by DID.
 */
export function deleteIdentity(db, did) {
  ensureDIDTables(db);
  const identity = getIdentity(db, did);
  if (!identity) return false;

  const result = db
    .prepare("DELETE FROM did_identities WHERE did = ?")
    .run(identity.did);
  if (result.changes > 0 && identity.is_default) {
    // Promote next identity to default
    const next = db
      .prepare("SELECT did FROM did_identities ORDER BY created_at ASC LIMIT 1")
      .get();
    if (next) {
      db.prepare("UPDATE did_identities SET is_default = 1 WHERE did = ?").run(
        next.did,
      );
    }
  }
  return result.changes > 0;
}

/**
 * Sign a message using an identity's secret key.
 * Returns the signature as hex string.
 */
export function signMessage(db, did, message) {
  ensureDIDTables(db);
  const identity = getIdentity(db, did);
  if (!identity) throw new Error(`Identity not found: ${did}`);

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(identity.secret_key, "hex"),
    format: "der",
    type: "pkcs8",
  });

  const signature = crypto.sign(null, Buffer.from(message, "utf8"), privateKey);
  return signature.toString("hex");
}

/**
 * Verify a signature against a message and public key.
 */
export function verifySignature(publicKeyHex, message, signatureHex) {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyHex, "hex"),
      format: "der",
      type: "spki",
    });

    return crypto.verify(
      null,
      Buffer.from(message, "utf8"),
      publicKey,
      Buffer.from(signatureHex, "hex"),
    );
  } catch (_err) {
    // Invalid key or signature format
    return false;
  }
}

/**
 * Verify a signature using a DID from the database.
 */
export function verifyWithDID(db, did, message, signatureHex) {
  const identity = getIdentity(db, did);
  if (!identity) throw new Error(`Identity not found: ${did}`);
  return verifySignature(identity.public_key, message, signatureHex);
}

/**
 * Export identity (public data only, no secret key).
 */
export function exportIdentity(db, did) {
  const identity = getIdentity(db, did);
  if (!identity) return null;

  return {
    did: identity.did,
    displayName: identity.display_name,
    publicKey: identity.public_key,
    document: JSON.parse(identity.did_document || "{}"),
    createdAt: identity.created_at,
  };
}

/**
 * Resolve a DID — returns the DID document.
 * Currently local-only resolution.
 */
export function resolveDID(db, did) {
  const identity = getIdentity(db, did);
  if (!identity) return null;
  return JSON.parse(identity.did_document || "{}");
}

/* ─────────────────────────────────────────────────────────────────────────
 * V2 in-memory governance layer (independent of SQLite did_identities)
 * ───────────────────────────────────────────────────────────────────────── */

export const IDENTITY_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  REVOKED: "revoked",
});

export const ISSUANCE_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  ISSUING: "issuing",
  ISSUED: "issued",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const IDENTITY_TERMINAL_V2 = new Set([IDENTITY_MATURITY_V2.REVOKED]);
const ISSUANCE_TERMINAL_V2 = new Set([
  ISSUANCE_LIFECYCLE_V2.ISSUED,
  ISSUANCE_LIFECYCLE_V2.FAILED,
  ISSUANCE_LIFECYCLE_V2.CANCELLED,
]);

const IDENTITY_TRANSITIONS_V2 = new Map([
  [
    IDENTITY_MATURITY_V2.PENDING,
    new Set([IDENTITY_MATURITY_V2.ACTIVE, IDENTITY_MATURITY_V2.REVOKED]),
  ],
  [
    IDENTITY_MATURITY_V2.ACTIVE,
    new Set([IDENTITY_MATURITY_V2.SUSPENDED, IDENTITY_MATURITY_V2.REVOKED]),
  ],
  [
    IDENTITY_MATURITY_V2.SUSPENDED,
    new Set([IDENTITY_MATURITY_V2.ACTIVE, IDENTITY_MATURITY_V2.REVOKED]),
  ],
]);

const ISSUANCE_TRANSITIONS_V2 = new Map([
  [
    ISSUANCE_LIFECYCLE_V2.QUEUED,
    new Set([ISSUANCE_LIFECYCLE_V2.ISSUING, ISSUANCE_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    ISSUANCE_LIFECYCLE_V2.ISSUING,
    new Set([
      ISSUANCE_LIFECYCLE_V2.ISSUED,
      ISSUANCE_LIFECYCLE_V2.FAILED,
      ISSUANCE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
]);

export const DID_DEFAULT_MAX_ACTIVE_IDENTITIES_PER_OWNER = 8;
export const DID_DEFAULT_MAX_PENDING_ISSUANCES_PER_IDENTITY = 12;
export const DID_DEFAULT_IDENTITY_IDLE_MS = 90 * 24 * 60 * 60 * 1000;
export const DID_DEFAULT_ISSUANCE_STUCK_MS = 5 * 60 * 1000;

let _maxActiveIdentitiesPerOwnerV2 =
  DID_DEFAULT_MAX_ACTIVE_IDENTITIES_PER_OWNER;
let _maxPendingIssuancesPerIdentityV2 =
  DID_DEFAULT_MAX_PENDING_ISSUANCES_PER_IDENTITY;
let _identityIdleMsV2 = DID_DEFAULT_IDENTITY_IDLE_MS;
let _issuanceStuckMsV2 = DID_DEFAULT_ISSUANCE_STUCK_MS;

const _identitiesV2 = new Map();
const _issuancesV2 = new Map();

function _posIntDidV2(n, label) {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return Math.floor(n);
}

export function getMaxActiveIdentitiesPerOwnerV2() {
  return _maxActiveIdentitiesPerOwnerV2;
}
export function setMaxActiveIdentitiesPerOwnerV2(n) {
  _maxActiveIdentitiesPerOwnerV2 = _posIntDidV2(
    n,
    "maxActiveIdentitiesPerOwner",
  );
  return _maxActiveIdentitiesPerOwnerV2;
}
export function getMaxPendingIssuancesPerIdentityV2() {
  return _maxPendingIssuancesPerIdentityV2;
}
export function setMaxPendingIssuancesPerIdentityV2(n) {
  _maxPendingIssuancesPerIdentityV2 = _posIntDidV2(
    n,
    "maxPendingIssuancesPerIdentity",
  );
  return _maxPendingIssuancesPerIdentityV2;
}
export function getIdentityIdleMsV2() {
  return _identityIdleMsV2;
}
export function setIdentityIdleMsV2(ms) {
  _identityIdleMsV2 = _posIntDidV2(ms, "identityIdleMs");
  return _identityIdleMsV2;
}
export function getIssuanceStuckMsV2() {
  return _issuanceStuckMsV2;
}
export function setIssuanceStuckMsV2(ms) {
  _issuanceStuckMsV2 = _posIntDidV2(ms, "issuanceStuckMs");
  return _issuanceStuckMsV2;
}

export function getActiveIdentityCountV2(ownerId) {
  let n = 0;
  for (const i of _identitiesV2.values()) {
    if (i.status !== IDENTITY_MATURITY_V2.ACTIVE) continue;
    if (ownerId && i.ownerId !== ownerId) continue;
    n++;
  }
  return n;
}

export function getPendingIssuanceCountV2(identityId) {
  let n = 0;
  for (const j of _issuancesV2.values()) {
    if (
      j.status !== ISSUANCE_LIFECYCLE_V2.QUEUED &&
      j.status !== ISSUANCE_LIFECYCLE_V2.ISSUING
    )
      continue;
    if (identityId && j.identityId !== identityId) continue;
    n++;
  }
  return n;
}

function _cloneIdentityV2(i) {
  return { ...i, metadata: { ...i.metadata } };
}
function _cloneIssuanceV2(j) {
  return { ...j, metadata: { ...j.metadata } };
}

export function registerIdentityV2(
  id,
  { ownerId, didMethod, displayName, metadata } = {},
) {
  if (!id || typeof id !== "string") throw new Error("identity id required");
  if (!ownerId || typeof ownerId !== "string")
    throw new Error("ownerId required");
  if (!didMethod || typeof didMethod !== "string")
    throw new Error("didMethod required");
  if (_identitiesV2.has(id)) throw new Error(`identity ${id} already exists`);
  const now = Date.now();
  const identity = {
    id,
    ownerId,
    didMethod,
    displayName: displayName || id,
    status: IDENTITY_MATURITY_V2.PENDING,
    createdAt: now,
    activatedAt: null,
    revokedAt: null,
    lastSeenAt: now,
    metadata: metadata ? { ...metadata } : {},
  };
  _identitiesV2.set(id, identity);
  return _cloneIdentityV2(identity);
}

export function getIdentityV2(id) {
  const i = _identitiesV2.get(id);
  return i ? _cloneIdentityV2(i) : null;
}

export function listIdentitiesV2({ ownerId, status, didMethod } = {}) {
  const out = [];
  for (const i of _identitiesV2.values()) {
    if (ownerId && i.ownerId !== ownerId) continue;
    if (status && i.status !== status) continue;
    if (didMethod && i.didMethod !== didMethod) continue;
    out.push(_cloneIdentityV2(i));
  }
  return out;
}

export function setIdentityStatusV2(id, next) {
  const i = _identitiesV2.get(id);
  if (!i) throw new Error(`unknown identity ${id}`);
  if (IDENTITY_TERMINAL_V2.has(i.status)) {
    throw new Error(`identity ${id} is terminal (${i.status})`);
  }
  const allowed = IDENTITY_TRANSITIONS_V2.get(i.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid identity transition ${i.status} -> ${next}`);
  }
  if (
    next === IDENTITY_MATURITY_V2.ACTIVE &&
    i.status === IDENTITY_MATURITY_V2.PENDING
  ) {
    const owned = getActiveIdentityCountV2(i.ownerId);
    if (owned >= _maxActiveIdentitiesPerOwnerV2) {
      throw new Error(
        `owner ${i.ownerId} active identity cap reached (${_maxActiveIdentitiesPerOwnerV2})`,
      );
    }
  }
  const now = Date.now();
  i.status = next;
  if (next === IDENTITY_MATURITY_V2.ACTIVE && !i.activatedAt)
    i.activatedAt = now;
  if (next === IDENTITY_MATURITY_V2.REVOKED && !i.revokedAt) i.revokedAt = now;
  i.lastSeenAt = now;
  return _cloneIdentityV2(i);
}

export function activateIdentityV2(id) {
  return setIdentityStatusV2(id, IDENTITY_MATURITY_V2.ACTIVE);
}
export function suspendIdentityV2(id) {
  return setIdentityStatusV2(id, IDENTITY_MATURITY_V2.SUSPENDED);
}
export function revokeIdentityV2(id) {
  return setIdentityStatusV2(id, IDENTITY_MATURITY_V2.REVOKED);
}

export function touchIdentityV2(id) {
  const i = _identitiesV2.get(id);
  if (!i) throw new Error(`unknown identity ${id}`);
  i.lastSeenAt = Date.now();
  return _cloneIdentityV2(i);
}

export function createIssuanceV2(
  id,
  { identityId, credentialType, metadata } = {},
) {
  if (!id || typeof id !== "string") throw new Error("issuance id required");
  if (!identityId || typeof identityId !== "string")
    throw new Error("identityId required");
  if (!credentialType || typeof credentialType !== "string")
    throw new Error("credentialType required");
  if (_issuancesV2.has(id)) throw new Error(`issuance ${id} already exists`);
  if (!_identitiesV2.has(identityId))
    throw new Error(`unknown identity ${identityId}`);
  const pending = getPendingIssuanceCountV2(identityId);
  if (pending >= _maxPendingIssuancesPerIdentityV2) {
    throw new Error(
      `identity ${identityId} pending issuance cap reached (${_maxPendingIssuancesPerIdentityV2})`,
    );
  }
  const now = Date.now();
  const job = {
    id,
    identityId,
    credentialType,
    status: ISSUANCE_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    startedAt: null,
    settledAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _issuancesV2.set(id, job);
  return _cloneIssuanceV2(job);
}

export function getIssuanceV2(id) {
  const j = _issuancesV2.get(id);
  return j ? _cloneIssuanceV2(j) : null;
}

export function listIssuancesV2({ identityId, status } = {}) {
  const out = [];
  for (const j of _issuancesV2.values()) {
    if (identityId && j.identityId !== identityId) continue;
    if (status && j.status !== status) continue;
    out.push(_cloneIssuanceV2(j));
  }
  return out;
}

export function setIssuanceStatusV2(id, next) {
  const j = _issuancesV2.get(id);
  if (!j) throw new Error(`unknown issuance ${id}`);
  if (ISSUANCE_TERMINAL_V2.has(j.status)) {
    throw new Error(`issuance ${id} is terminal (${j.status})`);
  }
  const allowed = ISSUANCE_TRANSITIONS_V2.get(j.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid issuance transition ${j.status} -> ${next}`);
  }
  const now = Date.now();
  j.status = next;
  if (next === ISSUANCE_LIFECYCLE_V2.ISSUING && !j.startedAt) j.startedAt = now;
  if (ISSUANCE_TERMINAL_V2.has(next) && !j.settledAt) j.settledAt = now;
  return _cloneIssuanceV2(j);
}

export function startIssuanceV2(id) {
  return setIssuanceStatusV2(id, ISSUANCE_LIFECYCLE_V2.ISSUING);
}
export function completeIssuanceV2(id) {
  return setIssuanceStatusV2(id, ISSUANCE_LIFECYCLE_V2.ISSUED);
}
export function failIssuanceV2(id) {
  return setIssuanceStatusV2(id, ISSUANCE_LIFECYCLE_V2.FAILED);
}
export function cancelIssuanceV2(id) {
  return setIssuanceStatusV2(id, ISSUANCE_LIFECYCLE_V2.CANCELLED);
}

export function autoSuspendIdleIdentitiesV2({ now = Date.now() } = {}) {
  const out = [];
  for (const i of _identitiesV2.values()) {
    if (i.status !== IDENTITY_MATURITY_V2.ACTIVE) continue;
    if (now - i.lastSeenAt < _identityIdleMsV2) continue;
    i.status = IDENTITY_MATURITY_V2.SUSPENDED;
    i.lastSeenAt = now;
    out.push(_cloneIdentityV2(i));
  }
  return out;
}

export function autoFailStuckIssuancesV2({ now = Date.now() } = {}) {
  const out = [];
  for (const j of _issuancesV2.values()) {
    if (j.status !== ISSUANCE_LIFECYCLE_V2.ISSUING) continue;
    if (!j.startedAt || now - j.startedAt < _issuanceStuckMsV2) continue;
    j.status = ISSUANCE_LIFECYCLE_V2.FAILED;
    j.settledAt = now;
    out.push(_cloneIssuanceV2(j));
  }
  return out;
}

export function getDidManagerStatsV2() {
  const identitiesByStatus = {};
  for (const s of Object.values(IDENTITY_MATURITY_V2))
    identitiesByStatus[s] = 0;
  for (const i of _identitiesV2.values()) identitiesByStatus[i.status]++;
  const issuancesByStatus = {};
  for (const s of Object.values(ISSUANCE_LIFECYCLE_V2))
    issuancesByStatus[s] = 0;
  for (const j of _issuancesV2.values()) issuancesByStatus[j.status]++;
  return {
    totalIdentitiesV2: _identitiesV2.size,
    totalIssuancesV2: _issuancesV2.size,
    maxActiveIdentitiesPerOwner: _maxActiveIdentitiesPerOwnerV2,
    maxPendingIssuancesPerIdentity: _maxPendingIssuancesPerIdentityV2,
    identityIdleMs: _identityIdleMsV2,
    issuanceStuckMs: _issuanceStuckMsV2,
    identitiesByStatus,
    issuancesByStatus,
  };
}

export function _resetStateDidManagerV2() {
  _identitiesV2.clear();
  _issuancesV2.clear();
  _maxActiveIdentitiesPerOwnerV2 = DID_DEFAULT_MAX_ACTIVE_IDENTITIES_PER_OWNER;
  _maxPendingIssuancesPerIdentityV2 =
    DID_DEFAULT_MAX_PENDING_ISSUANCES_PER_IDENTITY;
  _identityIdleMsV2 = DID_DEFAULT_IDENTITY_IDLE_MS;
  _issuanceStuckMsV2 = DID_DEFAULT_ISSUANCE_STUCK_MS;
}
