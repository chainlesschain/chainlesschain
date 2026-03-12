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
});
