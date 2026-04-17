import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureZKPTables,
  compileCircuit,
  generateProof,
  verifyProof,
  createIdentityProof,
  getZKPStats,
  listCircuits,
  listProofs,
  _resetState,
  PROOF_SCHEME,
  CIRCUIT_STATUS,
  setCircuitStatus,
  registerCredential,
  selectiveDisclose,
  listCredentials,
} from "../../src/lib/zkp-engine.js";

describe("zkp-engine", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureZKPTables(db);
  });

  // ─── ensureZKPTables ──────────────────────────────────────

  describe("ensureZKPTables", () => {
    it("creates zkp_circuits and zkp_proofs tables", () => {
      expect(db.tables.has("zkp_circuits")).toBe(true);
      expect(db.tables.has("zkp_proofs")).toBe(true);
    });

    it("is idempotent", () => {
      ensureZKPTables(db);
      ensureZKPTables(db);
      expect(db.tables.has("zkp_circuits")).toBe(true);
    });
  });

  // ─── compileCircuit ───────────────────────────────────────

  describe("compileCircuit", () => {
    it("compiles a circuit and returns metadata", () => {
      const circuit = compileCircuit(db, "age-check", {
        constraints: [{ type: "gte", field: "age", value: 18 }],
        inputs: ["age"],
        outputs: ["valid"],
      });
      expect(circuit.id).toBeDefined();
      expect(circuit.name).toBe("age-check");
      expect(circuit.constraints).toBe(1);
      expect(circuit.inputs).toEqual(["age"]);
      expect(circuit.outputs).toEqual(["valid"]);
      expect(circuit.verificationKey).toBeDefined();
      expect(circuit.compiled).toBeDefined();
    });

    it("handles string definition (JSON)", () => {
      const circuit = compileCircuit(
        db,
        "test",
        '{"constraints":[],"inputs":["x"]}',
      );
      expect(circuit.inputs).toEqual(["x"]);
    });

    it("handles invalid JSON string gracefully", () => {
      const circuit = compileCircuit(db, "broken", "not-json");
      // Falls back to empty constraints array → default constraint count is 1
      expect(circuit.constraints).toBe(1);
      expect(circuit.inputs).toEqual([]);
    });

    it("handles empty definition", () => {
      const circuit = compileCircuit(db, "empty", null);
      expect(circuit.name).toBe("empty");
    });

    it("persists circuit to database", () => {
      compileCircuit(db, "persist-test", {});
      const rows = db.data.get("zkp_circuits") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe("persist-test");
    });

    it("generates unique IDs for different circuits", () => {
      const c1 = compileCircuit(db, "circuit-a", {});
      const c2 = compileCircuit(db, "circuit-b", {});
      expect(c1.id).not.toBe(c2.id);
    });
  });

  // ─── generateProof ───────────────────────────────────────

  describe("generateProof", () => {
    it("generates a proof for a compiled circuit", () => {
      const circuit = compileCircuit(db, "test", {});
      const proof = generateProof(db, circuit.id, { secret: 42 }, [1, 2, 3]);
      expect(proof.id).toBeDefined();
      expect(proof.circuitId).toBe(circuit.id);
      expect(proof.scheme).toBe("groth16");
      expect(proof.proof.a).toBeDefined();
      expect(proof.proof.b).toBeDefined();
      expect(proof.proof.c).toBeDefined();
      expect(proof.publicInputs).toEqual([1, 2, 3]);
    });

    it("throws on unknown circuit", () => {
      expect(() => generateProof(db, "nonexistent", {}, [])).toThrow(
        "Circuit not found",
      );
    });

    it("defaults publicInputs to empty array", () => {
      const circuit = compileCircuit(db, "test", {});
      const proof = generateProof(db, circuit.id, {});
      expect(proof.publicInputs).toEqual([]);
    });

    it("persists proof to database", () => {
      const circuit = compileCircuit(db, "test", {});
      generateProof(db, circuit.id, {}, []);
      const rows = db.data.get("zkp_proofs") || [];
      expect(rows.length).toBe(1);
    });

    it("generates unique proof IDs", () => {
      const circuit = compileCircuit(db, "test", {});
      const p1 = generateProof(db, circuit.id, {}, []);
      const p2 = generateProof(db, circuit.id, {}, []);
      expect(p1.id).not.toBe(p2.id);
    });
  });

  // ─── verifyProof ──────────────────────────────────────────

  describe("verifyProof", () => {
    it("verifies a valid proof", () => {
      const circuit = compileCircuit(db, "test", {});
      const proof = generateProof(db, circuit.id, { x: 1 }, [1]);
      const result = verifyProof(db, proof.id);
      expect(result.valid).toBe(true);
      expect(result.proofId).toBe(proof.id);
      expect(result.circuitId).toBe(circuit.id);
      expect(result.scheme).toBe("groth16");
    });

    it("throws on unknown proof", () => {
      expect(() => verifyProof(db, "nonexistent")).toThrow("Proof not found");
    });

    it("updates verified status in memory", () => {
      const circuit = compileCircuit(db, "test", {});
      const proof = generateProof(db, circuit.id, {}, []);
      expect(proof.verified).toBe(false);
      verifyProof(db, proof.id);
      // Proof object in memory should now be verified
      const proofs = listProofs(db, {});
      const found = proofs.find((p) => p.id === proof.id);
      expect(found.verified).toBe(true);
    });
  });

  // ─── createIdentityProof ──────────────────────────────────

  describe("createIdentityProof", () => {
    it("discloses only specified fields", () => {
      const claims = { name: "Alice", age: 30, email: "alice@example.com" };
      const result = createIdentityProof(claims, ["name"]);
      expect(result.type).toBe("selective-disclosure");
      expect(result.disclosed).toEqual({ name: "Alice" });
      expect(result.hiddenCount).toBe(2);
      expect(result.commitment).toBeDefined();
    });

    it("hides all fields when no disclosure specified", () => {
      const claims = { name: "Bob", age: 25 };
      const result = createIdentityProof(claims, []);
      expect(result.disclosed).toEqual({});
      expect(result.hiddenCount).toBe(2);
    });

    it("discloses all fields when all specified", () => {
      const claims = { name: "Carol", age: 40 };
      const result = createIdentityProof(claims, ["name", "age"]);
      expect(result.disclosed).toEqual({ name: "Carol", age: 40 });
      expect(result.hiddenCount).toBe(0);
    });

    it("returns a unique ID", () => {
      const r1 = createIdentityProof({ a: 1 }, []);
      const r2 = createIdentityProof({ b: 2 }, []);
      expect(r1.id).not.toBe(r2.id);
    });

    it("throws on invalid claims", () => {
      expect(() => createIdentityProof(null, [])).toThrow(
        "Claims must be an object",
      );
    });

    it("generates commitment hash from all claims", () => {
      const claims = { x: 1, y: 2 };
      const result = createIdentityProof(claims, ["x"]);
      expect(typeof result.commitment).toBe("string");
      expect(result.commitment.length).toBe(64); // SHA-256 hex
    });
  });

  // ─── getZKPStats ──────────────────────────────────────────

  describe("getZKPStats", () => {
    it("returns zero counts initially", () => {
      const stats = getZKPStats();
      expect(stats.circuits).toBe(0);
      expect(stats.proofs).toBe(0);
      expect(stats.verifiedProofs).toBe(0);
    });

    it("counts circuits and proofs", () => {
      const c = compileCircuit(db, "test", {});
      generateProof(db, c.id, {}, []);
      generateProof(db, c.id, {}, []);
      const stats = getZKPStats();
      expect(stats.circuits).toBe(1);
      expect(stats.proofs).toBe(2);
      expect(stats.verifiedProofs).toBe(0);
    });

    it("counts verified proofs", () => {
      const c = compileCircuit(db, "test", {});
      const p = generateProof(db, c.id, {}, []);
      verifyProof(db, p.id);
      const stats = getZKPStats();
      expect(stats.verifiedProofs).toBe(1);
    });
  });

  // ─── listCircuits / listProofs ────────────────────────────

  describe("listCircuits", () => {
    it("returns empty array initially", () => {
      expect(listCircuits(db)).toEqual([]);
    });

    it("returns all compiled circuits", () => {
      compileCircuit(db, "a", {});
      compileCircuit(db, "b", {});
      expect(listCircuits(db).length).toBe(2);
    });
  });

  describe("listProofs", () => {
    it("returns empty array initially", () => {
      expect(listProofs(db, {})).toEqual([]);
    });

    it("filters proofs by circuitId", () => {
      const c1 = compileCircuit(db, "a", {});
      const c2 = compileCircuit(db, "b", {});
      generateProof(db, c1.id, {}, []);
      generateProof(db, c2.id, {}, []);
      generateProof(db, c1.id, {}, []);
      const filtered = listProofs(db, { circuitId: c1.id });
      expect(filtered.length).toBe(2);
    });

    it("returns all proofs when no filter", () => {
      const c = compileCircuit(db, "test", {});
      generateProof(db, c.id, {}, []);
      generateProof(db, c.id, {}, []);
      expect(listProofs(db, {}).length).toBe(2);
    });
  });

  // ─── Phase 88: frozen enums ───────────────────────────────

  describe("PROOF_SCHEME / CIRCUIT_STATUS", () => {
    it("PROOF_SCHEME is frozen", () => {
      expect(Object.isFrozen(PROOF_SCHEME)).toBe(true);
    });

    it("CIRCUIT_STATUS is frozen", () => {
      expect(Object.isFrozen(CIRCUIT_STATUS)).toBe(true);
    });

    it("PROOF_SCHEME contains spec values", () => {
      expect(PROOF_SCHEME.GROTH16).toBe("groth16");
      expect(PROOF_SCHEME.PLONK).toBe("plonk");
      expect(PROOF_SCHEME.BULLETPROOFS).toBe("bulletproofs");
    });

    it("CIRCUIT_STATUS contains spec values", () => {
      expect(CIRCUIT_STATUS.DRAFT).toBe("draft");
      expect(CIRCUIT_STATUS.COMPILED).toBe("compiled");
      expect(CIRCUIT_STATUS.VERIFIED).toBe("verified");
      expect(CIRCUIT_STATUS.FAILED).toBe("failed");
    });
  });

  // ─── Phase 88: circuit status ─────────────────────────────

  describe("circuit status", () => {
    it("compileCircuit sets status to COMPILED", () => {
      const c = compileCircuit(db, "test", {});
      expect(c.status).toBe(CIRCUIT_STATUS.COMPILED);
    });

    it("setCircuitStatus updates status", () => {
      const c = compileCircuit(db, "test", {});
      const result = setCircuitStatus(db, c.id, CIRCUIT_STATUS.VERIFIED);
      expect(result.status).toBe("verified");
    });

    it("setCircuitStatus rejects invalid status", () => {
      const c = compileCircuit(db, "test", {});
      expect(() => setCircuitStatus(db, c.id, "bogus")).toThrow(
        "Invalid circuit status",
      );
    });

    it("setCircuitStatus throws for unknown circuit", () => {
      expect(() =>
        setCircuitStatus(db, "unknown", CIRCUIT_STATUS.FAILED),
      ).toThrow("Circuit not found");
    });
  });

  // ─── Phase 88: scheme parameter on generateProof ──────────

  describe("generateProof scheme parameter", () => {
    it("defaults to GROTH16", () => {
      const c = compileCircuit(db, "t", {});
      const p = generateProof(db, c.id, {}, []);
      expect(p.scheme).toBe(PROOF_SCHEME.GROTH16);
      expect(typeof p.proof.a).toBe("string");
    });

    it("accepts PLONK scheme with correct proof shape", () => {
      const c = compileCircuit(db, "t", {});
      const p = generateProof(db, c.id, {}, [], { scheme: PROOF_SCHEME.PLONK });
      expect(p.scheme).toBe("plonk");
      expect(typeof p.proof.commitments).toBe("string");
      expect(typeof p.proof.evaluations).toBe("string");
    });

    it("accepts BULLETPROOFS scheme with correct proof shape", () => {
      const c = compileCircuit(db, "t", {});
      const p = generateProof(db, c.id, {}, [], {
        scheme: PROOF_SCHEME.BULLETPROOFS,
      });
      expect(p.scheme).toBe("bulletproofs");
      expect(typeof p.proof.V).toBe("string");
      expect(typeof p.proof.A).toBe("string");
    });

    it("rejects unsupported scheme", () => {
      const c = compileCircuit(db, "t", {});
      expect(() =>
        generateProof(db, c.id, {}, [], { scheme: "snark-v9000" }),
      ).toThrow("Unsupported proof scheme");
    });

    it("verifyProof validates PLONK proof structure", () => {
      const c = compileCircuit(db, "t", {});
      const p = generateProof(db, c.id, {}, [], { scheme: PROOF_SCHEME.PLONK });
      const r = verifyProof(db, p.id);
      expect(r.valid).toBe(true);
      expect(r.scheme).toBe("plonk");
    });

    it("verifyProof validates BULLETPROOFS proof structure", () => {
      const c = compileCircuit(db, "t", {});
      const p = generateProof(db, c.id, {}, [], {
        scheme: PROOF_SCHEME.BULLETPROOFS,
      });
      expect(verifyProof(db, p.id).valid).toBe(true);
    });
  });

  // ─── Phase 88: credentials + selectiveDisclose ────────────

  describe("registerCredential", () => {
    it("registers a credential with merkle root", () => {
      const cred = registerCredential(db, {
        did: "did:example:alice",
        claims: { name: "Alice", age: 30, country: "US" },
      });
      expect(cred.id).toBeDefined();
      expect(cred.did).toBe("did:example:alice");
      expect(typeof cred.merkleRoot).toBe("string");
      expect(cred.merkleRoot.length).toBe(64);
    });

    it("produces deterministic merkle root for same claims", () => {
      const a = registerCredential(db, { claims: { x: 1, y: 2 } });
      const b = registerCredential(db, { claims: { y: 2, x: 1 } });
      expect(a.merkleRoot).toBe(b.merkleRoot);
    });

    it("differs for different claims", () => {
      const a = registerCredential(db, { claims: { x: 1 } });
      const b = registerCredential(db, { claims: { x: 2 } });
      expect(a.merkleRoot).not.toBe(b.merkleRoot);
    });

    it("throws on invalid claims", () => {
      expect(() => registerCredential(db, { claims: null })).toThrow(
        "Claims must be an object",
      );
    });

    it("accepts credentials without DID", () => {
      const cred = registerCredential(db, { claims: { a: 1 } });
      expect(cred.did).toBeNull();
    });
  });

  describe("selectiveDisclose", () => {
    it("discloses only the requested fields", () => {
      const cred = registerCredential(db, {
        did: "did:example:alice",
        claims: { name: "Alice", age: 30, country: "US", ssn: "XXX" },
      });
      const result = selectiveDisclose(db, cred.id, ["name", "country"]);
      expect(result.disclosed).toEqual({ name: "Alice", country: "US" });
      expect(result.hiddenCount).toBe(2);
      expect(result.hiddenFields.sort()).toEqual(["age", "ssn"]);
    });

    it("preserves the credential's merkle root", () => {
      const cred = registerCredential(db, {
        claims: { a: 1, b: 2, c: 3 },
      });
      const result = selectiveDisclose(db, cred.id, ["a"]);
      expect(result.merkleRoot).toBe(cred.merkleRoot);
    });

    it("includes recipient DID when provided", () => {
      const cred = registerCredential(db, { claims: { x: 1 } });
      const result = selectiveDisclose(db, cred.id, ["x"], "did:example:bob");
      expect(result.recipientDid).toBe("did:example:bob");
    });

    it("throws for unknown credential", () => {
      expect(() => selectiveDisclose(db, "missing", ["x"])).toThrow(
        "Credential not found",
      );
    });

    it("throws when disclosedFields is not an array", () => {
      const cred = registerCredential(db, { claims: { x: 1 } });
      expect(() => selectiveDisclose(db, cred.id, "x")).toThrow(
        "disclosedFields must be an array",
      );
    });

    it("returns type selective-disclosure", () => {
      const cred = registerCredential(db, { claims: { x: 1 } });
      const result = selectiveDisclose(db, cred.id, []);
      expect(result.type).toBe("selective-disclosure");
    });

    it("empty disclosedFields hides everything", () => {
      const cred = registerCredential(db, {
        claims: { a: 1, b: 2, c: 3 },
      });
      const result = selectiveDisclose(db, cred.id, []);
      expect(Object.keys(result.disclosed).length).toBe(0);
      expect(result.hiddenCount).toBe(3);
    });
  });

  describe("listCredentials", () => {
    it("returns empty array initially", () => {
      expect(listCredentials(db)).toEqual([]);
    });

    it("returns all credentials", () => {
      registerCredential(db, { claims: { x: 1 } });
      registerCredential(db, { claims: { y: 2 } });
      expect(listCredentials(db).length).toBe(2);
    });

    it("filters by DID", () => {
      registerCredential(db, { did: "a", claims: { x: 1 } });
      registerCredential(db, { did: "b", claims: { y: 2 } });
      registerCredential(db, { did: "a", claims: { z: 3 } });
      expect(listCredentials(db, { did: "a" }).length).toBe(2);
    });
  });

  // ─── Phase 88: stats extensions ───────────────────────────

  describe("getZKPStats Phase 88 fields", () => {
    it("includes proofsByScheme breakdown", () => {
      const c = compileCircuit(db, "t", {});
      generateProof(db, c.id, {}, [], { scheme: PROOF_SCHEME.GROTH16 });
      generateProof(db, c.id, {}, [], { scheme: PROOF_SCHEME.PLONK });
      generateProof(db, c.id, {}, [], { scheme: PROOF_SCHEME.PLONK });
      const stats = getZKPStats();
      expect(stats.proofsByScheme.groth16).toBe(1);
      expect(stats.proofsByScheme.plonk).toBe(2);
      expect(stats.proofsByScheme.bulletproofs).toBe(0);
    });

    it("includes circuitsByStatus breakdown", () => {
      const c1 = compileCircuit(db, "t1", {});
      compileCircuit(db, "t2", {});
      setCircuitStatus(db, c1.id, CIRCUIT_STATUS.VERIFIED);
      const stats = getZKPStats();
      expect(stats.circuitsByStatus.compiled).toBe(1);
      expect(stats.circuitsByStatus.verified).toBe(1);
    });

    it("counts credentials", () => {
      registerCredential(db, { claims: { x: 1 } });
      registerCredential(db, { claims: { y: 2 } });
      expect(getZKPStats().credentials).toBe(2);
    });
  });
});
