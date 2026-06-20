import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const Database = require("better-sqlite3");
const { CICDOptimizer } = require("../cicd-optimizer.js");

// The optimizer talks to a db wrapper exposing exec/get/run(sql, paramsArray).
function makeDb() {
  const raw = new Database(":memory:");
  return {
    exec: (sql) => raw.exec(sql),
    get: (sql, params = []) => raw.prepare(sql).get(...params),
    run: (sql, params = []) => raw.prepare(sql).run(...params),
    _raw: raw,
  };
}

describe("CICDOptimizer build cache write path", () => {
  let opt, db;

  beforeEach(() => {
    db = makeDb();
    opt = new CICDOptimizer(db, process.cwd(), {});
    opt._ensureTables(); // create cicd_* tables without the heavy initialize()
  });

  it("recordBuildResult persists an entry that _checkBuildCache then finds", () => {
    expect(opt._checkBuildCache("build:main", "h1")).toBeFalsy();

    const r = opt.recordBuildResult("build:main", "h1", "/dist/main.js");
    expect(r.success).toBe(true);

    const cached = opt._checkBuildCache("build:main", "h1");
    expect(cached).toBeTruthy();
    expect(cached.step_name).toBe("build:main");
    expect(cached.input_hash).toBe("h1");
    expect(cached.output_path).toBe("/dist/main.js");
  });

  it("keeps one row per (step_name, input_hash), newest output wins", () => {
    opt.recordBuildResult("build:main", "h1", "/a");
    opt.recordBuildResult("build:main", "h1", "/b");
    const row = db.get(
      "SELECT COUNT(*) c FROM cicd_build_cache WHERE step_name=? AND input_hash=?",
      ["build:main", "h1"],
    );
    expect(row.c).toBe(1);
    expect(opt._checkBuildCache("build:main", "h1").output_path).toBe("/b");
  });

  it("rejects missing stepName/inputHash without writing", () => {
    expect(opt.recordBuildResult("", "h1").success).toBe(false);
    expect(opt.recordBuildResult("build:main", "").success).toBe(false);
    expect(db.get("SELECT COUNT(*) c FROM cicd_build_cache").c).toBe(0);
  });

  it("closes the loop: planIncrementalBuild marks a step cached after its result is recorded", () => {
    const changed = ["src/main/foo.js"];
    const plan1 = opt.planIncrementalBuild(changed);
    const step1 = plan1.steps.find((s) => s.name === "build:main");
    expect(step1).toBeTruthy();
    expect(step1.cached).toBe(false); // nothing recorded yet

    // Record the result for exactly the input hash the planner computes.
    opt.recordBuildResult("build:main", step1.inputHash, "/dist/main.js");

    const plan2 = opt.planIncrementalBuild(changed);
    const step2 = plan2.steps.find((s) => s.name === "build:main");
    expect(step2.cached).toBe(true); // now skippable
    expect(step2.estimatedMs).toBe(0);
    expect(plan2.cachedSteps).toBeGreaterThanOrEqual(1);
  });
});
