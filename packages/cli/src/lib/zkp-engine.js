/**
 * ZKP Engine — Zero-knowledge proof circuit compilation, proof generation,
 * verification, and selective identity disclosure (Phase 88).
 */

import crypto from "crypto";

/* ── Phase 88 frozen enums ─────────────────────────────────── */

export const PROOF_SCHEME = Object.freeze({
  GROTH16: "groth16",
  PLONK: "plonk",
  BULLETPROOFS: "bulletproofs",
});

export const CIRCUIT_STATUS = Object.freeze({
  DRAFT: "draft",
  COMPILED: "compiled",
  VERIFIED: "verified",
  FAILED: "failed",
});

export const SUPPORTED_SCHEMES = new Set(Object.values(PROOF_SCHEME));

/* ── In-memory stores ──────────────────────────────────────── */
const _circuits = new Map();
const _proofs = new Map();
const _verificationKeys = new Map();
const _credentials = new Map();

const DEFAULT_SCHEME = PROOF_SCHEME.GROTH16;

/* ── Schema ────────────────────────────────────────────────── */

export function ensureZKPTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS zkp_circuits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      definition TEXT,
      compiled TEXT,
      verification_key TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS zkp_proofs (
      id TEXT PRIMARY KEY,
      circuit_id TEXT NOT NULL,
      proof TEXT,
      public_inputs TEXT,
      verified INTEGER DEFAULT 0,
      scheme TEXT DEFAULT 'groth16',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS zkp_credentials (
      id TEXT PRIMARY KEY,
      did TEXT,
      claims TEXT NOT NULL,
      merkle_root TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Circuit Compilation ───────────────────────────────────── */

export function compileCircuit(db, name, definition) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Parse definition to extract constraints and I/O
  let parsed;
  if (typeof definition === "string") {
    try {
      parsed = JSON.parse(definition);
    } catch (_err) {
      parsed = { constraints: [], inputs: [], outputs: [] };
    }
  } else {
    parsed = definition || {};
  }

  const constraints = parsed.constraints || [];
  const inputs = parsed.inputs || [];
  const outputs = parsed.outputs || [];

  // Generate verification key
  const vkData = `${id}:${name}:${now}`;
  const verificationKey = crypto
    .createHash("sha256")
    .update(vkData)
    .digest("hex");

  const compiled = {
    bytecode: crypto.randomBytes(32).toString("hex"),
    constraintCount: constraints.length || 1,
    compiledAt: now,
  };

  const circuit = {
    id,
    name,
    definition: parsed,
    compiled,
    constraints: constraints.length || 1,
    inputs,
    outputs,
    verificationKey,
    status: CIRCUIT_STATUS.COMPILED,
    createdAt: now,
  };

  _circuits.set(id, circuit);
  _verificationKeys.set(id, verificationKey);

  db.prepare(
    `INSERT INTO zkp_circuits (id, name, definition, compiled, verification_key, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    JSON.stringify(parsed),
    JSON.stringify(compiled),
    verificationKey,
    CIRCUIT_STATUS.COMPILED,
    now,
  );

  return circuit;
}

/**
 * Update a circuit's status (DRAFT / COMPILED / VERIFIED / FAILED).
 */
export function setCircuitStatus(db, circuitId, status) {
  if (!Object.values(CIRCUIT_STATUS).includes(status)) {
    throw new Error(`Invalid circuit status: ${status}`);
  }
  const circuit = _circuits.get(circuitId);
  if (!circuit) throw new Error(`Circuit not found: ${circuitId}`);
  circuit.status = status;
  db.prepare("UPDATE zkp_circuits SET status = ? WHERE id = ?").run(
    status,
    circuitId,
  );
  return { id: circuitId, status };
}

/* ── Proof Generation ──────────────────────────────────────── */

export function generateProof(
  db,
  circuitId,
  privateInputs,
  publicInputs,
  options = {},
) {
  const circuit = _circuits.get(circuitId);
  if (!circuit) throw new Error(`Circuit not found: ${circuitId}`);

  const scheme = options.scheme || DEFAULT_SCHEME;
  if (!SUPPORTED_SCHEMES.has(scheme)) {
    throw new Error(
      `Unsupported proof scheme: ${scheme}. Supported: ${[...SUPPORTED_SCHEMES].join(", ")}`,
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Scheme-shaped mock proof structure
  let proofData;
  if (scheme === PROOF_SCHEME.GROTH16) {
    proofData = {
      a: crypto.randomBytes(32).toString("hex"),
      b: crypto.randomBytes(64).toString("hex"),
      c: crypto.randomBytes(32).toString("hex"),
    };
  } else if (scheme === PROOF_SCHEME.PLONK) {
    proofData = {
      commitments: crypto.randomBytes(96).toString("hex"),
      evaluations: crypto.randomBytes(64).toString("hex"),
    };
  } else {
    // bulletproofs — range proof shape
    proofData = {
      V: crypto.randomBytes(32).toString("hex"),
      A: crypto.randomBytes(32).toString("hex"),
      S: crypto.randomBytes(32).toString("hex"),
      t1: crypto.randomBytes(32).toString("hex"),
    };
  }

  const proof = {
    id,
    circuitId,
    scheme,
    proof: proofData,
    publicInputs: publicInputs || [],
    verified: false,
    createdAt: now,
  };

  _proofs.set(id, proof);

  db.prepare(
    `INSERT INTO zkp_proofs (id, circuit_id, proof, public_inputs, verified, scheme, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    circuitId,
    JSON.stringify(proofData),
    JSON.stringify(publicInputs || []),
    0,
    scheme,
    now,
  );

  return proof;
}

/* ── Proof Verification ────────────────────────────────────── */

export function verifyProof(db, proofId) {
  const proof = _proofs.get(proofId);
  if (!proof) throw new Error(`Proof not found: ${proofId}`);

  const circuit = _circuits.get(proof.circuitId);
  if (!circuit) throw new Error(`Circuit not found for proof: ${proofId}`);

  // Scheme-aware structural validation
  let structurallyValid = false;
  if (proof.scheme === PROOF_SCHEME.GROTH16) {
    structurallyValid =
      proof.proof &&
      typeof proof.proof.a === "string" &&
      typeof proof.proof.b === "string" &&
      typeof proof.proof.c === "string";
  } else if (proof.scheme === PROOF_SCHEME.PLONK) {
    structurallyValid =
      proof.proof &&
      typeof proof.proof.commitments === "string" &&
      typeof proof.proof.evaluations === "string";
  } else if (proof.scheme === PROOF_SCHEME.BULLETPROOFS) {
    structurallyValid =
      proof.proof &&
      typeof proof.proof.V === "string" &&
      typeof proof.proof.A === "string";
  }

  const valid = structurallyValid && _verificationKeys.has(proof.circuitId);

  proof.verified = valid;

  db.prepare(`UPDATE zkp_proofs SET verified = ? WHERE id = ?`).run(
    valid ? 1 : 0,
    proofId,
  );

  return { valid, proofId, circuitId: proof.circuitId, scheme: proof.scheme };
}

/* ── Identity Proof (Selective Disclosure) ─────────────────── */

export function createIdentityProof(claims, disclosedFields) {
  if (!claims || typeof claims !== "object") {
    throw new Error("Claims must be an object");
  }

  const allFields = Object.keys(claims);
  const disclosed = {};
  const hiddenFields = [];

  for (const field of allFields) {
    if (disclosedFields && disclosedFields.includes(field)) {
      disclosed[field] = claims[field];
    } else {
      hiddenFields.push(field);
    }
  }

  const commitment = crypto
    .createHash("sha256")
    .update(JSON.stringify(claims))
    .digest("hex");

  return {
    id: crypto.randomUUID(),
    type: "selective-disclosure",
    disclosed,
    hiddenCount: hiddenFields.length,
    commitment,
  };
}

/* ── Credentials + Merkle-tree selective disclosure ──────────── */

/**
 * Compute a deterministic Merkle root over sorted (field, hash(value)) leaves.
 * Each leaf = sha256(fieldName + ":" + sha256(stringified-value)).
 * Pairs combine as sha256(left + right), odd leaves are duplicated (standard).
 */
function _merkleRoot(claims) {
  const fields = Object.keys(claims).sort();
  if (fields.length === 0) {
    return crypto.createHash("sha256").update("").digest("hex");
  }

  let level = fields.map((field) => {
    const valHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(claims[field]))
      .digest("hex");
    return crypto
      .createHash("sha256")
      .update(`${field}:${valHash}`)
      .digest("hex");
  });

  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(
        crypto
          .createHash("sha256")
          .update(left + right)
          .digest("hex"),
      );
    }
    level = next;
  }
  return level[0];
}

/**
 * Register a verifiable credential. Returns `{ id, did, merkleRoot, claims }`.
 */
export function registerCredential(db, { did, claims }) {
  if (!claims || typeof claims !== "object") {
    throw new Error("Claims must be an object");
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const merkleRoot = _merkleRoot(claims);

  const credential = {
    id,
    did: did || null,
    claims,
    merkleRoot,
    createdAt: now,
  };
  _credentials.set(id, credential);

  db.prepare(
    `INSERT INTO zkp_credentials (id, did, claims, merkle_root, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, did || null, JSON.stringify(claims), merkleRoot, now);

  return credential;
}

/**
 * Selectively disclose a subset of credential fields to a recipient.
 * Returns `{ id, credentialId, recipientDid, disclosed, merkleRoot, hiddenCount }`.
 * The receiver can recompute the Merkle root (given hashed pads for hidden fields)
 * and match it against the credential's merkleRoot to confirm integrity.
 */
export function selectiveDisclose(
  db,
  credentialId,
  disclosedFields,
  recipientDid = null,
) {
  const credential = _credentials.get(credentialId);
  if (!credential) {
    throw new Error(`Credential not found: ${credentialId}`);
  }
  if (!Array.isArray(disclosedFields)) {
    throw new Error("disclosedFields must be an array");
  }

  const allFields = Object.keys(credential.claims);
  const disclosed = {};
  const hiddenFields = [];

  for (const field of allFields) {
    if (disclosedFields.includes(field)) {
      disclosed[field] = credential.claims[field];
    } else {
      hiddenFields.push(field);
    }
  }

  return {
    id: crypto.randomUUID(),
    type: "selective-disclosure",
    credentialId,
    recipientDid,
    disclosed,
    hiddenCount: hiddenFields.length,
    hiddenFields,
    merkleRoot: credential.merkleRoot,
    disclosedAt: new Date().toISOString(),
  };
}

/**
 * List registered credentials, optionally filtered by DID.
 */
export function listCredentials(db, options = {}) {
  let creds = [..._credentials.values()];
  if (options.did) {
    creds = creds.filter((c) => c.did === options.did);
  }
  return creds;
}

/* ── Stats ─────────────────────────────────────────────────── */

export function getZKPStats() {
  const proofList = [..._proofs.values()];
  const bySchemeCount = {};
  for (const scheme of Object.values(PROOF_SCHEME)) {
    bySchemeCount[scheme] = proofList.filter((p) => p.scheme === scheme).length;
  }
  const byStatusCount = {};
  for (const status of Object.values(CIRCUIT_STATUS)) {
    byStatusCount[status] = [..._circuits.values()].filter(
      (c) => c.status === status,
    ).length;
  }
  return {
    circuits: _circuits.size,
    proofs: proofList.length,
    verifiedProofs: proofList.filter((p) => p.verified).length,
    credentials: _credentials.size,
    proofsByScheme: bySchemeCount,
    circuitsByStatus: byStatusCount,
  };
}

/* ── Listing ───────────────────────────────────────────────── */

export function listCircuits(db) {
  return [..._circuits.values()];
}

export function listProofs(db, options) {
  let proofs = [..._proofs.values()];
  if (options && options.circuitId) {
    proofs = proofs.filter((p) => p.circuitId === options.circuitId);
  }
  return proofs;
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _circuits.clear();
  _proofs.clear();
  _verificationKeys.clear();
  _credentials.clear();
  _maxCircuitsPerCreator = ZKP_DEFAULT_MAX_CIRCUITS_PER_CREATOR;
  _proofExpiryMs = ZKP_DEFAULT_PROOF_EXPIRY_MS;
}

/* ──────────────────────────────────────────────────────────
 *  V2 — Phase 88 surface (strictly additive)
 * ────────────────────────────────────────────────────────── */

export const PROOF_SCHEME_V2 = PROOF_SCHEME;
export const CIRCUIT_STATUS_V2 = CIRCUIT_STATUS;

export const PROOF_STATUS_V2 = Object.freeze({
  PENDING: "pending",
  VERIFIED: "verified",
  INVALID: "invalid",
  EXPIRED: "expired",
});

export const ZKP_DEFAULT_MAX_CIRCUITS_PER_CREATOR = 10;
export const ZKP_DEFAULT_PROOF_EXPIRY_MS = 3600_000; // 1h

let _maxCircuitsPerCreator = ZKP_DEFAULT_MAX_CIRCUITS_PER_CREATOR;
let _proofExpiryMs = ZKP_DEFAULT_PROOF_EXPIRY_MS;

const CIRCUIT_TRANSITIONS_V2 = new Map([
  ["draft", new Set(["compiled", "failed"])],
  ["compiled", new Set(["verified", "failed"])],
]);
const CIRCUIT_TERMINALS_V2 = new Set(["verified", "failed"]);

const PROOF_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["verified", "invalid", "expired"])],
]);
const PROOF_TERMINALS_V2 = new Set(["verified", "invalid", "expired"]);

/* ── Config ────────────────────────────────────────────── */

export function setMaxCircuitsPerCreator(n) {
  if (typeof n !== "number" || Number.isNaN(n) || n < 1) {
    throw new Error("maxCircuitsPerCreator must be a positive integer");
  }
  _maxCircuitsPerCreator = Math.floor(n);
}

export function getMaxCircuitsPerCreator() {
  return _maxCircuitsPerCreator;
}

export function getCircuitCountByCreator(creator) {
  if (!creator) return 0;
  let count = 0;
  for (const c of _circuits.values()) {
    if (c.creator === creator) count += 1;
  }
  return count;
}

export function setProofExpiryMs(ms) {
  if (typeof ms !== "number" || Number.isNaN(ms) || ms < 1) {
    throw new Error("proofExpiryMs must be a positive integer");
  }
  _proofExpiryMs = Math.floor(ms);
}

export function getProofExpiryMs() {
  return _proofExpiryMs;
}

/* ── Circuit V2 ────────────────────────────────────────── */

export function compileCircuitV2(db, { name, definition, creator } = {}) {
  if (!name) throw new Error("name is required");
  if (creator) {
    const count = getCircuitCountByCreator(creator);
    if (count >= _maxCircuitsPerCreator) {
      throw new Error(
        `Max circuits per creator reached (${count}/${_maxCircuitsPerCreator})`,
      );
    }
  }
  const circuit = compileCircuit(db, name, definition);
  if (creator) {
    circuit.creator = creator;
  }
  return { ...circuit };
}

export function setCircuitStatusV2(db, circuitId, newStatus, patch = {}) {
  const circuit = _circuits.get(circuitId);
  if (!circuit) throw new Error(`Circuit not found: ${circuitId}`);
  if (!Object.values(CIRCUIT_STATUS_V2).includes(newStatus)) {
    throw new Error(`Unknown circuit status: ${newStatus}`);
  }
  const allowed = CIRCUIT_TRANSITIONS_V2.get(circuit.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${circuit.status} → ${newStatus}`);
  }
  circuit.status = newStatus;
  if (patch.errorMessage !== undefined)
    circuit.errorMessage = patch.errorMessage;
  db.prepare("UPDATE zkp_circuits SET status = ? WHERE id = ?").run(
    newStatus,
    circuitId,
  );
  return { ...circuit };
}

/* ── Proof V2 ──────────────────────────────────────────── */

export function generateProofV2(
  db,
  { circuitId, privateInputs, publicInputs, scheme } = {},
) {
  if (!circuitId) throw new Error("circuitId is required");
  const circuit = _circuits.get(circuitId);
  if (!circuit) throw new Error(`Circuit not found: ${circuitId}`);
  if (
    circuit.status !== CIRCUIT_STATUS.COMPILED &&
    circuit.status !== CIRCUIT_STATUS.VERIFIED
  ) {
    throw new Error(
      `Circuit not ready (status=${circuit.status}, must be compiled/verified)`,
    );
  }
  const proof = generateProof(db, circuitId, privateInputs, publicInputs, {
    scheme,
  });
  const stored = _proofs.get(proof.id);
  stored.status = PROOF_STATUS_V2.PENDING;
  stored.expiresAt = Date.now() + _proofExpiryMs;
  return { ...stored };
}

export function verifyProofV2(db, proofId) {
  const proof = _proofs.get(proofId);
  if (!proof) throw new Error(`Proof not found: ${proofId}`);
  const current = proof.status || PROOF_STATUS_V2.PENDING;
  if (PROOF_TERMINALS_V2.has(current)) {
    throw new Error(`Invalid transition: ${current} → verify (terminal)`);
  }
  if (proof.expiresAt && Date.now() > proof.expiresAt) {
    proof.status = PROOF_STATUS_V2.EXPIRED;
    db.prepare("UPDATE zkp_proofs SET verified = 0 WHERE id = ?").run(proofId);
    return { ...proof, valid: false, reason: "expired" };
  }
  const result = verifyProof(db, proofId);
  proof.status = result.valid
    ? PROOF_STATUS_V2.VERIFIED
    : PROOF_STATUS_V2.INVALID;
  return { ...proof, valid: result.valid };
}

export function failProof(db, proofId, { reason } = {}) {
  const proof = _proofs.get(proofId);
  if (!proof) throw new Error(`Proof not found: ${proofId}`);
  const current = proof.status || PROOF_STATUS_V2.PENDING;
  if (PROOF_TERMINALS_V2.has(current)) {
    throw new Error(`Invalid transition: ${current} → invalid (terminal)`);
  }
  proof.status = PROOF_STATUS_V2.INVALID;
  proof.verified = false;
  if (reason !== undefined) proof.errorMessage = reason;
  db.prepare("UPDATE zkp_proofs SET verified = 0 WHERE id = ?").run(proofId);
  return { ...proof };
}

export function setProofStatus(db, proofId, newStatus, patch = {}) {
  const proof = _proofs.get(proofId);
  if (!proof) throw new Error(`Proof not found: ${proofId}`);
  if (!Object.values(PROOF_STATUS_V2).includes(newStatus)) {
    throw new Error(`Unknown proof status: ${newStatus}`);
  }
  const current = proof.status || PROOF_STATUS_V2.PENDING;
  const allowed = PROOF_TRANSITIONS_V2.get(current);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${current} → ${newStatus}`);
  }
  proof.status = newStatus;
  if (patch.errorMessage !== undefined) proof.errorMessage = patch.errorMessage;
  if (newStatus === PROOF_STATUS_V2.VERIFIED) {
    proof.verified = true;
    db.prepare("UPDATE zkp_proofs SET verified = 1 WHERE id = ?").run(proofId);
  } else {
    proof.verified = false;
    db.prepare("UPDATE zkp_proofs SET verified = 0 WHERE id = ?").run(proofId);
  }
  return { ...proof };
}

export function autoExpireProofs(db) {
  const now = Date.now();
  const expired = [];
  for (const proof of _proofs.values()) {
    const current = proof.status || PROOF_STATUS_V2.PENDING;
    if (PROOF_TERMINALS_V2.has(current)) continue;
    if (proof.expiresAt && now > proof.expiresAt) {
      proof.status = PROOF_STATUS_V2.EXPIRED;
      proof.verified = false;
      db.prepare("UPDATE zkp_proofs SET verified = 0 WHERE id = ?").run(
        proof.id,
      );
      expired.push({ ...proof });
    }
  }
  return expired;
}

/* ── Selective Disclosure V2 ───────────────────────────── */

export function selectiveDiscloseV2(
  db,
  { credentialId, disclosedFields, requiredFields, recipientDid } = {},
) {
  if (!credentialId) throw new Error("credentialId is required");
  if (!Array.isArray(disclosedFields)) {
    throw new Error("disclosedFields must be an array");
  }
  const credential = _credentials.get(credentialId);
  if (!credential) throw new Error(`Credential not found: ${credentialId}`);
  if (Array.isArray(requiredFields)) {
    for (const f of requiredFields) {
      if (!disclosedFields.includes(f)) {
        throw new Error(`Required field missing from disclosure: ${f}`);
      }
      if (!(f in credential.claims)) {
        throw new Error(`Required field not in credential: ${f}`);
      }
    }
  }
  return selectiveDisclose(db, credentialId, disclosedFields, recipientDid);
}

/* ── V2 Stats ──────────────────────────────────────────── */

export function getZKPStatsV2() {
  const circuitsByStatus = {};
  for (const s of Object.values(CIRCUIT_STATUS_V2)) circuitsByStatus[s] = 0;
  const proofsByStatus = {};
  for (const s of Object.values(PROOF_STATUS_V2)) proofsByStatus[s] = 0;
  const proofsByScheme = {};
  for (const s of Object.values(PROOF_SCHEME_V2)) proofsByScheme[s] = 0;

  for (const c of _circuits.values()) {
    circuitsByStatus[c.status] = (circuitsByStatus[c.status] || 0) + 1;
  }
  let verifiedCount = 0;
  let pendingCount = 0;
  for (const p of _proofs.values()) {
    const status = p.status || PROOF_STATUS_V2.PENDING;
    proofsByStatus[status] = (proofsByStatus[status] || 0) + 1;
    proofsByScheme[p.scheme] = (proofsByScheme[p.scheme] || 0) + 1;
    if (status === PROOF_STATUS_V2.VERIFIED) verifiedCount += 1;
    if (status === PROOF_STATUS_V2.PENDING) pendingCount += 1;
  }

  const credentialsByDid = {};
  for (const c of _credentials.values()) {
    const key = c.did || "_anonymous";
    credentialsByDid[key] = (credentialsByDid[key] || 0) + 1;
  }

  return {
    totalCircuits: _circuits.size,
    totalProofs: _proofs.size,
    totalCredentials: _credentials.size,
    verifiedProofs: verifiedCount,
    pendingProofs: pendingCount,
    maxCircuitsPerCreator: _maxCircuitsPerCreator,
    proofExpiryMs: _proofExpiryMs,
    circuitsByStatus,
    proofsByStatus,
    proofsByScheme,
    credentialsByDid,
  };
}
