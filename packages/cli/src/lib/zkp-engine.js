/**
 * ZKP Engine — Zero-knowledge proof circuit compilation, proof generation,
 * verification, and selective identity disclosure.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _circuits = new Map();
const _proofs = new Map();
const _verificationKeys = new Map();

const DEFAULT_SCHEME = "groth16";

/* ── Schema ────────────────────────────────────────────────── */

export function ensureZKPTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS zkp_circuits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      definition TEXT,
      compiled TEXT,
      verification_key TEXT,
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
    createdAt: now,
  };

  _circuits.set(id, circuit);
  _verificationKeys.set(id, verificationKey);

  db.prepare(
    `INSERT INTO zkp_circuits (id, name, definition, compiled, verification_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    JSON.stringify(parsed),
    JSON.stringify(compiled),
    verificationKey,
    now,
  );

  return circuit;
}

/* ── Proof Generation ──────────────────────────────────────── */

export function generateProof(db, circuitId, privateInputs, publicInputs) {
  const circuit = _circuits.get(circuitId);
  if (!circuit) throw new Error(`Circuit not found: ${circuitId}`);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Mock zk-SNARK proof with {a, b, c} components (Groth16 structure)
  const proofData = {
    a: crypto.randomBytes(32).toString("hex"),
    b: crypto.randomBytes(64).toString("hex"),
    c: crypto.randomBytes(32).toString("hex"),
  };

  const proof = {
    id,
    circuitId,
    scheme: DEFAULT_SCHEME,
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
    DEFAULT_SCHEME,
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

  // Mock verification — check proof structure is valid
  const valid =
    proof.proof &&
    typeof proof.proof.a === "string" &&
    typeof proof.proof.b === "string" &&
    typeof proof.proof.c === "string" &&
    _verificationKeys.has(proof.circuitId);

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

/* ── Stats ─────────────────────────────────────────────────── */

export function getZKPStats() {
  const proofList = [..._proofs.values()];
  return {
    circuits: _circuits.size,
    proofs: proofList.length,
    verifiedProofs: proofList.filter((p) => p.verified).length,
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
}
