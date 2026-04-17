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
}
