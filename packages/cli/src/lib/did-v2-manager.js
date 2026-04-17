/**
 * DID v2.0 Manager — CLI port of Phase 55 去中心化身份2.0
 * (docs/design/modules/55_去中心化身份2.0.md).
 *
 * Desktop ships 8 IPC handlers for W3C DID v2.0: multi-method DID
 * (did:key / did:web / did:chain), Verifiable Presentations with
 * selective disclosure, social recovery via k-of-n threshold shards,
 * cross-platform identity roaming, and multi-source reputation
 * aggregation.
 *
 * CLI port is headless & single-process:
 * - ZKP integration (`zkp_proof_id` field) is a placeholder — real
 *   proof generation stays Desktop-only
 * - "Threshold" recovery uses simple k-of-n share matching, not
 *   Shamir — documented in memory
 * - Reputation aggregation uses weighted mean over caller-supplied
 *   sources (no real on-chain/social oracle)
 */

import crypto from "crypto";

/* ── Constants ───────────────────────────────────────────── */

export const DID_METHOD = Object.freeze({
  KEY: "key",
  WEB: "web",
  CHAIN: "chain",
});

export const CREDENTIAL_STATUS = Object.freeze({
  ACTIVE: "active",
  REVOKED: "revoked",
  EXPIRED: "expired",
  SUSPENDED: "suspended",
});

export const RECOVERY_STATUS = Object.freeze({
  PENDING: "pending",
  THRESHOLD_MET: "threshold_met",
  RECOVERED: "recovered",
  FAILED: "failed",
});

export const DID_STATUS = Object.freeze({
  ACTIVE: "active",
  REVOKED: "revoked",
  ROAMED: "roamed",
});

export const REPUTATION_SOURCE_WEIGHTS = Object.freeze({
  "on-chain": 1.3,
  social: 1.0,
  marketplace: 1.1,
});

export const DEFAULT_RECOVERY_THRESHOLD = 3;
export const DEFAULT_GUARDIAN_COUNT = 5;
export const VP_DEFAULT_TTL_MS = 30 * 60_000;

/* ── Schema ──────────────────────────────────────────────── */

export function ensureDIDv2Tables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS did_v2_documents (
      id TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      method TEXT NOT NULL,
      document TEXT NOT NULL,
      public_key TEXT,
      private_key TEXT,
      authentication TEXT,
      service_endpoints TEXT,
      recovery_guardians TEXT,
      recovery_threshold INTEGER DEFAULT 3,
      reputation_score REAL DEFAULT 0.0,
      status TEXT DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS did_v2_credentials (
      id TEXT PRIMARY KEY,
      holder_did TEXT NOT NULL,
      issuer_did TEXT NOT NULL,
      type TEXT NOT NULL,
      credential_subject TEXT,
      proof TEXT,
      issuance_date INTEGER NOT NULL,
      expiration_date INTEGER,
      status TEXT DEFAULT 'active',
      revocation_reason TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS did_v2_presentations (
      id TEXT PRIMARY KEY,
      holder_did TEXT NOT NULL,
      recipient_did TEXT,
      credential_ids TEXT NOT NULL,
      disclosed_fields TEXT,
      proof TEXT NOT NULL,
      zkp_proof_id TEXT,
      verified INTEGER DEFAULT 0,
      verification_time_ms REAL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS did_v2_recovery_attempts (
      id TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      guardians TEXT NOT NULL,
      shares_submitted TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      status TEXT NOT NULL,
      new_public_key TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS did_v2_roaming_log (
      id TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      source_platform TEXT,
      target_platform TEXT NOT NULL,
      migration_proof TEXT,
      credentials_migrated INTEGER DEFAULT 0,
      reputation_transferred REAL DEFAULT 0.0,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS did_v2_reputation_sources (
      id TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      source TEXT NOT NULL,
      score REAL NOT NULL,
      weight REAL NOT NULL,
      evidence TEXT,
      recorded_at INTEGER NOT NULL
    )
  `);
}

/* ── Internals ───────────────────────────────────────────── */

const _now = () => Date.now();
const _uuid = () => crypto.randomBytes(8).toString("hex");

function _sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function _generateEd25519() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKey: publicKey.toString("hex"),
    privateKey: privateKey.toString("hex"),
  };
}

function _signCanonical(privateKeyHex, payload) {
  const key = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, "hex"),
    format: "der",
    type: "pkcs8",
  });
  const data = Buffer.from(JSON.stringify(payload));
  return crypto.sign(null, data, key).toString("hex");
}

function _verifyCanonical(publicKeyHex, payload, signatureHex) {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeyHex, "hex"),
      format: "der",
      type: "spki",
    });
    const data = Buffer.from(JSON.stringify(payload));
    const sig = Buffer.from(signatureHex, "hex");
    return crypto.verify(null, data, key, sig);
  } catch {
    return false;
  }
}

function _deriveDID(method, publicKeyHex, domain) {
  if (method === DID_METHOD.KEY) {
    const hash = _sha256(Buffer.from(publicKeyHex, "hex"))
      .toString("base64url")
      .slice(0, 32);
    return `did:key:z${hash}`;
  }
  if (method === DID_METHOD.WEB) {
    const host = (domain || "chainless.local").replace(/[^a-z0-9.-]/gi, "");
    const id = _sha256(Buffer.from(publicKeyHex, "hex"))
      .toString("base64url")
      .slice(0, 16);
    return `did:web:${host}:${id}`;
  }
  // CHAIN
  const hash = _sha256(Buffer.from(publicKeyHex, "hex"))
    .toString("base64url")
    .slice(0, 32);
  return `did:chain:${hash}`;
}

function _buildDocument(did, method, publicKeyHex, services = []) {
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/ed25519-2020/v1",
    ],
    id: did,
    verificationMethod: [
      {
        id: `${did}#keys-1`,
        type: "Ed25519VerificationKey2020",
        controller: did,
        publicKeyHex,
      },
    ],
    authentication: [`${did}#keys-1`],
    assertionMethod: [`${did}#keys-1`],
    service: services.map((s, i) => ({
      id: `${did}#service-${i}`,
      type: s.type || "Service",
      serviceEndpoint: s.endpoint,
    })),
    method,
  };
}

function _parseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function _rowToDID(row) {
  if (!row) return null;
  return {
    did: row.did,
    method: row.method,
    document: _parseJSON(row.document, {}),
    publicKey: row.public_key,
    authentication: _parseJSON(row.authentication, []),
    serviceEndpoints: _parseJSON(row.service_endpoints, []),
    recoveryGuardians: _parseJSON(row.recovery_guardians, []),
    recoveryThreshold: row.recovery_threshold,
    reputationScore: row.reputation_score,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function _rowToCredential(row) {
  if (!row) return null;
  return {
    id: row.id,
    holderDid: row.holder_did,
    issuerDid: row.issuer_did,
    type: row.type,
    credentialSubject: _parseJSON(row.credential_subject, {}),
    proof: _parseJSON(row.proof, null),
    issuanceDate: row.issuance_date,
    expirationDate: row.expiration_date,
    status: row.status,
    revocationReason: row.revocation_reason,
    createdAt: row.created_at,
  };
}

function _rowToPresentation(row) {
  if (!row) return null;
  return {
    id: row.id,
    holderDid: row.holder_did,
    recipientDid: row.recipient_did,
    credentialIds: _parseJSON(row.credential_ids, []),
    disclosedFields: _parseJSON(row.disclosed_fields, []),
    proof: _parseJSON(row.proof, null),
    zkpProofId: row.zkp_proof_id,
    verified: row.verified === 1,
    verificationTimeMs: row.verification_time_ms,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function _rowToRecovery(row) {
  if (!row) return null;
  return {
    id: row.id,
    did: row.did,
    guardians: _parseJSON(row.guardians, []),
    sharesSubmitted: _parseJSON(row.shares_submitted, []),
    threshold: row.threshold,
    status: row.status,
    newPublicKey: row.new_public_key,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function _rowToRoamingEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    did: row.did,
    sourcePlatform: row.source_platform,
    targetPlatform: row.target_platform,
    migrationProof: row.migration_proof,
    credentialsMigrated: row.credentials_migrated,
    reputationTransferred: row.reputation_transferred,
    createdAt: row.created_at,
  };
}

/* ── DID lifecycle ───────────────────────────────────────── */

export function createDID(
  db,
  {
    method = DID_METHOD.KEY,
    domain,
    services = [],
    guardians = [],
    threshold = DEFAULT_RECOVERY_THRESHOLD,
    reputationScore = 0.0,
  } = {},
) {
  const validMethods = Object.values(DID_METHOD);
  if (!validMethods.includes(method)) {
    throw new Error(
      `invalid method: ${method} (expected one of ${validMethods.join(", ")})`,
    );
  }
  if (guardians.length > 0 && threshold > guardians.length) {
    throw new Error(
      `recovery threshold ${threshold} exceeds guardian count ${guardians.length}`,
    );
  }
  const { publicKey, privateKey } = _generateEd25519();
  const did = _deriveDID(method, publicKey, domain);

  const existing = db
    .prepare(`SELECT id FROM did_v2_documents WHERE did = ?`)
    .get(did);
  if (existing) {
    throw new Error(`did already exists: ${did}`);
  }

  const doc = _buildDocument(did, method, publicKey, services);
  const now = _now();
  const id = _uuid();

  db.prepare(
    `INSERT INTO did_v2_documents
      (id, did, method, document, public_key, private_key, authentication,
       service_endpoints, recovery_guardians, recovery_threshold,
       reputation_score, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    did,
    method,
    JSON.stringify(doc),
    publicKey,
    privateKey,
    JSON.stringify(doc.authentication || []),
    JSON.stringify(services),
    JSON.stringify(guardians),
    threshold,
    reputationScore,
    DID_STATUS.ACTIVE,
    now,
    now,
  );
  return { did, method, document: doc, privateKey, publicKey };
}

export function resolveDID(db, did) {
  if (!did) return null;
  const row = db
    .prepare(`SELECT * FROM did_v2_documents WHERE did = ?`)
    .get(did);
  return _rowToDID(row);
}

export function listDIDs(db, { method, status } = {}) {
  const wheres = [];
  const params = [];
  if (method) {
    wheres.push(`method = ?`);
    params.push(method);
  }
  if (status) {
    wheres.push(`status = ?`);
    params.push(status);
  }
  const sql = `SELECT * FROM did_v2_documents ${
    wheres.length ? "WHERE " + wheres.join(" AND ") : ""
  } ORDER BY created_at DESC`;
  return db
    .prepare(sql)
    .all(...params)
    .map(_rowToDID);
}

export function updateDIDStatus(db, did, status) {
  const validStatuses = Object.values(DID_STATUS);
  if (!validStatuses.includes(status)) {
    throw new Error(
      `invalid status: ${status} (expected one of ${validStatuses.join(", ")})`,
    );
  }
  const res = db
    .prepare(
      `UPDATE did_v2_documents SET status = ?, updated_at = ? WHERE did = ?`,
    )
    .run(status, _now(), did);
  return res.changes > 0;
}

/* ── Credentials ─────────────────────────────────────────── */

export function issueCredential(
  db,
  { holderDid, issuerDid, type, credentialSubject = {}, expiresInMs } = {},
) {
  if (!holderDid) throw new Error("holderDid required");
  if (!issuerDid) throw new Error("issuerDid required");
  if (!type) throw new Error("type required");

  const issuer = resolveDID(db, issuerDid);
  if (!issuer) throw new Error(`issuer not found: ${issuerDid}`);

  const issuerKeyRow = db
    .prepare(`SELECT private_key FROM did_v2_documents WHERE did = ?`)
    .get(issuerDid);
  if (!issuerKeyRow?.private_key) {
    throw new Error(`issuer has no signing key: ${issuerDid}`);
  }

  const id = `urn:uuid:${_uuid()}`;
  const issuanceDate = _now();
  const expirationDate = expiresInMs ? issuanceDate + expiresInMs : null;

  const vc = {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://w3id.org/security/suites/ed25519-2020/v1",
    ],
    id,
    type: ["VerifiableCredential", type],
    issuer: issuerDid,
    credentialSubject: { id: holderDid, ...credentialSubject },
    issuanceDate: new Date(issuanceDate).toISOString(),
    expirationDate: expirationDate
      ? new Date(expirationDate).toISOString()
      : undefined,
  };
  const signature = _signCanonical(issuerKeyRow.private_key, vc);
  const proof = {
    type: "Ed25519Signature2020",
    created: new Date(issuanceDate).toISOString(),
    verificationMethod: `${issuerDid}#keys-1`,
    proofPurpose: "assertionMethod",
    proofValue: signature,
  };

  db.prepare(
    `INSERT INTO did_v2_credentials
      (id, holder_did, issuer_did, type, credential_subject, proof,
       issuance_date, expiration_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    holderDid,
    issuerDid,
    type,
    JSON.stringify(credentialSubject),
    JSON.stringify(proof),
    issuanceDate,
    expirationDate,
    CREDENTIAL_STATUS.ACTIVE,
    issuanceDate,
  );

  return { ...vc, proof, _id: id };
}

export function getCredential(db, id) {
  const row = db
    .prepare(`SELECT * FROM did_v2_credentials WHERE id = ?`)
    .get(id);
  return _rowToCredential(row);
}

export function listCredentials(db, { holderDid, issuerDid, status } = {}) {
  const wheres = [];
  const params = [];
  if (holderDid) {
    wheres.push(`holder_did = ?`);
    params.push(holderDid);
  }
  if (issuerDid) {
    wheres.push(`issuer_did = ?`);
    params.push(issuerDid);
  }
  if (status) {
    wheres.push(`status = ?`);
    params.push(status);
  }
  const sql = `SELECT * FROM did_v2_credentials ${
    wheres.length ? "WHERE " + wheres.join(" AND ") : ""
  } ORDER BY issuance_date DESC`;
  return db
    .prepare(sql)
    .all(...params)
    .map(_rowToCredential);
}

export function revokeCredential(db, id, reason) {
  const res = db
    .prepare(
      `UPDATE did_v2_credentials SET status = ?, revocation_reason = ? WHERE id = ?`,
    )
    .run(CREDENTIAL_STATUS.REVOKED, reason || null, id);
  return res.changes > 0;
}

/* ── Verifiable Presentations ────────────────────────────── */

export function createPresentation(
  db,
  {
    holderDid,
    credentialIds = [],
    recipientDid,
    disclosedFields = [],
    ttlMs = VP_DEFAULT_TTL_MS,
    zkpEnabled = false,
  } = {},
) {
  if (!holderDid) throw new Error("holderDid required");
  if (!Array.isArray(credentialIds) || credentialIds.length === 0) {
    throw new Error("credentialIds must be a non-empty array");
  }

  const holder = resolveDID(db, holderDid);
  if (!holder) throw new Error(`holder not found: ${holderDid}`);

  const holderKeyRow = db
    .prepare(`SELECT private_key FROM did_v2_documents WHERE did = ?`)
    .get(holderDid);
  if (!holderKeyRow?.private_key) {
    throw new Error(`holder has no signing key: ${holderDid}`);
  }

  // Verify all credentials belong to holder and are active
  const creds = [];
  for (const cid of credentialIds) {
    const row = db
      .prepare(`SELECT * FROM did_v2_credentials WHERE id = ?`)
      .get(cid);
    if (!row) throw new Error(`credential not found: ${cid}`);
    if (row.holder_did !== holderDid) {
      throw new Error(
        `credential ${cid} belongs to ${row.holder_did}, not ${holderDid}`,
      );
    }
    if (row.status !== CREDENTIAL_STATUS.ACTIVE) {
      throw new Error(`credential ${cid} is ${row.status}, not active`);
    }
    if (row.expiration_date && row.expiration_date < _now()) {
      throw new Error(`credential ${cid} is expired`);
    }
    creds.push(row);
  }

  const id = `urn:uuid:${_uuid()}`;
  const now = _now();
  const expiresAt = now + ttlMs;

  // Build payload for signing (selective disclosure just echoes which
  // fields are disclosed — the CLI does not redact claims in storage)
  const payload = {
    id,
    type: ["VerifiablePresentation"],
    holder: holderDid,
    verifiableCredential: creds.map((c) => ({
      id: c.id,
      type: c.type,
      issuer: c.issuer_did,
    })),
    recipient: recipientDid || null,
    disclosedFields,
    created: now,
    expires: expiresAt,
  };
  const signature = _signCanonical(holderKeyRow.private_key, payload);
  const proof = {
    type: "Ed25519Signature2020",
    created: new Date(now).toISOString(),
    verificationMethod: `${holderDid}#keys-1`,
    proofPurpose: "authentication",
    proofValue: signature,
  };
  const zkpProofId = zkpEnabled ? `zkp:${_uuid()}` : null;

  db.prepare(
    `INSERT INTO did_v2_presentations
      (id, holder_did, recipient_did, credential_ids, disclosed_fields,
       proof, zkp_proof_id, verified, verification_time_ms,
       created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    holderDid,
    recipientDid || null,
    JSON.stringify(credentialIds),
    JSON.stringify(disclosedFields),
    JSON.stringify(proof),
    zkpProofId,
    0,
    null,
    now,
    expiresAt,
  );

  return {
    id,
    holderDid,
    recipientDid: recipientDid || null,
    credentialIds,
    disclosedFields,
    proof,
    zkpProofId,
    expiresAt,
  };
}

export function getPresentation(db, id) {
  const row = db
    .prepare(`SELECT * FROM did_v2_presentations WHERE id = ?`)
    .get(id);
  return _rowToPresentation(row);
}

export function listPresentations(db, { holderDid } = {}) {
  const wheres = [];
  const params = [];
  if (holderDid) {
    wheres.push(`holder_did = ?`);
    params.push(holderDid);
  }
  const sql = `SELECT * FROM did_v2_presentations ${
    wheres.length ? "WHERE " + wheres.join(" AND ") : ""
  } ORDER BY created_at DESC`;
  return db
    .prepare(sql)
    .all(...params)
    .map(_rowToPresentation);
}

export function verifyPresentation(db, id) {
  const start = _now();
  const row = db
    .prepare(`SELECT * FROM did_v2_presentations WHERE id = ?`)
    .get(id);
  if (!row) {
    return { ok: false, reason: "not_found" };
  }
  if (row.expires_at < start) {
    return { ok: false, reason: "expired", verificationTimeMs: 0 };
  }

  const holder = resolveDID(db, row.holder_did);
  if (!holder) return { ok: false, reason: "holder_missing" };

  const credIds = _parseJSON(row.credential_ids, []);
  for (const cid of credIds) {
    const c = db
      .prepare(
        `SELECT status, expiration_date FROM did_v2_credentials WHERE id = ?`,
      )
      .get(cid);
    if (!c) return { ok: false, reason: `credential_missing:${cid}` };
    if (c.status !== CREDENTIAL_STATUS.ACTIVE) {
      return { ok: false, reason: `credential_${c.status}:${cid}` };
    }
    if (c.expiration_date && c.expiration_date < start) {
      return { ok: false, reason: `credential_expired:${cid}` };
    }
  }

  // Re-derive signing payload from stored fields
  const proof = _parseJSON(row.proof, {});
  const creds = credIds.map((cid) => {
    const c = db
      .prepare(
        `SELECT id, type, issuer_did FROM did_v2_credentials WHERE id = ?`,
      )
      .get(cid);
    return { id: c.id, type: c.type, issuer: c.issuer_did };
  });
  const payload = {
    id: row.id,
    type: ["VerifiablePresentation"],
    holder: row.holder_did,
    verifiableCredential: creds,
    recipient: row.recipient_did || null,
    disclosedFields: _parseJSON(row.disclosed_fields, []),
    created: row.created_at,
    expires: row.expires_at,
  };
  const ok = _verifyCanonical(holder.publicKey, payload, proof.proofValue);
  const verificationTimeMs = _now() - start;

  db.prepare(
    `UPDATE did_v2_presentations SET verified = ?, verification_time_ms = ? WHERE id = ?`,
  ).run(ok ? 1 : 0, verificationTimeMs, id);

  return {
    ok,
    reason: ok ? null : "bad_signature",
    verificationTimeMs,
  };
}

/* ── Social recovery ─────────────────────────────────────── */

export function startRecovery(db, { did, shares = [] } = {}) {
  if (!did) throw new Error("did required");
  if (!Array.isArray(shares) || shares.length === 0) {
    throw new Error("shares must be a non-empty array");
  }
  const row = db
    .prepare(`SELECT * FROM did_v2_documents WHERE did = ?`)
    .get(did);
  if (!row) throw new Error(`did not found: ${did}`);

  const guardians = _parseJSON(row.recovery_guardians, []);
  const threshold = row.recovery_threshold;

  // Validate shares — each must include guardian identifier matching the DID's guardian list
  const validShares = shares.filter(
    (s) =>
      s &&
      typeof s === "object" &&
      s.guardian &&
      guardians.includes(s.guardian) &&
      s.share,
  );

  const status =
    validShares.length >= threshold
      ? RECOVERY_STATUS.THRESHOLD_MET
      : RECOVERY_STATUS.PENDING;

  const id = _uuid();
  const now = _now();
  db.prepare(
    `INSERT INTO did_v2_recovery_attempts
      (id, did, guardians, shares_submitted, threshold, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    did,
    JSON.stringify(guardians),
    JSON.stringify(validShares),
    threshold,
    status,
    now,
  );

  return {
    id,
    did,
    status,
    validShares: validShares.length,
    threshold,
  };
}

export function completeRecovery(db, recoveryId) {
  const row = db
    .prepare(`SELECT * FROM did_v2_recovery_attempts WHERE id = ?`)
    .get(recoveryId);
  if (!row) throw new Error(`recovery not found: ${recoveryId}`);
  if (row.status !== RECOVERY_STATUS.THRESHOLD_MET) {
    throw new Error(`recovery ${recoveryId} not ready: status=${row.status}`);
  }

  const { publicKey, privateKey } = _generateEd25519();
  const didRow = db
    .prepare(`SELECT * FROM did_v2_documents WHERE did = ?`)
    .get(row.did);
  if (!didRow) {
    db.prepare(
      `UPDATE did_v2_recovery_attempts SET status = ?, completed_at = ? WHERE id = ?`,
    ).run(RECOVERY_STATUS.FAILED, _now(), recoveryId);
    throw new Error(`did disappeared during recovery: ${row.did}`);
  }

  const doc = _buildDocument(
    row.did,
    didRow.method,
    publicKey,
    _parseJSON(didRow.service_endpoints, []),
  );

  const now = _now();
  db.prepare(
    `UPDATE did_v2_documents SET public_key = ?, private_key = ?, document = ?, authentication = ?, updated_at = ? WHERE did = ?`,
  ).run(
    publicKey,
    privateKey,
    JSON.stringify(doc),
    JSON.stringify(doc.authentication || []),
    now,
    row.did,
  );
  db.prepare(
    `UPDATE did_v2_recovery_attempts SET status = ?, new_public_key = ?, completed_at = ? WHERE id = ?`,
  ).run(RECOVERY_STATUS.RECOVERED, publicKey, now, recoveryId);

  return { did: row.did, newPublicKey: publicKey, privateKey };
}

export function getRecovery(db, recoveryId) {
  const row = db
    .prepare(`SELECT * FROM did_v2_recovery_attempts WHERE id = ?`)
    .get(recoveryId);
  return _rowToRecovery(row);
}

export function listRecoveries(db, { did } = {}) {
  const wheres = [];
  const params = [];
  if (did) {
    wheres.push(`did = ?`);
    params.push(did);
  }
  const sql = `SELECT * FROM did_v2_recovery_attempts ${
    wheres.length ? "WHERE " + wheres.join(" AND ") : ""
  } ORDER BY created_at DESC`;
  return db
    .prepare(sql)
    .all(...params)
    .map(_rowToRecovery);
}

/* ── Identity roaming ────────────────────────────────────── */

export function roamIdentity(
  db,
  { did, targetPlatform, sourcePlatform, migrationProof } = {},
) {
  if (!did) throw new Error("did required");
  if (!targetPlatform) throw new Error("targetPlatform required");

  const didRow = db
    .prepare(`SELECT * FROM did_v2_documents WHERE did = ?`)
    .get(did);
  if (!didRow) throw new Error(`did not found: ${did}`);

  const creds = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM did_v2_credentials WHERE holder_did = ? AND status = ?`,
    )
    .get(did, CREDENTIAL_STATUS.ACTIVE);

  const credentialsMigrated = creds?.cnt || 0;
  const reputationTransferred = didRow.reputation_score || 0.0;

  const id = _uuid();
  const now = _now();
  db.prepare(
    `INSERT INTO did_v2_roaming_log
      (id, did, source_platform, target_platform, migration_proof,
       credentials_migrated, reputation_transferred, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    did,
    sourcePlatform || null,
    targetPlatform,
    migrationProof || null,
    credentialsMigrated,
    reputationTransferred,
    now,
  );

  db.prepare(
    `UPDATE did_v2_documents SET status = ?, updated_at = ? WHERE did = ?`,
  ).run(DID_STATUS.ROAMED, now, did);

  return {
    id,
    did,
    sourcePlatform: sourcePlatform || null,
    targetPlatform,
    credentialsMigrated,
    reputationTransferred,
  };
}

export function listRoamingLog(db, { did } = {}) {
  const wheres = [];
  const params = [];
  if (did) {
    wheres.push(`did = ?`);
    params.push(did);
  }
  const sql = `SELECT * FROM did_v2_roaming_log ${
    wheres.length ? "WHERE " + wheres.join(" AND ") : ""
  } ORDER BY created_at DESC`;
  return db
    .prepare(sql)
    .all(...params)
    .map(_rowToRoamingEntry);
}

/* ── Reputation aggregation ──────────────────────────────── */

export function recordReputationSource(
  db,
  { did, source, score, evidence } = {},
) {
  if (!did) throw new Error("did required");
  if (!source) throw new Error("source required");
  if (typeof score !== "number") throw new Error("score must be a number");

  const weight = REPUTATION_SOURCE_WEIGHTS[source] ?? 1.0;
  const id = _uuid();
  db.prepare(
    `INSERT INTO did_v2_reputation_sources
      (id, did, source, score, weight, evidence, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    did,
    source,
    score,
    weight,
    evidence ? JSON.stringify(evidence) : null,
    _now(),
  );
  return { id, weight };
}

export function aggregateReputation(db, did, { sources } = {}) {
  if (!did) throw new Error("did required");

  const wheres = [`did = ?`];
  const params = [did];
  if (Array.isArray(sources) && sources.length > 0) {
    // Use multiple OR conditions via parameterized literals —
    // MockDB supports one "= ?" per condition, so filter in JS instead
  }
  const rows = db
    .prepare(
      `SELECT * FROM did_v2_reputation_sources ${
        wheres.length ? "WHERE " + wheres.join(" AND ") : ""
      }`,
    )
    .all(...params);

  const filtered =
    Array.isArray(sources) && sources.length > 0
      ? rows.filter((r) => sources.includes(r.source))
      : rows;

  if (filtered.length === 0) {
    return { did, aggregatedScore: 0.0, sourceCount: 0, sources: [] };
  }

  const numer = filtered.reduce((s, r) => s + r.score * r.weight, 0);
  const denom = filtered.reduce((s, r) => s + r.weight, 0);
  const aggregated = denom > 0 ? numer / denom : 0.0;

  db.prepare(
    `UPDATE did_v2_documents SET reputation_score = ?, updated_at = ? WHERE did = ?`,
  ).run(aggregated, _now(), did);

  const bySource = new Map();
  for (const r of filtered) {
    if (!bySource.has(r.source)) {
      bySource.set(r.source, {
        source: r.source,
        score: 0,
        weight: r.weight,
        count: 0,
      });
    }
    const entry = bySource.get(r.source);
    entry.score += r.score;
    entry.count += 1;
  }
  const sourceBreakdown = [...bySource.values()].map((e) => ({
    source: e.source,
    avgScore: e.count > 0 ? e.score / e.count : 0,
    weight: e.weight,
    sampleCount: e.count,
  }));

  return {
    did,
    aggregatedScore: aggregated,
    sourceCount: filtered.length,
    sources: sourceBreakdown,
  };
}

/* ── Export ──────────────────────────────────────────────── */

export function exportDID(db, did, { format = "json-ld" } = {}) {
  const row = db
    .prepare(`SELECT * FROM did_v2_documents WHERE did = ?`)
    .get(did);
  if (!row) throw new Error(`did not found: ${did}`);

  const document = _parseJSON(row.document, {});
  const creds = db
    .prepare(`SELECT * FROM did_v2_credentials WHERE holder_did = ?`)
    .all(did)
    .map(_rowToCredential);

  if (format === "jwt") {
    // Minimal JWT-style packaging (header.payload.signature) —
    // not a real JWS, signed with DID's Ed25519 key as payload hash
    const header = { alg: "EdDSA", typ: "DIDv2+JWT" };
    const payload = { did, document, credentials: creds };
    const h = Buffer.from(JSON.stringify(header)).toString("base64url");
    const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = row.private_key
      ? _signCanonical(row.private_key, { h, p })
      : "";
    return { format: "jwt", token: `${h}.${p}.${sig}` };
  }

  return {
    format: "json-ld",
    document,
    credentials: creds,
    reputationScore: row.reputation_score,
    status: row.status,
  };
}

/* ── Stats ───────────────────────────────────────────────── */

export function getStats(db) {
  const didCount =
    db.prepare(`SELECT COUNT(*) as cnt FROM did_v2_documents`).get()?.cnt || 0;
  const activeDIDs =
    db
      .prepare(`SELECT COUNT(*) as cnt FROM did_v2_documents WHERE status = ?`)
      .get(DID_STATUS.ACTIVE)?.cnt || 0;
  const credCount =
    db.prepare(`SELECT COUNT(*) as cnt FROM did_v2_credentials`).get()?.cnt ||
    0;
  const activeCreds =
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM did_v2_credentials WHERE status = ?`,
      )
      .get(CREDENTIAL_STATUS.ACTIVE)?.cnt || 0;
  const presentationCount =
    db.prepare(`SELECT COUNT(*) as cnt FROM did_v2_presentations`).get()?.cnt ||
    0;
  const verifiedPresentations =
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM did_v2_presentations WHERE verified = 1`,
      )
      .get()?.cnt || 0;
  const recoveryCount =
    db.prepare(`SELECT COUNT(*) as cnt FROM did_v2_recovery_attempts`).get()
      ?.cnt || 0;
  const roamingCount =
    db.prepare(`SELECT COUNT(*) as cnt FROM did_v2_roaming_log`).get()?.cnt ||
    0;

  return {
    didCount,
    activeDIDs,
    credentialCount: credCount,
    activeCredentials: activeCreds,
    presentationCount,
    verifiedPresentations,
    recoveryCount,
    roamingCount,
  };
}

export function getConfig() {
  return {
    methods: Object.values(DID_METHOD),
    credentialStatuses: Object.values(CREDENTIAL_STATUS),
    recoveryStatuses: Object.values(RECOVERY_STATUS),
    didStatuses: Object.values(DID_STATUS),
    reputationSourceWeights: { ...REPUTATION_SOURCE_WEIGHTS },
    defaultRecoveryThreshold: DEFAULT_RECOVERY_THRESHOLD,
    defaultGuardianCount: DEFAULT_GUARDIAN_COUNT,
    vpDefaultTTLMs: VP_DEFAULT_TTL_MS,
  };
}
