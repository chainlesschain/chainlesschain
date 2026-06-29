import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { SelfEvolvingSystem } = require("../self-evolving-system.js");

describe("SelfEvolvingSystem._logGrowth persistence", () => {
  let engine;
  let runs;

  beforeEach(() => {
    engine = new SelfEvolvingSystem();
    runs = [];
    engine.db = {
      prepare: (sql) => ({
        run: (...args) => {
          runs.push({ sql, args });
          return { changes: 1 };
        },
      }),
    };
  });

  it("persists each growth event to evolution_growth_log", () => {
    engine._logGrowth("assess", "capability assessed", "cap-1", 0.5);
    const inserts = runs.filter((r) => r.sql.includes("evolution_growth_log"));
    expect(inserts).toHaveLength(1);
    // args: id, event_type, description, capability_id, delta
    expect(inserts[0].args[1]).toBe("assess");
    expect(inserts[0].args[2]).toBe("capability assessed");
    expect(inserts[0].args[3]).toBe("cap-1");
    expect(inserts[0].args[4]).toBe(0.5);
  });

  it("still records the event in the in-memory growth log", () => {
    engine._logGrowth("repair", "self-repair", null, 0);
    expect(engine._growthLog).toHaveLength(1);
    expect(engine._growthLog[0].eventType).toBe("repair");
  });

  it("does not throw when the db is unavailable (in-memory still updates)", () => {
    engine.db = null;
    expect(() => engine._logGrowth("x", "y", null, 0)).not.toThrow();
    expect(engine._growthLog).toHaveLength(1);
  });
});

describe("SelfEvolvingSystem restart restore (load on init)", () => {
  function restoreDb(rowsByTable) {
    return {
      exec: vi.fn(),
      prepare: (sql) => ({
        all: () => {
          for (const [tbl, rows] of Object.entries(rowsByTable)) {
            if (sql.includes(tbl)) {
              return rows;
            }
          }
          return [];
        },
        get: () => null,
        run: () => ({ changes: 1 }),
      }),
    };
  }

  it("reloads the growth log so getGrowthLog is populated after restart", async () => {
    const engine = new SelfEvolvingSystem();
    // The write side persisted to evolution_growth_log, but init never loaded it
    // back → getGrowthLog returned empty after restart. Now it rehydrates.
    await engine.initialize(
      restoreDb({
        evolution_growth_log: [
          {
            id: "g1",
            event_type: "training",
            description: "trained",
            capability_id: null,
            delta: 0.01,
            created_at: new Date().toISOString(),
          },
        ],
      }),
    );
    const log = engine.getGrowthLog();
    expect(log).toHaveLength(1);
    expect(log[0].eventType).toBe("training");
  });

  it("reloads learning models so exportModel works after restart", async () => {
    const engine = new SelfEvolvingSystem();
    await engine.initialize(
      restoreDb({
        evolution_models: [
          {
            id: "model-x",
            name: "M",
            type: "classification",
            accuracy: 0.8,
            data_points: 100,
            status: "active",
          },
        ],
      }),
    );
    const exported = engine.exportModel("model-x");
    expect(exported).not.toBeNull();
    expect(exported.id).toBe("model-x");
    expect(exported.dataPoints).toBe(100);
  });
});
