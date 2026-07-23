/**
 * REPL `/goal <condition>` — a SESSION completion condition for interactive use.
 *
 * Three distinct "goal" concepts, kept separate on purpose:
 *   - `cc goal`               → long-term, cross-session OKR (goal-store.js).
 *   - headless --goal-condition → AUTO re-drives outer turns until met/exhausted.
 *   - REPL `/goal <cond>`      → THIS: a human is present each turn, so it
 *     EVALUATES + REPORTS after every turn whether the condition is met. It does
 *     NOT auto-submit follow-ups (that autonomous loop belongs to headless, where
 *     no human is watching) — the user decides whether to keep going.
 *
 * This is the pure, clock/dep-injected core over the already-tested
 * goal-condition-engine.js; the agent-repl wiring is thin display + eval glue.
 */

import {
  isDeterministicCondition,
  runDeterministicCheck,
  GoalConditionEngine,
  GOAL_DECISION,
} from "./goal-condition-engine.js";
import executionBroker from "./process-execution-broker/index.js";

const brokerRunner = executionBroker.spawnSync.bind(executionBroker);

export const _processDeps = {
  run: brokerRunner,
};

function runReplGoalCommand(command, options = {}) {
  return _processDeps.run(command, [], {
    ...options,
    timeout: options.timeout ?? 30000,
    origin: "repl-goal:exit-zero",
    policy: "allow",
    scope: "repl-goal",
  });
}

// Interactive sessions are human-paced, so the turn-count budget is generous —
// it exists only as a backstop (the engine hard-caps at 100 regardless). The
// meaningful signal in the REPL is met / not-yet-met, not budget exhaustion.
export const REPL_GOAL_MAX_OUTER_TURNS = 100;

/** Parse the `/goal` argument into an intent. Empty → status; a keyword → clear. */
export function parseGoalCommand(arg) {
  const s = String(arg ?? "").trim();
  if (!s) return { action: "status" };
  if (s === "clear" || s === "off" || s === "stop" || s === "drop")
    return { action: "clear" };
  return { action: "set", spec: s };
}

/**
 * Create the REPL's session goal engine for a spec. Throws (via
 * parseGoalCondition) on a malformed spec so the caller can report it.
 */
export function createReplGoal(spec, { now = () => 0 } = {}) {
  return new GoalConditionEngine({
    condition: spec,
    budget: { maxOuterTurns: REPL_GOAL_MAX_OUTER_TURNS },
    now,
  });
}

/** Display lines shown when a goal is set. */
export function renderGoalStart(engine) {
  return [
    `◎ goal set: ${engine.condition.source}`,
    `  evaluated after each turn (≤ ${engine.budget.maxOuterTurns} turns); /goal clear to drop, /goal to check`,
  ];
}

/** Display lines for `/goal` with no argument (status). */
export function renderGoalStatus(engine) {
  if (!engine)
    return [
      "No session goal. Set one with /goal <condition>",
      "  e.g. /goal exit-zero:npm test · /goal file-exists:dist/app.js · /goal contains:ALL GREEN · /goal the tests pass",
    ];
  const s = engine.state;
  return [
    `◎ goal: ${engine.condition.source}`,
    `  progress: outer turn ${s.outerTurns}/${engine.budget.maxOuterTurns}` +
      (isDeterministicCondition(engine.condition)
        ? ` (${engine.condition.kind} check)`
        : " (model-judged)"),
  ];
}

/** Verdict display lines for one evaluation's decision + events. */
export function renderGoalVerdict(decision, events) {
  const evaluated = (events || []).find((e) => e.type === "goal_evaluated");
  if (decision === GOAL_DECISION.COMPLETE) {
    const done = (events || []).find((e) => e.type === "goal_completed");
    return [
      `✔ goal met: ${done?.reason ?? evaluated?.reason ?? "condition met"}`,
    ];
  }
  if (decision === GOAL_DECISION.EXHAUSTED) {
    const ex = (events || []).find((e) => e.type === "goal_exhausted");
    return [
      `⛔ goal dropped — ${ex?.reason ?? "budget exhausted"}${ex?.limit ? ` (${ex.limit})` : ""}`,
    ];
  }
  return [
    `◎ goal not yet met: ${evaluated?.reason ?? "unmet"} · outer turn ${evaluated?.outerTurns ?? "?"}`,
  ];
}

/**
 * Evaluate the session goal against a completed turn's final text. Deterministic
 * conditions run inline (contains/regex on the text; exit-zero/file-exists via
 * injected process runner/`existsSync`); a model condition delegates to `judge`.
 *
 * @param {GoalConditionEngine} engine
 * @param {string} finalText  the assistant's answer this turn
 * @param {object} deps { cwd, spawnSync, existsSync, judge, tokens, costUsd }
 *   judge(condition, {finalText}) => {met, reason, evidence}
 * @returns {Promise<{decision, events, done, met}>}
 */
export async function evaluateReplGoalTurn(engine, finalText, deps = {}) {
  engine.recordTurnUsage({ tokens: deps.tokens, costUsd: deps.costUsd });
  const cond = engine.condition;
  let evaluation;
  if (isDeterministicCondition(cond)) {
    evaluation = runDeterministicCheck(cond, {
      lastOutput: finalText,
      cwd: deps.cwd,
      spawnSync: deps.spawnSync || runReplGoalCommand,
      existsSync: deps.existsSync,
    });
  } else if (typeof deps.judge === "function") {
    evaluation = await deps.judge(cond, { finalText });
  } else {
    evaluation = {
      met: false,
      reason: "no model judge available for this condition",
      evidence: { kind: "model" },
    };
  }
  const { decision, events } = engine.evaluate(evaluation);
  return {
    decision,
    events,
    done: engine.done,
    met: decision === GOAL_DECISION.COMPLETE,
  };
}
