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
  // V2 surface
  PROOF_SCHEME_V2,
  CIRCUIT_STATUS_V2,
  PROOF_STATUS_V2,
  ZKP_DEFAULT_MAX_CIRCUITS_PER_CREATOR,
  ZKP_DEFAULT_PROOF_EXPIRY_MS,
  setMaxCircuitsPerCreator,
  getMaxCircuitsPerCreator,
  getCircuitCountByCreator,
  setProofExpiryMs,
  getProofExpiryMs,
  compileCircuitV2,
  setCircuitStatusV2,
  generateProofV2,
  verifyProofV2,
  failProof,
  setProofStatus,
  autoExpireProofs,
  selectiveDiscloseV2,
  getZKPStatsV2,
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

  // ─── Phase 88 V2 ──────────────────────────────────────────

  describe("V2 frozen enums", () => {
    it("PROOF_SCHEME_V2 aliases legacy PROOF_SCHEME", () => {
      expect(PROOF_SCHEME_V2).toBe(PROOF_SCHEME);
      expect(Object.isFrozen(PROOF_SCHEME_V2)).toBe(true);
    });

    it("CIRCUIT_STATUS_V2 aliases legacy CIRCUIT_STATUS", () => {
      expect(CIRCUIT_STATUS_V2).toBe(CIRCUIT_STATUS);
      expect(Object.isFrozen(CIRCUIT_STATUS_V2)).toBe(true);
    });

    it("PROOF_STATUS_V2 has 4 explicit states", () => {
      expect(Object.isFrozen(PROOF_STATUS_V2)).toBe(true);
      expect(Object.values(PROOF_STATUS_V2).sort()).toEqual([
        "expired",
        "invalid",
        "pending",
        "verified",
      ]);
    });

    it("default constants are exposed", () => {
      expect(ZKP_DEFAULT_MAX_CIRCUITS_PER_CREATOR).toBe(10);
      expect(ZKP_DEFAULT_PROOF_EXPIRY_MS).toBe(3600_000);
    });
  });

  describe("setMaxCircuitsPerCreator", () => {
    it("defaults to ZKP_DEFAULT_MAX_CIRCUITS_PER_CREATOR", () => {
      expect(getMaxCircuitsPerCreator()).toBe(
        ZKP_DEFAULT_MAX_CIRCUITS_PER_CREATOR,
      );
    });

    it("accepts positive integer", () => {
      setMaxCircuitsPerCreator(5);
      expect(getMaxCircuitsPerCreator()).toBe(5);
    });

    it("floors non-integer inputs", () => {
      setMaxCircuitsPerCreator(3.7);
      expect(getMaxCircuitsPerCreator()).toBe(3);
    });

    it("rejects ≤0 / NaN / non-number", () => {
      expect(() => setMaxCircuitsPerCreator(0)).toThrow();
      expect(() => setMaxCircuitsPerCreator(-1)).toThrow();
      expect(() => setMaxCircuitsPerCreator(NaN)).toThrow();
      expect(() => setMaxCircuitsPerCreator("5")).toThrow();
    });

    it("_resetState restores default", () => {
      setMaxCircuitsPerCreator(99);
      _resetState();
      ensureZKPTables(db);
      expect(getMaxCircuitsPerCreator()).toBe(
        ZKP_DEFAULT_MAX_CIRCUITS_PER_CREATOR,
      );
    });
  });

  describe("getCircuitCountByCreator", () => {
    it("returns 0 for unknown creator", () => {
      expect(getCircuitCountByCreator("did:alice")).toBe(0);
      expect(getCircuitCountByCreator(null)).toBe(0);
    });

    it("counts circuits scoped per creator", () => {
      compileCircuitV2(db, { name: "a", creator: "did:alice" });
      compileCircuitV2(db, { name: "b", creator: "did:alice" });
      compileCircuitV2(db, { name: "c", creator: "did:bob" });
      expect(getCircuitCountByCreator("did:alice")).toBe(2);
      expect(getCircuitCountByCreator("did:bob")).toBe(1);
    });
  });

  describe("setProofExpiryMs", () => {
    it("defaults to ZKP_DEFAULT_PROOF_EXPIRY_MS", () => {
      expect(getProofExpiryMs()).toBe(ZKP_DEFAULT_PROOF_EXPIRY_MS);
    });

    it("accepts positive ms", () => {
      setProofExpiryMs(60_000);
      expect(getProofExpiryMs()).toBe(60_000);
    });

    it("rejects ≤0 / NaN", () => {
      expect(() => setProofExpiryMs(0)).toThrow();
      expect(() => setProofExpiryMs(-1)).toThrow();
      expect(() => setProofExpiryMs(NaN)).toThrow();
      expect(() => setProofExpiryMs("60000")).toThrow();
    });
  });

  describe("compileCircuitV2", () => {
    it("throws on missing name", () => {
      expect(() => compileCircuitV2(db, {})).toThrow(/name is required/);
    });

    it("creates a circuit and tags creator", () => {
      const c = compileCircuitV2(db, {
        name: "age",
        definition: { inputs: ["age"] },
        creator: "did:alice",
      });
      expect(c.id).toBeDefined();
      expect(c.creator).toBe("did:alice");
    });

    it("creates anonymous circuit (no creator)", () => {
      const c = compileCircuitV2(db, { name: "x" });
      expect(c.id).toBeDefined();
      expect(c.creator).toBeUndefined();
    });

    it("enforces per-creator cap", () => {
      setMaxCircuitsPerCreator(2);
      compileCircuitV2(db, { name: "a", creator: "did:alice" });
      compileCircuitV2(db, { name: "b", creator: "did:alice" });
      expect(() =>
        compileCircuitV2(db, { name: "c", creator: "did:alice" }),
      ).toThrow(/Max circuits per creator reached/);
    });

    it("cap is per-creator — alice's cap does not affect bob", () => {
      setMaxCircuitsPerCreator(1);
      compileCircuitV2(db, { name: "a", creator: "did:alice" });
      expect(() =>
        compileCircuitV2(db, { name: "b", creator: "did:bob" }),
      ).not.toThrow();
    });
  });

  describe("setCircuitStatusV2", () => {
    it("rejects unknown circuit", () => {
      expect(() => setCircuitStatusV2(db, "nonexistent", "verified")).toThrow(
        /not found/,
      );
    });

    it("rejects unknown status", () => {
      const c = compileCircuitV2(db, { name: "t" });
      expect(() => setCircuitStatusV2(db, c.id, "garbage")).toThrow(
        /Unknown circuit status/,
      );
    });

    it("rejects invalid transition (verified → compiled)", () => {
      const c = compileCircuitV2(db, { name: "t" });
      setCircuitStatusV2(db, c.id, CIRCUIT_STATUS.VERIFIED);
      expect(() =>
        setCircuitStatusV2(db, c.id, CIRCUIT_STATUS.COMPILED),
      ).toThrow(/Invalid transition/);
    });

    it("patches errorMessage on failed", () => {
      const c = compileCircuitV2(db, { name: "t" });
      const updated = setCircuitStatusV2(db, c.id, CIRCUIT_STATUS.FAILED, {
        errorMessage: "compile failed",
      });
      expect(updated.status).toBe(CIRCUIT_STATUS.FAILED);
      expect(updated.errorMessage).toBe("compile failed");
    });
  });

  describe("generateProofV2", () => {
    it("throws on missing circuitId", () => {
      expect(() => generateProofV2(db, {})).toThrow(/circuitId is required/);
    });

    it("throws on unknown circuit", () => {
      expect(() => generateProofV2(db, { circuitId: "nonexistent" })).toThrow(
        /Circuit not found/,
      );
    });

    it("rejects circuit not in compiled/verified state", () => {
      const c = compileCircuitV2(db, { name: "t" });
      setCircuitStatusV2(db, c.id, CIRCUIT_STATUS.FAILED, {
        errorMessage: "x",
      });
      expect(() => generateProofV2(db, { circuitId: c.id })).toThrow(
        /not ready/,
      );
    });

    it("stamps pending status and expiresAt", () => {
      setProofExpiryMs(60_000);
      const c = compileCircuitV2(db, { name: "t" });
      const before = Date.now();
      const proof = generateProofV2(db, { circuitId: c.id });
      expect(proof.status).toBe(PROOF_STATUS_V2.PENDING);
      expect(proof.expiresAt).toBeGreaterThanOrEqual(before + 60_000 - 10);
      expect(proof.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000 + 10);
    });
  });

  describe("verifyProofV2", () => {
    it("throws on unknown proof", () => {
      expect(() => verifyProofV2(db, "nonexistent")).toThrow(/not found/);
    });

    it("transitions pending → verified on success", () => {
      const c = compileCircuitV2(db, { name: "t" });
      const proof = generateProofV2(db, { circuitId: c.id });
      const result = verifyProofV2(db, proof.id);
      expect(result.valid).toBe(true);
      expect(result.status).toBe(PROOF_STATUS_V2.VERIFIED);
    });

    it("auto-expires a proof past its deadline", () => {
      setProofExpiryMs(1);
      const c = compileCircuitV2(db, { name: "t" });
      const proof = generateProofV2(db, { circuitId: c.id });
      // force expiry
      proof.expiresAt = Date.now() - 1000;
      const stored = listProofs(db).find((p) => p.id === proof.id);
      stored.expiresAt = Date.now() - 1000;
      const result = verifyProofV2(db, proof.id);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("expired");
      expect(result.status).toBe(PROOF_STATUS_V2.EXPIRED);
    });

    it("rejects re-verifying terminal proof", () => {
      const c = compileCircuitV2(db, { name: "t" });
      const proof = generateProofV2(db, { circuitId: c.id });
      verifyProofV2(db, proof.id);
      expect(() => verifyProofV2(db, proof.id)).toThrow(/terminal/);
    });
  });

  describe("failProof", () => {
    it("transitions non-terminal → invalid", () => {
      const c = compileCircuitV2(db, { name: "t" });
      const proof = generateProofV2(db, { circuitId: c.id });
      const failed = failProof(db, proof.id, { reason: "bad inputs" });
      expect(failed.status).toBe(PROOF_STATUS_V2.INVALID);
      expect(failed.errorMessage).toBe("bad inputs");
    });

    it("rejects terminal proof", () => {
      const c = compileCircuitV2(db, { name: "t" });
      const proof = generateProofV2(db, { circuitId: c.id });
      failProof(db, proof.id);
      expect(() => failProof(db, proof.id)).toThrow(/terminal/);
    });
  });

  describe("setProofStatus", () => {
    it("rejects unknown status", () => {
      const c = compileCircuitV2(db, { name: "t" });
      const proof = generateProofV2(db, { circuitId: c.id });
      expect(() => setProofStatus(db, proof.id, "garbage")).toThrow(
        /Unknown proof status/,
      );
    });

    it("rejects invalid transition", () => {
      const c = compileCircuitV2(db, { name: "t" });
      const proof = generateProofV2(db, { circuitId: c.id });
      setProofStatus(db, proof.id, PROOF_STATUS_V2.VERIFIED);
      expect(() =>
        setProofStatus(db, proof.id, PROOF_STATUS_V2.INVALID),
      ).toThrow(/Invalid transition/);
    });

    it("updates verified column on VERIFIED / INVALID", () => {
      const c = compileCircuitV2(db, { name: "t" });
      const proof = generateProofV2(db, { circuitId: c.id });
      const updated = setProofStatus(db, proof.id, PROOF_STATUS_V2.VERIFIED);
      expect(updated.verified).toBe(true);
    });
  });

  describe("autoExpireProofs", () => {
    it("bulk-flips past-deadline non-terminal proofs", () => {
      setProofExpiryMs(1);
      const c = compileCircuitV2(db, { name: "t" });
      const p1 = generateProofV2(db, { circuitId: c.id });
      const p2 = generateProofV2(db, { circuitId: c.id });
      // force both past deadline
      const all = listProofs(db);
      all.find((p) => p.id === p1.id).expiresAt = Date.now() - 100;
      all.find((p) => p.id === p2.id).expiresAt = Date.now() - 100;
      const expired = autoExpireProofs(db);
      expect(expired.length).toBe(2);
      expect(expired.every((p) => p.status === PROOF_STATUS_V2.EXPIRED)).toBe(
        true,
      );
    });

    it("skips already-terminal proofs", () => {
      const c = compileCircuitV2(db, { name: "t" });
      const p = generateProofV2(db, { circuitId: c.id });
      verifyProofV2(db, p.id);
      // force past deadline
      const stored = listProofs(db).find((x) => x.id === p.id);
      stored.expiresAt = Date.now() - 100;
      expect(autoExpireProofs(db)).toEqual([]);
    });
  });

  describe("selectiveDiscloseV2", () => {
    it("throws on missing credentialId", () => {
      expect(() => selectiveDiscloseV2(db, {})).toThrow(
        /credentialId is required/,
      );
    });

    it("throws on non-array disclosedFields", () => {
      expect(() =>
        selectiveDiscloseV2(db, {
          credentialId: "x",
          disclosedFields: "age",
        }),
      ).toThrow(/must be an array/);
    });

    it("enforces requiredFields (must be in disclosed)", () => {
      const cred = registerCredential(db, {
        claims: { age: 30, name: "alice", city: "nyc" },
      });
      expect(() =>
        selectiveDiscloseV2(db, {
          credentialId: cred.id,
          disclosedFields: ["name"],
          requiredFields: ["age"],
        }),
      ).toThrow(/Required field missing/);
    });

    it("passes when required fields are disclosed", () => {
      const cred = registerCredential(db, {
        claims: { age: 30, name: "alice" },
      });
      const disclosed = selectiveDiscloseV2(db, {
        credentialId: cred.id,
        disclosedFields: ["age", "name"],
        requiredFields: ["age"],
      });
      expect(disclosed.disclosed.age).toBe(30);
      expect(disclosed.disclosed.name).toBe("alice");
    });
  });

  describe("getZKPStatsV2", () => {
    it("zero-inits all enum keys when empty", () => {
      const stats = getZKPStatsV2();
      expect(stats.totalCircuits).toBe(0);
      expect(stats.totalProofs).toBe(0);
      expect(stats.totalCredentials).toBe(0);
      for (const s of Object.values(CIRCUIT_STATUS_V2)) {
        expect(stats.circuitsByStatus[s]).toBe(0);
      }
      for (const s of Object.values(PROOF_STATUS_V2)) {
        expect(stats.proofsByStatus[s]).toBe(0);
      }
      for (const s of Object.values(PROOF_SCHEME_V2)) {
        expect(stats.proofsByScheme[s]).toBe(0);
      }
      expect(stats.maxCircuitsPerCreator).toBe(
        ZKP_DEFAULT_MAX_CIRCUITS_PER_CREATOR,
      );
      expect(stats.proofExpiryMs).toBe(ZKP_DEFAULT_PROOF_EXPIRY_MS);
    });

    it("aggregates circuits/proofs/credentials correctly", () => {
      const c1 = compileCircuitV2(db, { name: "a", creator: "did:alice" });
      compileCircuitV2(db, { name: "b", creator: "did:bob" });
      setCircuitStatusV2(db, c1.id, CIRCUIT_STATUS.VERIFIED);
      const p1 = generateProofV2(db, { circuitId: c1.id });
      verifyProofV2(db, p1.id);
      generateProofV2(db, { circuitId: c1.id });
      registerCredential(db, { did: "did:alice", claims: { x: 1 } });
      registerCredential(db, { did: "did:alice", claims: { y: 2 } });
      registerCredential(db, { claims: { z: 3 } });

      const stats = getZKPStatsV2();
      expect(stats.totalCircuits).toBe(2);
      expect(stats.totalProofs).toBe(2);
      expect(stats.totalCredentials).toBe(3);
      expect(stats.verifiedProofs).toBe(1);
      expect(stats.pendingProofs).toBe(1);
      expect(stats.circuitsByStatus.verified).toBe(1);
      expect(stats.circuitsByStatus.compiled).toBe(1);
      expect(stats.proofsByStatus.verified).toBe(1);
      expect(stats.proofsByStatus.pending).toBe(1);
      expect(stats.credentialsByDid["did:alice"]).toBe(2);
      expect(stats.credentialsByDid._anonymous).toBe(1);
    });
  });
});
