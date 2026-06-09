import { describe, it, expect } from "vitest";
import {
  buildGoalContext,
  goalPrepareCall,
  composePrepareCall,
} from "../../src/lib/goal-context.js";
import { defaultPrepareCall } from "../../src/lib/turn-context.js";

const activeGoal = (over = {}) => ({
  id: "goal-1",
  objective: "Ship the CLI goal feature",
  status: "active",
  progress: 40,
  keyResults: [
    { id: "kr-1", text: "store + commands", done: true },
    { id: "kr-2", text: "loop injection", target: 3, current: 1, done: false },
  ],
  ...over,
});

describe("buildGoalContext", () => {
  it("renders objective, progress, and open key results", () => {
    const s = buildGoalContext(activeGoal());
    expect(s).toContain("Ship the CLI goal feature");
    expect(s).toContain("40% complete");
    expect(s).toContain("loop injection");
    expect(s).toContain("[1/3]"); // target progress
    // completed KR is not listed
    expect(s).not.toContain("store + commands");
  });

  it("returns null for non-active goals", () => {
    expect(buildGoalContext(activeGoal({ status: "paused" }))).toBeNull();
    expect(buildGoalContext(activeGoal({ status: "done" }))).toBeNull();
  });

  it("returns null for missing goal or empty objective", () => {
    expect(buildGoalContext(null)).toBeNull();
    expect(buildGoalContext(activeGoal({ objective: "  " }))).toBeNull();
  });

  it("caps the number of listed key results", () => {
    const krs = Array.from({ length: 20 }, (_, i) => ({
      id: `kr-${i}`,
      text: `kr number ${i}`,
      done: false,
    }));
    const s = buildGoalContext(activeGoal({ keyResults: krs }));
    expect(s).toContain("more key results");
  });
});

describe("goalPrepareCall", () => {
  it("wraps buildGoalContext into a prepareCall payload", () => {
    const r = goalPrepareCall(activeGoal())();
    expect(r).toHaveProperty("systemSuffix");
    expect(r.systemSuffix).toContain("Ship the CLI goal feature");
  });

  it("returns null when goal yields no context", () => {
    expect(goalPrepareCall(null)()).toBeNull();
    expect(goalPrepareCall(activeGoal({ status: "paused" }))()).toBeNull();
  });
});

describe("composePrepareCall", () => {
  it("concatenates suffixes from multiple prepareCall fns", async () => {
    const a = () => ({ systemSuffix: "FROM-A" });
    const b = () => ({ systemSuffix: "FROM-B" });
    const r = await composePrepareCall([a, b])({});
    expect(r.systemSuffix).toBe("FROM-A\n\nFROM-B");
  });

  it("skips null/empty members and failing members", async () => {
    const a = () => ({ systemSuffix: "FROM-A" });
    const nul = () => null;
    const empty = () => ({ systemSuffix: "   " });
    const boom = () => {
      throw new Error("boom");
    };
    const r = await composePrepareCall([a, nul, empty, boom])({});
    expect(r.systemSuffix).toBe("FROM-A");
  });

  it("returns null when nothing contributes", async () => {
    const r = await composePrepareCall([() => null, undefined])({});
    expect(r).toBeNull();
  });

  it("composes goal context WITH the real defaultPrepareCall", async () => {
    // defaultPrepareCall reads cwd/git — both suffixes must survive composition.
    const composed = composePrepareCall([
      defaultPrepareCall,
      goalPrepareCall(activeGoal()),
    ]);
    const r = await composed({ iteration: 1, cwd: process.cwd() });
    expect(r).not.toBeNull();
    expect(r.systemSuffix).toContain("Ship the CLI goal feature");
  });
});
