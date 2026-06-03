/**
 * ZKP Engine Unit Tests
 *
 * Covers:
 * - Field arithmetic (hashToField, FIELD_PRIME)
 * - Circuit compilation (R1CS generation, variable indexing)
 * - Proof generation (witness computation, Fiat-Shamir proof elements)
 * - Proof verification (pi_c recomputation, tamper detection)
 * - Identity proofs (selective disclosure, commitments)
 * - Error handling (missing circuit, invalid witness)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { ZKPEngine, FIELD_PRIME, hashToField } =
  await import("../../../src/main/crypto/zkp-engine.js");

// ─── Mock DB ─────────────────────────────────────────────────────────────────
let mockDb;
beforeEach(() => {
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
  };
});

describe("ZKP Engine", () => {
  let engine;

  beforeEach(async () => {
    engine = new ZKPEngine();
    await engine.initialize(mockDb);
  });

  // ── Field Arithmetic ─────────────────────────────────────────────────────
  describe("field arithmetic", () => {
    it("FIELD_PRIME is a large prime (BN254)", () => {
      expect(FIELD_PRIME).toBeGreaterThan(BigInt(2) ** BigInt(200));
    });

    it("hashToField returns a value in [0, FIELD_PRIME)", () => {
      const h = hashToField("hello", "world");
      expect(h).toBeGreaterThanOrEqual(BigInt(0));
      expect(h).toBeLessThan(FIELD_PRIME);
    });

    it("hashToField is deterministic", () => {
      const a = hashToField("test", "123");
      const b = hashToField("test", "123");
      expect(a).toBe(b);
    });

    it("hashToField is collision-resistant for different inputs", () => {
      const a = hashToField("a");
      const b = hashToField("b");
      expect(a).not.toBe(b);
    });
  });

  // ── Circuit Compilation ──────────────────────────────────────────────────
  describe("compileCircuit()", () => {
    it("compiles a simple multiplication circuit x * y = z", () => {
      const circuit = engine.compileCircuit("mul", {
        constraints: [{ a: { x: 1 }, b: { y: 1 }, c: { z: 1 } }],
        inputs: ["x", "y"],
        outputs: ["z"],
      });

      expect(circuit.id).toMatch(/^circuit-/);
      expect(circuit.compiled).toBe(true);
      expect(circuit.constraints.length).toBe(1);
      expect(circuit.variables).toContain("one");
      expect(circuit.variables).toContain("x");
      expect(circuit.variables).toContain("y");
      expect(circuit.variables).toContain("z");
    });

    it("generates unique verification key", () => {
      const c1 = engine.compileCircuit("c1", { constraints: [], inputs: [] });
      const c2 = engine.compileCircuit("c2", { constraints: [], inputs: [] });
      expect(c1.verificationKey).not.toBe(c2.verificationKey);
    });

    it("persists circuit to database", () => {
      engine.compileCircuit("persist-test", { constraints: [], inputs: [] });
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO zkp_circuits"),
      );
    });

    it("emits zkp:circuit-compiled event", () => {
      const handler = vi.fn();
      engine.on("zkp:circuit-compiled", handler);
      engine.compileCircuit("event-test", { constraints: [], inputs: [] });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ name: "event-test" }),
      );
    });
  });

  // ── Proof Generation ─────────────────────────────────────────────────────
  describe("generateProof()", () => {
    let circuitId;

    beforeEach(() => {
      // x * y = z circuit
      const circuit = engine.compileCircuit("mul", {
        constraints: [{ a: { x: 1 }, b: { y: 1 }, c: { z: 1 } }],
        inputs: ["x", "y"],
        outputs: ["z"],
      });
      circuitId = circuit.id;
    });

    it("generates proof for valid witness (3 * 5 = 15)", async () => {
      const proof = await engine.generateProof(
        circuitId,
        { x: 3, y: 5, z: 15 },
        { x: 3 },
      );

      expect(proof.id).toMatch(/^proof-/);
      expect(proof.circuitId).toBe(circuitId);
      expect(proof.scheme).toBe("groth16");
      expect(proof.proof.pi_a).toBeTruthy();
      expect(proof.proof.pi_b).toBeTruthy();
      expect(proof.proof.pi_c).toBeTruthy();
      // Proof elements are field element strings, not mock values
      expect(proof.proof.pi_a).not.toContain("mock");
    });

    it("throws for unknown circuit", async () => {
      await expect(engine.generateProof("nonexistent", {}, {})).rejects.toThrow(
        "not found",
      );
    });

    it("throws when witness doesn't satisfy constraints", async () => {
      await expect(
        engine.generateProof(circuitId, { x: 3, y: 5, z: 16 }, {}),
      ).rejects.toThrow("does not satisfy");
    });

    it("emits zkp:proof-generated event", async () => {
      const handler = vi.fn();
      engine.on("zkp:proof-generated", handler);
      await engine.generateProof(circuitId, { x: 2, y: 3, z: 6 }, {});
      expect(handler).toHaveBeenCalled();
    });

    it("persists proof to database", async () => {
      await engine.generateProof(circuitId, { x: 2, y: 3, z: 6 }, {});
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO zkp_proofs"),
      );
    });
  });

  // ── Proof Verification ───────────────────────────────────────────────────
  describe("verifyProof()", () => {
    let circuitId;

    beforeEach(() => {
      const circuit = engine.compileCircuit("mul", {
        constraints: [{ a: { x: 1 }, b: { y: 1 }, c: { z: 1 } }],
        inputs: ["x", "y"],
        outputs: ["z"],
      });
      circuitId = circuit.id;
    });

    it("verifies a valid proof", async () => {
      const proof = await engine.generateProof(
        circuitId,
        { x: 7, y: 11, z: 77 },
        { x: 7 },
      );
      const result = engine.verifyProof(proof.id);

      expect(result.valid).toBe(true);
      expect(result.proofId).toBe(proof.id);
      expect(result.circuitId).toBe(circuitId);
    });

    it("detects tampered pi_a", async () => {
      const proof = await engine.generateProof(
        circuitId,
        { x: 3, y: 5, z: 15 },
        {},
      );
      // Tamper with pi_a
      const stored = engine._proofs.get(proof.id);
      stored.proof.pi_a = "12345";

      const result = engine.verifyProof(proof.id);
      expect(result.valid).toBe(false);
    });

    it("detects tampered pi_c", async () => {
      const proof = await engine.generateProof(
        circuitId,
        { x: 3, y: 5, z: 15 },
        {},
      );
      const stored = engine._proofs.get(proof.id);
      stored.proof.pi_c = "99999";

      const result = engine.verifyProof(proof.id);
      expect(result.valid).toBe(false);
    });

    it("throws for unknown proof ID", () => {
      expect(() => engine.verifyProof("ghost")).toThrow("not found");
    });

    it("emits zkp:proof-verified event", async () => {
      const handler = vi.fn();
      engine.on("zkp:proof-verified", handler);
      const proof = await engine.generateProof(
        circuitId,
        { x: 2, y: 3, z: 6 },
        {},
      );
      engine.verifyProof(proof.id);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ valid: true }),
      );
    });

    it("different inputs produce different proofs", async () => {
      const p1 = await engine.generateProof(
        circuitId,
        { x: 2, y: 3, z: 6 },
        {},
      );
      const p2 = await engine.generateProof(
        circuitId,
        { x: 4, y: 5, z: 20 },
        {},
      );
      expect(p1.proof.pi_a).not.toBe(p2.proof.pi_a);
    });
  });

  // ── Identity Proofs ──────────────────────────────────────────────────────
  describe("createIdentityProof()", () => {
    it("creates proof with disclosed and hidden fields", () => {
      const proof = engine.createIdentityProof(
        { name: "Alice", age: 30, email: "alice@example.com" },
        ["name", "age"],
      );

      expect(proof.id).toMatch(/^id-proof-/);
      expect(proof.disclosed).toEqual({ name: "Alice", age: 30 });
      expect(proof.hiddenCount).toBe(1); // email hidden
      expect(proof.commitment).toBeTruthy();
      expect(proof.commitment).not.toBe("0");
    });

    it("commitment changes when hidden fields change", () => {
      const p1 = engine.createIdentityProof({ name: "Alice", secret: "aaa" }, [
        "name",
      ]);
      const p2 = engine.createIdentityProof({ name: "Alice", secret: "bbb" }, [
        "name",
      ]);
      expect(p1.commitment).not.toBe(p2.commitment);
    });

    it("handles empty disclosure", () => {
      const proof = engine.createIdentityProof({ a: 1 }, []);
      expect(Object.keys(proof.disclosed)).toHaveLength(0);
      expect(proof.hiddenCount).toBe(1);
    });
  });

  // ── selectiveDisclose ────────────────────────────────────────────────────
  describe("selectiveDisclose()", () => {
    it("returns additional disclosed fields", () => {
      const proof = engine.createIdentityProof({ a: 1, b: 2 }, ["a"]);
      const result = engine.selectiveDisclose(proof.id, ["b"]);
      expect(result.additionalDisclosed).toEqual(["b"]);
    });

    it("returns null for unknown proof", () => {
      expect(engine.selectiveDisclose("ghost", [])).toBeNull();
    });
  });

  // ── getStats ─────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    it("tracks circuit and proof counts", async () => {
      const c = engine.compileCircuit("stat-test", {
        constraints: [{ a: { x: 1 }, b: { y: 1 }, c: { z: 1 } }],
        inputs: ["x", "y"],
        outputs: ["z"],
      });
      await engine.generateProof(c.id, { x: 2, y: 3, z: 6 }, {});

      const stats = engine.getStats();
      expect(stats.circuits).toBe(1);
      expect(stats.proofs).toBe(1);
      expect(stats.verifiedProofs).toBe(0);
    });
  });

  // ── Multi-constraint circuit ─────────────────────────────────────────────
  describe("multi-constraint circuit", () => {
    it("handles circuit with 2 constraints: x*y=m, m*z=out", async () => {
      const circuit = engine.compileCircuit("chain-mul", {
        constraints: [
          { a: { x: 1 }, b: { y: 1 }, c: { m: 1 } },
          { a: { m: 1 }, b: { z: 1 }, c: { out: 1 } },
        ],
        inputs: ["x", "y", "z"],
        outputs: ["out"],
      });

      // x=2, y=3, m=6, z=4, out=24
      const proof = await engine.generateProof(
        circuit.id,
        { x: 2, y: 3, z: 4, m: 6, out: 24 },
        { x: 2 },
      );

      const result = engine.verifyProof(proof.id);
      expect(result.valid).toBe(true);
    });

    it("rejects incorrect intermediate value", async () => {
      const circuit = engine.compileCircuit("chain-mul-bad", {
        constraints: [
          { a: { x: 1 }, b: { y: 1 }, c: { m: 1 } },
          { a: { m: 1 }, b: { z: 1 }, c: { out: 1 } },
        ],
        inputs: ["x", "y", "z"],
        outputs: ["out"],
      });

      await expect(
        engine.generateProof(
          circuit.id,
          { x: 2, y: 3, z: 4, m: 7, out: 24 },
          {},
        ),
      ).rejects.toThrow("does not satisfy");
    });
  });
});
