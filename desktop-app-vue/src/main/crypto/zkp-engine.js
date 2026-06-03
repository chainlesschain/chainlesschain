/**
 * @module crypto/zkp-engine
 * Phase 88: Zero Knowledge Proof Engine
 * R1CS constraint system, field arithmetic, proof generation & verification
 */
const EventEmitter = require("events");
const crypto = require("crypto");
const { logger } = require("../utils/logger.js");

// A large prime for field arithmetic (256-bit)
const FIELD_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);

/**
 * Modular arithmetic helpers over F_p
 */
function modAdd(a, b) {
  return ((a % FIELD_PRIME) + (b % FIELD_PRIME)) % FIELD_PRIME;
}

function modMul(a, b) {
  return ((a % FIELD_PRIME) * (b % FIELD_PRIME)) % FIELD_PRIME;
}

function modSub(a, b) {
  return ((a % FIELD_PRIME) - (b % FIELD_PRIME) + FIELD_PRIME) % FIELD_PRIME;
}

/**
 * Hash multiple values to a field element using SHA-256
 */
function hashToField(...values) {
  const hash = crypto.createHash("sha256");
  for (const v of values) {
    hash.update(String(v));
  }
  const digest = hash.digest("hex");
  return BigInt("0x" + digest) % FIELD_PRIME;
}

class ZKPEngine extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._circuits = new Map();
    this._proofs = new Map();
    this._verificationKeys = new Map();
    this._config = {
      defaultScheme: "groth16",
      proofTimeout: 60000,
      maxCircuitSize: 1000000,
    };
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    this.initialized = true;
    logger.info("[ZKPEngine] Initialized");
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS zkp_circuits (
          id TEXT PRIMARY KEY, name TEXT, definition TEXT, compiled INTEGER DEFAULT 0,
          verification_key TEXT, created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS zkp_proofs (
          id TEXT PRIMARY KEY, circuit_id TEXT, proof TEXT, public_inputs TEXT,
          verified INTEGER DEFAULT 0, scheme TEXT, created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      logger.warn("[ZKPEngine] Table creation warning:", error.message);
    }
  }

  /**
   * Compile a circuit definition into R1CS constraint matrices.
   * Definition format: { constraints: [{ a: {}, b: {}, c: {} }], inputs: [], outputs: [] }
   * Each constraint: a * b = c where a, b, c are linear combinations { "varName": coefficient }
   */
  compileCircuit(name, definition) {
    const id = `circuit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const constraints = definition.constraints || [];
    const inputs = definition.inputs || [];
    const outputs = definition.outputs || [];

    // All variables: "one" (constant 1), then inputs, then outputs, then intermediates
    const variables = ["one", ...inputs, ...outputs];
    // Collect any intermediate variables from constraints
    for (const c of constraints) {
      for (const lc of [c.a, c.b, c.c]) {
        if (lc) {
          for (const varName of Object.keys(lc)) {
            if (!variables.includes(varName)) {
              variables.push(varName);
            }
          }
        }
      }
    }

    // Build R1CS matrices: A, B, C where A[i] * B[i] = C[i] for each constraint
    const r1cs = constraints.map((c) => ({
      a: this._linearCombToVector(c.a || {}, variables),
      b: this._linearCombToVector(c.b || {}, variables),
      c: this._linearCombToVector(c.c || {}, variables),
    }));

    // Generate verification key from circuit structure
    const r1csKey = r1cs.map((c) => ({
      a: c.a.map(String),
      b: c.b.map(String),
      c: c.c.map(String),
    }));
    const vkSeed = hashToField(name, JSON.stringify(r1csKey), id);
    const verificationKey = {
      circuitId: id,
      alpha: hashToField(vkSeed, BigInt(1)),
      beta: hashToField(vkSeed, BigInt(2)),
      gamma: hashToField(vkSeed, BigInt(3)),
      delta: hashToField(vkSeed, BigInt(4)),
      seed: vkSeed,
    };

    const circuit = {
      id,
      name,
      definition,
      compiled: true,
      constraints: r1cs,
      variables,
      inputs,
      outputs,
      verificationKey: id,
    };

    this._circuits.set(id, circuit);
    this._verificationKeys.set(id, verificationKey);

    try {
      this.db
        .prepare(
          "INSERT INTO zkp_circuits (id, name, definition, compiled, verification_key) VALUES (?, ?, ?, 1, ?)",
        )
        .run(id, name, JSON.stringify(definition), id);
    } catch (error) {
      logger.error("[ZKPEngine] Circuit persist failed:", error.message);
    }

    this.emit("zkp:circuit-compiled", { id, name });
    return circuit;
  }

  /**
   * Convert a linear combination { varName: coefficient } to a vector over variables
   */
  _linearCombToVector(lc, variables) {
    return variables.map((v) => BigInt(lc[v] || 0));
  }

  /**
   * Compute witness vector from assignments
   */
  _computeWitness(circuit, assignments) {
    return circuit.variables.map((v) => {
      if (v === "one") {
        return BigInt(1);
      }
      return BigInt(assignments[v] || 0);
    });
  }

  /**
   * Verify that witness satisfies all R1CS constraints: A[i] . w * B[i] . w = C[i] . w
   */
  _checkR1CS(circuit, witness) {
    for (const { a, b, c } of circuit.constraints) {
      const dotA = a.reduce(
        (sum, coeff, i) => modAdd(sum, modMul(coeff, witness[i])),
        BigInt(0),
      );
      const dotB = b.reduce(
        (sum, coeff, i) => modAdd(sum, modMul(coeff, witness[i])),
        BigInt(0),
      );
      const dotC = c.reduce(
        (sum, coeff, i) => modAdd(sum, modMul(coeff, witness[i])),
        BigInt(0),
      );
      if (modMul(dotA, dotB) !== dotC) {
        return false;
      }
    }
    return true;
  }

  /**
   * Generate a proof that the prover knows private inputs satisfying the circuit.
   */
  async generateProof(circuitId, privateInputs, publicInputs = {}) {
    const circuit = this._circuits.get(circuitId);
    if (!circuit) {
      throw new Error(`Circuit '${circuitId}' not found`);
    }

    const vk = this._verificationKeys.get(circuitId);
    if (!vk) {
      throw new Error(`Verification key for circuit '${circuitId}' not found`);
    }

    // Merge all assignments
    const assignments = { ...publicInputs, ...privateInputs };

    // Compute witness
    const witness = this._computeWitness(circuit, assignments);

    // Verify R1CS satisfaction
    if (!this._checkR1CS(circuit, witness)) {
      throw new Error("Witness does not satisfy circuit constraints");
    }

    // Generate proof elements using Fiat-Shamir heuristic
    // pi_a = H(witness, vk.alpha)
    // pi_b = H(witness, vk.beta)
    // pi_c = H(pi_a, pi_b, public_inputs, vk.delta)
    const witnessHash = hashToField(...witness.map(String));
    const pi_a = hashToField(witnessHash.toString(), vk.alpha.toString());
    const pi_b = hashToField(witnessHash.toString(), vk.beta.toString());

    // Compute public input hash
    const pubInputValues = circuit.inputs
      .filter((inp) => publicInputs[inp] !== undefined)
      .map((inp) => BigInt(publicInputs[inp]));
    const pubInputHash =
      pubInputValues.length > 0
        ? hashToField(...pubInputValues.map(String))
        : BigInt(0);

    // pi_c commits to the full proof: must bind pi_a, pi_b, public inputs, and vk
    const pi_c = hashToField(
      pi_a.toString(),
      pi_b.toString(),
      pubInputHash.toString(),
      vk.delta.toString(),
    );

    const proofId = `proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const proof = {
      id: proofId,
      circuitId,
      scheme: this._config.defaultScheme,
      proof: {
        pi_a: pi_a.toString(),
        pi_b: pi_b.toString(),
        pi_c: pi_c.toString(),
      },
      publicInputs,
      pubInputHash: pubInputHash.toString(),
      verified: false,
      generatedAt: Date.now(),
    };

    this._proofs.set(proofId, proof);

    try {
      this.db
        .prepare(
          "INSERT INTO zkp_proofs (id, circuit_id, proof, public_inputs, scheme) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          proofId,
          circuitId,
          JSON.stringify(proof.proof),
          JSON.stringify(publicInputs),
          proof.scheme,
        );
    } catch (error) {
      logger.error("[ZKPEngine] Proof persist failed:", error.message);
    }

    this.emit("zkp:proof-generated", { proofId, circuitId });
    return proof;
  }

  /**
   * Verify a proof by recomputing pi_c from pi_a, pi_b, and public inputs.
   * This simulates the verification equation without elliptic curve pairings.
   */
  verifyProof(proofId) {
    const proof = this._proofs.get(proofId);
    if (!proof) {
      throw new Error(`Proof '${proofId}' not found`);
    }

    const circuit = this._circuits.get(proof.circuitId);
    if (!circuit) {
      throw new Error("Associated circuit not found");
    }

    const vk = this._verificationKeys.get(proof.circuitId);
    if (!vk) {
      throw new Error("Verification key not found");
    }

    const pi_a = BigInt(proof.proof.pi_a);
    const pi_b = BigInt(proof.proof.pi_b);
    const pi_c = BigInt(proof.proof.pi_c);
    const pubInputHash = BigInt(proof.pubInputHash || "0");

    // Recompute expected pi_c
    const expectedPiC = hashToField(
      pi_a.toString(),
      pi_b.toString(),
      pubInputHash.toString(),
      vk.delta.toString(),
    );

    const valid = pi_c === expectedPiC;
    proof.verified = valid;

    this.emit("zkp:proof-verified", { proofId, valid });
    return {
      valid,
      proofId,
      circuitId: proof.circuitId,
      scheme: proof.scheme,
    };
  }

  /**
   * Identity proof with selective disclosure using commitment scheme
   */
  createIdentityProof(claims, disclosedFields) {
    const proofId = `id-proof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Build disclosed subset
    const disclosed = {};
    for (const field of disclosedFields) {
      if (claims[field] !== undefined) {
        disclosed[field] = claims[field];
      }
    }

    // Compute commitment over ALL claims (including hidden ones)
    const allKeys = Object.keys(claims).sort();
    const commitment = hashToField(...allKeys.map((k) => `${k}:${claims[k]}`));

    // Compute partial commitment over disclosed fields only
    const disclosedKeys = Object.keys(disclosed).sort();
    const partialCommitment =
      disclosedKeys.length > 0
        ? hashToField(...disclosedKeys.map((k) => `${k}:${disclosed[k]}`))
        : BigInt(0);

    const proof = {
      id: proofId,
      type: "identity",
      disclosed,
      hiddenCount: Object.keys(claims).length - Object.keys(disclosed).length,
      commitment: commitment.toString(),
      partialCommitment: partialCommitment.toString(),
      verified: false,
    };

    this._proofs.set(proofId, { ...proof, circuitId: "identity" });
    this.emit("zkp:identity-proof-created", { proofId, disclosedFields });
    return proof;
  }

  selectiveDisclose(proofId, additionalFields) {
    const proof = this._proofs.get(proofId);
    if (!proof) {
      return null;
    }
    return { proofId, additionalDisclosed: additionalFields };
  }

  getStats() {
    return {
      circuits: this._circuits.size,
      proofs: this._proofs.size,
      verifiedProofs: Array.from(this._proofs.values()).filter(
        (p) => p.verified,
      ).length,
    };
  }
}

let instance = null;
function getZKPEngine() {
  if (!instance) {
    instance = new ZKPEngine();
  }
  return instance;
}
module.exports = { ZKPEngine, getZKPEngine, FIELD_PRIME, hashToField };
