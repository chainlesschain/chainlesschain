/**
 * AnomalyDetector 单元测试 — v3.3
 *
 * 覆盖：initialize、updateBaselines、ingestMetric（Z-Score/IQR/EWMA）、
 *       calibrateBaseline、getBaselines、getStats、getConfig
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const {
  AnomalyDetector,
  DETECTION_METHODS,
  ANOMALY_SEVERITY,
} = require("../anomaly-detector");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
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

function makeBaselineRow(overrides = {}) {
  return {
    metric_name: "error_rate",
    detection_method: "z-score",
    threshold: 3.0,
    window: "5m",
    params: JSON.stringify({ minSamples: 30 }),
    baseline_values: JSON.stringify({ mean: 5, std: 1, min: 2, max: 8 }),
    last_calibrated: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AnomalyDetector", () => {
  let detector;
  let db;

  beforeEach(() => {
    detector = new AnomalyDetector();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true and use DB via prepare", async () => {
      await detector.initialize(db);

      expect(detector.initialized).toBe(true);
      // _ensureTables uses db.prepare(), _loadBaselines also uses db.prepare()
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should load existing baselines from DB on startup", async () => {
      db._prep.all.mockReturnValue([makeBaselineRow()]);

      await detector.initialize(db);

      expect(detector._baselines.size).toBe(1);
      expect(detector._baselines.has("error_rate")).toBe(true);
    });

    it("should be idempotent (second call is no-op)", async () => {
      await detector.initialize(db);
      const callsBefore = db.prepare.mock.calls.length;
      await detector.initialize(db);
      // Second initialize should not trigger new prepare calls
      expect(db.prepare.mock.calls.length).toBe(callsBefore);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // updateBaselines
  // ─────────────────────────────────────────────────────────────────────────
  describe("updateBaselines()", () => {
    beforeEach(async () => {
      await detector.initialize(db);
    });

    it("should add a z-score baseline", async () => {
      const result = await detector.updateBaselines([
        { name: "cpu_usage", method: "z-score", threshold: 3.0 },
      ]);

      expect(result.updated).toBe(1);
      expect(result.metrics).toContain("cpu_usage");
      expect(detector._baselines.has("cpu_usage")).toBe(true);
    });

    it("should add an IQR baseline", async () => {
      const result = await detector.updateBaselines([
        { name: "memory_usage", method: "iqr", multiplier: 1.5 },
      ]);

      expect(result.updated).toBe(1);
      expect(detector._baselines.get("memory_usage").detectionMethod).toBe(
        "iqr",
      );
    });

    it("should add an EWMA baseline", async () => {
      const result = await detector.updateBaselines([
        { name: "latency_p99", method: "ewma", alpha: 0.3, threshold: 2.0 },
      ]);

      expect(result.updated).toBe(1);
      expect(detector._baselines.get("latency_p99").detectionMethod).toBe(
        "ewma",
      );
    });

    it("should skip invalid entries (no name)", async () => {
      const result = await detector.updateBaselines([
        { method: "z-score" }, // missing name
        { name: "valid_metric", method: "z-score" },
      ]);

      expect(result.updated).toBe(1);
      expect(result.metrics).toContain("valid_metric");
    });

    it("should skip entries with unknown detection method", async () => {
      const result = await detector.updateBaselines([
        { name: "some_metric", method: "unknown-method" },
      ]);

      expect(result.updated).toBe(0);
    });

    it("should throw if metrics is not an array", async () => {
      await expect(detector.updateBaselines("not-an-array")).rejects.toThrow(
        "Metrics must be an array",
      );
    });

    it("should update multiple baselines at once", async () => {
      const result = await detector.updateBaselines([
        { name: "metric_a", method: "z-score" },
        { name: "metric_b", method: "iqr" },
        { name: "metric_c", method: "ewma" },
      ]);

      expect(result.updated).toBe(3);
      expect(detector._baselines.size).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ingestMetric — no baseline (returns null)
  // ─────────────────────────────────────────────────────────────────────────
  describe("ingestMetric() — no baseline", () => {
    beforeEach(async () => {
      await detector.initialize(db);
    });

    it("should buffer the value even with no baseline", () => {
      const anomaly = detector.ingestMetric("unknown_metric", 42);
      expect(anomaly).toBeNull();
      expect(detector._metricBuffers.has("unknown_metric")).toBe(true);
    });

    it("should return null if detector is disabled", () => {
      detector.configure({ enabled: false });
      const anomaly = detector.ingestMetric("cpu_usage", 100);
      expect(anomaly).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ingestMetric — Z-Score detection
  // ─────────────────────────────────────────────────────────────────────────
  describe("ingestMetric() — Z-Score", () => {
    // Build a large realistic buffer: 50 values tightly around 100 (std ≈ 3)
    // so an extreme spike like 200 gets detected and a near-normal 101 does not
    const NORMAL_VALUES = [
      95, 97, 98, 99, 99, 100, 100, 100, 101, 101, 102, 103, 97, 98, 100, 101,
      99, 100, 98, 102, 100, 101, 99, 100, 98, 102, 97, 103, 100, 100, 99, 101,
      100, 100, 98, 102, 101, 99, 100, 100, 100, 99, 101, 100, 100, 98, 102, 97,
      103, 100,
    ]; // 50 values, mean ≈ 100, std ≈ 1.7

    beforeEach(async () => {
      await detector.initialize(db);
      // Use default minSamples (30) with threshold 3.0
      await detector.updateBaselines([
        { name: "error_rate", method: "z-score", threshold: 3.0 },
      ]);
    });

    it("should detect anomaly for extreme spike value (z >> threshold)", () => {
      // Load 50 normal values to establish stable statistics
      NORMAL_VALUES.forEach((v) => detector.ingestMetric("error_rate", v));

      // Spike value: z-score = (200 - ~100) / ~1.7 ≈ 59 >> 3.0
      const anomaly = detector.ingestMetric("error_rate", 200);

      expect(anomaly).not.toBeNull();
      expect(anomaly.metricName).toBe("error_rate");
      expect(anomaly.method).toBe("z-score");
    });

    it("should not detect anomaly for value within normal range", () => {
      // Load 50 normal values
      NORMAL_VALUES.forEach((v) => detector.ingestMetric("error_rate", v));

      // 100.5 is clearly within normal range (z ≈ 0.3)
      const anomaly = detector.ingestMetric("error_rate", 100.5);
      expect(anomaly).toBeNull();
    });

    it("should return null when buffer has fewer than minSamples values", async () => {
      // Only 2 values — well below default minSamples (30)
      detector.ingestMetric("error_rate", 5);
      const anomaly = detector.ingestMetric("error_rate", 50);
      expect(anomaly).toBeNull();
    });

    it("should emit anomaly:detected event when anomaly found", () => {
      const listener = vi.fn();
      detector.on("anomaly:detected", listener);

      // Load 50 normal values then send extreme spike
      NORMAL_VALUES.forEach((v) => detector.ingestMetric("error_rate", v));
      detector.ingestMetric("error_rate", 500); // extreme spike

      expect(listener).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // calibrateBaseline
  // ─────────────────────────────────────────────────────────────────────────
  describe("calibrateBaseline()", () => {
    beforeEach(async () => {
      await detector.initialize(db);
      await detector.updateBaselines([{ name: "latency", method: "z-score" }]);
    });

    it("should calibrate from buffer with sufficient data", () => {
      // Feed 15 values
      for (let i = 0; i < 15; i++) {
        detector.ingestMetric("latency", 100 + i * 2);
      }

      const result = detector.calibrateBaseline("latency");

      expect(result.metricName).toBe("latency");
      expect(result.sampleSize).toBe(15);
      expect(typeof result.mean).toBe("number");
      expect(typeof result.std).toBe("number");
      expect(result.calibratedAt).toBeTruthy();
    });

    it("should throw if insufficient data (< 10 samples)", () => {
      for (let i = 0; i < 5; i++) {
        detector.ingestMetric("latency", 100);
      }

      expect(() => detector.calibrateBaseline("latency")).toThrow(
        "Insufficient data",
      );
    });

    it("should throw if metric not configured", () => {
      expect(() => detector.calibrateBaseline("nonexistent_metric")).toThrow(
        "No data for metric",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // checkMetric
  // ─────────────────────────────────────────────────────────────────────────
  describe("checkMetric()", () => {
    beforeEach(async () => {
      await detector.initialize(db);
    });

    it("should return null for unknown metric", () => {
      expect(detector.checkMetric("unknown")).toBeNull();
    });

    it("should return null for metric with no buffer", async () => {
      await detector.updateBaselines([{ name: "cpu", method: "z-score" }]);
      expect(detector.checkMetric("cpu")).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getBaselines / getBaseline
  // ─────────────────────────────────────────────────────────────────────────
  describe("getBaselines() / getBaseline()", () => {
    beforeEach(async () => {
      await detector.initialize(db);
      await detector.updateBaselines([
        { name: "metric_a", method: "z-score" },
        { name: "metric_b", method: "iqr" },
      ]);
    });

    it("getBaselines() should return all configured baselines", () => {
      const baselines = detector.getBaselines();
      expect(baselines.length).toBe(2);
      const names = baselines.map((b) => b.metricName);
      expect(names).toContain("metric_a");
      expect(names).toContain("metric_b");
    });

    it("getBaseline() should return specific metric", () => {
      const b = detector.getBaseline("metric_a");
      expect(b).not.toBeNull();
      expect(b.metricName).toBe("metric_a");
      expect(b.detectionMethod).toBe("z-score");
    });

    it("getBaseline() should return null for unknown metric", () => {
      expect(detector.getBaseline("not_there")).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    beforeEach(async () => {
      await detector.initialize(db);
      await detector.updateBaselines([{ name: "cpu", method: "z-score" }]);
      detector.ingestMetric("cpu", 50);
    });

    it("should return baselines count and buffer info", () => {
      const stats = detector.getStats();
      expect(stats.baselines).toBe(1);
      expect(stats.activeMetrics).toBe(1);
      expect(stats.bufferSizes.cpu).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getConfig / configure
  // ─────────────────────────────────────────────────────────────────────────
  describe("getConfig() / configure()", () => {
    beforeEach(async () => {
      await detector.initialize(db);
    });

    it("should return current config", () => {
      const config = detector.getConfig();
      expect(config).toHaveProperty("enabled");
      expect(config).toHaveProperty("bufferMaxSize");
      expect(config).toHaveProperty("checkIntervalMs");
    });

    it("should update config fields", () => {
      detector.configure({ bufferMaxSize: 500, enabled: false });
      const config = detector.getConfig();
      expect(config.bufferMaxSize).toBe(500);
      expect(config.enabled).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("Constants", () => {
    it("DETECTION_METHODS should have z-score, iqr, ewma", () => {
      expect(DETECTION_METHODS.Z_SCORE).toBe("z-score");
      expect(DETECTION_METHODS.IQR).toBe("iqr");
      expect(DETECTION_METHODS.EWMA).toBe("ewma");
    });

    it("ANOMALY_SEVERITY should have P0-P3", () => {
      expect(ANOMALY_SEVERITY.P0).toBe("P0");
      expect(ANOMALY_SEVERITY.P1).toBe("P1");
      expect(ANOMALY_SEVERITY.P2).toBe("P2");
      expect(ANOMALY_SEVERITY.P3).toBe("P3");
    });
  });
});
