/**
 * FederatedLearningAggregator unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  FederatedLearningAggregator,
  AGGREGATION_METHOD,
  ROUND_STATUS,
} = require("../federated-learning-aggregator");

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue({ count: 0 }),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

describe("FederatedLearningAggregator", () => {
  let aggregator;
  let db;

  beforeEach(() => {
    aggregator = new FederatedLearningAggregator();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    aggregator.destroy();
  });

  // ============================================================
  // initialize()
  // ============================================================

  describe("initialize()", () => {
    it("should set initialized=true", async () => {
      await aggregator.initialize(db);
      expect(aggregator.initialized).toBe(true);
    });

    it("should accept dependencies", async () => {
      const flManager = { name: "mockManager" };
      const zkpEngine = { name: "mockZkp" };
      await aggregator.initialize(db, { flManager, zkpEngine });
      expect(aggregator._flManager).toBe(flManager);
      expect(aggregator._zkpEngine).toBe(zkpEngine);
    });

    it("should be idempotent — second call does nothing", async () => {
      await aggregator.initialize(db);
      const firstManager = aggregator._flManager;
      await aggregator.initialize(db, { flManager: { new: true } });
      expect(aggregator._flManager).toBe(firstManager);
    });
  });

  // ============================================================
  // aggregateRound()
  // ============================================================

  describe("aggregateRound()", () => {
    beforeEach(async () => {
      await aggregator.initialize(db);
    });

    it("should aggregate with fedavg by default", async () => {
      const gradients = new Map();
      gradients.set("did:agent-1", [1.0, 2.0, 3.0]);
      gradients.set("did:agent-2", [3.0, 4.0, 5.0]);

      const result = await aggregator.aggregateRound("task-1", 1, gradients);
      expect(result.aggregatedModel).toEqual([2.0, 3.0, 4.0]);
      expect(result.method).toBe("fedavg");
    });

    it("should return correct result structure", async () => {
      const gradients = new Map();
      gradients.set("did:agent-1", [1.0, 2.0]);
      gradients.set("did:agent-2", [3.0, 4.0]);

      const result = await aggregator.aggregateRound("task-1", 1, gradients);
      expect(result.taskId).toBe("task-1");
      expect(result.roundNumber).toBe(1);
      expect(result.status).toBe("completed");
      expect(result.metrics.participantCount).toBe(2);
      expect(typeof result.metrics.aggregationTimeMs).toBe("number");
    });

    it("should emit round:aggregated event", async () => {
      const handler = vi.fn();
      aggregator.on("round:aggregated", handler);

      const gradients = new Map();
      gradients.set("did:agent-1", [1.0]);
      gradients.set("did:agent-2", [3.0]);

      await aggregator.aggregateRound("task-1", 1, gradients);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1", roundNumber: 1 }),
      );
    });

    it("should record metrics", async () => {
      const gradients = new Map();
      gradients.set("did:agent-1", [1.0]);
      gradients.set("did:agent-2", [3.0]);

      await aggregator.aggregateRound("task-1", 1, gradients);
      const metrics = aggregator.getRoundStatus("task-1", 1);
      expect(metrics).not.toBeNull();
      expect(metrics.status).toBe(ROUND_STATUS.COMPLETED);
    });

    it("should handle single participant", async () => {
      const gradients = new Map();
      gradients.set("did:agent-1", [5.0, 10.0]);

      const result = await aggregator.aggregateRound("task-1", 1, gradients);
      expect(result.aggregatedModel).toEqual([5.0, 10.0]);
    });
  });

  // ============================================================
  // fedAvg()
  // ============================================================

  describe("fedAvg()", () => {
    it("should average correctly: [1,2]+[3,4]=[2,3]", () => {
      const gradients = new Map();
      gradients.set("a", [1.0, 2.0]);
      gradients.set("b", [3.0, 4.0]);

      const result = aggregator.fedAvg(gradients);
      expect(result).toEqual([2.0, 3.0]);
    });

    it("should handle three participants", () => {
      const gradients = new Map();
      gradients.set("a", [3.0, 6.0, 9.0]);
      gradients.set("b", [6.0, 9.0, 12.0]);
      gradients.set("c", [9.0, 12.0, 15.0]);

      const result = aggregator.fedAvg(gradients);
      expect(result).toEqual([6.0, 9.0, 12.0]);
    });

    it("should handle single gradient", () => {
      const gradients = new Map();
      gradients.set("a", [7.0, 8.0, 9.0]);

      const result = aggregator.fedAvg(gradients);
      expect(result).toEqual([7.0, 8.0, 9.0]);
    });
  });

  // ============================================================
  // addDifferentialPrivacy()
  // ============================================================

  describe("addDifferentialPrivacy()", () => {
    it("should clip values to [-clipNorm, clipNorm]", () => {
      const model = [5.0, -5.0, 0.5];
      const result = aggregator.addDifferentialPrivacy(model, 0, 1.0);
      // With 0 noise, result is just clipped
      expect(result[0]).toBeLessThanOrEqual(1.0);
      expect(result[1]).toBeGreaterThanOrEqual(-1.0);
      expect(result[2]).toBeCloseTo(0.5, 5);
    });

    it("should add noise — result differs from input", () => {
      const model = [1.0, 2.0, 3.0];
      const result = aggregator.addDifferentialPrivacy(model, 1.0, 10.0);
      // With noise multiplier > 0 it's extremely unlikely all values are identical
      const allSame = result.every(
        (v, i) => Math.abs(v - Math.max(-10, Math.min(10, model[i]))) < 1e-15,
      );
      expect(allSame).toBe(false);
    });

    it("should respect clipNorm bound before noise", () => {
      const model = [100.0, -100.0];
      // Use 0 noise to test pure clipping
      const result = aggregator.addDifferentialPrivacy(model, 0, 2.0);
      expect(result[0]).toBe(2.0);
      expect(result[1]).toBe(-2.0);
    });

    it("should produce bounded noise", () => {
      const model = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const result = aggregator.addDifferentialPrivacy(model, 0.01, 1.0);
      // With small noise multiplier, values should be small
      for (const v of result) {
        expect(Math.abs(v)).toBeLessThan(1.0);
      }
    });
  });

  // ============================================================
  // secureAggregate()
  // ============================================================

  describe("secureAggregate()", () => {
    it("should return averaged result", () => {
      const gradients = new Map();
      gradients.set("a", [2.0, 4.0]);
      gradients.set("b", [4.0, 6.0]);

      const result = aggregator.secureAggregate(gradients);
      // Masks cancel out, so result should be close to fedAvg
      expect(result[0]).toBeCloseTo(3.0, 5);
      expect(result[1]).toBeCloseTo(5.0, 5);
    });

    it("should produce result similar to fedAvg", () => {
      const gradients = new Map();
      gradients.set("a", [1.0, 2.0, 3.0]);
      gradients.set("b", [3.0, 4.0, 5.0]);
      gradients.set("c", [5.0, 6.0, 7.0]);

      const secureResult = aggregator.secureAggregate(gradients);
      const avgResult = aggregator.fedAvg(gradients);

      for (let i = 0; i < avgResult.length; i++) {
        expect(secureResult[i]).toBeCloseTo(avgResult[i], 5);
      }
    });

    it("should handle 2+ participants", () => {
      const gradients = new Map();
      gradients.set("a", [10.0]);
      gradients.set("b", [20.0]);
      gradients.set("c", [30.0]);

      const result = aggregator.secureAggregate(gradients);
      expect(result[0]).toBeCloseTo(20.0, 5);
    });
  });

  // ============================================================
  // getRoundStatus() / getMetrics()
  // ============================================================

  describe("getRoundStatus() / getMetrics()", () => {
    beforeEach(async () => {
      await aggregator.initialize(db);
    });

    it("should return round status after aggregation", async () => {
      const gradients = new Map();
      gradients.set("a", [1.0, 2.0]);
      gradients.set("b", [3.0, 4.0]);

      await aggregator.aggregateRound("task-1", 1, gradients);
      const status = aggregator.getRoundStatus("task-1", 1);
      expect(status).not.toBeNull();
      expect(status.status).toBe(ROUND_STATUS.COMPLETED);
      expect(status.participantCount).toBe(2);
    });

    it("should return all metrics for a task", async () => {
      const gradients = new Map();
      gradients.set("a", [1.0]);
      gradients.set("b", [2.0]);

      await aggregator.aggregateRound("task-1", 1, gradients);
      await aggregator.aggregateRound("task-1", 2, gradients);

      const metrics = aggregator.getMetrics("task-1");
      expect(metrics.length).toBe(2);
    });

    it("should return null for non-existent round", () => {
      const status = aggregator.getRoundStatus("no-task", 99);
      expect(status).toBeNull();
    });
  });

  // ============================================================
  // krum()
  // ============================================================

  describe("krum()", () => {
    it("should select gradient closest to others", () => {
      const gradients = new Map();
      gradients.set("a", [1.0, 1.0]);
      gradients.set("b", [1.1, 1.1]);
      gradients.set("c", [100.0, 100.0]); // outlier / byzantine

      const result = aggregator.krum(gradients, 1);
      // Should select a or b (close together), not c
      expect(result[0]).toBeLessThan(2.0);
      expect(result[1]).toBeLessThan(2.0);
    });

    it("should handle byzantine count parameter", () => {
      const gradients = new Map();
      gradients.set("a", [2.0, 2.0]);
      gradients.set("b", [2.1, 2.1]);
      gradients.set("c", [50.0, 50.0]);
      gradients.set("d", [51.0, 51.0]);

      const result = aggregator.krum(gradients, 2);
      // Should return one of the honest gradients
      expect(result).toBeDefined();
      expect(result.length).toBe(2);
    });
  });

  // ============================================================
  // getStats() / destroy()
  // ============================================================

  describe("getStats() / destroy()", () => {
    beforeEach(async () => {
      await aggregator.initialize(db);
    });

    it("should return correct stats after aggregations", async () => {
      const gradients = new Map();
      gradients.set("a", [1.0]);
      gradients.set("b", [2.0]);

      await aggregator.aggregateRound("task-1", 1, gradients);
      await aggregator.aggregateRound("task-1", 2, gradients);

      const stats = aggregator.getStats();
      expect(stats.totalAggregations).toBe(2);
      expect(stats.byMethod.fedavg).toBe(2);
      expect(typeof stats.avgAggregationTimeMs).toBe("number");
    });

    it("should clear state on destroy", async () => {
      const gradients = new Map();
      gradients.set("a", [1.0]);
      gradients.set("b", [2.0]);

      await aggregator.aggregateRound("task-1", 1, gradients);
      aggregator.destroy();

      expect(aggregator.initialized).toBe(false);
      const stats = aggregator.getStats();
      expect(stats.totalAggregations).toBe(0);
    });
  });
});
