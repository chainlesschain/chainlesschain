import {
  evalDigest,
  evalHistoryRecordIssues,
  evalExecutionSucceeded,
} from "./evidence.js";

export const OUTCOME_PLAN_SCHEMA = "chainlesschain.outcome-plan/v1";
export const OUTCOME_REPORT_SCHEMA = "chainlesschain.outcome-report/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CATEGORIES = new Set([
  "repair",
  "support",
  "compatibility",
  "release",
  "test-infrastructure",
  "construction",
]);
const STAGES = ["install", "configure", "authenticate", "tool", "artifact"];
const FAILURE_CAUSES = new Set([
  "install",
  "configuration-identity",
  "model-protocol",
  "tools-permissions",
  "retrieval-context",
  "recovery",
  "artifact",
  "environment",
  "budget",
  "manual-repair",
]);
const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
const nonnegative = (value) => Number.isFinite(value) && value >= 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const rate = (numerator, denominator) =>
  denominator ? numerator / denominator : null;
function assert(value, message) {
  if (!value) throw new Error(message);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}
export function outcomeDigest(value) {
  return evalDigest(JSON.stringify(canonical(value)));
}
function epoch(value) {
  const time = Date.parse(value);
  return typeof value === "string" &&
    Number.isFinite(time) &&
    new Date(time).toISOString() === value
    ? time
    : NaN;
}
function uniqueIndex(rows, key, label) {
  assert(Array.isArray(rows), `${label} must be an array`);
  const index = new Map();
  for (const row of rows) {
    assert(
      row && nonempty(row[key]) && !index.has(row[key]),
      `${label} contains a missing or duplicate ${key}`,
    );
    index.set(row[key], row);
  }
  return index;
}

export function validateOutcomePlan(plan) {
  assert(plan?.schema === OUTCOME_PLAN_SCHEMA, "invalid outcome plan schema");
  assert(
    /^[a-f0-9]{40}$/u.test(plan.commitSha || ""),
    "plan requires an exact commit SHA",
  );
  assert(/^[A-Z]{3}$/u.test(plan.currency || ""), "plan requires one currency");
  assert(
    epoch(plan.window?.start) < epoch(plan.window?.end),
    "invalid observation window",
  );
  const samples = uniqueIndex(plan.samples, "id", "plan samples");
  assert(
    samples.size > 0 && samples.size <= 10000,
    "plan requires 1–10000 samples",
  );
  for (const sample of samples.values()) {
    assert(["task", "first-run"].includes(sample.kind), "invalid sample kind");
    assert(
      nonempty(sample.taskId) && nonempty(sample.stratum),
      "sample requires taskId and stratum",
    );
    assert(
      DIGEST.test(sample.comparisonDigest || ""),
      "sample requires an Eval comparison digest",
    );
    assert(
      nonnegative(sample.costBudget) &&
        Number.isFinite(sample.timeBudgetMs) &&
        sample.timeBudgetMs > 0,
      "sample requires finite cost and time budgets",
    );
  }
  return samples;
}

function summarize(rows) {
  const succeeded = rows.filter((row) => row.succeeded).length;
  const observed = rows.filter((row) => row.observed).length;
  const knownCost = rows.reduce((sum, row) => sum + (row.cost ?? 0), 0);
  const costsComplete = rows.every((row) => row.observed && row.cost !== null);
  return {
    planned: rows.length,
    observed,
    missing: rows.length - observed,
    succeeded,
    successRate: rate(succeeded, rows.length),
    knownCost,
    totalCost: costsComplete ? knownCost : null,
    costPerSuccess: costsComplete && succeeded ? knownCost / succeeded : null,
    retries: rows.every((row) => row.retries !== null)
      ? rows.reduce((sum, row) => sum + row.retries, 0)
      : null,
    manualRepairs: rows.every((row) => row.manualRepairs !== null)
      ? rows.reduce((sum, row) => sum + row.manualRepairs, 0)
      : null,
  };
}

/** Read-only measurement. Declarations and local Eval files are not attestations. */
export function buildOutcomeReport(
  { plan, history, observations = [], maintenance = null },
  { now = Date.now(), expectedPlanDigest } = {},
) {
  const samples = validateOutcomePlan(plan);
  assert(Number.isFinite(now), "invalid report time");
  const planDigest = outcomeDigest(plan);
  assert(
    !expectedPlanDigest || expectedPlanDigest === planDigest,
    "frozen plan digest mismatch",
  );
  const observed = uniqueIndex(observations, "sampleId", "observations");
  for (const id of observed.keys())
    assert(samples.has(id), "observation is outside the frozen plan");
  const runs = uniqueIndex(history?.runs ?? [], "runId", "Eval history");
  const issues = (history?.issues ?? []).map((issue) => issue.code);
  if (epoch(plan.window.end) > now)
    issues.push("observation_window_not_closed");
  const usedEvidence = new Set();
  const rows = [];
  for (const sample of samples.values()) {
    const observation = observed.get(sample.id);
    const reasons = [];
    const row = {
      sampleId: sample.id,
      kind: sample.kind,
      taskId: sample.taskId,
      stratum: sample.stratum,
      observed: Boolean(observation),
      succeeded: false,
      reasons,
      cost: null,
      elapsedMs: null,
      retries: null,
      manualRepairs: null,
      failureCause: null,
      firstRunCompletedStages: [],
    };
    rows.push(row);
    if (!observation) {
      reasons.push("missing_observation");
      issues.push(`${sample.id}:missing_observation`);
      continue;
    }
    for (const key of ["cost", "elapsedMs", "retries", "manualRepairs"]) {
      const valid = ["retries", "manualRepairs"].includes(key)
        ? count(observation[key])
        : nonnegative(observation[key]);
      if (valid) row[key] = observation[key];
      else reasons.push(`missing_or_invalid_${key}`);
    }
    const observedAt = epoch(observation.observedAt);
    if (!(
      observedAt <= Math.min(now, epoch(plan.window.end)) &&
      observedAt - (row.elapsedMs ?? 0) >= epoch(plan.window.start)
    ))
      reasons.push("observation_outside_window");
    const run = runs.get(observation.runId);
    const stoppedBeforeTask =
      sample.kind === "first-run" &&
      observation.runId === null &&
      observation.firstRun?.stages?.tool?.passed === false;
    const evidenceKey = JSON.stringify([observation.runId, sample.taskId]);
    if (observation.runId !== null) {
      assert(
        !usedEvidence.has(evidenceKey),
        "a task execution cannot count as multiple samples",
      );
      usedEvidence.add(evidenceKey);
    }
    if (!run && !stoppedBeforeTask) reasons.push("missing_eval_run");
    if (run) {
      // Failed executions are valid observations, not successful outcomes.
      // All other existing Eval integrity rules remain authoritative.
      const integrity = evalHistoryRecordIssues(
        run,
        now,
        Math.max(1, now - epoch(plan.window.start)),
      ).filter((reason) => reason !== "execution_not_successful");
      reasons.push(...integrity);
      if (run.label !== plan.commitSha) reasons.push("commit_mismatch");
      if (outcomeDigest(run.comparison) !== sample.comparisonDigest)
        reasons.push("comparison_mismatch");
      if (!(
        epoch(run.ranAt) >= epoch(plan.window.start) &&
        epoch(run.ranAt) <= epoch(plan.window.end)
      ))
        reasons.push("run_outside_window");
    }
    const result = run?.results?.find((item) => item?.id === sample.taskId);
    if (!result && !stoppedBeforeTask) reasons.push("missing_task_result");
    if (result && (!nonnegative(result.ms) || row.elapsedMs < result.ms))
      reasons.push("invalid_elapsed_time");
    if (sample.kind === "first-run") {
      if (typeof observation.firstRun?.cleanEnvironment !== "boolean")
        reasons.push("missing_clean_environment_evidence");
      for (const stage of STAGES) {
        const evidence = observation.firstRun?.stages?.[stage];
        if (
          !evidence ||
          typeof evidence.passed !== "boolean" ||
          !nonempty(evidence.receipt)
        )
          reasons.push(`missing_stage_evidence:${stage}`);
        else if (evidence.passed) row.firstRunCompletedStages.push(stage);
      }
      // A later completed stage without its prerequisites is not a valid funnel.
      if (
        row.firstRunCompletedStages.some(
          (stage, index) => stage !== STAGES[index],
        )
      )
        reasons.push("inconsistent_first_run_stages");
    }
    for (const reason of reasons) issues.push(`${sample.id}:${reason}`);
    const successfulExecution =
      result?.pass === true &&
      result.artifactCheckPassed === true &&
      evalExecutionSucceeded(result) &&
      result.executionEvidence.observedFallback === false;
    if (!successfulExecution) reasons.push("task_not_successful");
    if (row.elapsedMs > sample.timeBudgetMs || row.cost > sample.costBudget)
      reasons.push("budget_exceeded");
    if (row.manualRepairs > 0) reasons.push("manual_repair");
    if (
      sample.kind === "first-run" &&
      (observation.firstRun?.cleanEnvironment !== true ||
        row.firstRunCompletedStages.length !== STAGES.length)
    )
      reasons.push("first_run_not_completed");
    row.succeeded = reasons.length === 0;
    if (!row.succeeded) {
      if (FAILURE_CAUSES.has(observation.failureCause))
        row.failureCause = observation.failureCause;
      else issues.push(`${sample.id}:missing_failure_cause`);
    }
  }
  const categories = Object.fromEntries(
    [...CATEGORIES].map((category) => [category, 0]),
  );
  let maintenanceComplete = false;
  if (maintenance) {
    const entries = uniqueIndex(
      maintenance.entries,
      "id",
      "maintenance entries",
    );
    maintenanceComplete =
      maintenance.complete === true &&
      outcomeDigest(maintenance.window) === outcomeDigest(plan.window);
    for (const entry of entries.values()) {
      assert(
        CATEGORIES.has(entry.category) &&
          nonnegative(entry.hours) &&
          nonempty(entry.evidenceRef),
        "invalid maintenance entry",
      );
      categories[entry.category] += entry.hours;
    }
  }
  if (!maintenanceComplete) issues.push("incomplete_maintenance_records");
  const maintenanceHours = [...CATEGORIES]
    .filter((category) => category !== "construction")
    .reduce((sum, category) => sum + categories[category], 0);
  const attempts = rows.filter((row) => row.observed).length;
  const allObserved = rows.every((row) => row.observed);
  const firstRuns = rows.filter((row) => row.kind === "first-run");
  const tasks = rows.filter((row) => row.kind === "task");
  if (!firstRuns.length || !tasks.length)
    issues.push("missing_metric_population");
  return {
    schema: OUTCOME_REPORT_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    scope: "local-outcome-baseline",
    productionAttested: false,
    status: issues.length ? "INSUFFICIENT_EVIDENCE" : "BASELINE_RECORDED",
    // Neither a baseline nor operator declarations constitute an improvement gate.
    improvementVerdict: "NOT_EVALUATED",
    planDigest,
    commitSha: plan.commitSha,
    currency: plan.currency,
    window: plan.window,
    task: summarize(tasks),
    firstRun: summarize(firstRuns),
    maintenance: {
      complete: maintenanceComplete,
      knownHours: maintenanceHours,
      totalHours: maintenanceComplete ? maintenanceHours : null,
      per100Attempts:
        maintenanceComplete && allObserved && attempts
          ? (maintenanceHours / attempts) * 100
          : null,
      observedAttempts: attempts,
      constructionHours: maintenanceComplete ? categories.construction : null,
      categories,
    },
    groups: [
      ...new Set(
        rows.map((row) => JSON.stringify([row.kind, row.stratum, row.taskId])),
      ),
    ].map((key) => {
      const [kind, stratum, taskId] = JSON.parse(key);
      return {
        kind,
        stratum,
        taskId,
        ...summarize(
          rows.filter(
            (row) =>
              row.kind === kind &&
              row.stratum === stratum &&
              row.taskId === taskId,
          ),
        ),
      };
    }),
    firstRunFunnel: STAGES.map((stage, index) => ({
      stage,
      planned: firstRuns.length,
      passed: firstRuns.filter((row) =>
        STAGES.slice(0, index + 1).every((required) =>
          row.firstRunCompletedStages.includes(required),
        ),
      ).length,
    })),
    failureCauses: [
      ...new Set(
        rows
          .filter((row) => !row.succeeded)
          .map((row) => row.failureCause || "unknown"),
      ),
    ].map((cause) => ({
      cause,
      count: rows.filter(
        (row) => !row.succeeded && (row.failureCause || "unknown") === cause,
      ).length,
    })),
    issues: [...new Set(issues)],
    rows,
  };
}
