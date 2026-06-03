import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  OPTIMIZATION_OBJECTIVES,
  ANOMALY_DETECTORS,
  DECAY_MODELS,
  ensureReputationTables,
  addObservation,
  computeScore,
  listScores,
  detectAnomalies,
  startOptimization,
  getOptimizationStatus,
  getAnalytics,
  listOptimizationRuns,
  applyOptimizedParams,
  _resetState,
  // V2 (Phase 60)
  RUN_STATUS_V2,
  OBJECTIVE_V2,
  DECAY_MODEL_V2,
  ANOMALY_METHOD_V2,
  REPUTATION_DEFAULT_MAX_CONCURRENT,
  setMaxConcurrentOptimizations,
  getMaxConcurrentOptimizations,
  getActiveOptimizationCount,
  startOptimizationV2,
  completeOptimization,
  cancelOptimization,
  failOptimization,
  applyOptimization,
  setRunStatus,
  getReputationStatsV2,
} from "../../src/lib/reputation-optimizer.js";

describe("reputation-optimizer", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureReputationTables(db);
  });

  describe("ensureReputationTables", () => {
    it("creates observations, runs, and analytics tables", () => {
      expect(db.tables.has("reputation_observations")).toBe(true);
      expect(db.tables.has("reputation_optimization_runs")).toBe(true);
      expect(db.tables.has("reputation_analytics")).toBe(true);
    });

    it("is idempotent", () => {
      ensureReputationTables(db);
      expect(db.tables.has("reputation_observations")).toBe(true);
    });
  });

  describe("constants", () => {
    it("OPTIMIZATION_OBJECTIVES has 4 objectives", () => {
      expect(Object.keys(OPTIMIZATION_OBJECTIVES)).toEqual([
        "ACCURACY",
        "FAIRNESS",
        "RESILIENCE",
        "CONVERGENCE_SPEED",
      ]);
      expect(Object.isFrozen(OPTIMIZATION_OBJECTIVES)).toBe(true);
    });

    it("ANOMALY_DETECTORS has z_score + iqr", () => {
      expect(ANOMALY_DETECTORS.Z_SCORE).toBe("z_score");
      expect(ANOMALY_DETECTORS.IQR).toBe("iqr");
      expect(Object.isFrozen(ANOMALY_DETECTORS)).toBe(true);
    });

    it("DECAY_MODELS has exponential/linear/step/none", () => {
      expect(Object.keys(DECAY_MODELS)).toEqual([
        "EXPONENTIAL",
        "LINEAR",
        "STEP",
        "NONE",
      ]);
    });
  });

  describe("addObservation", () => {
    it("records a valid observation", () => {
      const obs = addObservation(db, "did:key:alice", 0.75);
      expect(obs.observationId).toBeDefined();
      expect(obs.did).toBe("did:key:alice");
      expect(obs.score).toBe(0.75);
      expect(obs.kind).toBe("generic");
      expect(obs.weight).toBe(1);
    });

    it("accepts kind and weight options", () => {
      const obs = addObservation(db, "did:key:bob", 0.5, {
        kind: "task",
        weight: 2.5,
      });
      expect(obs.kind).toBe("task");
      expect(obs.weight).toBe(2.5);
    });

    it("persists to reputation_observations table", () => {
      addObservation(db, "did:key:alice", 0.8);
      const rows = db.data.get("reputation_observations");
      expect(rows.length).toBe(1);
      expect(rows[0].did).toBe("did:key:alice");
    });

    it("throws when did missing", () => {
      expect(() => addObservation(db, "", 0.5)).toThrow(/DID is required/);
    });

    it("throws when score non-finite", () => {
      expect(() => addObservation(db, "did:x", NaN)).toThrow(/finite/);
      expect(() => addObservation(db, "did:x", "abc")).toThrow(/finite/);
    });

    it("throws when score out of [0, 1]", () => {
      expect(() => addObservation(db, "did:x", -0.1)).toThrow(/\[0, 1\]/);
      expect(() => addObservation(db, "did:x", 1.5)).toThrow(/\[0, 1\]/);
    });
  });

  describe("computeScore", () => {
    it("returns 0/0 for unknown DID", () => {
      const result = computeScore("did:key:unknown");
      expect(result.score).toBe(0);
      expect(result.observations).toBe(0);
    });

    it("returns raw average when decay=none", () => {
      addObservation(db, "did:key:alice", 0.8);
      addObservation(db, "did:key:alice", 0.6);
      const result = computeScore("did:key:alice");
      expect(result.score).toBeCloseTo(0.7, 4);
      expect(result.observations).toBe(2);
      expect(result.decay).toBe("none");
    });

    it("respects weights in aggregation", () => {
      addObservation(db, "did:key:alice", 1.0, { weight: 3 });
      addObservation(db, "did:key:alice", 0.0, { weight: 1 });
      // weighted: (1*3 + 0*1) / (3+1) = 0.75
      const result = computeScore("did:key:alice");
      expect(result.score).toBeCloseTo(0.75, 4);
    });

    it("applies exponential decay to older observations", () => {
      const now = Date.now();
      addObservation(db, "did:key:alice", 1.0, {
        recordedAt: now - 30 * 86400000, // 30 days ago
      });
      addObservation(db, "did:key:alice", 0.0, { recordedAt: now });
      const withoutDecay = computeScore("did:key:alice", {
        decay: "none",
        now,
      });
      const withDecay = computeScore("did:key:alice", {
        decay: "exponential",
        lambda: 0.1,
        now,
      });
      // With exponential decay, the old 1.0 gets heavily discounted → score drops
      expect(withDecay.score).toBeLessThan(withoutDecay.score);
    });

    it("supports linear decay", () => {
      const now = Date.now();
      addObservation(db, "did:key:alice", 1.0, {
        recordedAt: now - 10 * 86400000,
      });
      const result = computeScore("did:key:alice", {
        decay: "linear",
        alpha: 0.05,
        now,
      });
      // ageDays=10, alpha=0.05 → factor = 1 - 0.5 = 0.5
      // sole obs; weighted average still equals the obs value (0.5 * 1.0 / 0.5 = 1.0)
      expect(result.score).toBeCloseTo(1.0, 4);
    });

    it("supports step decay", () => {
      const now = Date.now();
      addObservation(db, "did:key:alice", 1.0, {
        recordedAt: now - 100 * 86400000, // 100 days → 0.1 factor
      });
      addObservation(db, "did:key:alice", 0.0, { recordedAt: now });
      const result = computeScore("did:key:alice", {
        decay: "step",
        now,
      });
      // weight_old = 1 * 0.1 = 0.1, weight_new = 1 * 1 = 1
      // weighted sum: 1.0*0.1 + 0.0*1 = 0.1, total weight 1.1
      // score ≈ 0.0909
      expect(result.score).toBeLessThan(0.2);
    });

    it("throws on unknown decay model", () => {
      addObservation(db, "did:key:alice", 0.5);
      expect(() =>
        computeScore("did:key:alice", { decay: "crazy-curve" }),
      ).toThrow(/Unknown decay model/);
    });
  });

  describe("listScores", () => {
    it("returns empty array when no observations", () => {
      expect(listScores()).toEqual([]);
    });

    it("returns scores sorted descending", () => {
      addObservation(db, "did:key:a", 0.3);
      addObservation(db, "did:key:b", 0.9);
      addObservation(db, "did:key:c", 0.6);
      const rows = listScores();
      expect(rows.map((r) => r.did)).toEqual([
        "did:key:b",
        "did:key:c",
        "did:key:a",
      ]);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        addObservation(db, `did:key:${i}`, Math.random());
      }
      expect(listScores({ limit: 2 }).length).toBe(2);
    });
  });

  describe("detectAnomalies", () => {
    it("returns insufficient-samples message when <3 DIDs", () => {
      addObservation(db, "did:a", 0.5);
      addObservation(db, "did:b", 0.5);
      const result = detectAnomalies();
      expect(result.message).toMatch(/Insufficient samples/);
      expect(result.anomalies).toEqual([]);
    });

    it("returns zero-variance message when all scores identical (z_score)", () => {
      for (const id of ["a", "b", "c", "d"]) {
        addObservation(db, `did:${id}`, 0.5);
      }
      const result = detectAnomalies({ method: "z_score" });
      expect(result.message).toMatch(/Zero variance/);
    });

    it("detects outliers with z_score method", () => {
      for (let i = 0; i < 10; i++) {
        addObservation(db, `did:normal${i}`, 0.5 + (i % 3) * 0.01);
      }
      addObservation(db, "did:outlier", 0.99);
      const result = detectAnomalies({ method: "z_score", threshold: 1.5 });
      expect(result.anomalies.length).toBeGreaterThan(0);
      expect(result.anomalies.some((a) => a.did === "did:outlier")).toBe(true);
    });

    it("detects outliers with IQR method", () => {
      for (let i = 0; i < 10; i++) {
        addObservation(db, `did:mid${i}`, 0.5);
      }
      addObservation(db, "did:high", 0.99);
      addObservation(db, "did:low", 0.01);
      const result = detectAnomalies({ method: "iqr", threshold: 1.5 });
      expect(Array.isArray(result.anomalies)).toBe(true);
      expect(result.method).toBe("iqr");
    });

    it("throws on unknown method", () => {
      for (let i = 0; i < 5; i++) addObservation(db, `did:${i}`, 0.5);
      expect(() => detectAnomalies({ method: "mystic" })).toThrow(
        /Unknown anomaly detector/,
      );
    });

    it("summary reflects count", () => {
      for (let i = 0; i < 10; i++) {
        addObservation(db, `did:n${i}`, 0.5 + i * 0.001);
      }
      addObservation(db, "did:outlier", 0.99);
      const result = detectAnomalies({ method: "z_score", threshold: 1.0 });
      expect(result.summary).toMatch(/\d+ anomal/);
    });
  });

  describe("startOptimization", () => {
    it("runs with default accuracy objective", () => {
      const run = startOptimization(db);
      expect(run.runId).toBeDefined();
      expect(run.objective).toBe("accuracy");
      expect(run.iterations).toBe(50);
      expect(run.status).toBe("complete");
      expect(run.bestParams).toBeTruthy();
      expect(typeof run.bestScore).toBe("number");
    });

    it("accepts explicit objective", () => {
      const run = startOptimization(db, {
        objective: "fairness",
        iterations: 10,
      });
      expect(run.objective).toBe("fairness");
      expect(run.iterations).toBe(10);
    });

    it("throws on unknown objective", () => {
      expect(() => startOptimization(db, { objective: "omniscience" })).toThrow(
        /Unknown objective/,
      );
    });

    it("clamps iterations into [1, 1000]", () => {
      const low = startOptimization(db, { iterations: 0 });
      expect(low.iterations).toBe(1);
      const high = startOptimization(db, { iterations: 99999 });
      expect(high.iterations).toBe(1000);
    });

    it("persists run + analytics to DB", () => {
      startOptimization(db, { iterations: 5 });
      expect((db.data.get("reputation_optimization_runs") || []).length).toBe(
        1,
      );
      expect((db.data.get("reputation_analytics") || []).length).toBe(1);
    });

    it("analytics includes distribution and recommendations", () => {
      addObservation(db, "did:a", 0.2);
      addObservation(db, "did:b", 0.5);
      addObservation(db, "did:c", 0.9);
      const run = startOptimization(db, { iterations: 5 });
      expect(run.analytics.reputationDistribution.buckets.length).toBe(3);
      expect(run.analytics.reputationDistribution.total).toBe(3);
      expect(Array.isArray(run.analytics.recommendations)).toBe(true);
      expect(run.analytics.recommendations.length).toBeGreaterThan(0);
    });

    it("generates unique run IDs", () => {
      const r1 = startOptimization(db, { iterations: 3 });
      const r2 = startOptimization(db, { iterations: 3 });
      expect(r1.runId).not.toBe(r2.runId);
    });

    it("keeps best score ≥ 0", () => {
      for (const obj of [
        "accuracy",
        "fairness",
        "resilience",
        "convergence_speed",
      ]) {
        const run = startOptimization(db, { objective: obj, iterations: 20 });
        expect(run.bestScore).toBeGreaterThanOrEqual(0);
        expect(run.bestScore).toBeLessThanOrEqual(1.1); // allow tiny jitter headroom
      }
    });
  });

  describe("getOptimizationStatus", () => {
    it("returns run without internal fields", () => {
      const run = startOptimization(db, { iterations: 3 });
      const status = getOptimizationStatus(run.runId);
      expect(status.runId).toBe(run.runId);
      expect(status.objective).toBe("accuracy");
      expect(status._seq).toBeUndefined();
    });

    it("throws on unknown runId", () => {
      expect(() => getOptimizationStatus("unknown")).toThrow(/not found/);
    });
  });

  describe("getAnalytics", () => {
    it("returns analytics for a run", () => {
      const run = startOptimization(db, { iterations: 3 });
      const a = getAnalytics(run.runId);
      expect(a.runId).toBe(run.runId);
      expect(a.reputationDistribution).toBeDefined();
      expect(Array.isArray(a.recommendations)).toBe(true);
    });

    it("throws on unknown runId", () => {
      expect(() => getAnalytics("unknown")).toThrow(/not found/);
    });
  });

  describe("listOptimizationRuns", () => {
    it("returns empty list with no runs", () => {
      expect(listOptimizationRuns()).toEqual([]);
    });

    it("sorts most-recent first", () => {
      const a = startOptimization(db, { iterations: 3 });
      const b = startOptimization(db, { iterations: 3 });
      const c = startOptimization(db, { iterations: 3 });
      const list = listOptimizationRuns();
      expect(list[0].runId).toBe(c.runId);
      expect(list[2].runId).toBe(a.runId);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        startOptimization(db, { iterations: 2 });
      }
      expect(listOptimizationRuns({ limit: 2 }).length).toBe(2);
    });

    it("strips internal fields", () => {
      startOptimization(db, { iterations: 3 });
      const list = listOptimizationRuns();
      expect(list[0]._seq).toBeUndefined();
      expect(list[0].history).toBeUndefined();
    });
  });

  describe("applyOptimizedParams", () => {
    it("marks run as applied and returns params", () => {
      const run = startOptimization(db, { iterations: 3 });
      const result = applyOptimizedParams(run.runId);
      expect(result.applied).toBe(true);
      expect(result.runId).toBe(run.runId);
      expect(result.params).toEqual(run.bestParams);
      const status = getOptimizationStatus(run.runId);
      expect(status.status).toBe("applied");
    });

    it("throws on unknown runId", () => {
      expect(() => applyOptimizedParams("unknown")).toThrow(/not found/);
    });
  });
});

describe("reputation-optimizer V2 (Phase 60)", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureReputationTables(db);
  });

  describe("frozen enums", () => {
    it("RUN_STATUS_V2 has 5 canonical states", () => {
      expect(Object.keys(RUN_STATUS_V2)).toEqual([
        "RUNNING",
        "COMPLETE",
        "APPLIED",
        "FAILED",
        "CANCELLED",
      ]);
      expect(Object.isFrozen(RUN_STATUS_V2)).toBe(true);
    });

    it("OBJECTIVE_V2 has 4 objectives (frozen)", () => {
      expect(Object.keys(OBJECTIVE_V2)).toEqual([
        "ACCURACY",
        "FAIRNESS",
        "RESILIENCE",
        "CONVERGENCE_SPEED",
      ]);
      expect(Object.isFrozen(OBJECTIVE_V2)).toBe(true);
    });

    it("DECAY_MODEL_V2 is frozen with 4 models", () => {
      expect(Object.keys(DECAY_MODEL_V2)).toEqual([
        "EXPONENTIAL",
        "LINEAR",
        "STEP",
        "NONE",
      ]);
      expect(Object.isFrozen(DECAY_MODEL_V2)).toBe(true);
    });

    it("ANOMALY_METHOD_V2 is frozen with iqr/z_score", () => {
      expect(ANOMALY_METHOD_V2.IQR).toBe("iqr");
      expect(ANOMALY_METHOD_V2.Z_SCORE).toBe("z_score");
      expect(Object.isFrozen(ANOMALY_METHOD_V2)).toBe(true);
    });

    it("REPUTATION_DEFAULT_MAX_CONCURRENT is 2", () => {
      expect(REPUTATION_DEFAULT_MAX_CONCURRENT).toBe(2);
    });
  });

  describe("setMaxConcurrentOptimizations", () => {
    it("defaults to REPUTATION_DEFAULT_MAX_CONCURRENT", () => {
      expect(getMaxConcurrentOptimizations()).toBe(
        REPUTATION_DEFAULT_MAX_CONCURRENT,
      );
    });

    it("accepts a positive integer", () => {
      expect(setMaxConcurrentOptimizations(5)).toBe(5);
      expect(getMaxConcurrentOptimizations()).toBe(5);
    });

    it("floors non-integer input", () => {
      expect(setMaxConcurrentOptimizations(3.7)).toBe(3);
    });

    it("rejects non-positive / NaN / non-number", () => {
      expect(() => setMaxConcurrentOptimizations(0)).toThrow(/positive/);
      expect(() => setMaxConcurrentOptimizations(-1)).toThrow(/positive/);
      expect(() => setMaxConcurrentOptimizations(NaN)).toThrow(/positive/);
      expect(() => setMaxConcurrentOptimizations("5")).toThrow(/positive/);
    });

    it("is restored by _resetState", () => {
      setMaxConcurrentOptimizations(9);
      _resetState();
      expect(getMaxConcurrentOptimizations()).toBe(
        REPUTATION_DEFAULT_MAX_CONCURRENT,
      );
    });
  });

  describe("startOptimizationV2 + concurrency cap", () => {
    it("creates a RUNNING run with no iterations computed yet", () => {
      const run = startOptimizationV2(db);
      expect(run.runId).toBeDefined();
      expect(run.status).toBe(RUN_STATUS_V2.RUNNING);
      expect(run.objective).toBe("accuracy");
      expect(run.iterations).toBe(50);
      expect(run.bestParams).toBeNull();
      expect(run.bestScore).toBeNull();
      expect(run.completedAt).toBeNull();
      expect(getActiveOptimizationCount()).toBe(1);
    });

    it("persists row to DB with status=running", () => {
      const run = startOptimizationV2(db, { iterations: 3 });
      const rows = db.data.get("reputation_optimization_runs");
      expect(rows.length).toBe(1);
      expect(rows[0].run_id).toBe(run.runId);
      expect(rows[0].status).toBe("running");
    });

    it("accepts explicit objective + iterations", () => {
      const run = startOptimizationV2(db, {
        objective: "fairness",
        iterations: 7,
      });
      expect(run.objective).toBe("fairness");
      expect(run.iterations).toBe(7);
    });

    it("rejects unknown objective", () => {
      expect(() =>
        startOptimizationV2(db, { objective: "omniscience" }),
      ).toThrow(/Unknown objective/);
    });

    it("clamps iterations into [1, 1000]", () => {
      const low = startOptimizationV2(db, { iterations: 0 });
      expect(low.iterations).toBe(1);
    });

    it("rejects when activeCount >= maxConcurrent", () => {
      setMaxConcurrentOptimizations(2);
      startOptimizationV2(db);
      startOptimizationV2(db);
      expect(() => startOptimizationV2(db)).toThrow(/Max concurrent/);
    });

    it("getActiveOptimizationCount decrements after terminal transition", () => {
      setMaxConcurrentOptimizations(1);
      const r1 = startOptimizationV2(db);
      expect(getActiveOptimizationCount()).toBe(1);
      cancelOptimization(db, r1.runId);
      expect(getActiveOptimizationCount()).toBe(0);
      // cap now free
      const r2 = startOptimizationV2(db);
      expect(r2.runId).not.toBe(r1.runId);
    });
  });

  describe("completeOptimization", () => {
    it("transitions RUNNING → COMPLETE with bestParams + analytics", () => {
      const run = startOptimizationV2(db, { iterations: 5 });
      const completed = completeOptimization(db, run.runId);
      expect(completed.status).toBe(RUN_STATUS_V2.COMPLETE);
      expect(completed.bestParams).toBeTruthy();
      expect(typeof completed.bestScore).toBe("number");
      expect(completed.completedAt).toBeGreaterThan(0);
      expect(completed.analytics).toBeDefined();
      expect(completed.analytics.reputationDistribution).toBeDefined();
      expect(Array.isArray(completed.analytics.recommendations)).toBe(true);
    });

    it("persists analytics row", () => {
      const run = startOptimizationV2(db, { iterations: 3 });
      completeOptimization(db, run.runId);
      const rows = db.data.get("reputation_analytics");
      expect(rows.length).toBe(1);
      expect(rows[0].run_id).toBe(run.runId);
    });

    it("refuses to complete a cancelled run", () => {
      const run = startOptimizationV2(db);
      cancelOptimization(db, run.runId);
      expect(() => completeOptimization(db, run.runId)).toThrow(
        /Invalid run status transition/,
      );
    });

    it("throws on unknown runId", () => {
      expect(() => completeOptimization(db, "unknown")).toThrow(/not found/);
    });
  });

  describe("cancelOptimization / failOptimization shortcuts", () => {
    it("cancel transitions RUNNING → CANCELLED", () => {
      const run = startOptimizationV2(db);
      const result = cancelOptimization(db, run.runId);
      expect(result.status).toBe(RUN_STATUS_V2.CANCELLED);
      expect(result.completedAt).toBeGreaterThan(0);
    });

    it("fail transitions RUNNING → FAILED and stores errorMessage", () => {
      const run = startOptimizationV2(db);
      const result = failOptimization(db, run.runId, "boom");
      expect(result.status).toBe(RUN_STATUS_V2.FAILED);
      expect(result.errorMessage).toBe("boom");
      expect(result.completedAt).toBeGreaterThan(0);
    });
  });

  describe("applyOptimization + state machine", () => {
    it("applies a completed run (COMPLETE → APPLIED)", () => {
      const run = startOptimizationV2(db, { iterations: 3 });
      completeOptimization(db, run.runId);
      const applied = applyOptimization(db, run.runId);
      expect(applied.status).toBe(RUN_STATUS_V2.APPLIED);
    });

    it("refuses to apply a RUNNING run directly", () => {
      const run = startOptimizationV2(db);
      expect(() => applyOptimization(db, run.runId)).toThrow(
        /Invalid run status transition/,
      );
    });

    it("refuses to re-apply an already-APPLIED run", () => {
      const run = startOptimizationV2(db, { iterations: 3 });
      completeOptimization(db, run.runId);
      applyOptimization(db, run.runId);
      expect(() => applyOptimization(db, run.runId)).toThrow(
        /Invalid run status transition/,
      );
    });
  });

  describe("setRunStatus (generic)", () => {
    it("accepts valid transition with patch.errorMessage", () => {
      const run = startOptimizationV2(db);
      const result = setRunStatus(db, run.runId, RUN_STATUS_V2.FAILED, {
        errorMessage: "fatal",
      });
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("fatal");
    });

    it("rejects unknown status", () => {
      const run = startOptimizationV2(db);
      expect(() => setRunStatus(db, run.runId, "haunted")).toThrow(
        /Unknown run status/,
      );
    });

    it("rejects running → applied (must go via complete)", () => {
      const run = startOptimizationV2(db);
      expect(() => setRunStatus(db, run.runId, RUN_STATUS_V2.APPLIED)).toThrow(
        /Invalid run status transition/,
      );
    });

    it("rejects any outgoing transition from FAILED / CANCELLED / APPLIED", () => {
      const run = startOptimizationV2(db, { iterations: 3 });
      failOptimization(db, run.runId, "err");
      for (const target of [
        RUN_STATUS_V2.RUNNING,
        RUN_STATUS_V2.COMPLETE,
        RUN_STATUS_V2.CANCELLED,
        RUN_STATUS_V2.APPLIED,
      ]) {
        expect(() => setRunStatus(db, run.runId, target)).toThrow(
          /Invalid run status transition/,
        );
      }
    });

    it("throws on unknown runId", () => {
      expect(() => setRunStatus(db, "unknown", RUN_STATUS_V2.COMPLETE)).toThrow(
        /not found/,
      );
    });

    it("auto-sets completedAt on terminal transition", () => {
      const run = startOptimizationV2(db);
      const result = setRunStatus(db, run.runId, RUN_STATUS_V2.CANCELLED);
      expect(result.completedAt).toBeGreaterThan(0);
    });
  });

  describe("getReputationStatsV2", () => {
    it("returns zero-state shape with all enum keys", () => {
      const stats = getReputationStatsV2();
      expect(stats.totalRuns).toBe(0);
      expect(stats.activeRuns).toBe(0);
      expect(stats.maxConcurrentOptimizations).toBe(
        REPUTATION_DEFAULT_MAX_CONCURRENT,
      );
      for (const s of Object.values(RUN_STATUS_V2)) {
        expect(stats.byStatus[s]).toBe(0);
      }
      for (const o of Object.values(OBJECTIVE_V2)) {
        expect(stats.byObjective[o]).toBe(0);
      }
      expect(stats.observations.totalDids).toBe(0);
      expect(stats.observations.totalObservations).toBe(0);
      expect(stats.bestScoreEver).toBeNull();
    });

    it("aggregates runs + observations + bestScore", () => {
      addObservation(db, "did:key:a", 0.3);
      addObservation(db, "did:key:b", 0.8);
      addObservation(db, "did:key:b", 0.9);

      const r1 = startOptimizationV2(db, { iterations: 3 });
      completeOptimization(db, r1.runId);

      const r2 = startOptimizationV2(db, {
        objective: "fairness",
        iterations: 3,
      });
      cancelOptimization(db, r2.runId);

      const stats = getReputationStatsV2();
      expect(stats.totalRuns).toBe(2);
      expect(stats.activeRuns).toBe(0);
      expect(stats.byStatus.complete).toBe(1);
      expect(stats.byStatus.cancelled).toBe(1);
      expect(stats.byObjective.accuracy).toBe(1);
      expect(stats.byObjective.fairness).toBe(1);
      expect(stats.observations.totalDids).toBe(2);
      expect(stats.observations.totalObservations).toBe(3);
      expect(stats.bestScoreEver).not.toBeNull();
    });
  });
});
