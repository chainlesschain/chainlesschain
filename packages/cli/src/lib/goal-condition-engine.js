/**
 * Session-level completion-condition engine (P1 §"会话级完成条件引擎").
 *
 * Distinct from `cc goal` (long-term, cross-session OKR progress) and from
 * `cc loop` (a timer that re-runs ONE command): this drives the agent's OUTER
 * turns. After each outer turn an independent evaluator judges a completion
 * CONDITION; if unmet, the runner starts the next outer turn — until the
 * condition is met (`completed`) or a budget is exhausted (`exhausted`).
 *
 * The engine is a pure reducer over usage + per-turn evaluations, so it is
 * deterministically testable without a model or the real agent loop. It:
 *   - supports model-judged conditions AND deterministic checkers
 *     (exit-zero / file-exists / contains / regex),
 *   - enforces max_outer_turns and token / cost / time budgets,
 *   - emits the SDK event taxonomy (goal_started / goal_evaluated /
 *     goal_completed / goal_exhausted) with structured reason, evidence and
 *     turn/token/cost/time, and
 *   - snapshots/restores so a condition survives `--resume`.
 *
 * The clock is injected (`now`) and NEVER read implicitly, so snapshots replay
 * identically and tests are deterministic.
 */

/** SDK event taxonomy for the completion-condition loop. */
export const GOAL_EVENTS = Object.freeze({
  STARTED: "goal_started",
  EVALUATED: "goal_evaluated",
  COMPLETED: "goal_completed",
  EXHAUSTED: "goal_exhausted",
});

/** Terminal decisions the reducer can return alongside `continue`. */
export const GOAL_DECISION = Object.freeze({
  CONTINUE: "continue",
  COMPLETE: "complete",
  EXHAUSTED: "exhausted",
});

/** Default budget — a bounded outer-turn count; other axes unbounded (null). */
export const DEFAULT_GOAL_BUDGET = Object.freeze({
  maxOuterTurns: 10,
  maxTokens: null,
  maxCostUsd: null,
  maxTimeMs: null,
});

// A hard ceiling so a misconfigured condition can never spin forever.
const OUTER_TURN_HARD_CAP = 100;

function positiveIntOrNull(value, cap) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const floored = Math.floor(n);
  return cap ? Math.min(floored, cap) : floored;
}

function positiveNumOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Normalize a budget: sane defaults, positive values, hard outer-turn cap. */
export function normalizeGoalBudget(input = {}) {
  const maxOuterTurns =
    positiveIntOrNull(input.maxOuterTurns, OUTER_TURN_HARD_CAP) ??
    DEFAULT_GOAL_BUDGET.maxOuterTurns;
  return {
    maxOuterTurns,
    maxTokens: positiveIntOrNull(input.maxTokens),
    maxCostUsd: positiveNumOrNull(input.maxCostUsd),
    maxTimeMs: positiveIntOrNull(input.maxTimeMs),
  };
}

/**
 * Parse a `--goal-condition` spec into a condition descriptor. A `kind:` prefix
 * selects a deterministic checker; anything else (or an explicit `model:`) is
 * model-judged natural language.
 *
 *   exit-zero:npm test        → run the command, met iff exit 0
 *   file-exists:dist/app.js   → met iff the path exists
 *   contains:ALL GREEN        → met iff the last output contains the text
 *   regex:^BUILD OK$          → met iff the last output matches
 *   model:the tests pass      → a model judges the transcript
 *   the tests pass            → (bare) model-judged
 */
export function parseGoalCondition(spec) {
  const raw = String(spec ?? "").trim();
  if (!raw) throw new Error("goal condition is required");
  const idx = raw.indexOf(":");
  const prefix = idx === -1 ? "" : raw.slice(0, idx).trim().toLowerCase();
  const rest = idx === -1 ? "" : raw.slice(idx + 1).trim();
  switch (prefix) {
    case "exit-zero":
    case "exit0":
      if (!rest) throw new Error("exit-zero condition needs a command");
      return { kind: "exit-zero", command: rest, source: raw };
    case "file-exists":
    case "file":
      if (!rest) throw new Error("file-exists condition needs a path");
      return { kind: "file-exists", path: rest, source: raw };
    case "contains":
      if (!rest) throw new Error("contains condition needs text");
      return { kind: "contains", text: rest, source: raw };
    case "regex":
      if (!rest) throw new Error("regex condition needs a pattern");
      return { kind: "regex", pattern: rest, source: raw };
    case "model":
      if (!rest) throw new Error("model condition needs a description");
      return { kind: "model", text: rest, source: raw };
    default:
      return { kind: "model", text: raw, source: raw };
  }
}

/** True when a condition is a deterministic checker (not model-judged). */
export function isDeterministicCondition(condition) {
  return Boolean(condition) && condition.kind !== "model";
}

/**
 * Evaluate a deterministic condition against gathered evidence — PURE.
 * `evidence` supplies `output` (last turn text), `exitCode`, and a
 * `fileExists(path) => boolean` predicate. Returns `{met, reason, evidence}`.
 */
export function checkDeterministicCondition(condition, evidence = {}) {
  const output = String(evidence.output ?? "");
  switch (condition?.kind) {
    case "contains": {
      const met = output.includes(condition.text);
      return {
        met,
        reason: met
          ? `output contains "${condition.text}"`
          : `output does not contain "${condition.text}"`,
        evidence: { kind: "contains", matched: met },
      };
    }
    case "regex": {
      let re;
      try {
        re = new RegExp(condition.pattern, condition.flags || "m");
      } catch (err) {
        return {
          met: false,
          reason: `invalid regex: ${err.message}`,
          evidence: { kind: "regex", error: true },
        };
      }
      const met = re.test(output);
      return {
        met,
        reason: met
          ? `output matches /${condition.pattern}/`
          : `output does not match /${condition.pattern}/`,
        evidence: { kind: "regex", matched: met },
      };
    }
    case "exit-zero": {
      const met = Number(evidence.exitCode) === 0;
      return {
        met,
        reason: `\`${condition.command}\` exited ${evidence.exitCode}`,
        evidence: { kind: "exit-zero", exitCode: evidence.exitCode ?? null },
      };
    }
    case "file-exists": {
      const fx = typeof evidence.fileExists === "function";
      const met = fx ? evidence.fileExists(condition.path) === true : false;
      return {
        met,
        reason: met
          ? `${condition.path} exists`
          : `${condition.path} does not exist`,
        evidence: { kind: "file-exists", path: condition.path, met },
      };
    }
    default:
      return {
        met: false,
        reason: `not a deterministic condition (${condition?.kind})`,
        evidence: { kind: condition?.kind ?? "unknown" },
      };
  }
}

/**
 * Gather evidence and run a deterministic check. Deps (`spawnSync`,
 * `existsSync`) are injected for tests; `lastOutput` feeds contains/regex.
 */
export function runDeterministicCheck(condition, deps = {}) {
  const evidence = { output: deps.lastOutput ?? "" };
  if (condition.kind === "exit-zero") {
    const spawnSync = deps.spawnSync;
    if (typeof spawnSync !== "function") {
      return {
        met: false,
        reason: "no spawnSync available for exit-zero",
        evidence: { kind: "exit-zero", error: true },
      };
    }
    const res = spawnSync(condition.command, {
      cwd: deps.cwd,
      shell: true,
      encoding: "utf8",
      windowsHide: true,
    });
    evidence.exitCode = res?.status ?? (res?.error ? 1 : null);
  } else if (condition.kind === "file-exists") {
    const existsSync = deps.existsSync;
    evidence.fileExists = (p) =>
      typeof existsSync === "function" ? existsSync(p) === true : false;
  }
  return checkDeterministicCondition(condition, evidence);
}

function usageSnapshot(state, nowMs) {
  return {
    outerTurns: state.outerTurns,
    tokens: state.tokens,
    costUsd: state.costUsd,
    elapsedMs: Math.max(0, nowMs - state.startedAtMs),
  };
}

function whichLimitHit(state, budget, nowMs) {
  if (budget.maxOuterTurns != null && state.outerTurns >= budget.maxOuterTurns)
    return "max_outer_turns";
  if (budget.maxTokens != null && state.tokens >= budget.maxTokens)
    return "max_tokens";
  if (budget.maxCostUsd != null && state.costUsd >= budget.maxCostUsd)
    return "max_cost";
  if (
    budget.maxTimeMs != null &&
    Math.max(0, nowMs - state.startedAtMs) >= budget.maxTimeMs
  )
    return "max_time";
  return null;
}

/**
 * The pure decision step. Given the accumulated `state`, this turn's
 * `evaluation` ({met, reason, evidence}), the `budget`, and the current time,
 * decide `complete | continue | exhausted` and produce events. Always emits a
 * `goal_evaluated`; adds a terminal `goal_completed` / `goal_exhausted` when
 * the loop stops. Does NOT mutate `state` — returns the next one.
 */
export function evaluateGoalStep(state, evaluation, budget, opts = {}) {
  const nowMs = Number(opts.now ?? state.startedAtMs);
  const next = {
    ...state,
    outerTurns: state.outerTurns + 1,
  };
  const usage = usageSnapshot(next, nowMs);
  const met = evaluation?.met === true;
  const evaluated = {
    type: GOAL_EVENTS.EVALUATED,
    met,
    reason: evaluation?.reason ?? null,
    evidence: evaluation?.evidence ?? null,
    ...usage,
  };
  if (met) {
    return {
      state: { ...next, done: true, outcome: "completed" },
      decision: GOAL_DECISION.COMPLETE,
      events: [
        evaluated,
        {
          type: GOAL_EVENTS.COMPLETED,
          reason: evaluation?.reason ?? "condition met",
          evidence: evaluation?.evidence ?? null,
          ...usage,
        },
      ],
    };
  }
  const limit = whichLimitHit(next, budget, nowMs);
  if (limit) {
    return {
      state: { ...next, done: true, outcome: "exhausted", limit },
      decision: GOAL_DECISION.EXHAUSTED,
      events: [
        evaluated,
        {
          type: GOAL_EVENTS.EXHAUSTED,
          limit,
          reason: `budget exhausted (${limit})`,
          ...usage,
        },
      ],
    };
  }
  return { state: next, decision: GOAL_DECISION.CONTINUE, events: [evaluated] };
}

/**
 * Stateful wrapper over the reducer for the runner. Inject `now` (a `() => ms`
 * clock) so behavior is deterministic and snapshot-replayable.
 */
export class GoalConditionEngine {
  constructor({ condition, budget, now } = {}) {
    this.condition =
      typeof condition === "string" ? parseGoalCondition(condition) : condition;
    this.budget = normalizeGoalBudget(budget);
    this._now = typeof now === "function" ? now : () => 0;
    this.state = {
      outerTurns: 0,
      tokens: 0,
      costUsd: 0,
      startedAtMs: this._now(),
      done: false,
      outcome: null,
    };
  }

  /** Emit the opening event; call once before the first outer turn. */
  start() {
    return {
      type: GOAL_EVENTS.STARTED,
      condition: this.condition,
      budget: this.budget,
      startedAtMs: this.state.startedAtMs,
    };
  }

  /** Accumulate a turn's usage before evaluating it. */
  recordTurnUsage({ tokens = 0, costUsd = 0 } = {}) {
    this.state = {
      ...this.state,
      tokens: this.state.tokens + (Number(tokens) || 0),
      costUsd: this.state.costUsd + (Number(costUsd) || 0),
    };
    return this.state;
  }

  /** Evaluate this outer turn; returns `{decision, events}`. */
  evaluate(evaluation) {
    const result = evaluateGoalStep(this.state, evaluation, this.budget, {
      now: this._now(),
    });
    this.state = result.state;
    return { decision: result.decision, events: result.events };
  }

  get done() {
    return this.state.done === true;
  }

  /** Serialize for `--resume`. startedAtMs is preserved so time keeps counting. */
  snapshot() {
    return {
      condition: this.condition,
      budget: this.budget,
      state: { ...this.state },
    };
  }

  /** Restore a prior run (same clock injection contract). */
  static fromSnapshot(snap, { now } = {}) {
    const engine = new GoalConditionEngine({
      condition: snap.condition,
      budget: snap.budget,
      now,
    });
    engine.state = { ...snap.state };
    return engine;
  }
}
