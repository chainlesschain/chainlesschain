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
} from "../../src/lib/evolution-system.js";

describe("evolution-system", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
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
});
