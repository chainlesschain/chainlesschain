/**
 * Session-level completion-condition engine (P1). Pure + deterministic: an
 * injected clock and injected checker deps mean no model or real agent loop.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  GOAL_EVENTS,
  GOAL_DECISION,
  DEFAULT_GOAL_BUDGET,
  normalizeGoalBudget,
  parseGoalCondition,
  isDeterministicCondition,
  checkDeterministicCondition,
  runDeterministicCheck,
  evaluateGoalStep,
  GoalConditionEngine,
} from "../../src/lib/goal-condition-engine.js";

describe("parseGoalCondition", () => {
  it("parses each deterministic checker prefix", () => {
    expect(parseGoalCondition("exit-zero:npm test")).toMatchObject({
      kind: "exit-zero",
      command: "npm test",
    });
    expect(parseGoalCondition("file-exists:dist/app.js")).toMatchObject({
      kind: "file-exists",
      path: "dist/app.js",
    });
    expect(parseGoalCondition("contains:ALL GREEN")).toMatchObject({
      kind: "contains",
      text: "ALL GREEN",
    });
    expect(parseGoalCondition("regex:^OK$")).toMatchObject({
      kind: "regex",
      pattern: "^OK$",
    });
  });

  it("treats an explicit or bare description as model-judged", () => {
    expect(parseGoalCondition("model:the tests pass")).toMatchObject({
      kind: "model",
      text: "the tests pass",
    });
    expect(parseGoalCondition("the tests pass")).toMatchObject({
      kind: "model",
      text: "the tests pass",
    });
    // A URL-ish description with a colon is still model-judged (unknown prefix).
    expect(parseGoalCondition("visit https://x/y works").kind).toBe("model");
  });

  it("rejects empty specs and empty checker payloads", () => {
    expect(() => parseGoalCondition("")).toThrow(/required/);
    expect(() => parseGoalCondition("exit-zero:")).toThrow(/command/);
    expect(() => parseGoalCondition("contains:")).toThrow(/text/);
  });

  it("classifies deterministic vs model", () => {
    expect(isDeterministicCondition(parseGoalCondition("contains:x"))).toBe(
      true,
    );
    expect(isDeterministicCondition(parseGoalCondition("just judge it"))).toBe(
      false,
    );
  });
});

describe("normalizeGoalBudget", () => {
  it("defaults a bounded outer-turn count, leaves other axes unbounded", () => {
    expect(normalizeGoalBudget({})).toEqual({
      maxOuterTurns: DEFAULT_GOAL_BUDGET.maxOuterTurns,
      maxTokens: null,
      maxCostUsd: null,
      maxTimeMs: null,
    });
  });

  it("keeps positive values and rejects junk (falls back / nulls)", () => {
    const b = normalizeGoalBudget({
      maxOuterTurns: 3,
      maxTokens: 5000,
      maxCostUsd: 0.5,
      maxTimeMs: -1,
    });
    expect(b.maxOuterTurns).toBe(3);
    expect(b.maxTokens).toBe(5000);
    expect(b.maxCostUsd).toBe(0.5);
    expect(b.maxTimeMs).toBe(null); // negative → unbounded
  });

  it("hard-caps the outer-turn count so it can never spin forever", () => {
    expect(normalizeGoalBudget({ maxOuterTurns: 1e9 }).maxOuterTurns).toBe(100);
  });
});

describe("checkDeterministicCondition (pure)", () => {
  it("contains / regex against the last output", () => {
    expect(
      checkDeterministicCondition(parseGoalCondition("contains:DONE"), {
        output: "work... DONE",
      }).met,
    ).toBe(true);
    expect(
      checkDeterministicCondition(parseGoalCondition("regex:^BUILD OK$"), {
        output: "prelude\nBUILD OK\n",
      }).met,
    ).toBe(true);
    expect(
      checkDeterministicCondition(parseGoalCondition("contains:DONE"), {
        output: "still working",
      }).met,
    ).toBe(false);
  });

  it("exit-zero reads the evidence exit code", () => {
    const cond = parseGoalCondition("exit-zero:npm test");
    expect(checkDeterministicCondition(cond, { exitCode: 0 }).met).toBe(true);
    expect(checkDeterministicCondition(cond, { exitCode: 1 }).met).toBe(false);
  });

  it("file-exists uses the injected predicate", () => {
    const cond = parseGoalCondition("file-exists:dist/app.js");
    expect(
      checkDeterministicCondition(cond, {
        fileExists: (p) => p === "dist/app.js",
      }).met,
    ).toBe(true);
    expect(
      checkDeterministicCondition(cond, { fileExists: () => false }).met,
    ).toBe(false);
  });

  it("an invalid regex fails closed (not met, no throw)", () => {
    const r = checkDeterministicCondition(
      { kind: "regex", pattern: "(" },
      { output: "x" },
    );
    expect(r.met).toBe(false);
    expect(r.reason).toMatch(/invalid regex/);
  });
});

describe("runDeterministicCheck", () => {
  it("runs exit-zero via a REAL spawn and reads the exit code", () => {
    const zero = runDeterministicCheck(
      parseGoalCondition("exit-zero:node -e 0"),
      {
        spawnSync,
      },
    );
    expect(zero.met).toBe(true);
    const nonzero = runDeterministicCheck(
      parseGoalCondition("exit-zero:node -e process.exit(3)"),
      { spawnSync },
    );
    expect(nonzero.met).toBe(false);
  });

  it("file-exists via injected existsSync; contains via lastOutput", () => {
    expect(
      runDeterministicCheck(parseGoalCondition("file-exists:/x"), {
        existsSync: (p) => p === "/x",
      }).met,
    ).toBe(true);
    expect(
      runDeterministicCheck(parseGoalCondition("contains:READY"), {
        lastOutput: "system READY",
      }).met,
    ).toBe(true);
  });
});

describe("evaluateGoalStep (reducer)", () => {
  const budget = normalizeGoalBudget({ maxOuterTurns: 3 });
  const s0 = {
    outerTurns: 0,
    tokens: 0,
    costUsd: 0,
    startedAtMs: 1000,
    done: false,
    outcome: null,
  };

  it("completes when the condition is met, emitting evaluated + completed", () => {
    const r = evaluateGoalStep(
      s0,
      { met: true, reason: "tests pass" },
      budget,
      {
        now: 1500,
      },
    );
    expect(r.decision).toBe(GOAL_DECISION.COMPLETE);
    expect(r.events.map((e) => e.type)).toEqual([
      GOAL_EVENTS.EVALUATED,
      GOAL_EVENTS.COMPLETED,
    ]);
    expect(r.events[1]).toMatchObject({ outerTurns: 1, elapsedMs: 500 });
    expect(r.state.done).toBe(true);
    expect(r.state.outcome).toBe("completed");
  });

  it("continues when unmet and under budget", () => {
    const r = evaluateGoalStep(s0, { met: false, reason: "not yet" }, budget, {
      now: 1000,
    });
    expect(r.decision).toBe(GOAL_DECISION.CONTINUE);
    expect(r.events.map((e) => e.type)).toEqual([GOAL_EVENTS.EVALUATED]);
    expect(r.state.outerTurns).toBe(1);
    expect(r.state.done).toBe(false);
  });

  it("exhausts on max_outer_turns", () => {
    const s = { ...s0, outerTurns: 2 }; // this step makes it 3 == cap
    const r = evaluateGoalStep(s, { met: false }, budget, { now: 1000 });
    expect(r.decision).toBe(GOAL_DECISION.EXHAUSTED);
    expect(r.events[1]).toMatchObject({
      type: GOAL_EVENTS.EXHAUSTED,
      limit: "max_outer_turns",
    });
  });

  it("exhausts on token / cost / time limits", () => {
    const tok = evaluateGoalStep(
      { ...s0, tokens: 5000 },
      { met: false },
      normalizeGoalBudget({ maxOuterTurns: 99, maxTokens: 5000 }),
      { now: 1000 },
    );
    expect(tok.state.limit).toBe("max_tokens");

    const time = evaluateGoalStep(
      s0,
      { met: false },
      normalizeGoalBudget({ maxOuterTurns: 99, maxTimeMs: 100 }),
      { now: 1200 }, // 200ms elapsed >= 100
    );
    expect(time.state.limit).toBe("max_time");
  });

  it("does not mutate the input state", () => {
    const copy = { ...s0 };
    evaluateGoalStep(s0, { met: true }, budget, { now: 1000 });
    expect(s0).toEqual(copy);
  });
});

describe("GoalConditionEngine", () => {
  it("drives a run to completion with an injected clock", () => {
    let t = 0;
    const engine = new GoalConditionEngine({
      condition: "contains:DONE",
      budget: { maxOuterTurns: 5 },
      now: () => t,
    });
    const started = engine.start();
    expect(started.type).toBe(GOAL_EVENTS.STARTED);

    // turn 1: not met → continue
    t = 100;
    engine.recordTurnUsage({ tokens: 10, costUsd: 0.01 });
    let r = engine.evaluate(
      checkDeterministicCondition(engine.condition, { output: "working" }),
    );
    expect(r.decision).toBe(GOAL_DECISION.CONTINUE);
    expect(engine.done).toBe(false);

    // turn 2: met → complete
    t = 250;
    engine.recordTurnUsage({ tokens: 15, costUsd: 0.02 });
    r = engine.evaluate(
      checkDeterministicCondition(engine.condition, { output: "all DONE" }),
    );
    expect(r.decision).toBe(GOAL_DECISION.COMPLETE);
    expect(engine.done).toBe(true);
    const completed = r.events.find((e) => e.type === GOAL_EVENTS.COMPLETED);
    expect(completed).toMatchObject({ outerTurns: 2, elapsedMs: 250 });
  });

  it("snapshots and restores across resume, preserving usage + start time", () => {
    let t = 0;
    const engine = new GoalConditionEngine({
      condition: "model:the feature works",
      budget: { maxOuterTurns: 4 },
      now: () => t,
    });
    engine.start();
    t = 500;
    engine.recordTurnUsage({ tokens: 100, costUsd: 0.5 });
    engine.evaluate({ met: false, reason: "turn 1" });
    const snap = engine.snapshot();
    expect(snap.state.outerTurns).toBe(1);
    expect(snap.state.tokens).toBe(100);

    // Resume in a "new process": restore, keep counting from the same start.
    let t2 = 800;
    const resumed = GoalConditionEngine.fromSnapshot(snap, { now: () => t2 });
    resumed.recordTurnUsage({ tokens: 50, costUsd: 0.25 });
    const r = resumed.evaluate({ met: true, reason: "done after resume" });
    expect(r.decision).toBe(GOAL_DECISION.COMPLETE);
    const done = r.events.find((e) => e.type === GOAL_EVENTS.COMPLETED);
    // cumulative across the resume boundary: 2 turns, 150 tokens, elapsed 800ms
    expect(done).toMatchObject({
      outerTurns: 2,
      tokens: 150,
      elapsedMs: 800,
    });
  });
});
