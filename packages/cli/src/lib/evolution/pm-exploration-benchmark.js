/** PM dataset tooling and launch preflight. No runtime or promotion authority. */
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  buildEvolutionEvalSuite,
  computeEvolutionEvalTrainingPartitionDigest,
  verifyEvolutionEvalPolicy,
  verifyEvolutionEvalSuite,
} from "./evolution-eval-gate.js";
import { createPmExplorationPlan } from "./pm-exploration-rounds.js";
import grader from "./pm-result-grader.cjs";

const GROUPS = ["template", "project", "principal", "timeWindow"];
const PREFIXES = ["template", "project", "principal", "time-window"];
const GROUP_DIGEST = /^[a-f0-9]{64}$/u;
const REQUIRED_ENV = Object.freeze({
  NODE_ENV: "production",
  MOCK_LLM: "false",
  MOCK_HARDWARE: "false",
  SKIP_SLOW_INIT: "false",
  CHAINLESSCHAIN_DISABLE_NATIVE_DB: "0",
  CHAINLESSCHAIN_DISABLE_DB_PERSISTENCE: "0",
  CC_IPC_ACTOR_GUARD: "enforce",
  CC_IPC_RBAC_GUARD: "enforce",
});
const PM_GRADER = "pm-objective-outcome-v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const EFFECT_PHASES = Object.freeze([
  "exploration",
  "curriculum-planning",
  "memory-distillation",
  "failure-retry",
  "environment-reset",
]);
const FAILURE_CLASSES = new Set([
  "none",
  "model",
  "tool",
  "provider",
  "sandbox",
  "permission",
  "infrastructure",
  "grader",
  "unknown",
]);

export const PM_EXPLORATION_EFFECT_PLAN_SCHEMA =
  "chainlesschain.pm-exploration-effect-plan/v1";
export const PM_EXPLORATION_EFFECT_REPORT_SCHEMA =
  "chainlesschain.pm-exploration-effect-report/v1";

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new TypeError(`${label} must be plain data`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        !keys.includes(key) ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  )
    throw new TypeError(`${label} has unexpected or missing fields`);
}

function groupKey(kind, value) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !value ||
    value.length > 256
  )
    throw new TypeError(`invalid ${kind} group`);
  return `${kind}-${createHash("sha256").update(value).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function assertPlainData(value, label, seen = new WeakSet(), depth = 0) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError(`${label} contains an invalid number`);
    }
    return;
  }
  if (!value || typeof value !== "object" || isProxy(value) || depth > 64) {
    throw new TypeError(`${label} is not bounded plain data`);
  }
  if (seen.has(value)) throw new TypeError(`${label} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1
    ) {
      throw new TypeError(`${label} contains an invalid array`);
    }
  } else if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} contains a non-plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} contains a symbol field`);
    }
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label} contains an accessor or hidden field`);
    }
    assertPlainData(descriptor.value, label, seen, depth + 1);
  }
  seen.delete(value);
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function boundedString(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 256
  ) {
    throw new TypeError(`${label} must be a bounded nonempty string`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
  return value;
}

function integer(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function finite(value, label, maximum = 1) {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new TypeError(`${label} is outside its allowed range`);
  }
  return value;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function normalizeVersion(value, label) {
  exact(value, ["id", "artifactDigest"], label);
  return Object.freeze({
    id: boundedString(value.id, `${label} id`),
    artifactDigest: digest(value.artifactDigest, `${label} artifactDigest`),
  });
}

function normalizeEffectBudget(value) {
  exact(
    value,
    ["maxTokens", "maxToolCalls", "maxWallClockMs", "maxCostMicrounits"],
    "PM effect budget",
  );
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, amount]) => {
        const normalized = integer(amount, `PM effect budget ${key}`);
        if (normalized < 1) {
          throw new TypeError(`PM effect budget ${key} must be positive`);
        }
        return [key, normalized];
      }),
    ),
  );
}

export function verifyPmExplorationEffectPlan(value) {
  exact(
    value,
    [
      "schema",
      "experimentId",
      "suiteDigest",
      "policyDigest",
      "testTaskIds",
      "baselineVersion",
      "candidateVersion",
      "actorConfigDigest",
      "modelConfigDigest",
      "toolPolicyDigest",
      "permissionPolicyDigest",
      "environmentDigest",
      "resetProtocolDigest",
      "seeds",
      "budgetPerArmPerSeed",
      "costPhases",
      "minimumScoreDelta",
      "bootstrapSamples",
      "equalBudget",
      "promotionAuthority",
      "planDigest",
    ],
    "PM effect plan",
  );
  if (
    value.schema !== PM_EXPLORATION_EFFECT_PLAN_SCHEMA ||
    value.bootstrapSamples !== 1_000 ||
    value.equalBudget !== true ||
    value.promotionAuthority !== false
  ) {
    throw new TypeError("PM effect plan invariants are invalid");
  }
  const core = {
    schema: value.schema,
    experimentId: boundedString(value.experimentId, "experimentId"),
    suiteDigest: digest(value.suiteDigest, "suiteDigest"),
    policyDigest: digest(value.policyDigest, "policyDigest"),
    testTaskIds: normalizeStringArray(value.testTaskIds, "testTaskIds"),
    baselineVersion: normalizeVersion(value.baselineVersion, "baselineVersion"),
    candidateVersion: normalizeVersion(
      value.candidateVersion,
      "candidateVersion",
    ),
    actorConfigDigest: digest(value.actorConfigDigest, "actorConfigDigest"),
    modelConfigDigest: digest(value.modelConfigDigest, "modelConfigDigest"),
    toolPolicyDigest: digest(value.toolPolicyDigest, "toolPolicyDigest"),
    permissionPolicyDigest: digest(
      value.permissionPolicyDigest,
      "permissionPolicyDigest",
    ),
    environmentDigest: digest(value.environmentDigest, "environmentDigest"),
    resetProtocolDigest: digest(
      value.resetProtocolDigest,
      "resetProtocolDigest",
    ),
    seeds: normalizeSeeds(value.seeds),
    budgetPerArmPerSeed: normalizeEffectBudget(value.budgetPerArmPerSeed),
    costPhases: normalizeStringArray(value.costPhases, "costPhases"),
    minimumScoreDelta: finite(value.minimumScoreDelta, "minimumScoreDelta"),
    bootstrapSamples: 1_000,
    equalBudget: true,
    promotionAuthority: false,
  };
  if (canonical(core.costPhases) !== canonical(EFFECT_PHASES)) {
    throw new TypeError("PM effect plan cost phases are invalid");
  }
  const planDigest = digest(value.planDigest, "planDigest");
  if (planDigest !== hash(PM_EXPLORATION_EFFECT_PLAN_SCHEMA, core)) {
    throw new Error("PM effect plan digest mismatch");
  }
  return deepFreeze({ ...core, planDigest });
}

function normalizeStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 ||
    value.length > 10_000 ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError(`${label} must be a bounded dense array`);
  }
  const normalized = value.map((item, index) =>
    boundedString(item, `${label}[${index}]`),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${label} must contain unique values`);
  }
  return Object.freeze(normalized);
}

function normalizeSeeds(value) {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 3 ||
    value.length > 32 ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError("PM effect seeds must contain 3-32 dense entries");
  }
  const seeds = value.map((seed, index) =>
    integer(seed, `PM effect seed ${index}`, 0x7fffffff),
  );
  if (new Set(seeds).size !== seeds.length) {
    throw new TypeError("PM effect seeds must be unique");
  }
  return Object.freeze(seeds);
}

/**
 * Freezes the PM comparison before execution. Both arms receive the same hard
 * per-seed budget and differ only by the two declared immutable artifacts.
 */
export function buildPmExplorationEffectPlan(input) {
  exact(
    input,
    [
      "experimentId",
      "suite",
      "policy",
      "baselineVersion",
      "candidateVersion",
      "actorConfigDigest",
      "modelConfigDigest",
      "toolPolicyDigest",
      "permissionPolicyDigest",
      "environmentDigest",
      "resetProtocolDigest",
      "seeds",
      "budgetPerArmPerSeed",
      "minimumScoreDelta",
    ],
    "PM effect plan input",
  );
  const suite = verifyPmSuite(input.suite);
  const policy = verifyEvolutionEvalPolicy(input.policy);
  const seeds = normalizeSeeds(input.seeds);
  const testTaskIds = suite.tasks
    .filter((task) => task.split === "test")
    .map((task) => task.id);
  if (canonical(seeds) !== canonical(policy.seeds)) {
    throw new Error("PM effect seeds must equal the Eval Gate policy seeds");
  }
  const core = {
    schema: PM_EXPLORATION_EFFECT_PLAN_SCHEMA,
    experimentId: boundedString(input.experimentId, "experimentId"),
    suiteDigest: suite.suiteDigest,
    policyDigest: policy.policyDigest,
    testTaskIds: Object.freeze(testTaskIds),
    baselineVersion: normalizeVersion(input.baselineVersion, "baselineVersion"),
    candidateVersion: normalizeVersion(
      input.candidateVersion,
      "candidateVersion",
    ),
    actorConfigDigest: digest(input.actorConfigDigest, "actorConfigDigest"),
    modelConfigDigest: digest(input.modelConfigDigest, "modelConfigDigest"),
    toolPolicyDigest: digest(input.toolPolicyDigest, "toolPolicyDigest"),
    permissionPolicyDigest: digest(
      input.permissionPolicyDigest,
      "permissionPolicyDigest",
    ),
    environmentDigest: digest(input.environmentDigest, "environmentDigest"),
    resetProtocolDigest: digest(
      input.resetProtocolDigest,
      "resetProtocolDigest",
    ),
    seeds,
    budgetPerArmPerSeed: normalizeEffectBudget(input.budgetPerArmPerSeed),
    costPhases: EFFECT_PHASES,
    minimumScoreDelta: finite(input.minimumScoreDelta, "minimumScoreDelta"),
    bootstrapSamples: 1_000,
    equalBudget: true,
    promotionAuthority: false,
  };
  return deepFreeze({
    ...core,
    planDigest: hash(PM_EXPLORATION_EFFECT_PLAN_SCHEMA, core),
  });
}

function normalizeUsage(value, label) {
  exact(
    value,
    ["receiptDigest", "tokens", "toolCalls", "wallClockMs", "costMicrounits"],
    label,
  );
  const metrics = {
    tokens: integer(value.tokens, `${label} tokens`),
    toolCalls: integer(value.toolCalls, `${label} toolCalls`),
    wallClockMs: integer(value.wallClockMs, `${label} wallClockMs`),
    costMicrounits: integer(value.costMicrounits, `${label} costMicrounits`),
  };
  const used = Object.values(metrics).some((amount) => amount > 0);
  if (
    (used && !DIGEST.test(value.receiptDigest ?? "")) ||
    (!used && value.receiptDigest !== null)
  ) {
    throw new TypeError(`${label} receipt binding is invalid`);
  }
  return Object.freeze({ receiptDigest: value.receiptDigest, ...metrics });
}

function normalizePhases(value, label) {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length !== EFFECT_PHASES.length ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError(`${label} must cover every cost phase`);
  }
  return Object.freeze(
    value.map((entry, index) => {
      exact(entry, ["phase", "usage"], `${label}[${index}]`);
      if (entry.phase !== EFFECT_PHASES[index]) {
        throw new TypeError(`${label} phase order is invalid`);
      }
      return Object.freeze({
        phase: entry.phase,
        usage: normalizeUsage(entry.usage, `${label} ${entry.phase}`),
      });
    }),
  );
}

function normalizeArm(value, label) {
  exact(
    value,
    [
      "outcomeReceiptDigest",
      "graderReceiptDigest",
      "score",
      "passed",
      "usage",
      "securityViolations",
      "permissionViolations",
      "failureClass",
    ],
    label,
  );
  if (
    typeof value.passed !== "boolean" ||
    !FAILURE_CLASSES.has(value.failureClass)
  ) {
    throw new TypeError(`${label} result fields are invalid`);
  }
  return Object.freeze({
    outcomeReceiptDigest: digest(
      value.outcomeReceiptDigest,
      `${label} outcomeReceiptDigest`,
    ),
    graderReceiptDigest: digest(
      value.graderReceiptDigest,
      `${label} graderReceiptDigest`,
    ),
    score: finite(value.score, `${label} score`),
    passed: value.passed,
    usage: normalizeUsage(value.usage, `${label} usage`),
    securityViolations: integer(
      value.securityViolations,
      `${label} securityViolations`,
    ),
    permissionViolations: integer(
      value.permissionViolations,
      `${label} permissionViolations`,
    ),
    failureClass: value.failureClass,
  });
}

function addUsage(target, usage) {
  target.tokens += usage.tokens;
  target.toolCalls += usage.toolCalls;
  target.wallClockMs += usage.wallClockMs;
  target.costMicrounits += usage.costMicrounits;
}

function emptyUsage() {
  return { tokens: 0, toolCalls: 0, wallClockMs: 0, costMicrounits: 0 };
}

function exceedsBudget(usage, budget) {
  return (
    usage.tokens > budget.maxTokens ||
    usage.toolCalls > budget.maxToolCalls ||
    usage.wallClockMs > budget.maxWallClockMs ||
    usage.costMicrounits > budget.maxCostMicrounits
  );
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sorted, probability) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function prngFromDigest(value) {
  let state = Number.parseInt(value.slice(7, 15), 16) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function armTotals(runs, arm) {
  const usage = emptyUsage();
  let securityViolations = 0;
  let permissionViolations = 0;
  let passCount = 0;
  const scores = [];
  for (const run of runs) {
    for (const phase of run.phases[arm]) addUsage(usage, phase.usage);
    for (const item of run.cases) {
      const result = item[arm];
      addUsage(usage, result.usage);
      securityViolations += result.securityViolations;
      permissionViolations += result.permissionViolations;
      passCount += result.passed ? 1 : 0;
      scores.push(result.score);
    }
  }
  return Object.freeze({
    sampleCount: scores.length,
    passCount,
    passRate: passCount / scores.length,
    meanScore: mean(scores),
    usage: Object.freeze(usage),
    securityViolations,
    permissionViolations,
  });
}

/**
 * Recomputes a complete paired PM effect report. It is deliberately not a
 * promotion receipt; an independent signed Eval Gate/Pilot decision remains
 * mandatory even when every preregistered threshold is met.
 */
export function buildPmExplorationEffectReport({ plan, runs } = {}) {
  const verifiedPlan = verifyPmExplorationEffectPlan(plan);
  if (
    !Array.isArray(runs) ||
    isProxy(runs) ||
    Object.getPrototypeOf(runs) !== Array.prototype ||
    runs.length !== verifiedPlan.seeds.length ||
    Reflect.ownKeys(runs).length !== runs.length + 1
  ) {
    throw new TypeError("PM effect runs must exactly cover the seed schedule");
  }
  const expectedTasks = new Set(verifiedPlan.testTaskIds);
  const seenSeeds = new Set();
  const normalizedRuns = runs.map((run, runIndex) => {
    exact(
      run,
      ["runId", "seed", "phases", "cases"],
      `PM effect run ${runIndex}`,
    );
    const seed = integer(
      run.seed,
      `PM effect run ${runIndex} seed`,
      0x7fffffff,
    );
    if (!verifiedPlan.seeds.includes(seed) || seenSeeds.has(seed)) {
      throw new TypeError(
        `PM effect run ${runIndex} seed is absent or duplicated`,
      );
    }
    seenSeeds.add(seed);
    exact(
      run.phases,
      ["baseline", "candidate"],
      `PM effect run ${runIndex} phases`,
    );
    const phases = Object.freeze({
      baseline: normalizePhases(
        run.phases.baseline,
        `PM effect run ${runIndex} baseline phases`,
      ),
      candidate: normalizePhases(
        run.phases.candidate,
        `PM effect run ${runIndex} candidate phases`,
      ),
    });
    if (
      !Array.isArray(run.cases) ||
      isProxy(run.cases) ||
      Object.getPrototypeOf(run.cases) !== Array.prototype ||
      run.cases.length !== expectedTasks.size ||
      Reflect.ownKeys(run.cases).length !== run.cases.length + 1
    ) {
      throw new TypeError(
        `PM effect run ${runIndex} must cover every test task`,
      );
    }
    const seenTasks = new Set();
    const cases = run.cases.map((item, caseIndex) => {
      exact(
        item,
        ["taskId", "baseline", "candidate"],
        `PM effect run ${runIndex} case ${caseIndex}`,
      );
      const taskId = boundedString(item.taskId, "PM effect taskId");
      if (!expectedTasks.has(taskId) || seenTasks.has(taskId)) {
        throw new TypeError(
          `PM effect run ${runIndex} has an absent or duplicate task`,
        );
      }
      seenTasks.add(taskId);
      return Object.freeze({
        taskId,
        baseline: normalizeArm(item.baseline, `PM effect ${taskId} baseline`),
        candidate: normalizeArm(
          item.candidate,
          `PM effect ${taskId} candidate`,
        ),
      });
    });
    cases.sort((left, right) => left.taskId.localeCompare(right.taskId, "en"));
    const budgetViolations = [];
    for (const arm of ["baseline", "candidate"]) {
      const usage = emptyUsage();
      for (const phase of phases[arm]) addUsage(usage, phase.usage);
      for (const item of cases) addUsage(usage, item[arm].usage);
      if (exceedsBudget(usage, verifiedPlan.budgetPerArmPerSeed)) {
        budgetViolations.push(arm);
      }
    }
    return Object.freeze({
      runId: boundedString(run.runId, `PM effect run ${runIndex} runId`),
      seed,
      phases,
      cases: Object.freeze(cases),
      budgetViolations: Object.freeze(budgetViolations),
    });
  });
  normalizedRuns.sort(
    (left, right) =>
      verifiedPlan.seeds.indexOf(left.seed) -
      verifiedPlan.seeds.indexOf(right.seed),
  );
  const deltas = normalizedRuns.flatMap((run) =>
    run.cases.map((item) => item.candidate.score - item.baseline.score),
  );
  const random = prngFromDigest(verifiedPlan.planDigest);
  const bootstrap = Array.from({ length: verifiedPlan.bootstrapSamples }, () =>
    mean(
      Array.from(
        { length: deltas.length },
        () => deltas[Math.floor(random() * deltas.length)],
      ),
    ),
  ).sort((left, right) => left - right);
  const baseline = armTotals(normalizedRuns, "baseline");
  const candidate = armTotals(normalizedRuns, "candidate");
  const perTask = Object.freeze(
    verifiedPlan.testTaskIds.map((taskId) => {
      const observations = normalizedRuns.map((run) =>
        run.cases.find((item) => item.taskId === taskId),
      );
      const baselineScores = observations.map((item) => item.baseline.score);
      const candidateScores = observations.map((item) => item.candidate.score);
      const baselinePassRate =
        observations.filter((item) => item.baseline.passed).length /
        observations.length;
      const candidatePassRate =
        observations.filter((item) => item.candidate.passed).length /
        observations.length;
      return Object.freeze({
        taskId,
        sampleCount: observations.length,
        baselineScore: mean(baselineScores),
        candidateScore: mean(candidateScores),
        scoreDelta: mean(candidateScores) - mean(baselineScores),
        baselinePassRate,
        candidatePassRate,
      });
    }),
  );
  const pairedScoreDelta = Object.freeze({
    mean: mean(deltas),
    bootstrap95Ci: Object.freeze([
      percentile(bootstrap, 0.025),
      percentile(bootstrap, 0.975),
    ]),
  });
  const budgetViolationCount = normalizedRuns.reduce(
    (sum, run) => sum + run.budgetViolations.length,
    0,
  );
  const thresholdMet =
    budgetViolationCount === 0 &&
    candidate.securityViolations === 0 &&
    candidate.permissionViolations === 0 &&
    pairedScoreDelta.bootstrap95Ci[0] >= verifiedPlan.minimumScoreDelta;
  const core = {
    schema: PM_EXPLORATION_EFFECT_REPORT_SCHEMA,
    planDigest: verifiedPlan.planDigest,
    runCount: normalizedRuns.length,
    pairedObservationCount: deltas.length,
    baseline,
    candidate,
    perTask,
    pairedScoreDelta,
    budgetViolationCount,
    evidenceDecision: thresholdMet ? "threshold-met" : "threshold-not-met",
    requiresIndependentPilotApproval: true,
    qualifiesForPromotion: false,
    runs: Object.freeze(normalizedRuns),
  };
  return deepFreeze({
    ...core,
    reportDigest: hash(PM_EXPLORATION_EFFECT_REPORT_SCHEMA, core),
  });
}

export function verifyPmExplorationEffectReport({ plan, report } = {}) {
  const verifiedPlan = verifyPmExplorationEffectPlan(plan);
  if (!report || typeof report !== "object" || isProxy(report)) {
    throw new TypeError("a canonical PM effect report is required");
  }
  assertPlainData(report, "PM effect report");
  if (report.schema !== PM_EXPLORATION_EFFECT_REPORT_SCHEMA) {
    throw new TypeError("a canonical PM effect report is required");
  }
  exact(
    report,
    [
      "schema",
      "planDigest",
      "runCount",
      "pairedObservationCount",
      "baseline",
      "candidate",
      "perTask",
      "pairedScoreDelta",
      "budgetViolationCount",
      "evidenceDecision",
      "requiresIndependentPilotApproval",
      "qualifiesForPromotion",
      "runs",
      "reportDigest",
    ],
    "PM effect report",
  );
  if (
    !Array.isArray(report.runs) ||
    isProxy(report.runs) ||
    Object.getPrototypeOf(report.runs) !== Array.prototype ||
    Reflect.ownKeys(report.runs).length !== report.runs.length + 1
  ) {
    throw new TypeError("PM effect report runs are invalid");
  }
  const sourceRuns = report.runs.map((run, index) => {
    exact(
      run,
      ["runId", "seed", "phases", "cases", "budgetViolations"],
      `PM effect report run ${index}`,
    );
    return {
      runId: run.runId,
      seed: run.seed,
      phases: run.phases,
      cases: run.cases,
    };
  });
  const recreated = buildPmExplorationEffectReport({
    plan: verifiedPlan,
    runs: sourceRuns,
  });
  if (canonical(recreated) !== canonical(report)) {
    throw new Error("PM effect report digest mismatch");
  }
  return recreated;
}

/** Trusted dataset-author input; store the result outside the Actor workspace. */
export function buildPmExplorationSuite(input) {
  exact(input, ["suiteId", "datasetVersion", "tasks"], "PM suite input");
  if (
    !Array.isArray(input.tasks) ||
    input.tasks.length < 3 ||
    input.tasks.length > 10_000
  )
    throw new TypeError(
      "PM suite requires bounded training, validation and test tasks",
    );
  const tasks = input.tasks.map((task) => {
    exact(task, ["id", "split", "groups", "prompt", "expected"], "PM task");
    exact(task.groups, GROUPS, "PM task groups");
    if (
      typeof task.prompt !== "string" ||
      !task.prompt.trim() ||
      task.prompt.length > 16_384
    )
      throw new TypeError("PM task prompt is required and bounded");
    const expected = grader.normalizePmExpectation(task.expected);
    return {
      id: task.id,
      split: task.split,
      groupKeys: GROUPS.map((key, i) =>
        groupKey(PREFIXES[i], task.groups[key]),
      ),
      taskType: expected.kind === "file-export" ? "file" : "retrieval",
      publicInput: { prompt: task.prompt },
      graderId: PM_GRADER,
      privateExpected: expected,
    };
  });
  return verifyPmSuite(
    buildEvolutionEvalSuite({
      suiteId: input.suiteId,
      datasetVersion: input.datasetVersion,
      tasks,
    }),
  );
}

function verifyPmSuite(value) {
  const suite = verifyEvolutionEvalSuite(value);
  if (
    !["training", "validation", "test"].every((split) =>
      suite.tasks.some((task) => task.split === split),
    )
  )
    throw new TypeError("PM suite must include all three partitions");
  for (const task of suite.tasks) {
    exact(task.publicInput, ["prompt"], "PM public input");
    if (
      typeof task.publicInput.prompt !== "string" ||
      !task.publicInput.prompt.trim() ||
      task.publicInput.prompt.length > 16_384
    )
      throw new TypeError("invalid PM public prompt");
    const expected = grader.normalizePmExpectation(task.privateExpected);
    if (
      task.graderId !== PM_GRADER ||
      task.taskType !==
        (expected.kind === "file-export" ? "file" : "retrieval") ||
      !task.groupKeys.every(
        (key, index) =>
          key.startsWith(`${PREFIXES[index]}-`) &&
          GROUP_DIGEST.test(key.slice(PREFIXES[index].length + 1)),
      )
    )
      throw new TypeError("suite is not a PM exploration dataset");
  }
  return suite;
}

/** Explicit projection: no validation/test tasks, expected answers or grader IDs. */
export function projectPmExplorationTrainingView(value) {
  const suite = verifyPmSuite(value);
  return Object.freeze({
    suiteDigest: suite.suiteDigest,
    trainingPartitionDigest: computeEvolutionEvalTrainingPartitionDigest(suite),
    tasks: Object.freeze(
      suite.tasks
        .filter((task) => task.split === "training")
        .map((task) =>
          Object.freeze({ id: task.id, publicInput: task.publicInput }),
        ),
    ),
  });
}

/** Structural check only; signed provenance is still verified by EvolutionEvalGate. */
export function assertPmExplorationTrainingSources(value, input) {
  exact(
    input,
    ["trainingPartitionDigest", "sourceTaskIds"],
    "PM memory sources",
  );
  const view = projectPmExplorationTrainingView(value);
  if (input.trainingPartitionDigest !== view.trainingPartitionDigest)
    throw new Error("PM training partition binding mismatch");
  const ids = input.sourceTaskIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > view.tasks.length ||
    new Set(ids).size !== ids.length
  )
    throw new TypeError("PM source task IDs must be nonempty and unique");
  const allowed = new Set(view.tasks.map((task) => task.id));
  if (ids.some((id) => !allowed.has(id)))
    throw new Error("PM memory source is outside the training partition");
  return Object.freeze({
    trainingPartitionDigest: view.trainingPartitionDigest,
    sourceTaskIds: Object.freeze([...ids]),
  });
}

/** Builds the round protocol from the verified training-only projection. */
export function buildPmExplorationRoundPlan(value, input) {
  exact(
    input,
    [
      "planId",
      "environmentDigest",
      "initialMemoryDigest",
      "broadBranchIds",
      "maxRounds",
      "maxTokens",
      "maxToolCalls",
      "maxWallClockMs",
      "maxConsecutiveNoGain",
    ],
    "PM round plan input",
  );
  const training = projectPmExplorationTrainingView(value);
  return createPmExplorationPlan({
    ...input,
    suiteDigest: training.suiteDigest,
    trainingPartitionDigest: training.trainingPartitionDigest,
    trainingTaskIds: training.tasks.map((task) => task.id),
  });
}

export function buildPmExplorationLaunchProfile(budget) {
  exact(budget, ["maxTokens", "maxToolCalls", "maxWallClockMs"], "PM budget");
  for (const key of Object.keys(budget)) {
    if (!Number.isSafeInteger(budget[key]) || budget[key] <= 0)
      throw new TypeError(`${key} must be a positive safe integer`);
  }
  return Object.freeze({
    schema: "chainlesschain.pm-exploration-launch-profile/v1",
    environment: REQUIRED_ENV,
    budget: Object.freeze({ ...budget }),
    budgetEnforced: false,
    runtimeVerified: false,
    productionQualified: false,
  });
}

/** No secrets or raw environment values are copied to diagnostics. */
export function inspectPmExplorationEnvironment(environment = process.env) {
  if (!environment || typeof environment !== "object" || isProxy(environment))
    throw new TypeError("environment must be a data object");
  const issues = Object.entries(REQUIRED_ENV).flatMap(([key, required]) => {
    const prop = Object.getOwnPropertyDescriptor(environment, key);
    return prop && "value" in prop && prop.value === required
      ? []
      : [
          Object.freeze({
            code: "PM_RUNTIME_CONFIGURATION_MISMATCH",
            variable: key,
            required,
          }),
        ];
  });
  return Object.freeze({
    schema: "chainlesschain.pm-exploration-preflight/v1",
    status: issues.length ? "blocked" : "requires-host-verification",
    configurationCompatible: issues.length === 0,
    issues: Object.freeze(issues),
    missingEvidence: Object.freeze([
      "authenticated-model-ingress",
      "unlocked-real-identity",
      "enforced-tool-and-workspace-isolation",
      "host-enforced-budget",
      "independent-read-only-grader",
      "reset-and-restart-persistence",
    ]),
    launchAllowed: false,
    runtimeVerified: false,
    productionQualified: false,
  });
}
