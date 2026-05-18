/**
 * Privacy Computing Unit Tests
 *
 * Covers:
 * - Laplace noise generation
 * - Shamir Secret Sharing (split + reconstruct via Lagrange interpolation)
 * - Federated Learning (FedAvg aggregation, round progression)
 * - MPC computation (sum, average, max, min)
 * - Differential Privacy (noise injection, budget tracking)
 * - Homomorphic Encryption (simulation)
 * - Configuration and reporting
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { PrivacyComputing, SHAMIR_PRIME, lagrangeInterpolate, laplaceNoise } =
  await import("../../../src/main/crypto/privacy-computing.js");

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

describe("Privacy Computing", () => {
  let pc;

  beforeEach(async () => {
    pc = new PrivacyComputing();
    await pc.initialize(mockDb);
  });

  // ── Laplace Noise ───────────────────────────────────────────────────────
  describe("laplaceNoise()", () => {
    it("returns a number", () => {
      const noise = laplaceNoise(1.0);
      expect(typeof noise).toBe("number");
      expect(Number.isFinite(noise)).toBe(true);
    });

    it("produces different values on repeated calls", () => {
      const samples = new Set();
      for (let i = 0; i < 20; i++) {
        samples.add(laplaceNoise(1.0));
      }
      expect(samples.size).toBeGreaterThan(1);
    });

    it("noise magnitude scales with scale parameter", () => {
      const smallNoise = [];
      const largeNoise = [];
      for (let i = 0; i < 200; i++) {
        smallNoise.push(Math.abs(laplaceNoise(0.01)));
        largeNoise.push(Math.abs(laplaceNoise(10.0)));
      }
      const smallMean =
        smallNoise.reduce((a, b) => a + b, 0) / smallNoise.length;
      const largeMean =
        largeNoise.reduce((a, b) => a + b, 0) / largeNoise.length;
      expect(largeMean).toBeGreaterThan(smallMean * 5);
    });
  });

  // ── Shamir Secret Sharing ───────────────────────────────────────────────
  describe("Shamir Secret Sharing", () => {
    it("SHAMIR_PRIME is a large 128-bit prime", () => {
      expect(SHAMIR_PRIME).toBeGreaterThan(BigInt(2) ** BigInt(100));
    });

    it("splits and reconstructs a secret via Lagrange interpolation", () => {
      const secret = BigInt(42000);
      const threshold = 3;
      const n = 5;
      const shares = pc._shamirSplit(secret, threshold, n);

      expect(shares.length).toBe(n);
      // Reconstruct from threshold shares
      const reconstructed = lagrangeInterpolate(
        shares.slice(0, threshold),
        SHAMIR_PRIME,
      );
      expect(reconstructed).toBe(secret);
    });

    it("reconstructs from any subset of threshold shares", () => {
      const secret = BigInt(99999);
      const threshold = 3;
      const n = 5;
      const shares = pc._shamirSplit(secret, threshold, n);

      // Use shares [1, 3, 4] instead of [0, 1, 2]
      const subset = [shares[1], shares[3], shares[4]];
      const reconstructed = lagrangeInterpolate(subset, SHAMIR_PRIME);
      expect(reconstructed).toBe(secret);
    });

    it("fails to reconstruct with fewer than threshold shares", () => {
      const secret = BigInt(12345);
      const threshold = 3;
      const n = 5;
      const shares = pc._shamirSplit(secret, threshold, n);

      const reconstructed = lagrangeInterpolate(
        shares.slice(0, 2),
        SHAMIR_PRIME,
      );
      expect(reconstructed).not.toBe(secret);
    });
  });

  // ── Federated Learning ──────────────────────────────────────────────────
  describe("federatedTrain()", () => {
    it("creates a federated model with correct initial state", async () => {
      const model = await pc.federatedTrain("fl-1", {
        name: "test-model",
        participants: 3,
        rounds: 5,
      });

      expect(model.id).toBe("fl-1");
      expect(model.type).toBe("federated");
      expect(model.status).toBe("training");
      expect(model.participants).toBe(3);
      expect(model.rounds).toBe(5);
      expect(model.currentRound).toBe(0);
    });

    it("persists model to database", async () => {
      await pc.federatedTrain("fl-db", { name: "db-model" });
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO privacy_models"),
      );
    });

    it("emits privacy:training-started event", async () => {
      const handler = vi.fn();
      pc.on("privacy:training-started", handler);
      await pc.federatedTrain("fl-evt", {});
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: "fl-evt" }),
      );
    });
  });

  describe("submitUpdate()", () => {
    it("collects updates from participants", async () => {
      await pc.federatedTrain("fl-u1", { participants: 3 });
      const result = pc.submitUpdate("fl-u1", "p1", {
        gradients: [0.1, 0.2, 0.3],
        sampleCount: 10,
      });

      expect(result.pendingCount).toBe(1);
      expect(result.participantsNeeded).toBe(3);
    });

    it("throws for unknown model", () => {
      expect(() =>
        pc.submitUpdate("ghost", "p1", { gradients: [1], sampleCount: 1 }),
      ).toThrow("not found");
    });

    it("throws for non-training model", async () => {
      const model = await pc.federatedTrain("fl-done", {
        participants: 1,
        rounds: 1,
      });
      // Submit to complete the round and model
      pc.submitUpdate("fl-done", "p1", { gradients: [1.0], sampleCount: 1 });
      // Model should now be completed
      expect(() =>
        pc.submitUpdate("fl-done", "p2", { gradients: [1.0], sampleCount: 1 }),
      ).toThrow("not in training");
    });

    it("auto-aggregates when all participants submit", async () => {
      await pc.federatedTrain("fl-agg", { participants: 2, rounds: 5 });

      pc.submitUpdate("fl-agg", "p1", {
        gradients: [1.0, 2.0],
        sampleCount: 10,
      });
      const result = pc.submitUpdate("fl-agg", "p2", {
        gradients: [3.0, 4.0],
        sampleCount: 10,
      });

      expect(result.aggregated).toBe(true);
      expect(result.round).toBe(1);
      // Equal sample counts → simple average
      expect(result.globalWeights[0]).toBeCloseTo(2.0);
      expect(result.globalWeights[1]).toBeCloseTo(3.0);
    });

    it("performs weighted average based on sample count", async () => {
      await pc.federatedTrain("fl-wt", { participants: 2, rounds: 5 });

      // p1: 90 samples, gradients [10], p2: 10 samples, gradients [0]
      pc.submitUpdate("fl-wt", "p1", { gradients: [10.0], sampleCount: 90 });
      const result = pc.submitUpdate("fl-wt", "p2", {
        gradients: [0.0],
        sampleCount: 10,
      });

      // Weighted avg: (10*90 + 0*10) / 100 = 9.0
      expect(result.globalWeights[0]).toBeCloseTo(9.0);
    });

    it("completes model after all rounds", async () => {
      await pc.federatedTrain("fl-complete", { participants: 1, rounds: 2 });

      pc.submitUpdate("fl-complete", "p1", {
        gradients: [1.0],
        sampleCount: 1,
      });
      expect(pc.getModelStatus("fl-complete").status).toBe("training");

      const result = pc.submitUpdate("fl-complete", "p1", {
        gradients: [2.0],
        sampleCount: 1,
      });
      expect(result.status).toBe("completed");
    });
  });

  // ── MPC Computation ─────────────────────────────────────────────────────
  describe("mpcCompute()", () => {
    it("computes sum of secret inputs", async () => {
      const result = await pc.mpcCompute(
        "sum",
        [{ id: "a" }, { id: "b" }, { id: "c" }],
        [10, 20, 30],
      );

      expect(result.type).toBe("mpc");
      expect(result.operation).toBe("sum");
      expect(result.result.value).toBeCloseTo(60, 0);
      expect(result.status).toBe("completed");
    });

    it("computes average of secret inputs", async () => {
      const result = await pc.mpcCompute(
        "average",
        [{ id: "a" }, { id: "b" }],
        [100, 200],
      );

      expect(result.result.value).toBeCloseTo(150, 0);
    });

    it("computes max of inputs", async () => {
      const result = await pc.mpcCompute(
        "max",
        [{ id: "a" }, { id: "b" }, { id: "c" }],
        [5, 99, 42],
      );

      expect(result.result.value).toBe(99);
    });

    it("computes min of inputs", async () => {
      const result = await pc.mpcCompute(
        "min",
        [{ id: "a" }, { id: "b" }],
        [7, 3],
      );

      expect(result.result.value).toBe(3);
    });

    it("requires at least 2 parties", async () => {
      await expect(pc.mpcCompute("sum", [{ id: "a" }], [10])).rejects.toThrow(
        "at least 2 parties",
      );
    });

    it("requires matching inputs and parties", async () => {
      await expect(
        pc.mpcCompute("sum", [{ id: "a" }, { id: "b" }], [10]),
      ).rejects.toThrow("exactly one input");
    });

    it("throws for unknown operation", async () => {
      await expect(
        pc.mpcCompute("multiply", [{ id: "a" }, { id: "b" }], [1, 2]),
      ).rejects.toThrow("Unknown MPC operation");
    });

    it("emits privacy:mpc-completed event", async () => {
      const handler = vi.fn();
      pc.on("privacy:mpc-completed", handler);
      await pc.mpcCompute("sum", [{ id: "a" }, { id: "b" }], [1, 2]);
      expect(handler).toHaveBeenCalled();
    });

    it("has information-theoretic privacy guarantee", async () => {
      const result = await pc.mpcCompute(
        "sum",
        [{ id: "a" }, { id: "b" }],
        [1, 2],
      );
      expect(result.privacyGuarantee).toBe("information-theoretic");
    });
  });

  // ── Differential Privacy ────────────────────────────────────────────────
  describe("dpPublish()", () => {
    it("adds noise to a single number", async () => {
      const result = await pc.dpPublish(100, {
        epsilon: 1.0,
        sensitivity: 1.0,
      });

      expect(result.type).toBe("differential-privacy");
      expect(typeof result.noisyData).toBe("number");
      expect(result.noisyData).not.toBe(100); // noise should change it (very unlikely to be exact)
      expect(result.noiseAdded).toBe(true);
      expect(result.epsilon).toBe(1.0);
    });

    it("adds noise to an array of numbers", async () => {
      const data = [10, 20, 30, 40, 50];
      const result = await pc.dpPublish(data, {
        epsilon: 0.5,
        sensitivity: 1.0,
      });

      expect(Array.isArray(result.noisyData)).toBe(true);
      expect(result.noisyData.length).toBe(5);
      expect(result.originalSize).toBe(5);

      // At least some values should differ
      const changed = result.noisyData.filter((v, i) => v !== data[i]);
      expect(changed.length).toBeGreaterThan(0);
    });

    it("does not add noise to non-numeric values in array", async () => {
      const data = [10, "text", 30];
      const result = await pc.dpPublish(data, { epsilon: 1.0 });

      expect(result.noisyData[1]).toBe("text");
      expect(typeof result.noisyData[0]).toBe("number");
      expect(typeof result.noisyData[2]).toBe("number");
    });

    it("tracks cumulative privacy budget", async () => {
      await pc.dpPublish(1, { epsilon: 0.5 });
      await pc.dpPublish(2, { epsilon: 0.3 });

      expect(pc._privacyBudgetUsed).toBeCloseTo(0.8);

      const report = pc.getPrivacyReport();
      expect(report.privacyBudgetUsed).toBeCloseTo(0.8);
    });

    it("uses config defaults when options not provided", async () => {
      pc.configure({ epsilon: 2.0 });
      const result = await pc.dpPublish(100);
      expect(result.epsilon).toBe(2.0);
    });

    it("emits privacy:dp-published event", async () => {
      const handler = vi.fn();
      pc.on("privacy:dp-published", handler);
      await pc.dpPublish(42);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ epsilon: 1.0 }),
      );
    });

    it("passes through non-numeric scalar data unchanged", async () => {
      const result = await pc.dpPublish("hello");
      expect(result.noisyData).toBe("hello");
    });
  });

  // ── Homomorphic Encryption (simulation) ─────────────────────────────────
  describe("heQuery()", () => {
    it("returns simulated HE query result", async () => {
      const result = await pc.heQuery("encrypted-data", "SELECT SUM(salary)");

      expect(result.type).toBe("homomorphic");
      expect(result.computedOnEncrypted).toBe(true);
      expect(result.decryptionRequired).toBe(true);
    });

    it("emits privacy:he-query-completed event", async () => {
      const handler = vi.fn();
      pc.on("privacy:he-query-completed", handler);
      await pc.heQuery("data", "query");
      expect(handler).toHaveBeenCalled();
    });
  });

  // ── Reports & Config ────────────────────────────────────────────────────
  describe("getPrivacyReport()", () => {
    it("returns correct counts", async () => {
      await pc.federatedTrain("r-model", {});
      await pc.dpPublish(1);

      const report = pc.getPrivacyReport();
      expect(report.models).toBe(1);
      expect(report.computations).toBe(1);
      expect(report.config).toBeTruthy();
    });
  });

  describe("configure()", () => {
    it("updates config values", () => {
      const result = pc.configure({ epsilon: 2.0, noiseScale: 0.5 });
      expect(result.epsilon).toBe(2.0);
      expect(result.noiseScale).toBe(0.5);
      expect(result.delta).toBe(1e-5); // unchanged
    });
  });

  describe("getModelStatus()", () => {
    it("returns model for known ID", async () => {
      await pc.federatedTrain("ms-1", { name: "status-test" });
      const status = pc.getModelStatus("ms-1");
      expect(status).toBeTruthy();
      expect(status.name).toBe("status-test");
    });

    it("returns null for unknown ID", () => {
      expect(pc.getModelStatus("ghost")).toBeNull();
    });
  });

  describe("exportModel()", () => {
    it("exports model with timestamp", async () => {
      await pc.federatedTrain("ex-1", { name: "export-test" });
      const exported = pc.exportModel("ex-1");
      expect(exported).toBeTruthy();
      expect(exported.exportedAt).toBeTruthy();
      expect(exported.name).toBe("export-test");
    });

    it("returns null for unknown model", () => {
      expect(pc.exportModel("ghost")).toBeNull();
    });
  });

  // ── Initialization ──────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("creates database tables", async () => {
      const freshPc = new PrivacyComputing();
      await freshPc.initialize(mockDb);
      expect(mockDb.exec).toHaveBeenCalled();
    });

    it("is idempotent", async () => {
      const freshDb = {
        exec: vi.fn(),
        prepare: vi.fn(() => ({
          run: vi.fn(),
          get: vi.fn(),
          all: vi.fn(() => []),
        })),
      };
      const freshPc = new PrivacyComputing();
      await freshPc.initialize(freshDb);
      await freshPc.initialize(freshDb);
      expect(freshDb.exec).toHaveBeenCalledTimes(1);
    });
  });
});
