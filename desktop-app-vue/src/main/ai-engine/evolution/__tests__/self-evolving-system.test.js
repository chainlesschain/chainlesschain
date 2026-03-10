/**
 * SelfEvolvingSystem unit tests — Phase 100
 *
 * Covers: initialize, assessCapability, trainIncremental, selfDiagnose,
 *         selfRepair, predictBehavior, getGrowthLog, configure, exportModel
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
const { SelfEvolvingSystem } = require("../self-evolving-system");

// ─── Helpers ─────────────────────────────────────────────────────────────────
function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(prep),
    _prep: prep,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe("SelfEvolvingSystem", () => {
  let sys;
  let db;

  beforeEach(() => {
    sys = new SelfEvolvingSystem();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  it("should construct with default state", () => {
    expect(sys.initialized).toBe(false);
    expect(sys._capabilities.size).toBe(0);
    expect(sys._growthLog).toHaveLength(0);
    expect(sys._config.autoRepairEnabled).toBe(true);
  });

  // ── initialize ───────────────────────────────────────────────────────────
  it("should initialize with database", async () => {
    await sys.initialize(db);
    expect(sys.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it("should skip double initialization", async () => {
    await sys.initialize(db);
    await sys.initialize(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  // ── assessCapability ─────────────────────────────────────────────────────
  it("should assess a new capability", async () => {
    await sys.initialize(db);
    const cap = sys.assessCapability("Code Review", 0.85, "development");
    expect(cap.id).toBe("cap-code-review");
    expect(cap.name).toBe("Code Review");
    expect(cap.score).toBe(0.85);
    expect(cap.category).toBe("development");
    expect(cap.trend).toBe("stable"); // first assessment
    expect(cap.history).toHaveLength(1);
  });

  it("should detect improving trend on update", async () => {
    await sys.initialize(db);
    sys.assessCapability("Skill A", 0.5);
    const updated = sys.assessCapability("Skill A", 0.7);
    expect(updated.trend).toBe("improving");
    expect(updated.history).toHaveLength(2);
  });

  it("should detect declining trend on update", async () => {
    await sys.initialize(db);
    sys.assessCapability("Skill B", 0.8);
    const updated = sys.assessCapability("Skill B", 0.6);
    expect(updated.trend).toBe("declining");
  });

  it("should emit evolution:capability-assessed event", async () => {
    await sys.initialize(db);
    const listener = vi.fn();
    sys.on("evolution:capability-assessed", listener);
    sys.assessCapability("Test", 0.9);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test", score: 0.9 }),
    );
  });

  it("should log growth entry on assessment", async () => {
    await sys.initialize(db);
    sys.assessCapability("Test", 0.5);
    expect(sys._growthLog.length).toBeGreaterThan(0);
    expect(sys._growthLog[0].eventType).toBe("assessment");
  });

  // ── trainIncremental ─────────────────────────────────────────────────────
  it("should train a new model incrementally", async () => {
    await sys.initialize(db);
    const model = await sys.trainIncremental(null, [1, 2, 3], {
      name: "classifier",
    });
    expect(model.id).toMatch(/^model-/);
    expect(model.name).toBe("classifier");
    expect(model.dataPoints).toBe(3);
    expect(model.accuracy).toBeGreaterThan(0);
  });

  it("should accumulate data points on subsequent training", async () => {
    await sys.initialize(db);
    await sys.trainIncremental("m1", [1, 2, 3]);
    const model = await sys.trainIncremental("m1", [4, 5]);
    expect(model.dataPoints).toBe(5);
  });

  it("should increase accuracy with more data", async () => {
    await sys.initialize(db);
    const m1 = await sys.trainIncremental("m1", [1]);
    const acc1 = m1.accuracy;
    await sys.trainIncremental("m1", [2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const m2 = await sys.trainIncremental(
      "m1",
      Array.from({ length: 50 }, (_, i) => i),
    );
    expect(m2.accuracy).toBeGreaterThan(acc1);
  });

  it("should emit evolution:model-trained event", async () => {
    await sys.initialize(db);
    const listener = vi.fn();
    sys.on("evolution:model-trained", listener);
    await sys.trainIncremental("m1", [1]);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1" }),
    );
  });

  // ── selfDiagnose ─────────────────────────────────────────────────────────
  it("should perform self-diagnosis", async () => {
    await sys.initialize(db);
    const diag = sys.selfDiagnose();
    expect(diag.id).toMatch(/^diag-/);
    expect(diag.components).toBeDefined();
    expect(diag.components.length).toBe(4);
    expect(diag.overallStatus).toBeDefined();
  });

  it("should report needs-attention when no capabilities tracked", async () => {
    await sys.initialize(db);
    const diag = sys.selfDiagnose();
    // No capabilities or models — some components will be warning/info
    expect(diag.issues.length).toBeGreaterThan(0);
  });

  it("should emit evolution:diagnosed event", async () => {
    await sys.initialize(db);
    const listener = vi.fn();
    sys.on("evolution:diagnosed", listener);
    sys.selfDiagnose();
    expect(listener).toHaveBeenCalled();
  });

  // ── selfRepair ───────────────────────────────────────────────────────────
  it("should attempt high-memory repair", async () => {
    await sys.initialize(db);
    const result = await sys.selfRepair("high-memory");
    expect(result.issue).toBe("high-memory");
    expect(result.actions.length).toBeGreaterThan(0);
  });

  it("should handle stale-cache repair", async () => {
    await sys.initialize(db);
    const result = await sys.selfRepair("stale-cache");
    expect(result.actions).toContain("Cache cleanup initiated");
  });

  it("should handle degraded-model repair", async () => {
    await sys.initialize(db);
    const result = await sys.selfRepair("degraded-model");
    expect(result.actions).toContain("Model retraining scheduled");
  });

  it("should emit evolution:repaired event", async () => {
    await sys.initialize(db);
    const listener = vi.fn();
    sys.on("evolution:repaired", listener);
    await sys.selfRepair("memory");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ issue: "memory" }),
    );
  });

  // ── predictBehavior ──────────────────────────────────────────────────────
  it("should predict user behavior", async () => {
    await sys.initialize(db);
    const prediction = sys.predictBehavior("user-1");
    expect(prediction.userId).toBe("user-1");
    expect(prediction.predictions).toHaveLength(3);
    expect(prediction.confidence).toBeGreaterThan(0);
    expect(prediction.basedOn).toBe("historical-patterns");
  });

  // ── getGrowthLog ─────────────────────────────────────────────────────────
  it("should return growth log entries", async () => {
    await sys.initialize(db);
    sys.assessCapability("A", 0.5);
    sys.assessCapability("B", 0.6);
    const log = sys.getGrowthLog();
    expect(log.length).toBe(2);
  });

  it("should filter growth log by type", async () => {
    await sys.initialize(db);
    sys.assessCapability("A", 0.5);
    await sys.trainIncremental("m1", [1]);
    const assessments = sys.getGrowthLog({ type: "assessment" });
    expect(assessments.length).toBe(1);
    const trainings = sys.getGrowthLog({ type: "training" });
    expect(trainings.length).toBe(1);
  });

  it("should respect limit option", async () => {
    await sys.initialize(db);
    for (let i = 0; i < 10; i++) {
      sys.assessCapability(`Skill ${i}`, i * 0.1);
    }
    const log = sys.getGrowthLog({ limit: 5 });
    expect(log.length).toBe(5);
  });

  // ── configure ────────────────────────────────────────────────────────────
  it("should update configuration", async () => {
    await sys.initialize(db);
    const config = sys.configure({
      predictionWindow: 14,
      autoRepairEnabled: false,
    });
    expect(config.predictionWindow).toBe(14);
    expect(config.autoRepairEnabled).toBe(false);
    expect(config.assessmentInterval).toBe(3600000); // unchanged
  });

  // ── exportModel ──────────────────────────────────────────────────────────
  it("should export an existing model", async () => {
    await sys.initialize(db);
    await sys.trainIncremental("export-me", [1, 2, 3], {
      name: "export-model",
    });
    const exported = sys.exportModel("export-me");
    expect(exported.id).toBe("export-me");
    expect(exported.exportedAt).toBeDefined();
  });

  it("should return null for unknown model export", async () => {
    await sys.initialize(db);
    expect(sys.exportModel("nonexistent")).toBeNull();
  });
});
