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
