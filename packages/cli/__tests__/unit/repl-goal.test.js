/**
 * REPL `/goal <condition>` pure core (repl-goal.js): a session completion
 * condition that EVALUATES + REPORTS after each turn (interactive; no auto
 * re-drive). Built on the tested goal-condition-engine.js; clock + fs/spawn +
 * model judge are injected, so it's fully deterministic here.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  _processDeps,
  parseGoalCommand,
  createReplGoal,
  renderGoalStart,
  renderGoalStatus,
  renderGoalVerdict,
  evaluateReplGoalTurn,
  REPL_GOAL_MAX_OUTER_TURNS,
} from "../../src/lib/repl-goal.js";

const originalProcessRunner = _processDeps.run;

afterEach(() => {
  _processDeps.run = originalProcessRunner;
});

const clock =
  (t = 0) =>
  () =>
    t;

describe("parseGoalCommand", () => {
  it("empty → status", () => {
    expect(parseGoalCommand("")).toEqual({ action: "status" });
    expect(parseGoalCommand("   ")).toEqual({ action: "status" });
  });
  it("clear keywords → clear", () => {
    for (const k of ["clear", "off", "stop", "drop"])
      expect(parseGoalCommand(k)).toEqual({ action: "clear" });
  });
  it("anything else → set with the spec", () => {
    expect(parseGoalCommand("exit-zero:npm test")).toEqual({
      action: "set",
      spec: "exit-zero:npm test",
    });
    expect(parseGoalCommand("the tests pass")).toEqual({
      action: "set",
      spec: "the tests pass",
    });
  });
});

describe("createReplGoal", () => {
  it("uses the generous interactive turn budget", () => {
    const g = createReplGoal("contains:DONE", { now: clock() });
    expect(g.budget.maxOuterTurns).toBe(REPL_GOAL_MAX_OUTER_TURNS);
    expect(g.condition.kind).toBe("contains");
  });
  it("throws on a malformed spec (caller reports)", () => {
    expect(() => createReplGoal("exit-zero:", { now: clock() })).toThrow();
  });
});

describe("render helpers", () => {
  it("renderGoalStatus differs for no-goal vs active", () => {
    expect(renderGoalStatus(null)[0]).toMatch(/No session goal/);
    const g = createReplGoal("regex:^OK$", { now: clock() });
    const lines = renderGoalStatus(g);
    expect(lines[0]).toMatch(/goal: regex:\^OK\$/);
    expect(lines[1]).toMatch(/regex check/);
  });
  it("renderGoalStart names the condition", () => {
    const g = createReplGoal("the build is green", { now: clock() });
    expect(renderGoalStart(g)[0]).toMatch(/goal set: the build is green/);
  });
});

describe("evaluateReplGoalTurn — deterministic", () => {
  it("contains: met when the answer contains the text", async () => {
    const g = createReplGoal("contains:ALL GREEN", { now: clock() });
    const r = await evaluateReplGoalTurn(g, "result: ALL GREEN now", {});
    expect(r.met).toBe(true);
    expect(r.done).toBe(true);
    expect(renderGoalVerdict(r.decision, r.events)[0]).toMatch(/✔ goal met/);
  });

  it("contains: not-yet when the text is absent", async () => {
    const g = createReplGoal("contains:ALL GREEN", { now: clock() });
    const r = await evaluateReplGoalTurn(g, "still failing", {});
    expect(r.met).toBe(false);
    expect(r.done).toBe(false);
    const line = renderGoalVerdict(r.decision, r.events)[0];
    expect(line).toMatch(/not yet met/);
    expect(line).toMatch(/outer turn 1/);
  });

  it("exit-zero: uses the injected spawnSync (exit 0 → met)", async () => {
    const g = createReplGoal("exit-zero:npm test", { now: clock() });
    const spawnSync = () => ({ status: 0 });
    const r = await evaluateReplGoalTurn(g, "", { spawnSync });
    expect(r.met).toBe(true);
  });

  it("exit-zero: uses the process broker adapter by default", async () => {
    _processDeps.run = vi.fn(() => ({ status: 0 }));
    const g = createReplGoal("exit-zero:npm test", { now: clock() });

    const r = await evaluateReplGoalTurn(g, "", { cwd: "C:/workspace" });

    expect(r.met).toBe(true);
    expect(_processDeps.run).toHaveBeenCalledWith(
      "npm test",
      [],
      expect.objectContaining({
        cwd: "C:/workspace",
        shell: true,
        timeout: 30000,
        origin: "repl-goal:exit-zero",
        policy: "allow",
        scope: "repl-goal",
      }),
    );
  });

  it("file-exists: uses the injected existsSync", async () => {
    const g = createReplGoal("file-exists:dist/app.js", { now: clock() });
    const r = await evaluateReplGoalTurn(g, "", {
      existsSync: (p) => p === "dist/app.js",
    });
    expect(r.met).toBe(true);
  });
});

describe("evaluateReplGoalTurn — model-judged", () => {
  it("delegates to the injected judge", async () => {
    const g = createReplGoal("the refactor is complete", { now: clock() });
    const judge = async (_cond, { finalText }) => ({
      met: /done/.test(finalText),
      reason: "judge saw done",
      evidence: { kind: "model" },
    });
    const r = await evaluateReplGoalTurn(g, "all done here", { judge });
    expect(r.met).toBe(true);
    expect(renderGoalVerdict(r.decision, r.events)[0]).toMatch(
      /judge saw done/,
    );
  });

  it("reports unmet when no judge is available for a model condition", async () => {
    const g = createReplGoal("looks good to me", { now: clock() });
    const r = await evaluateReplGoalTurn(g, "whatever", {});
    expect(r.met).toBe(false);
  });
});

describe("evaluateReplGoalTurn — exhaustion", () => {
  it("drops the goal after the outer-turn budget is spent", async () => {
    const g = createReplGoal("contains:NEVER", { now: clock() });
    let last;
    // Never-met condition: run until the hard turn budget exhausts it.
    for (let i = 0; i < REPL_GOAL_MAX_OUTER_TURNS; i++) {
      last = await evaluateReplGoalTurn(g, "nope", {});
    }
    expect(last.done).toBe(true);
    expect(renderGoalVerdict(last.decision, last.events)[0]).toMatch(
      /goal dropped/,
    );
  });
});
