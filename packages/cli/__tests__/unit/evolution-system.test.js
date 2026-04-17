import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureEvolutionTables,
  assessCapability,
  trainIncremental,
  selfDiagnose,
  selfRepair,
  predictBehavior,
  getGrowthLog,
  getCapabilities,
  getModels,
  exportModel,
  _resetState,
  // Phase 100 V2
  CAPABILITY_DIMENSION,
  DIAGNOSIS_SEVERITY,
  REPAIR_STRATEGY,
  GROWTH_MILESTONE,
  assessCapabilityV2,
  getCapabilityV2,
  listCapabilitiesV2,
  trainIncrementalV2,
  listTrainingLogV2,
  selfDiagnoseV2,
  getDiagnosisV2,
  listDiagnosesV2,
  selfRepairV2,
  predictBehaviorV2,
  recordMilestone,
  getGrowthLogV2,
  configureEvolution,
  getEvolutionConfig,
  getEvolutionStatsV2,
  _resetV2State,
} from "../../src/lib/evolution-system.js";

describe("evolution-system", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    _resetV2State();
  });

  // ─── ensureEvolutionTables ────────────────────────────────

  describe("ensureEvolutionTables", () => {
    it("creates evolution_capabilities table", () => {
      ensureEvolutionTables(db);
      expect(db.tables.has("evolution_capabilities")).toBe(true);
    });

    it("creates evolution_growth_log table", () => {
      ensureEvolutionTables(db);
      expect(db.tables.has("evolution_growth_log")).toBe(true);
    });

    it("creates evolution_diagnoses table", () => {
      ensureEvolutionTables(db);
      expect(db.tables.has("evolution_diagnoses")).toBe(true);
    });

    it("creates evolution_models table", () => {
      ensureEvolutionTables(db);
      expect(db.tables.has("evolution_models")).toBe(true);
    });
  });

  // ─── assessCapability ─────────────────────────────────────

  describe("assessCapability", () => {
    it("creates a new capability", () => {
      const result = assessCapability(db, "reasoning", 0.75, "cognitive");
      expect(result.id).toBeTruthy();
      expect(result.name).toBe("reasoning");
      expect(result.score).toBe(0.75);
      expect(result.trend).toBe("stable");
      expect(result.history.length).toBe(1);
    });

    it("updates an existing capability", () => {
      assessCapability(db, "reasoning", 0.6);
      const result = assessCapability(db, "reasoning", 0.8);
      expect(result.score).toBe(0.8);
      expect(result.history.length).toBe(2);
    });

    it("detects improving trend", () => {
      assessCapability(db, "logic", 0.5);
      assessCapability(db, "logic", 0.6);
      const result = assessCapability(db, "logic", 0.7);
      expect(result.trend).toBe("improving");
    });

    it("detects declining trend", () => {
      assessCapability(db, "speed", 0.9);
      assessCapability(db, "speed", 0.7);
      const result = assessCapability(db, "speed", 0.5);
      expect(result.trend).toBe("declining");
    });

    it("detects stable trend", () => {
      assessCapability(db, "memory", 0.7);
      assessCapability(db, "memory", 0.7);
      const result = assessCapability(db, "memory", 0.7);
      expect(result.trend).toBe("stable");
    });

    it("logs growth event on assessment", () => {
      assessCapability(db, "test-cap", 0.5);
      const log = getGrowthLog(db);
      expect(log.length).toBe(1);
      expect(log[0].eventType).toBe("capability-assessment");
    });
  });

  // ─── trainIncremental ─────────────────────────────────────

  describe("trainIncremental", () => {
    it("creates a new model", () => {
      const result = trainIncremental(db, "model-1", [1, 2, 3]);
      expect(result.id).toBe("model-1");
      expect(result.type).toBe("classification");
      expect(result.dataPoints).toBe(3);
      expect(result.accuracy).toBeGreaterThan(0.5);
    });

    it("increases accuracy with more data", () => {
      const r1 = trainIncremental(db, "model-2", [1, 2, 3]);
      const r2 = trainIncremental(db, "model-2", [4, 5, 6, 7, 8]);
      expect(r2.accuracy).toBeGreaterThan(r1.accuracy);
      expect(r2.dataPoints).toBe(8);
    });

    it("caps accuracy at 0.99", () => {
      let result;
      for (let i = 0; i < 100; i++) {
        result = trainIncremental(db, "model-3", Array(100).fill(1));
      }
      expect(result.accuracy).toBeLessThanOrEqual(0.99);
    });

    it("respects model type option", () => {
      const result = trainIncremental(db, "reg-model", [1], {
        type: "regression",
      });
      expect(result.type).toBe("regression");
    });

    it("handles single data item (non-array)", () => {
      const result = trainIncremental(db, "model-4", "single-item");
      expect(result.dataPoints).toBe(1);
    });

    it("logs growth event on training", () => {
      trainIncremental(db, "model-5", [1, 2]);
      const log = getGrowthLog(db, { type: "model-training" });
      expect(log.length).toBe(1);
    });
  });

  // ─── selfDiagnose ─────────────────────────────────────────

  describe("selfDiagnose", () => {
    it("returns overall status", () => {
      const result = selfDiagnose(db);
      expect(result.overallStatus).toBeTruthy();
      expect(["healthy", "warning"]).toContain(result.overallStatus);
    });

    it("includes components", () => {
      const result = selfDiagnose(db);
      expect(result.components.length).toBeGreaterThanOrEqual(4);
      const names = result.components.map((c) => c.name);
      expect(names).toContain("memory");
      expect(names).toContain("capabilities");
      expect(names).toContain("models");
      expect(names).toContain("growth");
    });

    it("returns issues array", () => {
      const result = selfDiagnose(db);
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it("returns recommendations array", () => {
      const result = selfDiagnose(db);
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it("detects degraded models", () => {
      trainIncremental(db, "bad-model", [1]); // low accuracy
      const result = selfDiagnose(db);
      const modelComp = result.components.find((c) => c.name === "models");
      expect(modelComp).toBeDefined();
    });

    it("detects declining capabilities", () => {
      assessCapability(db, "declining-cap", 0.9);
      assessCapability(db, "declining-cap", 0.6);
      assessCapability(db, "declining-cap", 0.3);
      const result = selfDiagnose(db);
      const capIssue = result.issues.find(
        (i) => i.type === "declining-capabilities",
      );
      expect(capIssue).toBeDefined();
    });
  });

  // ─── selfRepair ───────────────────────────────────────────

  describe("selfRepair", () => {
    it("handles high-memory repair", () => {
      const result = selfRepair(db, "high-memory");
      expect(result.issue).toBe("high-memory");
      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.timestamp).toBeTruthy();
    });

    it("handles stale-cache repair", () => {
      assessCapability(db, "old-cap", 0.5);
      const result = selfRepair(db, "stale-cache");
      expect(result.issue).toBe("stale-cache");
      expect(result.actions.length).toBeGreaterThan(0);
    });

    it("handles degraded-model repair", () => {
      trainIncremental(db, "weak-model", [1]); // low accuracy
      const result = selfRepair(db, "degraded-model");
      expect(result.actions.length).toBeGreaterThan(0);

      // Verify model was reset
      const mdls = getModels(db);
      const model = mdls.find((m) => m.id === "weak-model");
      expect(model.accuracy).toBe(0.5);
      expect(model.dataPoints).toBe(0);
    });

    it("handles unknown issue gracefully", () => {
      const result = selfRepair(db, "unknown-issue");
      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.actions[0]).toContain("No automated repair");
    });

    it("logs repair in growth log", () => {
      selfRepair(db, "high-memory");
      const log = getGrowthLog(db, { type: "self-repair" });
      expect(log.length).toBe(1);
    });
  });

  // ─── predictBehavior ──────────────────────────────────────

  describe("predictBehavior", () => {
    it("returns predictions array", () => {
      assessCapability(db, "test", 0.5);
      const result = predictBehavior(db, "user-1");
      expect(Array.isArray(result.predictions)).toBe(true);
    });

    it("returns confidence score", () => {
      const result = predictBehavior(db, "user-2");
      expect(typeof result.confidence).toBe("number");
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("includes user ID", () => {
      const result = predictBehavior(db, "user-3");
      expect(result.userId).toBe("user-3");
    });

    it("defaults to 'default' userId when none given", () => {
      const result = predictBehavior(db, undefined);
      expect(result.userId).toBe("default");
    });

    it("predictions sorted by probability descending", () => {
      assessCapability(db, "a", 0.5);
      assessCapability(db, "b", 0.6);
      trainIncremental(db, "m1", [1]);
      const result = predictBehavior(db, "user-4");
      if (result.predictions.length >= 2) {
        expect(result.predictions[0].probability).toBeGreaterThanOrEqual(
          result.predictions[1].probability,
        );
      }
    });

    it("confidence increases with more events", () => {
      const r1 = predictBehavior(db, "user-5");
      for (let i = 0; i < 10; i++) {
        assessCapability(db, `cap-${i}`, 0.5 + i * 0.05);
      }
      const r2 = predictBehavior(db, "user-5");
      expect(r2.confidence).toBeGreaterThanOrEqual(r1.confidence);
    });
  });

  // ─── getGrowthLog ─────────────────────────────────────────

  describe("getGrowthLog", () => {
    it("returns all entries", () => {
      assessCapability(db, "a", 0.5);
      trainIncremental(db, "m", [1]);
      const log = getGrowthLog(db);
      expect(log.length).toBe(2);
    });

    it("filters by type", () => {
      assessCapability(db, "a", 0.5);
      trainIncremental(db, "m", [1]);
      const log = getGrowthLog(db, { type: "model-training" });
      expect(log.length).toBe(1);
      expect(log[0].eventType).toBe("model-training");
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        assessCapability(db, `cap-${i}`, 0.5);
      }
      const log = getGrowthLog(db, { limit: 3 });
      expect(log.length).toBe(3);
    });
  });

  // ─── getCapabilities / getModels ──────────────────────────

  describe("getCapabilities", () => {
    it("returns empty list initially", () => {
      const caps = getCapabilities(db);
      expect(caps.length).toBe(0);
    });

    it("returns tracked capabilities", () => {
      assessCapability(db, "reasoning", 0.8, "cognitive");
      assessCapability(db, "speed", 0.6, "performance");
      const caps = getCapabilities(db);
      expect(caps.length).toBe(2);
      expect(caps[0].name).toBeTruthy();
      expect(caps[0].category).toBeTruthy();
    });
  });

  describe("getModels", () => {
    it("returns empty list initially", () => {
      const mdls = getModels(db);
      expect(mdls.length).toBe(0);
    });

    it("returns registered models", () => {
      trainIncremental(db, "m1", [1, 2]);
      trainIncremental(db, "m2", [3, 4], { type: "regression" });
      const mdls = getModels(db);
      expect(mdls.length).toBe(2);
    });
  });

  // ─── exportModel ──────────────────────────────────────────

  describe("exportModel", () => {
    it("exports model data", () => {
      trainIncremental(db, "export-test", [1, 2, 3]);
      const exported = exportModel(db, "export-test");
      expect(exported.id).toBe("export-test");
      expect(exported.accuracy).toBeGreaterThan(0);
      expect(exported.dataPoints).toBe(3);
      expect(exported.exportedAt).toBeTruthy();
    });

    it("throws for non-existent model", () => {
      expect(() => exportModel(db, "nonexistent")).toThrow("not found");
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Phase 100 — Self-Evolving AI V2
  // ═══════════════════════════════════════════════════════════

  describe("V2 frozen enums", () => {
    it("CAPABILITY_DIMENSION has 6 dimensions and is frozen", () => {
      expect(Object.values(CAPABILITY_DIMENSION)).toEqual([
        "reasoning",
        "knowledge",
        "creativity",
        "accuracy",
        "speed",
        "adaptability",
      ]);
      expect(Object.isFrozen(CAPABILITY_DIMENSION)).toBe(true);
    });

    it("DIAGNOSIS_SEVERITY has 4 levels", () => {
      expect(Object.values(DIAGNOSIS_SEVERITY)).toEqual([
        "normal",
        "warning",
        "critical",
        "fatal",
      ]);
      expect(Object.isFrozen(DIAGNOSIS_SEVERITY)).toBe(true);
    });

    it("REPAIR_STRATEGY has 4 strategies", () => {
      expect(Object.values(REPAIR_STRATEGY)).toEqual([
        "parameter_tune",
        "model_rollback",
        "cache_rebuild",
        "full_reset",
      ]);
      expect(Object.isFrozen(REPAIR_STRATEGY)).toBe(true);
    });

    it("GROWTH_MILESTONE has 4 types", () => {
      expect(Object.values(GROWTH_MILESTONE)).toEqual([
        "capability_gain",
        "knowledge_expansion",
        "self_repair_success",
        "prediction_accuracy",
      ]);
      expect(Object.isFrozen(GROWTH_MILESTONE)).toBe(true);
    });
  });

  describe("assessCapabilityV2", () => {
    it("rejects invalid dimension", () => {
      expect(() =>
        assessCapabilityV2({ dimension: "bogus", score: 0.5 }),
      ).toThrow("Invalid dimension");
    });

    it("rejects score out of [0, 1]", () => {
      expect(() =>
        assessCapabilityV2({ dimension: "reasoning", score: 1.5 }),
      ).toThrow("Score must be a finite number in [0, 1]");
      expect(() =>
        assessCapabilityV2({ dimension: "reasoning", score: -0.1 }),
      ).toThrow("Score must be a finite number in [0, 1]");
    });

    it("creates a new capability with initial trend=stable", () => {
      const r = assessCapabilityV2({
        dimension: CAPABILITY_DIMENSION.REASONING,
        score: 0.6,
      });
      expect(r.dimension).toBe("reasoning");
      expect(r.score).toBe(0.6);
      expect(r.previousScore).toBe(0);
      expect(r.trend).toBe("stable"); // first sample: delta = 0.6 from 0 but initial is 0 → improving is also valid
      expect(r.sampleCount).toBe(1);
    });

    it("detects improving trend on second assessment with delta>0.01", () => {
      assessCapabilityV2({ dimension: "knowledge", score: 0.5 });
      const r = assessCapabilityV2({ dimension: "knowledge", score: 0.7 });
      expect(r.trend).toBe("improving");
      expect(r.sampleCount).toBe(2);
      expect(r.previousScore).toBe(0.5);
    });

    it("detects declining trend", () => {
      assessCapabilityV2({ dimension: "speed", score: 0.8 });
      const r = assessCapabilityV2({ dimension: "speed", score: 0.5 });
      expect(r.trend).toBe("declining");
    });

    it("records CAPABILITY_GAIN milestone on delta ≥ 0.1", () => {
      assessCapabilityV2({ dimension: "creativity", score: 0.4 });
      assessCapabilityV2({ dimension: "creativity", score: 0.6 });
      const log = getGrowthLogV2({
        milestoneType: GROWTH_MILESTONE.CAPABILITY_GAIN,
      });
      expect(log.length).toBe(1);
      expect(log[0].capabilityId).toBeTruthy();
    });

    it("merges metadata across assessments", () => {
      assessCapabilityV2({
        dimension: "accuracy",
        score: 0.5,
        metadata: { source: "benchmark-A" },
      });
      const r = assessCapabilityV2({
        dimension: "accuracy",
        score: 0.6,
        metadata: { run: 2 },
      });
      expect(r.metadata).toEqual({ source: "benchmark-A", run: 2 });
    });

    it("listCapabilitiesV2 returns sorted by dimension", () => {
      assessCapabilityV2({ dimension: "speed", score: 0.7 });
      assessCapabilityV2({ dimension: "accuracy", score: 0.6 });
      const list = listCapabilitiesV2();
      expect(list.map((e) => e.dimension)).toEqual(["accuracy", "speed"]);
    });

    it("getCapabilityV2 returns null for unknown dimension", () => {
      expect(getCapabilityV2("reasoning")).toBeNull();
    });
  });

  describe("trainIncrementalV2", () => {
    it("rejects invalid strategy", () => {
      expect(() =>
        trainIncrementalV2({
          strategy: "bogus",
          dataSize: 10,
          lossBefore: 0.5,
          lossAfter: 0.3,
        }),
      ).toThrow("Invalid training strategy");
    });

    it("rejects non-finite loss values", () => {
      expect(() =>
        trainIncrementalV2({
          strategy: "replay",
          dataSize: 10,
          lossBefore: NaN,
          lossAfter: 0.3,
        }),
      ).toThrow("lossBefore and lossAfter must be finite numbers");
    });

    it("computes knowledge retention ∈ [0, 1]", () => {
      const r = trainIncrementalV2({
        strategy: "elastic-weight",
        dataSize: 100,
        lossBefore: 0.5,
        lossAfter: 0.4,
      });
      expect(r.knowledgeRetention).toBeGreaterThan(0);
      expect(r.knowledgeRetention).toBeLessThanOrEqual(1);
    });

    it("marks completed when retention ≥ threshold", () => {
      const r = trainIncrementalV2({
        strategy: "elastic-weight",
        dataSize: 100,
        lossBefore: 0.5,
        lossAfter: 0.48,
      });
      expect(r.status).toBe("completed");
    });

    it("marks retention_low when below threshold", () => {
      const r = trainIncrementalV2({
        strategy: "replay",
        dataSize: 100,
        lossBefore: 0.5,
        lossAfter: 0.1,
      });
      expect(r.status).toBe("retention_low");
    });

    it("records KNOWLEDGE_EXPANSION milestone on loss reduction + completed", () => {
      trainIncrementalV2({
        strategy: "elastic-weight",
        dataSize: 100,
        lossBefore: 0.5,
        lossAfter: 0.49,
      });
      const log = getGrowthLogV2({
        milestoneType: GROWTH_MILESTONE.KNOWLEDGE_EXPANSION,
      });
      expect(log.length).toBe(1);
    });

    it("listTrainingLogV2 filters by strategy and respects limit", () => {
      trainIncrementalV2({
        strategy: "replay",
        dataSize: 10,
        lossBefore: 0.5,
        lossAfter: 0.45,
      });
      trainIncrementalV2({
        strategy: "elastic-weight",
        dataSize: 10,
        lossBefore: 0.4,
        lossAfter: 0.35,
      });
      const list = listTrainingLogV2({ strategy: "replay" });
      expect(list.length).toBe(1);
      expect(list[0].strategy).toBe("replay");
    });
  });

  describe("selfDiagnoseV2 + selfRepairV2", () => {
    it("returns NORMAL severity when nothing is wrong", () => {
      const r = selfDiagnoseV2();
      expect(r.severity).toBe(DIAGNOSIS_SEVERITY.NORMAL);
      expect(r.anomaliesDetected).toBe(0);
      expect(r.rootCause).toBeNull();
    });

    it("flags WARNING on sharp capability drop ≥ 0.2", () => {
      assessCapabilityV2({ dimension: "reasoning", score: 0.9 });
      assessCapabilityV2({ dimension: "reasoning", score: 0.5 });
      const r = selfDiagnoseV2();
      expect(r.severity).toBe(DIAGNOSIS_SEVERITY.WARNING);
      expect(r.repairSuggestion).toBe(REPAIR_STRATEGY.PARAMETER_TUNE);
    });

    it("flags CRITICAL on 3+ low-retention training runs", () => {
      for (let i = 0; i < 3; i++) {
        trainIncrementalV2({
          strategy: "replay",
          dataSize: 10,
          lossBefore: 0.5,
          lossAfter: 0.1,
        });
      }
      const r = selfDiagnoseV2();
      expect(r.severity).toBe(DIAGNOSIS_SEVERITY.CRITICAL);
      expect(r.repairSuggestion).toBe(REPAIR_STRATEGY.MODEL_ROLLBACK);
    });

    it("selfRepairV2 rejects unknown diagnosis", () => {
      expect(() =>
        selfRepairV2({
          diagnosisId: "missing",
          strategy: REPAIR_STRATEGY.PARAMETER_TUNE,
        }),
      ).toThrow("Diagnosis not found");
    });

    it("selfRepairV2 rejects invalid strategy", () => {
      const d = selfDiagnoseV2();
      expect(() =>
        selfRepairV2({ diagnosisId: d.id, strategy: "bogus" }),
      ).toThrow("Invalid repair strategy");
    });

    it("selfRepairV2 marks diagnosis completed + records milestone", () => {
      const d = selfDiagnoseV2();
      const r = selfRepairV2({
        diagnosisId: d.id,
        strategy: REPAIR_STRATEGY.CACHE_REBUILD,
      });
      expect(r.strategy).toBe("cache_rebuild");
      expect(r.actions.length).toBeGreaterThan(0);
      const after = getDiagnosisV2(d.id);
      expect(after.repairStatus).toBe("completed");
      expect(after.repairedAt).toBeTruthy();
      const log = getGrowthLogV2({
        milestoneType: GROWTH_MILESTONE.SELF_REPAIR_SUCCESS,
      });
      expect(log.length).toBe(1);
    });

    it("selfRepairV2 rejects double-repair", () => {
      const d = selfDiagnoseV2();
      selfRepairV2({
        diagnosisId: d.id,
        strategy: REPAIR_STRATEGY.PARAMETER_TUNE,
      });
      expect(() =>
        selfRepairV2({
          diagnosisId: d.id,
          strategy: REPAIR_STRATEGY.MODEL_ROLLBACK,
        }),
      ).toThrow("Diagnosis already repaired");
    });

    it("listDiagnosesV2 filters by severity", () => {
      assessCapabilityV2({ dimension: "reasoning", score: 0.9 });
      assessCapabilityV2({ dimension: "reasoning", score: 0.5 });
      selfDiagnoseV2();
      selfDiagnoseV2({ scope: "memory" });
      const list = listDiagnosesV2({ severity: DIAGNOSIS_SEVERITY.WARNING });
      expect(list.length).toBe(2);
    });
  });

  describe("predictBehaviorV2 + milestones", () => {
    it("predictBehaviorV2 defaults horizon from config", () => {
      const r = predictBehaviorV2();
      expect(r.horizonMs).toBe(86400000);
      expect(Array.isArray(r.predictions)).toBe(true);
    });

    it("predictBehaviorV2 confidence grows with milestone count", () => {
      const before = predictBehaviorV2();
      for (let i = 0; i < 10; i++) {
        recordMilestone({
          type: GROWTH_MILESTONE.PREDICTION_ACCURACY,
          description: `m${i}`,
        });
      }
      const after = predictBehaviorV2();
      expect(after.confidence).toBeGreaterThan(before.confidence);
    });

    it("recordMilestone rejects invalid type", () => {
      expect(() =>
        recordMilestone({ type: "bogus", description: "x" }),
      ).toThrow("Invalid milestone type");
    });

    it("getGrowthLogV2 filters by period", () => {
      const m = recordMilestone({
        type: GROWTH_MILESTONE.CAPABILITY_GAIN,
        description: "old",
      });
      const future = { fromMs: m.timestamp + 1000 };
      expect(getGrowthLogV2({ period: future }).length).toBe(0);
      expect(getGrowthLogV2({ period: { fromMs: 0 } }).length).toBe(1);
    });

    it("getGrowthLogV2 respects limit", () => {
      for (let i = 0; i < 5; i++) {
        recordMilestone({
          type: GROWTH_MILESTONE.PREDICTION_ACCURACY,
          description: `m${i}`,
        });
      }
      expect(getGrowthLogV2({ limit: 2 }).length).toBe(2);
    });
  });

  describe("configureEvolution + stats", () => {
    it("rejects unknown config key", () => {
      expect(() => configureEvolution({ key: "unknown", value: 1 })).toThrow(
        "Unknown config key",
      );
    });

    it("rejects invalid trainingStrategy", () => {
      expect(() =>
        configureEvolution({ key: "trainingStrategy", value: "bogus" }),
      ).toThrow("Invalid trainingStrategy");
    });

    it("rejects threshold out of [0, 1]", () => {
      expect(() =>
        configureEvolution({
          key: "knowledgeRetentionThreshold",
          value: 1.5,
        }),
      ).toThrow("knowledgeRetentionThreshold must be in [0, 1]");
    });

    it("accepts valid config values", () => {
      const c = configureEvolution({
        key: "knowledgeRetentionThreshold",
        value: 0.9,
      });
      expect(c.knowledgeRetentionThreshold).toBe(0.9);
    });

    it("getEvolutionConfig returns a copy (not a reference)", () => {
      const c1 = getEvolutionConfig();
      c1.assessmentDimensions.push("xxx");
      const c2 = getEvolutionConfig();
      expect(c2.assessmentDimensions).toEqual(
        Object.values(CAPABILITY_DIMENSION),
      );
    });

    it("getEvolutionStatsV2 aggregates V2 state", () => {
      assessCapabilityV2({ dimension: "reasoning", score: 0.5 });
      trainIncrementalV2({
        strategy: "replay",
        dataSize: 10,
        lossBefore: 0.5,
        lossAfter: 0.4,
      });
      selfDiagnoseV2();
      const stats = getEvolutionStatsV2();
      expect(stats.capabilityCount).toBe(1);
      expect(stats.trainingRuns).toBe(1);
      expect(stats.diagnoses.total).toBe(1);
    });

    it("_resetV2State clears V2 stores and restores defaults", () => {
      assessCapabilityV2({ dimension: "reasoning", score: 0.5 });
      configureEvolution({
        key: "knowledgeRetentionThreshold",
        value: 0.5,
      });
      _resetV2State();
      expect(listCapabilitiesV2().length).toBe(0);
      expect(getEvolutionConfig().knowledgeRetentionThreshold).toBe(0.85);
    });
  });
});
