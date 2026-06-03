/**
 * Integration test — Crypto & Privacy Computing cross-module flows
 *
 * Covers end-to-end flows:
 *   1. ZKP: compile circuit → generate proof → verify proof (full lifecycle)
 *   2. Privacy: federated train → submit updates → aggregate → export
 *   3. MPC + DP combined: secret computation with differential privacy noise
 *   4. ZKP identity proof with selective disclosure workflow
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { ZKPEngine, FIELD_PRIME, hashToField } =
  await import("../../src/main/crypto/zkp-engine.js");
const { PrivacyComputing, SHAMIR_PRIME, lagrangeInterpolate, laplaceNoise } =
  await import("../../src/main/crypto/privacy-computing.js");

function createMockDb() {
  return {
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
  };
}

describe("Crypto & Privacy Integration", () => {
  let zkp, pc, db;

  beforeEach(async () => {
    db = createMockDb();
    zkp = new ZKPEngine();
    pc = new PrivacyComputing();
    await zkp.initialize(db);
    await pc.initialize(db);
  });

  // ── ZKP Full Lifecycle ──────────────────────────────────────────────────
  describe("ZKP full lifecycle", () => {
    it("compile → prove → verify for a multiplication circuit", async () => {
      // Step 1: Compile
      const circuit = zkp.compileCircuit("mul-lifecycle", {
        constraints: [{ a: { x: 1 }, b: { y: 1 }, c: { z: 1 } }],
        inputs: ["x", "y"],
        outputs: ["z"],
      });
      expect(circuit.compiled).toBe(true);

      // Step 2: Generate proof
      const proof = await zkp.generateProof(
        circuit.id,
        { x: 7, y: 13, z: 91 },
        { x: 7 },
      );
      expect(proof.proof.pi_a).toBeTruthy();

      // Step 3: Verify
      const result = zkp.verifyProof(proof.id);
      expect(result.valid).toBe(true);

      // Step 4: Stats reflect the work
      const stats = zkp.getStats();
      expect(stats.circuits).toBe(1);
      expect(stats.proofs).toBe(1);
      expect(stats.verifiedProofs).toBe(1);
    });

    it("multi-constraint chained circuit end-to-end", async () => {
      // (x * y = m) AND (m + z = out)  →  out = x*y + z
      // Using R1CS: a*b=c format, we need:
      //   Constraint 1: x * y = m
      //   Constraint 2: m * one = m  (identity, so we can use m+z=out differently)
      // Actually for addition we need: (m + z) * 1 = out
      // R1CS: { a: {m:1, z:1}, b: {one:1}, c: {out:1} }
      const circuit = zkp.compileCircuit("chain", {
        constraints: [
          { a: { x: 1 }, b: { y: 1 }, c: { m: 1 } },
          { a: { m: 1, z: 1 }, b: { one: 1 }, c: { out: 1 } },
        ],
        inputs: ["x", "y", "z"],
        outputs: ["out"],
      });

      // x=3, y=4, m=12, z=5, out=17
      const proof = await zkp.generateProof(
        circuit.id,
        { x: 3, y: 4, z: 5, m: 12, out: 17 },
        { x: 3, z: 5 },
      );

      const result = zkp.verifyProof(proof.id);
      expect(result.valid).toBe(true);
    });

    it("tampered proof fails verification", async () => {
      const circuit = zkp.compileCircuit("tamper-test", {
        constraints: [{ a: { x: 1 }, b: { y: 1 }, c: { z: 1 } }],
        inputs: ["x", "y"],
        outputs: ["z"],
      });

      const proof = await zkp.generateProof(
        circuit.id,
        { x: 5, y: 6, z: 30 },
        {},
      );

      // Tamper
      const stored = zkp._proofs.get(proof.id);
      stored.proof.pi_c = "999";

      expect(zkp.verifyProof(proof.id).valid).toBe(false);
    });
  });

  // ── Federated Learning Full Lifecycle ───────────────────────────────────
  describe("Federated Learning full lifecycle", () => {
    it("train → submit updates → aggregate → complete", async () => {
      const events = [];
      pc.on("privacy:training-started", (e) => events.push(["started", e]));
      pc.on("privacy:round-aggregated", (e) => events.push(["aggregated", e]));

      // Step 1: Start training
      const model = await pc.federatedTrain("fl-int", {
        name: "integration-model",
        participants: 3,
        rounds: 2,
      });
      expect(model.status).toBe("training");

      // Step 2: All participants submit for round 1
      pc.submitUpdate("fl-int", "p1", {
        gradients: [1.0, 2.0, 3.0],
        sampleCount: 100,
      });
      pc.submitUpdate("fl-int", "p2", {
        gradients: [2.0, 3.0, 4.0],
        sampleCount: 200,
      });
      const r1 = pc.submitUpdate("fl-int", "p3", {
        gradients: [3.0, 4.0, 5.0],
        sampleCount: 100,
      });

      expect(r1.aggregated).toBe(true);
      expect(r1.round).toBe(1);
      // Weighted average: (1*100+2*200+3*100)/400=2.0, (2*100+3*200+4*100)/400=3.0, etc.
      expect(r1.globalWeights[0]).toBeCloseTo(2.0);
      expect(r1.globalWeights[1]).toBeCloseTo(3.0);

      // Step 3: Round 2
      pc.submitUpdate("fl-int", "p1", {
        gradients: [0.5, 1.0, 1.5],
        sampleCount: 100,
      });
      pc.submitUpdate("fl-int", "p2", {
        gradients: [0.5, 1.0, 1.5],
        sampleCount: 100,
      });
      const r2 = pc.submitUpdate("fl-int", "p3", {
        gradients: [0.5, 1.0, 1.5],
        sampleCount: 100,
      });

      expect(r2.status).toBe("completed");
      expect(r2.round).toBe(2);

      // Step 4: Export
      const exported = pc.exportModel("fl-int");
      expect(exported).toBeTruthy();
      expect(exported.exportedAt).toBeTruthy();

      // Verify events
      expect(events.length).toBeGreaterThanOrEqual(3); // 1 started + 2 aggregated
    });
  });

  // ── MPC + DP Combined ──────────────────────────────────────────────────
  describe("MPC computation then DP publish", () => {
    it("compute secret sum then publish with differential privacy", async () => {
      // Step 1: MPC secret sum
      const mpcResult = await pc.mpcCompute(
        "sum",
        [{ id: "alice" }, { id: "bob" }, { id: "carol" }],
        [50000, 60000, 70000],
      );
      expect(mpcResult.result.value).toBeCloseTo(180000, -1);

      // Step 2: Publish with DP noise
      const dpResult = await pc.dpPublish(mpcResult.result.value, {
        epsilon: 0.5,
        sensitivity: 1000,
      });
      expect(dpResult.noiseAdded).toBe(true);
      expect(typeof dpResult.noisyData).toBe("number");
      // Should be in reasonable range of 180000 (noise scale = 1000/0.5 = 2000)
      expect(Math.abs(dpResult.noisyData - 180000)).toBeLessThan(50000);

      // Budget tracked
      expect(pc._privacyBudgetUsed).toBeCloseTo(0.5);
    });
  });

  // ── ZKP Identity + Selective Disclosure ─────────────────────────────────
  describe("ZKP identity workflow", () => {
    it("create identity proof → selective disclosure → commitment integrity", () => {
      const claims = {
        name: "Alice",
        age: 30,
        email: "alice@example.com",
        role: "admin",
      };

      // Step 1: Initial proof with partial disclosure
      const proof = zkp.createIdentityProof(claims, ["name", "age"]);
      expect(proof.disclosed).toEqual({ name: "Alice", age: 30 });
      expect(proof.hiddenCount).toBe(2);
      expect(proof.commitment).toBeTruthy();

      // Step 2: Selective disclosure of additional fields
      const additional = zkp.selectiveDisclose(proof.id, ["role"]);
      expect(additional.additionalDisclosed).toEqual(["role"]);

      // Step 3: Different hidden fields produce different commitments
      const proof2 = zkp.createIdentityProof(
        { ...claims, email: "different@example.com" },
        ["name", "age"],
      );
      expect(proof2.commitment).not.toBe(proof.commitment);

      // Step 4: Same claims produce same commitment
      const proof3 = zkp.createIdentityProof(claims, ["name"]);
      expect(proof3.commitment).toBe(proof.commitment); // Same full claims
    });
  });

  // ── Shamir Secret Sharing Correctness ───────────────────────────────────
  describe("Shamir secret sharing correctness", () => {
    it("reconstructs from any threshold-sized subset", () => {
      const secret = BigInt(12345678);
      const threshold = 3;
      const n = 7;
      const shares = pc._shamirSplit(secret, threshold, n);

      // Try multiple subsets
      const subsets = [
        [0, 1, 2],
        [2, 4, 6],
        [1, 3, 5],
        [0, 3, 6],
      ];

      for (const indices of subsets) {
        const subset = indices.map((i) => shares[i]);
        const reconstructed = lagrangeInterpolate(subset, SHAMIR_PRIME);
        expect(reconstructed).toBe(secret);
      }
    });
  });
});
