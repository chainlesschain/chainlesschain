/** PM dataset tooling and launch preflight. No runtime or promotion authority. */
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  buildEvolutionEvalSuite,
  computeEvolutionEvalContextDigest,
  computeEvolutionEvalTrainingPartitionDigest,
  verifyEvolutionEvalPolicy,
  verifyEvolutionEvalReceipt,
  verifyEvolutionEvalResultEvidence,
  verifyEvolutionEvalSuite,
} from "./evolution-eval-gate.js";
import { createPmExplorationPlan } from "./pm-exploration-rounds.js";
import { capturePmExplorationProviderSettlementStore } from "./pm-exploration-provider-settlement-adapter.js";
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
const COMPLETION_FAILURE_CLASSES = new Set([
  ...FAILURE_CLASSES,
  "setup",
  "timeout",
  "cancelled",
]);

export const PM_EXPLORATION_EFFECT_PLAN_SCHEMA =
  "chainlesschain.pm-exploration-effect-plan/v2";
export const PM_EXPLORATION_EFFECT_REPORT_SCHEMA =
  "chainlesschain.pm-exploration-effect-report/v2";
export const PM_EXPLORATION_EFFECT_EVIDENCE_REPORT_SCHEMA =
  "chainlesschain.pm-exploration-effect-evidence-report/v1";
export const PM_EXPLORATION_PREPARATION_PROVIDER_EVIDENCE_SCHEMA =
  "chainlesschain.pm-exploration-preparation-provider-evidence/v1";
export const PM_EXPLORATION_EFFECT_PROVIDER_EVIDENCE_BUNDLE_SCHEMA =
  "chainlesschain.pm-exploration-effect-provider-evidence-bundle/v1";
export const PM_EXPLORATION_EFFECT_INTERRUPTED_EVIDENCE_SCHEMA =
  "chainlesschain.pm-exploration-effect-interrupted-evidence/v1";
export const PM_EXPLORATION_EFFECT_RUNTIME_FAILURE_EVIDENCE_SCHEMA =
  "chainlesschain.pm-exploration-effect-runtime-failure-evidence/v1";
export const PM_EXPLORATION_EFFECT_PREFLIGHT_REJECTION_EVIDENCE_SCHEMA =
  "chainlesschain.pm-exploration-effect-preflight-rejection-evidence/v1";
export const PM_EXPLORATION_EFFECT_ATTEMPT_COHORT_SCHEMA =
  "chainlesschain.pm-exploration-effect-attempt-cohort/v1";
export const PM_EXPLORATION_EFFECT_ATTEMPT_COHORT_V2_SCHEMA =
  "chainlesschain.pm-exploration-effect-attempt-cohort/v2";
export const PM_EXPLORATION_EFFECT_ATTEMPT_COHORT_V3_SCHEMA =
  "chainlesschain.pm-exploration-effect-attempt-cohort/v3";
export const PM_EXPLORATION_EFFECT_ATTEMPT_COHORT_V4_SCHEMA =
  "chainlesschain.pm-exploration-effect-attempt-cohort/v4";
export const PM_EXPLORATION_EFFECT_SLOT_MANIFEST_SCHEMA =
  "chainlesschain.pm-exploration-effect-slot-manifest/v1";
export const PM_EXPLORATION_EFFECT_MANIFEST_BOUND_COHORT_SCHEMA =
  "chainlesschain.pm-exploration-effect-manifest-bound-cohort/v1";
export const PM_EXPLORATION_EFFECT_COHORT_USAGE_EVIDENCE_SCHEMA =
  "chainlesschain.pm-exploration-effect-cohort-usage-evidence/v1";
const LEGACY_EFFECT_PLAN_SCHEMA =
  "chainlesschain.pm-exploration-effect-plan/v1";
const LEGACY_EFFECT_REPORT_SCHEMA =
  "chainlesschain.pm-exploration-effect-report/v1";
const PRIMARY_METRIC = "strict-completion-rate";
const RESAMPLING_UNIT = "task-group-component";
const PREPARATION_PROVIDER_REQUESTS_SCHEMA =
  "chainlesschain.pm-preparation-provider-requests/v1";
const SIGNED_EVAL_USAGE_FIELDS = Object.freeze([
  "executionCount",
  "totalTokens",
  "totalLatencyMs",
  "totalToolCalls",
  "totalCostMicrounits",
]);

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
  assertPlainData(value, "PM effect plan");
  const legacy = value?.schema === LEGACY_EFFECT_PLAN_SCHEMA;
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
      ...(legacy
        ? ["minimumScoreDelta"]
        : [
            "minimumPassRateDelta",
            "minimumIndependentGroups",
            "taskGroups",
            "primaryMetric",
            "resamplingUnit",
          ]),
      "bootstrapSamples",
      "equalBudget",
      "promotionAuthority",
      "planDigest",
    ],
    "PM effect plan",
  );
  if (
    (!legacy && value.schema !== PM_EXPLORATION_EFFECT_PLAN_SCHEMA) ||
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
    ...(legacy
      ? {
          minimumScoreDelta: finite(
            value.minimumScoreDelta,
            "minimumScoreDelta",
          ),
        }
      : normalizeCompletionPolicy(value)),
    bootstrapSamples: 1_000,
    equalBudget: true,
    promotionAuthority: false,
  };
  if (canonical(core.costPhases) !== canonical(EFFECT_PHASES)) {
    throw new TypeError("PM effect plan cost phases are invalid");
  }
  const planDigest = digest(value.planDigest, "planDigest");
  if (planDigest !== hash(value.schema, core)) {
    throw new Error("PM effect plan digest mismatch");
  }
  return deepFreeze({ ...core, planDigest });
}

function normalizeCompletionPolicy(value) {
  const minimumIndependentGroups = integer(
    value.minimumIndependentGroups,
    "minimumIndependentGroups",
    10_000,
  );
  if (
    minimumIndependentGroups < 2 ||
    value.primaryMetric !== PRIMARY_METRIC ||
    value.resamplingUnit !== RESAMPLING_UNIT ||
    !Array.isArray(value.taskGroups) ||
    value.taskGroups.length !== value.testTaskIds.length
  ) {
    throw new TypeError("PM completion policy or task groups are invalid");
  }
  const taskGroups = value.taskGroups.map((task, index) => {
    exact(task, ["taskId", "groupKeys"], "PM effect task group");
    const groupKeys = normalizeStringArray(
      task.groupKeys,
      "PM effect groupKeys",
    );
    if (
      task.taskId !== value.testTaskIds[index] ||
      groupKeys.length !== PREFIXES.length ||
      groupKeys.some(
        (key, groupIndex) =>
          !key.startsWith(`${PREFIXES[groupIndex]}-`) ||
          !GROUP_DIGEST.test(key.slice(PREFIXES[groupIndex].length + 1)),
      )
    ) {
      throw new TypeError("PM effect task group binding is invalid");
    }
    return Object.freeze({ taskId: task.taskId, groupKeys });
  });
  return {
    minimumPassRateDelta: finite(
      value.minimumPassRateDelta,
      "minimumPassRateDelta",
    ),
    minimumIndependentGroups,
    taskGroups: Object.freeze(taskGroups),
    primaryMetric: PRIMARY_METRIC,
    resamplingUnit: RESAMPLING_UNIT,
  };
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
  assertPlainData(input, "PM effect plan input");
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
      "minimumPassRateDelta",
      "minimumIndependentGroups",
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
    minimumPassRateDelta: input.minimumPassRateDelta,
    minimumIndependentGroups: input.minimumIndependentGroups,
    taskGroups: suite.tasks
      .filter((task) => task.split === "test")
      .map((task) => ({ taskId: task.id, groupKeys: task.groupKeys })),
    primaryMetric: PRIMARY_METRIC,
    resamplingUnit: RESAMPLING_UNIT,
    bootstrapSamples: 1_000,
    equalBudget: true,
    promotionAuthority: false,
  };
  return verifyPmExplorationEffectPlan({
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

function normalizeArm(value, label, legacy) {
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
    !(legacy ? FAILURE_CLASSES : COMPLETION_FAILURE_CLASSES).has(
      value.failureClass,
    )
  ) {
    throw new TypeError(`${label} result fields are invalid`);
  }
  if (
    !legacy &&
    value.passed &&
    (value.score !== 1 ||
      value.failureClass !== "none" ||
      value.securityViolations !== 0 ||
      value.permissionViolations !== 0)
  ) {
    throw new TypeError(`${label} passed requires a complete, safe outcome`);
  }
  const ungradedFailure =
    !legacy &&
    value.graderReceiptDigest === null &&
    value.passed === false &&
    value.score === 0 &&
    value.failureClass !== "none";
  return Object.freeze({
    outcomeReceiptDigest: digest(
      value.outcomeReceiptDigest,
      `${label} outcomeReceiptDigest`,
    ),
    graderReceiptDigest: ungradedFailure
      ? null
      : digest(value.graderReceiptDigest, `${label} graderReceiptDigest`),
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

function addUsage(target, usage, strict = false) {
  for (const key of Object.keys(target)) {
    target[key] += usage[key];
    if (strict) integer(target[key], `PM effect total ${key}`);
  }
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

function armTotals(runs, arm, legacy) {
  const usage = emptyUsage();
  let securityViolations = 0;
  let permissionViolations = 0;
  let passCount = 0;
  const failureCounts = Object.fromEntries(
    [...COMPLETION_FAILURE_CLASSES]
      .filter((key) => key !== "none")
      .concat("incomplete")
      .map((key) => [key, 0]),
  );
  const scores = [];
  for (const run of runs) {
    for (const phase of run.phases[arm]) addUsage(usage, phase.usage, !legacy);
    for (const item of run.cases) {
      const result = item[arm];
      addUsage(usage, result.usage, !legacy);
      securityViolations += result.securityViolations;
      permissionViolations += result.permissionViolations;
      if (!legacy) {
        integer(securityViolations, "PM effect total securityViolations");
        integer(permissionViolations, "PM effect total permissionViolations");
      }
      passCount += result.passed ? 1 : 0;
      if (!result.passed) {
        failureCounts[
          result.failureClass === "none" ? "incomplete" : result.failureClass
        ] += 1;
      }
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
    ...(!legacy
      ? {
          failureCount: scores.length - passCount,
          failureCounts: Object.freeze(failureCounts),
        }
      : {}),
  });
}

// Shared template/project/principal/time-window keys form transitive clusters.
// All seeds of a task stay together; repeated samples never add independent units.
function completionGroups(plan) {
  const parents = plan.taskGroups.map((_, index) => index);
  const find = (index) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const owners = new Map();
  plan.taskGroups.forEach((task, index) => {
    for (const key of task.groupKeys) {
      if (owners.has(key)) parents[find(index)] = find(owners.get(key));
      else owners.set(key, index);
    }
  });
  const groups = new Map();
  plan.taskGroups.forEach((task, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(index);
  });
  return [...groups.values()];
}

/** Planning diagnostics only; this neither launches nor authenticates a run. */
export function inspectPmExplorationEffectPlan(value) {
  const plan = verifyPmExplorationEffectPlan(value);
  if (plan.schema !== PM_EXPLORATION_EFFECT_PLAN_SCHEMA) {
    throw new TypeError("PM completion diagnostics require an effect plan v2");
  }
  const groups = completionGroups(plan).map((indices) =>
    indices.map((index) => plan.taskGroups[index].taskId),
  );
  const groupCountSatisfied = groups.length >= plan.minimumIndependentGroups;
  return deepFreeze({
    schema: "chainlesschain.pm-exploration-effect-plan-inspection/v1",
    planDigest: plan.planDigest,
    status: groupCountSatisfied
      ? "group-count-satisfied"
      : "insufficient-independent-groups",
    testTaskCount: plan.testTaskIds.length,
    plannedRunCount: plan.seeds.length,
    plannedPairedObservationCount: plan.testTaskIds.length * plan.seeds.length,
    plannedArmObservationCount: 2 * plan.testTaskIds.length * plan.seeds.length,
    independentGroupCount: groups.length,
    minimumIndependentGroups: plan.minimumIndependentGroups,
    independentGroups: groups,
    runtimeVerified: false,
    evidenceAuthenticated: false,
    qualifiesForPromotion: false,
  });
}

function clusteredDeltas(plan, perTask) {
  const groups = completionGroups(plan).map((indices) =>
    indices.map((index) => perTask[index]),
  );
  const totals = groups.map((group) => ({
    taskCount: group.length,
    score: group.reduce((sum, task) => sum + task.scoreDelta, 0),
    passRate: group.reduce((sum, task) => sum + task.passRateDelta, 0),
  }));
  // Use the frozen grouping as the random seed: adding identical seed repeats
  // must not narrow the interval through either pseudoreplication or RNG drift.
  const random = prngFromDigest(hash(RESAMPLING_UNIT, plan.taskGroups));
  const scoreSamples = [];
  const passSamples = [];
  for (let sample = 0; sample < plan.bootstrapSamples; sample += 1) {
    let count = 0;
    let score = 0;
    let passRate = 0;
    for (let index = 0; index < totals.length; index += 1) {
      const selected = totals[Math.floor(random() * totals.length)];
      count += selected.taskCount;
      score += selected.score;
      passRate += selected.passRate;
    }
    scoreSamples.push(score / count);
    passSamples.push(passRate / count);
  }
  const summarize = (samples, key) => {
    samples.sort((left, right) => left - right);
    return Object.freeze({
      mean: mean(perTask.map((task) => task[key])),
      // A single cluster cannot estimate between-cluster uncertainty.
      bootstrap95Ci:
        groups.length < 2
          ? null
          : Object.freeze([
              percentile(samples, 0.025),
              percentile(samples, 0.975),
            ]),
    });
  };
  return {
    independentGroupCount: groups.length,
    pairedScoreDelta: summarize(scoreSamples, "scoreDelta"),
    pairedPassRateDelta: summarize(passSamples, "passRateDelta"),
  };
}

/**
 * Recomputes a complete paired PM effect report. It is deliberately not a
 * promotion receipt; an independent signed Eval Gate/Pilot decision remains
 * mandatory even when every preregistered threshold is met.
 */
export function buildPmExplorationEffectReport({ plan, runs } = {}) {
  const verifiedPlan = verifyPmExplorationEffectPlan(plan);
  const legacy = verifiedPlan.schema === LEGACY_EFFECT_PLAN_SCHEMA;
  assertPlainData(runs, "PM effect runs");
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
  const seenRunIds = new Set();
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
    const runId = boundedString(run.runId, `PM effect run ${runIndex} runId`);
    if (!legacy && seenRunIds.has(runId)) {
      throw new TypeError("PM effect runId is duplicated");
    }
    seenRunIds.add(runId);
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
        baseline: normalizeArm(
          item.baseline,
          `PM effect ${taskId} baseline`,
          legacy,
        ),
        candidate: normalizeArm(
          item.candidate,
          `PM effect ${taskId} candidate`,
          legacy,
        ),
      });
    });
    cases.sort((left, right) => left.taskId.localeCompare(right.taskId, "en"));
    const budgetViolations = [];
    for (const arm of ["baseline", "candidate"]) {
      const usage = emptyUsage();
      for (const phase of phases[arm]) addUsage(usage, phase.usage, !legacy);
      for (const item of cases) addUsage(usage, item[arm].usage, !legacy);
      if (exceedsBudget(usage, verifiedPlan.budgetPerArmPerSeed)) {
        budgetViolations.push(arm);
      }
    }
    return Object.freeze({
      runId,
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
  const bootstrap = legacy
    ? Array.from({ length: verifiedPlan.bootstrapSamples }, () =>
        mean(
          Array.from(
            { length: deltas.length },
            () => deltas[Math.floor(random() * deltas.length)],
          ),
        ),
      ).sort((left, right) => left - right)
    : null;
  const baseline = armTotals(normalizedRuns, "baseline", legacy);
  const candidate = armTotals(normalizedRuns, "candidate", legacy);
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
        ...(!legacy
          ? { passRateDelta: candidatePassRate - baselinePassRate }
          : {}),
      });
    }),
  );
  const completion = legacy ? null : clusteredDeltas(verifiedPlan, perTask);
  const pairedScoreDelta = legacy
    ? Object.freeze({
        mean: mean(deltas),
        bootstrap95Ci: Object.freeze([
          percentile(bootstrap, 0.025),
          percentile(bootstrap, 0.975),
        ]),
      })
    : completion.pairedScoreDelta;
  const budgetViolationCount = normalizedRuns.reduce(
    (sum, run) => sum + run.budgetViolations.length,
    0,
  );
  const safetyAndBudgetSatisfied =
    budgetViolationCount === 0 &&
    candidate.securityViolations === 0 &&
    candidate.permissionViolations === 0 &&
    (legacy ||
      (baseline.securityViolations === 0 &&
        baseline.permissionViolations === 0));
  const thresholdMet =
    safetyAndBudgetSatisfied &&
    (legacy
      ? pairedScoreDelta.bootstrap95Ci[0] >= verifiedPlan.minimumScoreDelta
      : completion.independentGroupCount >=
          verifiedPlan.minimumIndependentGroups &&
        completion.pairedPassRateDelta.mean > 0 &&
        completion.pairedPassRateDelta.bootstrap95Ci[0] >=
          verifiedPlan.minimumPassRateDelta);
  const insufficient =
    !legacy &&
    safetyAndBudgetSatisfied &&
    completion.independentGroupCount < verifiedPlan.minimumIndependentGroups;
  const core = {
    schema: legacy
      ? LEGACY_EFFECT_REPORT_SCHEMA
      : PM_EXPLORATION_EFFECT_REPORT_SCHEMA,
    planDigest: verifiedPlan.planDigest,
    runCount: normalizedRuns.length,
    pairedObservationCount: deltas.length,
    baseline,
    candidate,
    perTask,
    pairedScoreDelta,
    ...(!legacy
      ? {
          primaryMetric: PRIMARY_METRIC,
          resamplingUnit: RESAMPLING_UNIT,
          independentGroupCount: completion.independentGroupCount,
          pairedPassRateDelta: completion.pairedPassRateDelta,
        }
      : {}),
    budgetViolationCount,
    evidenceDecision: insufficient
      ? "insufficient-evidence"
      : thresholdMet
        ? "threshold-met"
        : "threshold-not-met",
    requiresIndependentPilotApproval: true,
    qualifiesForPromotion: false,
    runs: Object.freeze(normalizedRuns),
  };
  return deepFreeze({
    ...core,
    reportDigest: hash(core.schema, core),
  });
}

export function verifyPmExplorationEffectReport({ plan, report } = {}) {
  const verifiedPlan = verifyPmExplorationEffectPlan(plan);
  const legacy = verifiedPlan.schema === LEGACY_EFFECT_PLAN_SCHEMA;
  if (!report || typeof report !== "object" || isProxy(report)) {
    throw new TypeError("a canonical PM effect report is required");
  }
  assertPlainData(report, "PM effect report");
  if (
    report.schema !==
    (legacy ? LEGACY_EFFECT_REPORT_SCHEMA : PM_EXPLORATION_EFFECT_REPORT_SCHEMA)
  ) {
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
      ...(!legacy
        ? [
            "primaryMetric",
            "resamplingUnit",
            "independentGroupCount",
            "pairedPassRateDelta",
          ]
        : []),
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

function snapshotEffectEvidence(value, label) {
  assertPlainData(value, label);
  const serialized = canonical(value);
  if (Buffer.byteLength(serialized, "utf8") > 16 * 1024 * 1024) {
    throw new TypeError(`${label} exceeds the 16 MiB limit`);
  }
  return deepFreeze(JSON.parse(serialized));
}

function effectUsageFromEval(row) {
  const usage = {
    tokens: row.metrics.tokens,
    toolCalls: row.metrics.toolCalls,
    wallClockMs: row.metrics.latencyMs,
    costMicrounits: row.metrics.costMicrounits,
  };
  return {
    // The execution receipt is the signed source of these metrics. This is not
    // a claim to have re-read a provider settlement or a separate usage receipt.
    receiptDigest: Object.values(usage).some((amount) => amount > 0)
      ? row.executionDigest
      : null,
    ...usage,
  };
}

function effectArmFromEval(row) {
  const failureClass =
    row.permissionViolations > 0
      ? "permission"
      : row.securityViolations > 0 || (!row.pass && row.metrics.errors > 0)
        ? "unknown"
        : "none";
  return {
    outcomeReceiptDigest: row.executionDigest,
    graderReceiptDigest: row.gradeDigest,
    score: row.qualityScore,
    passed: row.pass && row.qualityScore === 1 && failureClass === "none",
    usage: effectUsageFromEval(row),
    securityViolations: row.securityViolations,
    permissionViolations: row.permissionViolations,
    failureClass,
  };
}

/**
 * Authenticate only the provider token count and estimated USD cost for
 * independently registered preparation requests. This does not establish that
 * the registry contains every request, or authenticate tools and elapsed time.
 */
export function buildPmExplorationPreparationProviderEvidence(
  adapter,
  input,
  expected,
) {
  const store = capturePmExplorationProviderSettlementStore(adapter);
  const source = snapshotEffectEvidence(
    input,
    "PM preparation provider source",
  );
  const registered = snapshotEffectEvidence(
    expected,
    "PM preparation provider registered requests",
  );
  exact(
    source,
    ["plan", "phaseUsage", "settlements"],
    "PM preparation provider source",
  );
  exact(
    registered,
    ["planDigest", "descriptorDigest", "requests"],
    "PM preparation provider registered requests",
  );
  const plan = verifyPmExplorationEffectPlan(source.plan);
  if (
    plan.schema !== PM_EXPLORATION_EFFECT_PLAN_SCHEMA ||
    plan.planDigest !== registered.planDigest ||
    store.inspect().descriptorDigest !== registered.descriptorDigest
  ) {
    throw new Error(
      "PM preparation provider registration differs from plan or store",
    );
  }
  if (
    !Array.isArray(source.phaseUsage) ||
    source.phaseUsage.length !== plan.seeds.length ||
    !Array.isArray(source.settlements) ||
    !Array.isArray(registered.requests) ||
    source.settlements.length === 0 ||
    source.settlements.length !== registered.requests.length
  ) {
    throw new TypeError("PM preparation provider evidence coverage is invalid");
  }
  const preparation = new Map();
  for (const entry of source.phaseUsage) {
    exact(entry, ["seed", "baseline", "candidate"], "PM preparation usage");
    if (!plan.seeds.includes(entry.seed) || preparation.has(entry.seed))
      throw new TypeError("PM preparation usage seed is absent or duplicated");
    preparation.set(entry.seed, {
      baseline: normalizePhases(entry.baseline, "PM baseline preparation"),
      candidate: normalizePhases(entry.candidate, "PM candidate preparation"),
    });
  }
  const registrations = new Map();
  const requestDigests = new Set();
  for (const entry of registered.requests) {
    exact(
      entry,
      [
        "seed",
        "arm",
        "phase",
        "operationId",
        "executionRequestDigest",
        "requestDigest",
      ],
      "PM preparation provider request",
    );
    if (
      !plan.seeds.includes(entry.seed) ||
      !["baseline", "candidate"].includes(entry.arm) ||
      !EFFECT_PHASES.includes(entry.phase)
    ) {
      throw new TypeError(
        "PM preparation provider request has invalid coordinates",
      );
    }
    const executionDigest = digest(
      entry.executionRequestDigest,
      "PM preparation execution request digest",
    );
    digest(entry.requestDigest, "PM preparation provider request digest");
    if (
      typeof entry.operationId !== "string" ||
      !entry.operationId ||
      entry.operationId.length > 256 ||
      requestDigests.has(executionDigest)
    ) {
      throw new TypeError(
        "PM preparation provider request is duplicated or invalid",
      );
    }
    requestDigests.add(executionDigest);
    registrations.set(executionDigest, entry);
  }
  const seen = new Set();
  const totals = new Map();
  const entries = [];
  for (const entry of source.settlements) {
    exact(
      entry,
      ["seed", "arm", "phase", "settlement", "persistence"],
      "PM preparation provider settlement",
    );
    const settlement = entry.settlement;
    const registeredRequest = registrations.get(
      settlement?.executionRequestDigest,
    );
    if (
      !registeredRequest ||
      registeredRequest.seed !== entry.seed ||
      registeredRequest.arm !== entry.arm ||
      registeredRequest.phase !== entry.phase ||
      registeredRequest.operationId !== settlement.operationId ||
      registeredRequest.requestDigest !== settlement.requestDigest ||
      seen.has(settlement.executionRequestDigest)
    ) {
      throw new Error(
        "PM preparation settlement lacks unique registered request binding",
      );
    }
    store.verifySettlementPersistence(settlement, entry.persistence);
    seen.add(settlement.executionRequestDigest);
    const key = `${entry.seed}\0${entry.arm}\0${entry.phase}`;
    const previous = totals.get(key) ?? { tokens: 0, estimatedUsd: 0 };
    const tokens = previous.tokens + settlement.usage.totalTokens;
    const estimatedUsd = previous.estimatedUsd + settlement.estimatedCost.total;
    if (!Number.isSafeInteger(tokens) || !Number.isFinite(estimatedUsd))
      throw new TypeError(
        "PM preparation provider totals exceed numeric bounds",
      );
    totals.set(key, { tokens, estimatedUsd });
    entries.push({
      seed: entry.seed,
      arm: entry.arm,
      phase: entry.phase,
      executionRequestDigest: settlement.executionRequestDigest,
      settlementDigest: settlement.settlementDigest,
      durableRecordDigest: entry.persistence.recordDigest,
      tokens: settlement.usage.totalTokens,
      estimatedUsd: settlement.estimatedCost.total,
    });
  }
  if (seen.size !== registrations.size)
    throw new Error(
      "PM preparation provider registration is not fully covered",
    );
  const phaseTotals = [];
  for (const seed of plan.seeds) {
    for (const arm of ["baseline", "candidate"]) {
      for (const { phase, usage } of preparation.get(seed)[arm]) {
        const total = totals.get(`${seed}\0${arm}\0${phase}`);
        if (!total) continue;
        // Round upward: the integer micro-USD comparison must never understate
        // the provider's independently re-read estimated dollar amount.
        const costMicrounitsUpperBound = Math.ceil(total.estimatedUsd * 1e6);
        if (
          !Number.isSafeInteger(costMicrounitsUpperBound) ||
          total.tokens > usage.tokens ||
          costMicrounitsUpperBound > usage.costMicrounits
        ) {
          throw new Error(
            "PM preparation provider cost exceeds declared phase usage",
          );
        }
        phaseTotals.push({
          seed,
          arm,
          phase,
          tokens: total.tokens,
          estimatedUsd: total.estimatedUsd,
          costMicrounitsUpperBound,
        });
      }
    }
  }
  const core = {
    schema: PM_EXPLORATION_PREPARATION_PROVIDER_EVIDENCE_SCHEMA,
    planDigest: plan.planDigest,
    descriptorDigest: registered.descriptorDigest,
    registeredRequestDigest: hash(
      PREPARATION_PROVIDER_REQUESTS_SCHEMA,
      registered.requests,
    ),
    phaseUsageDigest: hash(
      "chainlesschain.pm-effect-preparation-usage/v1",
      plan.seeds.map((seed) => ({ seed, ...preparation.get(seed) })),
    ),
    entries,
    phaseTotals,
    authenticationScope: "registered-provider-tokens-and-estimated-cost-only",
    preparationEvidenceAuthenticated: false,
    reportAuthenticated: false,
  };
  return deepFreeze({
    ...core,
    evidenceDigest: hash(core.schema, core),
  });
}

export function verifyPmExplorationPreparationProviderEvidence(
  adapter,
  input,
  expected,
) {
  exact(input, ["source", "evidence"], "PM preparation provider verification");
  const evidence = snapshotEffectEvidence(
    input.evidence,
    "PM preparation provider evidence",
  );
  const recreated = buildPmExplorationPreparationProviderEvidence(
    adapter,
    input.source,
    expected,
  );
  if (canonical(recreated) !== canonical(evidence))
    throw new Error(
      "PM preparation provider evidence differs from durable source",
    );
  return recreated;
}

/**
 * Connect authenticated Eval Gate rows to the v2 statistics. Preparation usage
 * remains caller-supplied, so the envelope can never certify a complete effect
 * claim. `expected` is an independent, pre-registered host binding, not data to
 * derive from the report being verified.
 */
export async function buildPmExplorationEffectEvidenceReport(
  verifier,
  input,
  expected,
) {
  const source = snapshotEffectEvidence(input, "PM effect evidence source");
  exact(
    source,
    ["plan", "suite", "policy", "receipt", "resultEvidence", "phaseUsage"],
    "PM effect evidence source",
  );
  const registered = snapshotEffectEvidence(
    expected,
    "PM effect registered context",
  );
  exact(
    registered,
    ["planDigest", "targetMatrixRoot", "cellId", "runtimeId", "receiptContext"],
    "PM effect registered context",
  );
  const { plan, context, evaluationContextDigest } =
    verifyPmEffectSourceRegistration(source, registered);
  return projectPmEffectEvidenceReport(
    verifier,
    source,
    plan,
    context,
    evaluationContextDigest,
  );
}

function verifyPmEffectSourceRegistration(source, registered) {
  const plan = verifyPmExplorationEffectPlan(source.plan);
  if (
    plan.schema !== PM_EXPLORATION_EFFECT_PLAN_SCHEMA ||
    plan.planDigest !== registered.planDigest
  ) {
    throw new Error("PM effect requires the registered v2 plan");
  }
  // Rebuild from the actual suite and policy; a self-consistent rehash of
  // caller-invented task groups or a different seed list must not be enough.
  const planInput = Object.fromEntries(
    [
      "experimentId",
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
      "minimumPassRateDelta",
      "minimumIndependentGroups",
    ].map((key) => [key, plan[key]]),
  );
  const reconstructed = buildPmExplorationEffectPlan({
    ...planInput,
    suite: source.suite,
    policy: source.policy,
  });
  if (reconstructed.planDigest !== plan.planDigest) {
    throw new Error("PM effect plan differs from its source suite or policy");
  }
  const context = registered.receiptContext;
  const bindings = {
    suiteDigest: plan.suiteDigest,
    policyDigest: plan.policyDigest,
    environmentDigest: plan.environmentDigest,
    candidateId: plan.candidateVersion.artifactDigest,
    baselineId: plan.baselineVersion.artifactDigest,
  };
  if (
    !context ||
    Object.entries(bindings).some(([key, value]) => context[key] !== value)
  ) {
    throw new Error(
      "PM effect registered receipt context differs from its plan",
    );
  }
  const evaluationContextDigest = computeEvolutionEvalContextDigest({
    ...bindings,
    planDigest: plan.planDigest,
    tenantId: context.tenantId,
    targetEnvironmentRef: context.targetEnvironmentRef,
    evaluationAuthorityRoot: context.evaluationAuthorityRoot,
    targetMatrixRoot: registered.targetMatrixRoot,
    cellId: registered.cellId,
    runtimeId: registered.runtimeId,
  });
  if (evaluationContextDigest !== context.evaluationContextDigest) {
    throw new Error(
      "PM effect evaluation context does not bind the registered plan",
    );
  }
  return { plan, context, evaluationContextDigest };
}

async function projectPmEffectEvidenceReport(
  verifier,
  source,
  plan,
  context,
  evaluationContextDigest,
) {
  if (
    !Array.isArray(source.phaseUsage) ||
    source.phaseUsage.length !== plan.seeds.length
  ) {
    throw new TypeError("PM effect preparation usage must cover every seed");
  }
  const preparation = new Map();
  for (const entry of source.phaseUsage) {
    exact(
      entry,
      ["seed", "baseline", "candidate"],
      "PM effect preparation usage",
    );
    if (!plan.seeds.includes(entry.seed) || preparation.has(entry.seed)) {
      throw new TypeError("PM effect preparation seed is absent or duplicated");
    }
    preparation.set(entry.seed, {
      baseline: normalizePhases(entry.baseline, "PM baseline preparation"),
      candidate: normalizePhases(entry.candidate, "PM candidate preparation"),
    });
  }
  const evidence = await verifyEvolutionEvalResultEvidence(
    verifier,
    {
      receipt: source.receipt,
      resultEvidence: source.resultEvidence,
      suite: source.suite,
      policy: source.policy,
    },
    context,
  );
  const taskDigests = new Map(
    source.suite.tasks
      .filter((task) => task.split === "test")
      .map((task) => [task.id, task.taskDigest]),
  );
  const indexed = Object.fromEntries(
    ["baseline", "candidate"].map((arm) => [
      arm,
      new Map(
        evidence.test[arm].map((row) => [
          `${row.taskDigest}\0${row.seed}`,
          row,
        ]),
      ),
    ]),
  );
  const runs = plan.seeds.map((seed) => ({
    // A deterministic grouping ID, not a claim of an additional execution.
    runId: `pm-effect-${hash("chainlesschain.pm-effect-eval-seed/v1", { receiptDigest: source.receipt.receiptDigest, seed }).slice(7)}`,
    seed,
    phases: preparation.get(seed),
    cases: plan.testTaskIds.map((taskId) => ({
      taskId,
      ...Object.fromEntries(
        ["baseline", "candidate"].map((arm) => [
          arm,
          effectArmFromEval(
            indexed[arm].get(`${taskDigests.get(taskId)}\0${seed}`),
          ),
        ]),
      ),
    })),
  }));
  const report = buildPmExplorationEffectReport({ plan, runs });
  const validationUsage = plan.seeds.map((seed) => ({
    seed,
    ...Object.fromEntries(
      ["baseline", "candidate"].map((arm) => {
        const usage = emptyUsage();
        for (const row of evidence.validation[arm]) {
          if (row.seed === seed)
            addUsage(usage, effectUsageFromEval(row), true);
        }
        return [arm, usage];
      }),
    ),
  }));
  const knownUsage = {
    baseline: { ...report.baseline.usage },
    candidate: { ...report.candidate.usage },
  };
  const knownBudgetViolations = [];
  for (const [index, run] of report.runs.entries()) {
    for (const arm of ["baseline", "candidate"]) {
      const usage = { ...validationUsage[index][arm] };
      addUsage(knownUsage[arm], usage, true);
      for (const phase of run.phases[arm]) addUsage(usage, phase.usage, true);
      for (const row of run.cases) addUsage(usage, row[arm].usage, true);
      if (exceedsBudget(usage, plan.budgetPerArmPerSeed))
        knownBudgetViolations.push({ seed: run.seed, arm });
    }
  }
  const validationUnsafe = ["baseline", "candidate"].some((arm) =>
    evidence.validation[arm].some(
      (row) => row.securityViolations > 0 || row.permissionViolations > 0,
    ),
  );
  const blockingReasons = ["preparation-costs-unverified"];
  if (source.receipt.decision !== "accepted")
    blockingReasons.push("source-eval-not-accepted");
  if (knownBudgetViolations.length)
    blockingReasons.push("known-budget-exceeded");
  if (validationUnsafe) blockingReasons.push("validation-safety-violation");
  if (report.evidenceDecision !== "threshold-met")
    blockingReasons.push(
      report.evidenceDecision === "threshold-not-met"
        ? "statistical-threshold-not-met"
        : "independent-groups-insufficient",
    );
  const core = {
    schema: PM_EXPLORATION_EFFECT_EVIDENCE_REPORT_SCHEMA,
    planDigest: plan.planDigest,
    sourceEvalRunId: source.receipt.runId,
    sourceEvalDecision: source.receipt.decision,
    sourceEvalReceiptDigest: source.receipt.receiptDigest,
    sourceResultEvidenceDigest: evidence.evidenceDigest,
    evaluationContextDigest,
    phaseUsageDigest: hash(
      "chainlesschain.pm-effect-preparation-usage/v1",
      plan.seeds.map((seed) => ({ seed, ...preparation.get(seed) })),
    ),
    validationUsage,
    knownUsage,
    knownBudgetViolations,
    testExecutionErrors: Object.fromEntries(
      ["baseline", "candidate"].map((arm) => [
        arm,
        integer(
          evidence.test[arm].reduce((sum, row) => sum + row.metrics.errors, 0),
          "test execution errors",
        ),
      ]),
    ),
    report,
    executionEvidenceAuthenticated: true,
    preparationEvidenceAuthenticated: false,
    reportAuthenticated: false,
    evidenceDecision:
      source.receipt.decision !== "accepted" ||
      knownBudgetViolations.length > 0 ||
      validationUnsafe ||
      report.evidenceDecision === "threshold-not-met"
        ? "threshold-not-met"
        : "insufficient-evidence",
    blockingReasons,
    requiresIndependentPilotApproval: true,
    qualifiesForPromotion: false,
  };
  const result = deepFreeze({
    ...core,
    evidenceReportDigest: hash(core.schema, core),
  });
  // Projection/bootstrap work must not turn a receipt that expired since the
  // row verification into a freshly authenticated returned report.
  await verifyEvolutionEvalReceipt(verifier, source.receipt, context);
  return result;
}

export async function verifyPmExplorationEffectEvidenceReport(
  verifier,
  input,
  expected,
) {
  exact(input, ["source", "report"], "PM effect evidence report verification");
  const report = snapshotEffectEvidence(
    input.report,
    "PM effect evidence report",
  );
  const recreated = await buildPmExplorationEffectEvidenceReport(
    verifier,
    input.source,
    expected,
  );
  if (canonical(recreated) !== canonical(report)) {
    throw new Error(
      "PM effect evidence report does not match its authenticated source",
    );
  }
  return recreated;
}

/**
 * Preserve a signed, budget-interrupted attempt in the preregistered test
 * denominator without inventing task outcomes or per-arm costs. Other thrown
 * failures have no final signed receipt and cannot use this contract.
 */
export async function buildPmExplorationEffectInterruptedEvidence(
  verifier,
  input,
  expected,
) {
  const source = snapshotEffectEvidence(input, "PM interrupted effect source");
  exact(
    source,
    ["plan", "suite", "policy", "receipt"],
    "PM interrupted effect source",
  );
  const registered = snapshotEffectEvidence(
    expected,
    "PM interrupted effect registration",
  );
  exact(
    registered,
    ["planDigest", "targetMatrixRoot", "cellId", "runtimeId", "receiptContext"],
    "PM interrupted effect registration",
  );
  const { plan, context, evaluationContextDigest } =
    verifyPmEffectSourceRegistration(source, registered);
  const receipt = source.receipt;
  await verifyEvolutionEvalReceipt(verifier, receipt, context);
  const splitCounts = Object.fromEntries(
    ["training", "validation", "test"].map((split) => [
      split,
      source.suite.tasks.filter((task) => task.split === split).length,
    ]),
  );
  const plannedTestObservationsPerArm =
    plan.seeds.length * plan.testTaskIds.length;
  const plannedExecutionCount =
    (splitCounts.validation + splitCounts.test) * plan.seeds.length * 2;
  if (
    canonical(receipt.splitCounts) !== canonical(splitCounts) ||
    receipt.decision !== "rejected" ||
    canonical(receipt.reasonCodes) !== canonical(["total-budget-exceeded"]) ||
    receipt.validation !== null ||
    receipt.test !== null ||
    !Number.isSafeInteger(plannedExecutionCount) ||
    !Number.isSafeInteger(plannedTestObservationsPerArm) ||
    receipt.usage.executionCount < 1 ||
    receipt.usage.executionCount > plannedExecutionCount
  ) {
    throw new Error(
      "PM interrupted effect requires a signed partial budget rejection",
    );
  }
  const core = {
    schema: PM_EXPLORATION_EFFECT_INTERRUPTED_EVIDENCE_SCHEMA,
    planDigest: plan.planDigest,
    sourceEvalRunId: receipt.runId,
    sourceEvalReceiptDigest: receipt.receiptDigest,
    evaluationContextDigest,
    interruptionReason: "total-budget-exceeded",
    plannedExecutionCount,
    signedExecutionCount: receipt.usage.executionCount,
    plannedTestObservationsPerArm,
    authenticatedTestOutcomesPerArm: 0,
    unresolvedTestObservationsPerArm: plannedTestObservationsPerArm,
    aggregateSignedUsage: receipt.usage,
    outcomeAvailability: "unavailable",
    denominatorTreatment: "unresolved-blocks-promotion",
    statisticalEstimateAvailable: false,
    evidenceDecision: "threshold-not-met",
    blockingReasons: [
      "source-eval-budget-exceeded",
      "test-outcomes-unavailable",
    ],
    requiresIndependentPilotApproval: true,
    qualifiesForPromotion: false,
  };
  const evidence = deepFreeze({
    ...core,
    interruptedEvidenceDigest: hash(core.schema, core),
  });
  await verifyEvolutionEvalReceipt(verifier, receipt, context);
  return evidence;
}

export async function verifyPmExplorationEffectInterruptedEvidence(
  verifier,
  input,
  expected,
) {
  exact(input, ["source", "evidence"], "PM interrupted effect verification");
  const evidence = snapshotEffectEvidence(
    input.evidence,
    "PM interrupted effect evidence",
  );
  const recreated = await buildPmExplorationEffectInterruptedEvidence(
    verifier,
    input.source,
    expected,
  );
  if (canonical(recreated) !== canonical(evidence))
    throw new Error(
      "PM interrupted effect evidence differs from signed source",
    );
  return recreated;
}

/** A signed post-execution runtime rejection leaves every test outcome unresolved. */
export async function buildPmExplorationEffectRuntimeFailureEvidence(
  verifier,
  input,
  expected,
) {
  const source = snapshotEffectEvidence(input, "PM runtime failure source");
  exact(
    source,
    ["plan", "suite", "policy", "receipt"],
    "PM runtime failure source",
  );
  const registered = snapshotEffectEvidence(
    expected,
    "PM runtime failure registration",
  );
  exact(
    registered,
    ["planDigest", "targetMatrixRoot", "cellId", "runtimeId", "receiptContext"],
    "PM runtime failure registration",
  );
  const { plan, context, evaluationContextDigest } =
    verifyPmEffectSourceRegistration(source, registered);
  const receipt = source.receipt;
  await verifyEvolutionEvalReceipt(verifier, receipt, context);
  const splitCounts = Object.fromEntries(
    ["training", "validation", "test"].map((split) => [
      split,
      source.suite.tasks.filter((task) => task.split === split).length,
    ]),
  );
  const plannedTestObservationsPerArm =
    plan.seeds.length * plan.testTaskIds.length;
  const plannedExecutionCount =
    (splitCounts.validation + splitCounts.test) * plan.seeds.length * 2;
  const failureReason = receipt.reasonCodes?.[0];
  if (
    canonical(receipt.splitCounts) !== canonical(splitCounts) ||
    receipt.decision !== "rejected" ||
    receipt.reasonCodes?.length !== 1 ||
    ![
      "runtime-execution-failed",
      "runtime-grader-failed",
      "runtime-safety-failed",
    ].includes(failureReason) ||
    receipt.validation !== null ||
    receipt.test !== null ||
    !Number.isSafeInteger(plannedExecutionCount) ||
    !Number.isSafeInteger(plannedTestObservationsPerArm) ||
    receipt.usage.executionCount < 1 ||
    receipt.usage.executionCount > plannedExecutionCount
  ) {
    throw new Error(
      "PM runtime failure requires a signed post-execution rejection",
    );
  }
  const core = {
    schema: PM_EXPLORATION_EFFECT_RUNTIME_FAILURE_EVIDENCE_SCHEMA,
    planDigest: plan.planDigest,
    sourceEvalRunId: receipt.runId,
    sourceEvalReceiptDigest: receipt.receiptDigest,
    evaluationContextDigest,
    failureReason,
    plannedExecutionCount,
    signedExecutionCount: receipt.usage.executionCount,
    plannedTestObservationsPerArm,
    authenticatedTestOutcomesPerArm: 0,
    unresolvedTestObservationsPerArm: plannedTestObservationsPerArm,
    aggregateSignedUsage: receipt.usage,
    outcomeAvailability: "unavailable",
    denominatorTreatment: "unresolved-blocks-promotion",
    statisticalEstimateAvailable: false,
    evidenceDecision: "threshold-not-met",
    blockingReasons: [
      `source-eval-${failureReason}`,
      "test-outcomes-unavailable",
    ],
    requiresIndependentPilotApproval: true,
    qualifiesForPromotion: false,
  };
  const evidence = deepFreeze({
    ...core,
    runtimeFailureEvidenceDigest: hash(core.schema, core),
  });
  await verifyEvolutionEvalReceipt(verifier, receipt, context);
  return evidence;
}

export async function verifyPmExplorationEffectRuntimeFailureEvidence(
  verifier,
  input,
  expected,
) {
  exact(input, ["source", "evidence"], "PM runtime failure verification");
  const evidence = snapshotEffectEvidence(
    input.evidence,
    "PM runtime failure evidence",
  );
  const recreated = await buildPmExplorationEffectRuntimeFailureEvidence(
    verifier,
    input.source,
    expected,
  );
  if (canonical(recreated) !== canonical(evidence))
    throw new Error("PM runtime failure evidence differs from signed source");
  return recreated;
}

/** Preserve a signed zero-execution preflight rejection without inventing outcomes. */
export async function buildPmExplorationEffectPreflightRejectionEvidence(
  verifier,
  input,
  expected,
) {
  const source = snapshotEffectEvidence(input, "PM preflight rejection source");
  exact(
    source,
    ["plan", "suite", "policy", "receipt"],
    "PM preflight rejection source",
  );
  const registered = snapshotEffectEvidence(
    expected,
    "PM preflight rejection registration",
  );
  exact(
    registered,
    ["planDigest", "targetMatrixRoot", "cellId", "runtimeId", "receiptContext"],
    "PM preflight rejection registration",
  );
  const { plan, context, evaluationContextDigest } =
    verifyPmEffectSourceRegistration(source, registered);
  const receipt = source.receipt;
  await verifyEvolutionEvalReceipt(verifier, receipt, context);
  const splitCounts = Object.fromEntries(
    ["training", "validation", "test"].map((split) => [
      split,
      source.suite.tasks.filter((task) => task.split === split).length,
    ]),
  );
  const plannedTestObservationsPerArm =
    plan.seeds.length * plan.testTaskIds.length;
  const plannedExecutionCount =
    (splitCounts.validation + splitCounts.test) * plan.seeds.length * 2;
  const insufficient = ["training", "validation", "test"]
    .filter(
      (split) =>
        splitCounts[split] <
        source.policy[`min${split[0].toUpperCase()}${split.slice(1)}Tasks`],
    )
    .map((split) => `insufficient-${split}`);
  const expectedDecision = insufficient.length
    ? "needs-more-evidence"
    : "rejected";
  const expectedReasons = insufficient.length
    ? insufficient
    : ["execution-budget-insufficient"];
  const genuinePreflight =
    insufficient.length > 0 ||
    plannedExecutionCount > source.policy.maxExecutions;
  if (
    canonical(receipt.splitCounts) !== canonical(splitCounts) ||
    !Number.isSafeInteger(plannedExecutionCount) ||
    !Number.isSafeInteger(plannedTestObservationsPerArm) ||
    !genuinePreflight ||
    receipt.decision !== expectedDecision ||
    canonical(receipt.reasonCodes) !== canonical(expectedReasons) ||
    receipt.validation !== null ||
    receipt.test !== null
  ) {
    throw new Error("PM preflight requires a signed zero-execution rejection");
  }
  exact(receipt.usage, SIGNED_EVAL_USAGE_FIELDS, "PM preflight signed usage");
  if (SIGNED_EVAL_USAGE_FIELDS.some((field) => receipt.usage[field] !== 0)) {
    throw new Error("PM preflight rejection cannot claim execution usage");
  }
  const core = {
    schema: PM_EXPLORATION_EFFECT_PREFLIGHT_REJECTION_EVIDENCE_SCHEMA,
    planDigest: plan.planDigest,
    sourceEvalRunId: receipt.runId,
    sourceEvalReceiptDigest: receipt.receiptDigest,
    evaluationContextDigest,
    preflightDecision: receipt.decision,
    preflightReasonCodes: receipt.reasonCodes,
    plannedExecutionCount,
    signedExecutionCount: 0,
    plannedTestObservationsPerArm,
    authenticatedTestOutcomesPerArm: 0,
    unresolvedTestObservationsPerArm: plannedTestObservationsPerArm,
    aggregateSignedUsage: receipt.usage,
    outcomeAvailability: "unavailable",
    denominatorTreatment: "unresolved-blocks-promotion",
    statisticalEstimateAvailable: false,
    evidenceDecision: "threshold-not-met",
    blockingReasons: [
      "source-eval-preflight-rejected",
      "test-outcomes-unavailable",
    ],
    requiresIndependentPilotApproval: true,
    qualifiesForPromotion: false,
  };
  const evidence = deepFreeze({
    ...core,
    preflightRejectionEvidenceDigest: hash(core.schema, core),
  });
  await verifyEvolutionEvalReceipt(verifier, receipt, context);
  return evidence;
}

export async function verifyPmExplorationEffectPreflightRejectionEvidence(
  verifier,
  input,
  expected,
) {
  exact(input, ["source", "evidence"], "PM preflight rejection verification");
  const evidence = snapshotEffectEvidence(
    input.evidence,
    "PM preflight rejection evidence",
  );
  const recreated = await buildPmExplorationEffectPreflightRejectionEvidence(
    verifier,
    input.source,
    expected,
  );
  if (canonical(recreated) !== canonical(evidence))
    throw new Error("PM preflight rejection differs from signed source");
  return recreated;
}

/** Freeze the intended cohort slots before collection; persist the digest in an independent host record. */
export function buildPmExplorationEffectSlotManifest(input) {
  const source = snapshotEffectEvidence(input, "PM effect slot manifest input");
  exact(
    source,
    ["plan", "cohortId", "slotIds"],
    "PM effect slot manifest input",
  );
  const plan = verifyPmExplorationEffectPlan(source.plan);
  if (plan.schema !== PM_EXPLORATION_EFFECT_PLAN_SCHEMA)
    throw new TypeError("PM effect slot manifest requires a v2 plan");
  if (
    !Array.isArray(source.slotIds) ||
    source.slotIds.length === 0 ||
    source.slotIds.length > 32
  ) {
    throw new TypeError("PM effect slot manifest requires 1-32 slots");
  }
  const slotIds = source.slotIds.map((value) =>
    boundedString(value, "PM effect slot ID"),
  );
  if (new Set(slotIds).size !== slotIds.length)
    throw new TypeError("PM effect slot manifest has duplicate slots");
  const core = {
    schema: PM_EXPLORATION_EFFECT_SLOT_MANIFEST_SCHEMA,
    planDigest: plan.planDigest,
    cohortId: boundedString(source.cohortId, "PM effect cohort ID"),
    slotIds,
    plannedTestObservationsPerArm: integer(
      slotIds.length * plan.seeds.length * plan.testTaskIds.length,
      "PM effect slot manifest planned observations",
    ),
    promotionAuthority: false,
  };
  return deepFreeze({
    ...core,
    manifestDigest: hash(core.schema, core),
  });
}

export function verifyPmExplorationEffectSlotManifest(input) {
  exact(input, ["plan", "manifest"], "PM effect slot manifest verification");
  const manifest = snapshotEffectEvidence(
    input.manifest,
    "PM effect slot manifest",
  );
  exact(
    manifest,
    [
      "schema",
      "planDigest",
      "cohortId",
      "slotIds",
      "plannedTestObservationsPerArm",
      "promotionAuthority",
      "manifestDigest",
    ],
    "PM effect slot manifest",
  );
  const recreated = buildPmExplorationEffectSlotManifest({
    plan: input.plan,
    cohortId: manifest.cohortId,
    slotIds: manifest.slotIds,
  });
  if (canonical(recreated) !== canonical(manifest))
    throw new Error("PM effect slot manifest differs from its frozen plan");
  return recreated;
}

/**
 * Reconcile only the attempts named in an independent host slot manifest.
 * A scheduled slot without a signed receipt is counted as unresolved, never
 * as an authenticated launch. Cohort completeness and promotion remain false.
 */
export async function buildPmExplorationEffectAttemptCohort(
  verifier,
  input,
  expected,
) {
  const source = snapshotEffectEvidence(input, "PM attempt cohort source");
  const registered = snapshotEffectEvidence(
    expected,
    "PM attempt cohort registration",
  );
  exact(source, ["plan", "attempts"], "PM attempt cohort source");
  exact(
    registered,
    ["cohortId", "planDigest", "slots"],
    "PM attempt cohort registration",
  );
  const plan = verifyPmExplorationEffectPlan(source.plan);
  if (
    plan.schema !== PM_EXPLORATION_EFFECT_PLAN_SCHEMA ||
    plan.planDigest !== registered.planDigest
  ) {
    throw new Error("PM attempt cohort requires the registered v2 plan");
  }
  if (
    !Array.isArray(source.attempts) ||
    !Array.isArray(registered.slots) ||
    source.attempts.length === 0 ||
    source.attempts.length > 32 ||
    source.attempts.length !== registered.slots.length
  ) {
    throw new TypeError("PM attempt cohort must cover every registered slot");
  }
  const cohortId = boundedString(registered.cohortId, "PM cohortId");
  const slots = new Map();
  const registeredReceipts = new Set();
  for (const slot of registered.slots) {
    exact(
      slot,
      ["slotId", "receiptDigest", "context"],
      "PM attempt cohort slot",
    );
    const slotId = boundedString(slot.slotId, "PM attempt slotId");
    const receiptDigest =
      slot.receiptDigest === null
        ? null
        : digest(slot.receiptDigest, "PM attempt receiptDigest");
    if (
      (receiptDigest === null && slot.context !== null) ||
      (receiptDigest !== null && slot.context === null)
    )
      throw new Error("PM attempt slot receipt and context must agree");
    if (
      slots.has(slotId) ||
      (receiptDigest !== null && registeredReceipts.has(receiptDigest))
    )
      throw new Error("PM attempt cohort registration is duplicated");
    slots.set(slotId, slot);
    if (receiptDigest !== null) registeredReceipts.add(receiptDigest);
  }
  const seen = new Set();
  const runIds = new Set();
  const attempts = [];
  const perArmDenominator = integer(
    plan.seeds.length * plan.testTaskIds.length * source.attempts.length,
    "PM cohort per-arm denominator",
  );
  const totals = {
    baseline: { authenticatedOutcomes: 0, verifiedPasses: 0, unresolved: 0 },
    candidate: { authenticatedOutcomes: 0, verifiedPasses: 0, unresolved: 0 },
  };
  let budgetInterruptedCount = 0;
  let runtimeFailedCount = 0;
  let missingReceiptCount = 0;
  let preflightRejectedCount = 0;
  let failedCompleteCount = 0;
  for (const attempt of source.attempts) {
    exact(
      attempt,
      ["slotId", "kind", "source", "evidence"],
      "PM attempt cohort entry",
    );
    const slotId = boundedString(attempt.slotId, "PM attempt slotId");
    const slot = slots.get(slotId);
    if (!slot || seen.has(slotId)) {
      throw new Error("PM attempt cohort contains a foreign or duplicate slot");
    }
    seen.add(slotId);
    if (attempt.kind === "receipt-unavailable") {
      if (
        slot.receiptDigest !== null ||
        slot.context !== null ||
        attempt.source !== null ||
        attempt.evidence !== null
      ) {
        throw new Error("PM missing receipt slot has a substituted source");
      }
      missingReceiptCount += 1;
      for (const arm of ["baseline", "candidate"]) {
        totals[arm].unresolved = integer(
          totals[arm].unresolved + plan.seeds.length * plan.testTaskIds.length,
          "PM cohort unresolved outcomes",
        );
      }
      attempts.push({
        slotId,
        kind: attempt.kind,
        runId: null,
        receiptDigest: null,
        evidenceDigest: null,
      });
      continue;
    }
    if (
      slot.receiptDigest === null ||
      canonical(attempt.source?.plan) !== canonical(plan)
    ) {
      throw new Error("PM attempt cohort contains a foreign signed source");
    }
    let verified;
    let evidenceDigest;
    if (attempt.kind === "complete") {
      verified = await verifyPmExplorationEffectEvidenceReport(
        verifier,
        { source: attempt.source, report: attempt.evidence },
        slot.context,
      );
      evidenceDigest = verified.evidenceReportDigest;
      if (verified.evidenceDecision === "threshold-not-met")
        failedCompleteCount += 1;
      for (const arm of ["baseline", "candidate"]) {
        totals[arm].authenticatedOutcomes = integer(
          totals[arm].authenticatedOutcomes + verified.report[arm].sampleCount,
          "PM cohort authenticated outcomes",
        );
        totals[arm].verifiedPasses = integer(
          totals[arm].verifiedPasses + verified.report[arm].passCount,
          "PM cohort verified passes",
        );
      }
    } else if (attempt.kind === "budget-interrupted") {
      verified = await verifyPmExplorationEffectInterruptedEvidence(
        verifier,
        { source: attempt.source, evidence: attempt.evidence },
        slot.context,
      );
      evidenceDigest = verified.interruptedEvidenceDigest;
      budgetInterruptedCount += 1;
      for (const arm of ["baseline", "candidate"]) {
        totals[arm].unresolved = integer(
          totals[arm].unresolved + verified.unresolvedTestObservationsPerArm,
          "PM cohort unresolved outcomes",
        );
      }
    } else if (attempt.kind === "runtime-failed") {
      verified = await verifyPmExplorationEffectRuntimeFailureEvidence(
        verifier,
        { source: attempt.source, evidence: attempt.evidence },
        slot.context,
      );
      evidenceDigest = verified.runtimeFailureEvidenceDigest;
      runtimeFailedCount += 1;
      for (const arm of ["baseline", "candidate"]) {
        totals[arm].unresolved = integer(
          totals[arm].unresolved + verified.unresolvedTestObservationsPerArm,
          "PM cohort unresolved outcomes",
        );
      }
    } else if (attempt.kind === "preflight-rejected") {
      verified = await verifyPmExplorationEffectPreflightRejectionEvidence(
        verifier,
        { source: attempt.source, evidence: attempt.evidence },
        slot.context,
      );
      evidenceDigest = verified.preflightRejectionEvidenceDigest;
      preflightRejectedCount += 1;
      for (const arm of ["baseline", "candidate"]) {
        totals[arm].unresolved = integer(
          totals[arm].unresolved + verified.unresolvedTestObservationsPerArm,
          "PM cohort unresolved outcomes",
        );
      }
    } else {
      throw new TypeError("PM attempt cohort kind is invalid");
    }
    if (
      verified.sourceEvalReceiptDigest !== slot.receiptDigest ||
      runIds.has(verified.sourceEvalRunId)
    ) {
      throw new Error("PM attempt cohort receipt is substituted or reused");
    }
    runIds.add(verified.sourceEvalRunId);
    attempts.push({
      slotId,
      kind: attempt.kind,
      runId: verified.sourceEvalRunId,
      receiptDigest: verified.sourceEvalReceiptDigest,
      evidenceDigest,
    });
  }
  for (const arm of ["baseline", "candidate"]) {
    if (
      totals[arm].authenticatedOutcomes + totals[arm].unresolved !==
      perArmDenominator
    ) {
      throw new Error("PM attempt cohort denominator is incomplete");
    }
  }
  attempts.sort(
    (left, right) =>
      registered.slots.findIndex((slot) => slot.slotId === left.slotId) -
      registered.slots.findIndex((slot) => slot.slotId === right.slotId),
  );
  // A receipt may expire while later slots are being checked.
  for (const attempt of source.attempts) {
    if (attempt.kind === "receipt-unavailable") continue;
    const slot = slots.get(attempt.slotId);
    await verifyEvolutionEvalReceipt(
      verifier,
      attempt.source.receipt,
      slot.context.receiptContext,
    );
  }
  const core = {
    schema:
      preflightRejectedCount > 0
        ? PM_EXPLORATION_EFFECT_ATTEMPT_COHORT_V4_SCHEMA
        : missingReceiptCount > 0
          ? PM_EXPLORATION_EFFECT_ATTEMPT_COHORT_V3_SCHEMA
          : runtimeFailedCount > 0
            ? PM_EXPLORATION_EFFECT_ATTEMPT_COHORT_V2_SCHEMA
            : PM_EXPLORATION_EFFECT_ATTEMPT_COHORT_SCHEMA,
    cohortId,
    planDigest: plan.planDigest,
    registeredSlotCount: slots.size,
    authenticatedAttemptCount: attempts.length - missingReceiptCount,
    budgetInterruptedCount,
    ...(runtimeFailedCount > 0 || missingReceiptCount > 0
      ? { runtimeFailedCount }
      : {}),
    ...(missingReceiptCount > 0 ? { missingReceiptCount } : {}),
    ...(preflightRejectedCount > 0 ? { preflightRejectedCount } : {}),
    failedCompleteCount,
    perArmDenominator,
    baseline: totals.baseline,
    candidate: totals.candidate,
    attempts,
    unresolvedBlocksPromotion:
      budgetInterruptedCount > 0 ||
      runtimeFailedCount > 0 ||
      missingReceiptCount > 0 ||
      preflightRejectedCount > 0,
    allRegisteredOutcomesAvailable:
      budgetInterruptedCount === 0 &&
      runtimeFailedCount === 0 &&
      missingReceiptCount === 0 &&
      preflightRejectedCount === 0,
    statisticalEstimateAvailable: false,
    cohortCompletenessAuthenticated: false,
    reportAuthenticated: false,
    evidenceDecision:
      budgetInterruptedCount > 0 ||
      runtimeFailedCount > 0 ||
      missingReceiptCount > 0 ||
      preflightRejectedCount > 0 ||
      failedCompleteCount > 0
        ? "threshold-not-met"
        : "insufficient-evidence",
    requiresIndependentPilotApproval: true,
    qualifiesForPromotion: false,
  };
  return deepFreeze({ ...core, cohortDigest: hash(core.schema, core) });
}

export async function verifyPmExplorationEffectAttemptCohort(
  verifier,
  input,
  expected,
) {
  exact(input, ["source", "cohort"], "PM attempt cohort verification");
  const cohort = snapshotEffectEvidence(input.cohort, "PM attempt cohort");
  const recreated = await buildPmExplorationEffectAttemptCohort(
    verifier,
    input.source,
    expected,
  );
  if (canonical(recreated) !== canonical(cohort))
    throw new Error("PM attempt cohort differs from its signed sources");
  return recreated;
}

/** Associate the independently saved slot schedule with a reverified cohort. */
export async function buildPmExplorationEffectManifestBoundCohort(
  verifier,
  input,
  expected,
) {
  exact(
    input,
    ["cohortSource", "cohort", "slotManifest"],
    "PM manifest-bound cohort source",
  );
  exact(
    expected,
    ["cohort", "slotManifestDigest"],
    "PM manifest-bound cohort registration",
  );
  const cohortSource = snapshotEffectEvidence(
    input.cohortSource,
    "PM manifest-bound cohort source",
  );
  const cohort = snapshotEffectEvidence(input.cohort, "PM registered cohort");
  const slotManifest = snapshotEffectEvidence(
    input.slotManifest,
    "PM registered slot manifest",
  );
  const registeredCohort = snapshotEffectEvidence(
    expected.cohort,
    "PM registered cohort context",
  );
  const manifestDigest = digest(
    expected.slotManifestDigest,
    "PM registered slot manifest digest",
  );
  const manifest = verifyPmExplorationEffectSlotManifest({
    plan: cohortSource.plan,
    manifest: slotManifest,
  });
  if (
    manifest.manifestDigest !== manifestDigest ||
    manifest.cohortId !== registeredCohort.cohortId ||
    !Array.isArray(registeredCohort.slots) ||
    canonical(manifest.slotIds) !==
      canonical(registeredCohort.slots.map((slot) => slot.slotId))
  ) {
    throw new Error("PM cohort slots differ from the frozen manifest");
  }
  const verified = await verifyPmExplorationEffectAttemptCohort(
    verifier,
    { source: cohortSource, cohort },
    registeredCohort,
  );
  if (
    verified.cohortId !== manifest.cohortId ||
    verified.planDigest !== manifest.planDigest ||
    verified.perArmDenominator !== manifest.plannedTestObservationsPerArm
  ) {
    throw new Error("PM cohort denominator differs from the frozen manifest");
  }
  const core = {
    schema: PM_EXPLORATION_EFFECT_MANIFEST_BOUND_COHORT_SCHEMA,
    planDigest: manifest.planDigest,
    cohortId: manifest.cohortId,
    slotManifestDigest: manifest.manifestDigest,
    cohortDigest: verified.cohortDigest,
    registeredSlotCount: verified.registeredSlotCount,
    perArmDenominator: verified.perArmDenominator,
    slotScheduleBound: true,
    slotScheduleAuthenticated: false,
    cohortCompletenessAuthenticated: false,
    reportAuthenticated: false,
    evidenceDecision: verified.evidenceDecision,
    requiresIndependentPilotApproval: true,
    qualifiesForPromotion: false,
  };
  return deepFreeze({
    ...core,
    bindingDigest: hash(core.schema, core),
  });
}

export async function verifyPmExplorationEffectManifestBoundCohort(
  verifier,
  input,
  expected,
) {
  exact(
    input,
    ["cohortSource", "cohort", "slotManifest", "binding"],
    "PM manifest-bound cohort verification",
  );
  const binding = snapshotEffectEvidence(
    input.binding,
    "PM manifest-bound cohort",
  );
  const recreated = await buildPmExplorationEffectManifestBoundCohort(
    verifier,
    {
      cohortSource: input.cohortSource,
      cohort: input.cohort,
      slotManifest: input.slotManifest,
    },
    expected,
  );
  if (canonical(recreated) !== canonical(binding))
    throw new Error("PM manifest-bound cohort differs from its sources");
  return recreated;
}

/**
 * Sum only usage carried by independently verified final Eval receipts in a
 * frozen cohort. Missing receipts and preparation costs stay explicitly unknown.
 */
export async function buildPmExplorationEffectCohortUsageEvidence(
  verifier,
  input,
  expected,
) {
  const source = snapshotEffectEvidence(input, "PM cohort usage source");
  const registered = snapshotEffectEvidence(
    expected,
    "PM cohort usage registration",
  );
  exact(
    source,
    ["cohortSource", "cohort", "slotManifest", "binding"],
    "PM cohort usage source",
  );
  exact(
    registered,
    ["cohort", "slotManifestDigest"],
    "PM cohort usage registration",
  );
  const binding = await verifyPmExplorationEffectManifestBoundCohort(
    verifier,
    source,
    registered,
  );
  const knownSignedUsage = Object.fromEntries(
    SIGNED_EVAL_USAGE_FIELDS.map((field) => [field, 0]),
  );
  const slots = new Map(
    registered.cohort.slots.map((slot) => [slot.slotId, slot]),
  );
  let signedReceiptCount = 0;
  let slotsWithoutSignedUsage = 0;
  for (const attempt of source.cohortSource.attempts) {
    if (attempt.kind === "receipt-unavailable") {
      slotsWithoutSignedUsage += 1;
      continue;
    }
    const usage = attempt.source.receipt.usage;
    exact(usage, SIGNED_EVAL_USAGE_FIELDS, "signed Eval usage");
    for (const field of SIGNED_EVAL_USAGE_FIELDS) {
      knownSignedUsage[field] = integer(
        knownSignedUsage[field] + integer(usage[field], `signed ${field}`),
        `cohort ${field}`,
      );
    }
    signedReceiptCount += 1;
  }
  if (
    signedReceiptCount !== source.cohort.authenticatedAttemptCount ||
    signedReceiptCount + slotsWithoutSignedUsage !== binding.registeredSlotCount
  ) {
    throw new Error("PM cohort signed usage coverage differs from its slots");
  }
  // A receipt can expire while other slots are being aggregated.
  for (const attempt of source.cohortSource.attempts) {
    if (attempt.kind === "receipt-unavailable") continue;
    await verifyEvolutionEvalReceipt(
      verifier,
      attempt.source.receipt,
      slots.get(attempt.slotId).context.receiptContext,
    );
  }
  const core = {
    schema: PM_EXPLORATION_EFFECT_COHORT_USAGE_EVIDENCE_SCHEMA,
    planDigest: binding.planDigest,
    cohortId: binding.cohortId,
    slotManifestDigest: binding.slotManifestDigest,
    cohortDigest: binding.cohortDigest,
    bindingDigest: binding.bindingDigest,
    registeredSlotCount: binding.registeredSlotCount,
    signedReceiptCount,
    slotsWithoutSignedUsage,
    knownSignedUsage,
    usageScope: "signed-eval-execution-aggregate-only",
    providerSettlementsAuthenticated: false,
    preparationCostsAuthenticated: false,
    totalCostAuthenticated: false,
    cohortCompletenessAuthenticated: false,
    reportAuthenticated: false,
    evidenceDecision: binding.evidenceDecision,
    requiresIndependentPilotApproval: true,
    qualifiesForPromotion: false,
  };
  return deepFreeze({
    ...core,
    usageEvidenceDigest: hash(core.schema, core),
  });
}

export async function verifyPmExplorationEffectCohortUsageEvidence(
  verifier,
  input,
  expected,
) {
  exact(
    input,
    ["cohortSource", "cohort", "slotManifest", "binding", "usageEvidence"],
    "PM cohort usage verification",
  );
  const evidence = snapshotEffectEvidence(
    input.usageEvidence,
    "PM cohort usage evidence",
  );
  const recreated = await buildPmExplorationEffectCohortUsageEvidence(
    verifier,
    {
      cohortSource: input.cohortSource,
      cohort: input.cohort,
      slotManifest: input.slotManifest,
      binding: input.binding,
    },
    expected,
  );
  if (canonical(recreated) !== canonical(evidence))
    throw new Error("PM cohort usage differs from its signed sources");
  return recreated;
}

/**
 * Re-read both independent authorities and bind their results to the same
 * frozen plan and preparation declaration. Provider evidence is partial, so
 * this bundle must never upgrade the effect report's authentication decision.
 */
export async function buildPmExplorationEffectProviderEvidenceBundle(
  verifier,
  providerAdapter,
  input,
  expected,
) {
  exact(
    input,
    ["effectSource", "effectReport", "providerSource", "providerEvidence"],
    "PM effect provider bundle source",
  );
  exact(
    expected,
    ["effect", "provider"],
    "PM effect provider bundle registration",
  );
  // Capture all caller data before the first asynchronous receipt check.
  const effectSource = snapshotEffectEvidence(
    input.effectSource,
    "PM effect provider bundle effect source",
  );
  const effectReport = snapshotEffectEvidence(
    input.effectReport,
    "PM effect provider bundle effect report",
  );
  const providerSource = snapshotEffectEvidence(
    input.providerSource,
    "PM effect provider bundle provider source",
  );
  const providerEvidence = snapshotEffectEvidence(
    input.providerEvidence,
    "PM effect provider bundle provider evidence",
  );
  const effectExpected = snapshotEffectEvidence(
    expected.effect,
    "PM effect provider bundle effect registration",
  );
  const providerExpected = snapshotEffectEvidence(
    expected.provider,
    "PM effect provider bundle provider registration",
  );
  if (
    canonical(effectSource.plan) !== canonical(providerSource.plan) ||
    canonical(effectSource.phaseUsage) !== canonical(providerSource.phaseUsage)
  ) {
    throw new Error("PM provider evidence differs from effect plan or phases");
  }
  let verifiedProvider = verifyPmExplorationPreparationProviderEvidence(
    providerAdapter,
    { source: providerSource, evidence: providerEvidence },
    providerExpected,
  );
  const verifiedEffect = await verifyPmExplorationEffectEvidenceReport(
    verifier,
    { source: effectSource, report: effectReport },
    effectExpected,
  );
  // Recheck receipt freshness, then read the durable provider artifact last.
  await verifyEvolutionEvalReceipt(
    verifier,
    effectSource.receipt,
    effectExpected.receiptContext,
  );
  verifiedProvider = verifyPmExplorationPreparationProviderEvidence(
    providerAdapter,
    { source: providerSource, evidence: providerEvidence },
    providerExpected,
  );
  if (
    verifiedEffect.planDigest !== verifiedProvider.planDigest ||
    verifiedEffect.phaseUsageDigest !== verifiedProvider.phaseUsageDigest
  ) {
    throw new Error("PM provider evidence is not bound to the effect report");
  }
  const core = {
    schema: PM_EXPLORATION_EFFECT_PROVIDER_EVIDENCE_BUNDLE_SCHEMA,
    planDigest: verifiedEffect.planDigest,
    phaseUsageDigest: verifiedEffect.phaseUsageDigest,
    effectEvidenceReportDigest: verifiedEffect.evidenceReportDigest,
    providerEvidenceDigest: verifiedProvider.evidenceDigest,
    providerPhaseTotals: verifiedProvider.phaseTotals,
    evidenceDecision: verifiedEffect.evidenceDecision,
    blockingReasons: verifiedEffect.blockingReasons,
    executionEvidenceAuthenticated: true,
    providerCostsAuthenticatedForRegisteredRequests: true,
    preparationEvidenceAuthenticated: false,
    reportAuthenticated: false,
    requiresIndependentPilotApproval: true,
    qualifiesForPromotion: false,
  };
  return deepFreeze({
    ...core,
    bundleDigest: hash(core.schema, core),
  });
}

export async function verifyPmExplorationEffectProviderEvidenceBundle(
  verifier,
  providerAdapter,
  input,
  expected,
) {
  exact(
    input,
    [
      "effectSource",
      "effectReport",
      "providerSource",
      "providerEvidence",
      "bundle",
    ],
    "PM effect provider bundle verification",
  );
  const bundle = snapshotEffectEvidence(
    input.bundle,
    "PM effect provider bundle",
  );
  const recreated = await buildPmExplorationEffectProviderEvidenceBundle(
    verifier,
    providerAdapter,
    {
      effectSource: input.effectSource,
      effectReport: input.effectReport,
      providerSource: input.providerSource,
      providerEvidence: input.providerEvidence,
    },
    expected,
  );
  if (canonical(recreated) !== canonical(bundle))
    throw new Error(
      "PM effect provider bundle differs from authenticated sources",
    );
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
