/**
 * QualityGate — pluggable quality-check registry for pipeline results.
 *
 * Path B-2 of CutClaw architecture alignment. Generalizes the video
 * editing reviewer pattern (protagonist-ratio + aesthetic-score checkers)
 * into a domain-agnostic registry that any skill/agent can use.
 *
 * Design:
 *   - Register named checkers: (result, context) => { pass, score, reason }
 *   - Run all (or subset) checkers against a result
 *   - Aggregate scores with configurable weights
 *   - Policy-driven pass/fail threshold
 *   - Integrates with ApprovalGate for human-in-the-loop escalation
 */

const CHECK_RESULT = Object.freeze({
  PASS: "pass",
  FAIL: "fail",
  SKIP: "skip",
});

const AGGREGATE = Object.freeze({
  WEIGHTED_MEAN: "weighted-mean",
  MIN: "min",
  ALL_PASS: "all-pass",
});

const VALID_AGGREGATES = new Set(Object.values(AGGREGATE));

/**
 * Validate a single checker definition.
 */
function validateChecker(checker) {
  if (!checker || typeof checker !== "object") {
    return { valid: false, reason: "checker must be an object" };
  }
  if (typeof checker.name !== "string" || !checker.name) {
    return { valid: false, reason: "checker.name is required" };
  }
  if (typeof checker.fn !== "function") {
    return { valid: false, reason: "checker.fn must be a function" };
  }
  if (checker.weight != null && (typeof checker.weight !== "number" || checker.weight < 0)) {
    return { valid: false, reason: "checker.weight must be a non-negative number" };
  }
  return { valid: true };
}

/**
 * Compute aggregate score from individual check results.
 *
 * @param {object[]} checks - [{ name, pass, score, weight }]
 * @param {string} strategy - one of AGGREGATE values
 * @returns {number} aggregate score in [0, 1]
 */
function aggregateScore(checks, strategy = AGGREGATE.WEIGHTED_MEAN) {
  const scored = checks.filter(
    (c) => c.status !== CHECK_RESULT.SKIP && typeof c.score === "number",
  );
  if (scored.length === 0) return 1; // no checks → pass by default

  switch (strategy) {
    case AGGREGATE.MIN:
      return Math.min(...scored.map((c) => c.score));

    case AGGREGATE.ALL_PASS:
      return scored.every((c) => c.pass) ? 1 : 0;

    case AGGREGATE.WEIGHTED_MEAN:
    default: {
      let totalWeight = 0;
      let weightedSum = 0;
      for (const c of scored) {
        const w = c.weight ?? 1;
        totalWeight += w;
        weightedSum += c.score * w;
      }
      return totalWeight > 0 ? weightedSum / totalWeight : 0;
    }
  }
}

class QualityGate {
  /**
   * @param {object} [options]
   * @param {number} [options.threshold=0.6] - minimum aggregate score to pass
   * @param {string} [options.aggregate="weighted-mean"] - scoring strategy
   * @param {Function} [options.onCheck] - (checkResult) => void — telemetry hook
   */
  constructor(options = {}) {
    this._checkers = new Map(); // name → { name, fn, weight, description, tags }
    this._threshold = typeof options.threshold === "number" ? options.threshold : 0.6;

    const agg = options.aggregate || AGGREGATE.WEIGHTED_MEAN;
    if (!VALID_AGGREGATES.has(agg)) {
      throw new Error(`QualityGate: invalid aggregate strategy "${agg}"`);
    }
    this._aggregate = agg;
    this._onCheck = options.onCheck || null;
  }

  get threshold() {
    return this._threshold;
  }

  set threshold(v) {
    if (typeof v !== "number" || v < 0 || v > 1) {
      throw new Error("QualityGate: threshold must be a number in [0, 1]");
    }
    this._threshold = v;
  }

  get aggregate() {
    return this._aggregate;
  }

  /**
   * Register a quality checker.
   *
   * @param {object} checker
   * @param {string} checker.name - unique identifier
   * @param {Function} checker.fn - async (result, context) => { pass, score, reason? }
   * @param {number} [checker.weight=1] - weight for weighted-mean aggregation
   * @param {string} [checker.description]
   * @param {string[]} [checker.tags] - for selective runs (e.g., ["video", "vision"])
   */
  register(checker) {
    const { valid, reason } = validateChecker(checker);
    if (!valid) {
      throw new Error(`QualityGate.register: ${reason}`);
    }
    this._checkers.set(checker.name, {
      name: checker.name,
      fn: checker.fn,
      weight: checker.weight ?? 1,
      description: checker.description || "",
      tags: Array.isArray(checker.tags) ? [...checker.tags] : [],
    });
  }

  /**
   * Unregister a checker by name.
   * @returns {boolean} true if the checker existed
   */
  unregister(name) {
    return this._checkers.delete(name);
  }

  /**
   * List registered checkers (without fn — safe for serialization).
   */
  list() {
    return [...this._checkers.values()].map((c) => ({
      name: c.name,
      weight: c.weight,
      description: c.description,
      tags: c.tags,
    }));
  }

  /**
   * Return checker count.
   */
  get size() {
    return this._checkers.size;
  }

  /**
   * Run quality checks on a result.
   *
   * @param {object} result - the pipeline/task result to evaluate
   * @param {object} [context] - shared context passed to each checker
   * @param {object} [options]
   * @param {string[]} [options.only] - run only checkers with these names
   * @param {string[]} [options.tags] - run only checkers matching any of these tags
   * @returns {{ pass: boolean, score: number, checks: object[], threshold: number }}
   */
  async check(result, context = {}, options = {}) {
    const checkers = this._selectCheckers(options);
    const checks = [];

    for (const checker of checkers) {
      let checkResult;
      try {
        const raw = await checker.fn(result, context);
        checkResult = {
          name: checker.name,
          pass: !!raw.pass,
          score: typeof raw.score === "number" ? Math.max(0, Math.min(1, raw.score)) : (raw.pass ? 1 : 0),
          reason: raw.reason || "",
          status: CHECK_RESULT.PASS,
          weight: checker.weight,
        };
        if (!checkResult.pass) {
          checkResult.status = CHECK_RESULT.FAIL;
        }
      } catch (err) {
        checkResult = {
          name: checker.name,
          pass: false,
          score: 0,
          reason: `checker error: ${err.message}`,
          status: CHECK_RESULT.FAIL,
          weight: checker.weight,
        };
      }

      checks.push(checkResult);

      if (this._onCheck) {
        try {
          this._onCheck(checkResult);
        } catch {
          /* swallow telemetry errors */
        }
      }
    }

    const score = aggregateScore(checks, this._aggregate);
    const pass = score >= this._threshold;

    return { pass, score, checks, threshold: this._threshold };
  }

  /**
   * Select checkers based on options.only / options.tags filters.
   */
  _selectCheckers(options) {
    let checkers = [...this._checkers.values()];

    if (Array.isArray(options.only) && options.only.length > 0) {
      const nameSet = new Set(options.only);
      checkers = checkers.filter((c) => nameSet.has(c.name));
    }

    if (Array.isArray(options.tags) && options.tags.length > 0) {
      const tagSet = new Set(options.tags);
      checkers = checkers.filter((c) =>
        c.tags.some((t) => tagSet.has(t)),
      );
    }

    return checkers;
  }
}

// ── Built-in checker factories ─────────────────────────────────────
// These return checker objects ready for gate.register(). They are
// factories (not pre-registered) so callers opt-in explicitly.

/**
 * Vision-based protagonist ratio checker.
 * Expects result to have `protagonist_ratio` (0-1).
 */
function createProtagonistChecker(options = {}) {
  const minRatio = options.minRatio ?? 0.3;
  return {
    name: "vision-protagonist",
    description: `Checks protagonist_ratio >= ${minRatio}`,
    weight: options.weight ?? 0.6,
    tags: ["video", "vision"],
    fn: async (result) => {
      const ratio = result.protagonist_ratio ?? 0;
      return {
        pass: ratio >= minRatio,
        score: Math.min(ratio / Math.max(minRatio, 0.01), 1),
        reason: ratio < minRatio
          ? `protagonist_ratio ${ratio.toFixed(2)} < ${minRatio}`
          : undefined,
      };
    },
  };
}

/**
 * Duration accuracy checker.
 * Compares result.total_duration against result.target_duration.
 */
function createDurationChecker(options = {}) {
  const tolerance = options.tolerance ?? 0.3; // 30% deviation allowed
  return {
    name: "duration-accuracy",
    description: `Checks duration within ${(tolerance * 100).toFixed(0)}% of target`,
    weight: options.weight ?? 0.4,
    tags: ["video", "timing"],
    fn: async (result) => {
      const target = result.target_duration || 0;
      const actual = result.total_duration || 0;
      if (target <= 0) return { pass: true, score: 1 };
      const deviation = Math.abs(actual - target) / target;
      const score = 1 - Math.min(deviation / Math.max(tolerance, 0.01), 1);
      return {
        pass: deviation <= tolerance,
        score,
        reason: deviation > tolerance
          ? `duration ${actual.toFixed(1)}s deviates ${(deviation * 100).toFixed(0)}% from target ${target.toFixed(1)}s`
          : undefined,
      };
    },
  };
}

/**
 * Generic threshold checker factory.
 * Checks that result[field] >= minValue.
 */
function createThresholdChecker({ name, field, minValue, weight, tags, description }) {
  return {
    name: name || `threshold-${field}`,
    description: description || `Checks ${field} >= ${minValue}`,
    weight: weight ?? 1,
    tags: tags || [],
    fn: async (result) => {
      const value = result[field] ?? 0;
      const pass = value >= minValue;
      return {
        pass,
        score: minValue > 0 ? Math.min(value / minValue, 1) : (pass ? 1 : 0),
        reason: pass ? undefined : `${field} ${value} < ${minValue}`,
      };
    },
  };
}

module.exports = {
  QualityGate,
  CHECK_RESULT,
  AGGREGATE,
  VALID_AGGREGATES,
  validateChecker,
  aggregateScore,
  // Built-in checker factories
  createProtagonistChecker,
  createDurationChecker,
  createThresholdChecker,
};
