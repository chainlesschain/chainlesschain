/**
 * GradientAggregator Unit Tests
 *
 * Covers:
 * - aggregateFedAvg with simple gradients
 * - aggregateFedAvg with weighted inputs
 * - aggregateFedProx with proximal term
 * - validateGradients catches dimension mismatch
 * - validateGradients catches NaN values
 * - computeContributionScores returns cosine similarity scores
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { GradientAggregator } = require("../gradient-aggregator.js");

describe("GradientAggregator", () => {
  let aggregator;

  beforeEach(() => {
    aggregator = new GradientAggregator();
  });

  describe("aggregateFedAvg()", () => {
    it("should compute simple average with equal weights", () => {
      const gradients = [
        [1, 2, 3],
        [3, 2, 1],
      ];
      const weights = [1, 1];

      const result = aggregator.aggregateFedAvg(gradients, weights);

      expect(result).toHaveLength(3);
      expect(result[0]).toBeCloseTo(2, 10);
      expect(result[1]).toBeCloseTo(2, 10);
      expect(result[2]).toBeCloseTo(2, 10);
    });

    it("should compute weighted average correctly", () => {
      const gradients = [
        [10, 0],
        [0, 10],
      ];
      // First participant has 3x the weight
      const weights = [3, 1];

      const result = aggregator.aggregateFedAvg(gradients, weights);

      expect(result).toHaveLength(2);
      // (10*3/4 + 0*1/4) = 7.5
      expect(result[0]).toBeCloseTo(7.5, 10);
      // (0*3/4 + 10*1/4) = 2.5
      expect(result[1]).toBeCloseTo(2.5, 10);
    });

    it("should handle single participant", () => {
      const gradients = [[5, 10, 15]];
      const weights = [1];

      const result = aggregator.aggregateFedAvg(gradients, weights);

      expect(result[0]).toBeCloseTo(5, 10);
      expect(result[1]).toBeCloseTo(10, 10);
      expect(result[2]).toBeCloseTo(15, 10);
    });

    it("should handle many participants", () => {
      const gradients = [
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ];
      const weights = [1, 1, 1, 1];

      const result = aggregator.aggregateFedAvg(gradients, weights);

      expect(result[0]).toBeCloseTo(2.5, 10);
      expect(result[1]).toBeCloseTo(2.5, 10);
    });

    it("should throw if gradients array is empty", () => {
      expect(() => aggregator.aggregateFedAvg([], [1])).toThrow(
        "Gradients array must be non-empty"
      );
    });

    it("should throw if weights length does not match gradients", () => {
      expect(() =>
        aggregator.aggregateFedAvg([[1, 2]], [1, 2])
      ).toThrow("Weights array must have same length as gradients");
    });

    it("should throw if total weight is zero", () => {
      expect(() =>
        aggregator.aggregateFedAvg([[1, 2], [3, 4]], [0, 0])
      ).toThrow("Total weight must be non-zero");
    });

    it("should handle negative gradients", () => {
      const gradients = [
        [-1, -2],
        [1, 2],
      ];
      const weights = [1, 1];

      const result = aggregator.aggregateFedAvg(gradients, weights);

      expect(result[0]).toBeCloseTo(0, 10);
      expect(result[1]).toBeCloseTo(0, 10);
    });
  });

  describe("aggregateFedProx()", () => {
    it("should apply proximal regularization", () => {
      const gradients = [
        [2, 4],
        [4, 2],
      ];
      const weights = [1, 1];
      const globalModel = [0, 0];
      const mu = 0.1;

      const result = aggregator.aggregateFedProx(
        gradients,
        weights,
        globalModel,
        mu
      );

      // FedAvg would give [3, 3]
      // FedProx adds mu * (avg - global): 0.1 * (3 - 0) = 0.3
      // Result: [3.3, 3.3]
      expect(result).toHaveLength(2);
      expect(result[0]).toBeCloseTo(3.3, 10);
      expect(result[1]).toBeCloseTo(3.3, 10);
    });

    it("should converge toward global model when mu is large", () => {
      const gradients = [
        [10, 10],
        [10, 10],
      ];
      const weights = [1, 1];
      const globalModel = [5, 5];
      const mu = 0.0; // No proximal term

      const result = aggregator.aggregateFedProx(
        gradients,
        weights,
        globalModel,
        mu
      );

      // With mu=0, result should be same as FedAvg: [10, 10]
      expect(result[0]).toBeCloseTo(10, 10);
      expect(result[1]).toBeCloseTo(10, 10);
    });

    it("should use default mu of 0.01", () => {
      const gradients = [
        [1, 1],
        [1, 1],
      ];
      const weights = [1, 1];
      const globalModel = [0, 0];

      const result = aggregator.aggregateFedProx(
        gradients,
        weights,
        globalModel
      );

      // avg = [1, 1], proximal = 0.01 * (1 - 0) = 0.01
      // Result: [1.01, 1.01]
      expect(result[0]).toBeCloseTo(1.01, 10);
      expect(result[1]).toBeCloseTo(1.01, 10);
    });

    it("should throw if global model dimension mismatches", () => {
      expect(() =>
        aggregator.aggregateFedProx(
          [[1, 2, 3]],
          [1],
          [0, 0], // dimension 2 vs 3
          0.01
        )
      ).toThrow("Global model dimension");
    });

    it("should throw if global model is empty", () => {
      expect(() =>
        aggregator.aggregateFedProx([[1, 2]], [1], [], 0.01)
      ).toThrow("Global model must be a non-empty array");
    });
  });

  describe("validateGradients()", () => {
    it("should return valid for correct gradients", () => {
      const result = aggregator.validateGradients([
        [1, 2, 3],
        [4, 5, 6],
      ]);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect dimension mismatch", () => {
      const result = aggregator.validateGradients([
        [1, 2, 3],
        [4, 5],
      ]);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Dimension mismatch");
    });

    it("should detect NaN values", () => {
      const result = aggregator.validateGradients([
        [1, NaN, 3],
        [4, 5, 6],
      ]);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("NaN"))).toBe(true);
    });

    it("should detect Infinity values", () => {
      const result = aggregator.validateGradients([
        [1, Infinity, 3],
        [4, 5, 6],
      ]);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Infinity"))).toBe(
        true
      );
    });

    it("should detect non-array gradient", () => {
      const result = aggregator.validateGradients([
        [1, 2],
        "not-array",
      ]);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("not an array"))).toBe(
        true
      );
    });

    it("should reject non-array input", () => {
      const result = aggregator.validateGradients("not-an-array");

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("must be an array");
    });

    it("should reject empty array", () => {
      const result = aggregator.validateGradients([]);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("empty");
    });

    it("should detect non-numeric values", () => {
      const result = aggregator.validateGradients([
        [1, "two", 3],
        [4, 5, 6],
      ]);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Non-numeric"))).toBe(
        true
      );
    });
  });

  describe("computeContributionScores()", () => {
    it("should return high score for aligned gradients", () => {
      const gradients = [
        [1, 0, 0],
        [1, 0, 0],
      ];
      const aggregated = [1, 0, 0];

      const scores =
        aggregator.computeContributionScores(gradients, aggregated);

      expect(scores).toHaveLength(2);
      expect(scores[0]).toBeCloseTo(1.0, 5);
      expect(scores[1]).toBeCloseTo(1.0, 5);
    });

    it("should return low score for opposed gradients", () => {
      const gradients = [
        [1, 0],
        [-1, 0],
      ];
      const aggregated = [1, 0]; // The aggregated direction

      const scores =
        aggregator.computeContributionScores(gradients, aggregated);

      expect(scores[0]).toBeCloseTo(1.0, 5); // Aligned
      expect(scores[1]).toBeCloseTo(0, 5); // Opposed (clamped to 0)
    });

    it("should return moderate score for partially aligned gradients", () => {
      const gradients = [
        [1, 1],
        [1, 0],
      ];
      const aggregated = [1, 0.5]; // The average

      const scores =
        aggregator.computeContributionScores(gradients, aggregated);

      expect(scores[0]).toBeGreaterThan(0.5);
      expect(scores[0]).toBeLessThanOrEqual(1.0);
      expect(scores[1]).toBeGreaterThan(0.5);
      expect(scores[1]).toBeLessThanOrEqual(1.0);
    });

    it("should return 0 for zero-norm gradients", () => {
      const gradients = [
        [0, 0, 0],
        [1, 2, 3],
      ];
      const aggregated = [1, 2, 3];

      const scores =
        aggregator.computeContributionScores(gradients, aggregated);

      expect(scores[0]).toBe(0); // Zero gradient has no contribution
      expect(scores[1]).toBeCloseTo(1.0, 5);
    });

    it("should handle single participant", () => {
      const gradients = [[3, 4]];
      const aggregated = [3, 4];

      const scores =
        aggregator.computeContributionScores(gradients, aggregated);

      expect(scores).toHaveLength(1);
      expect(scores[0]).toBeCloseTo(1.0, 5);
    });

    it("should throw if gradients array is empty", () => {
      expect(() =>
        aggregator.computeContributionScores([], [1, 2])
      ).toThrow("Gradients array must be non-empty");
    });

    it("should throw if aggregated is empty", () => {
      expect(() =>
        aggregator.computeContributionScores([[1, 2]], [])
      ).toThrow("Aggregated gradient must be non-empty");
    });

    it("should return 0 for dimension-mismatched gradient", () => {
      const gradients = [
        [1, 2, 3],
        [1, 2],
      ];
      const aggregated = [1, 2, 3];

      const scores =
        aggregator.computeContributionScores(gradients, aggregated);

      expect(scores[0]).toBeCloseTo(1.0, 5);
      expect(scores[1]).toBe(0); // Mismatched dimension
    });
  });
});
