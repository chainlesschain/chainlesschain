import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { computeTrend } from "./trend.js";
import { redactSecrets } from "../secret-scan.js";

export const EVAL_HISTORY_SCHEMA = "chainlesschain.eval-history/v1";
export const EVAL_CONTEXT_SCHEMA = "chainlesschain.eval-comparison-context/v1";
export const EVAL_COMPARISON_SCHEMA = "chainlesschain.eval-comparison/v1";
export const EVAL_EXECUTION_PROTOCOL = "cc-agent-stream-json/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const CONTEXT_KEYS = [
  "schema",
  "provider",
  "model",
  "modelRevision",
  "environmentDigest",
  "permissionDigest",
  "inferenceDigest",
];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function evalDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function nonempty(value) {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 1024
  );
}

/** These are operator declarations, not observed provider state or PKI proofs. */
export function validateComparisonContext(value, { provider, model } = {}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== CONTEXT_KEYS.length ||
    Object.keys(value).some((key) => !CONTEXT_KEYS.includes(key)) ||
    value.schema !== EVAL_CONTEXT_SCHEMA ||
    ![value.provider, value.model, value.modelRevision].every(nonempty) ||
    ![
      value.environmentDigest,
      value.permissionDigest,
      value.inferenceDigest,
    ].every((v) => DIGEST.test(v || ""))
  ) {
    throw new Error(
      "comparison context requires its v1 schema, provider, model, modelRevision and environment/permission/inference sha256 digests",
    );
  }
  if (
    (provider !== undefined && value.provider !== provider) ||
    (model !== undefined && value.model !== model)
  ) {
    throw new Error(
      "comparison context must match explicit --provider and --model",
    );
  }
  return { ...value };
}

export function readComparisonContext(file, selection) {
  if (fs.statSync(file).size > 16 * 1024)
    throw new Error("comparison context exceeds its size limit");
  const bytes = fs.readFileSync(file);
  if (bytes.length === 0 || bytes.length > 16 * 1024) {
    throw new Error("comparison context exceeds its size limit");
  }
  return validateComparisonContext(
    JSON.parse(bytes.toString("utf8")),
    selection,
  );
}

export function createEvalComparison({
  suite,
  corpusDigest,
  provider,
  model,
  context,
  platform = process.platform,
  arch = process.arch,
  node = process.version,
} = {}) {
  if (!context) return null;
  if (!nonempty(provider) || !nonempty(model)) {
    throw new Error(
      "--comparison-context requires explicit --provider and --model",
    );
  }
  if (!nonempty(suite) || !DIGEST.test(corpusDigest || ""))
    throw new Error("eval corpus identity is required");
  const declared = validateComparisonContext(context, { provider, model });
  return {
    schema: EVAL_COMPARISON_SCHEMA,
    basis: "local-runtime-and-operator-declarations",
    suite,
    corpusDigest,
    provider,
    model,
    runtime: { platform, arch, node },
    permissionMode: "acceptEdits",
    executionProtocol: EVAL_EXECUTION_PROTOCOL,
    declared,
  };
}

export function createEvalHistoryRecord(
  summary,
  {
    comparison = null,
    dryRun = false,
    label = null,
    ranAt = new Date().toISOString(),
    runId = randomUUID(),
  } = {},
) {
  return {
    schema: EVAL_HISTORY_SCHEMA,
    runId,
    ranAt,
    label,
    dryRun,
    comparison,
    passed: summary.passed,
    failed: summary.failed,
    total: summary.total,
    passRate: summary.passRate,
    unrelatedChangeRate: summary.unrelatedChangeRate,
    results: summary.results.map((result) => ({
      id: result.id,
      pass: result.pass,
      artifactCheckPassed: result.artifactCheckPassed,
      executionSucceeded: result.executionSucceeded,
      agentOk: result.agentOk,
      executionEvidence: result.executionEvidence,
      error:
        result.error == null
          ? null
          : redactSecrets(String(result.error)).slice(0, 2048),
      detail: redactSecrets(String(result.detail || "")).slice(0, 2048),
      ms: result.ms,
      changedFiles: result.changedFiles,
      unrelatedChanges: result.unrelatedChanges,
    })),
  };
}

/** Diagnostic callers may inspect valid rows, but must keep parse issues. */
export function parseEvalHistory(text) {
  const runs = [],
    issues = [];
  if (Buffer.byteLength(text, "utf8") > MAX_HISTORY_BYTES) {
    return { runs, issues: [{ code: "history_too_large" }] };
  }
  text.split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("not a record");
      runs.push(value);
    } catch {
      issues.push({ code: "invalid_history_record", line: index + 1 });
    }
  });
  return { runs, issues };
}

export function readEvalHistory(file) {
  if (!fs.existsSync(file)) return { runs: [], issues: [] };
  if (fs.statSync(file).size > MAX_HISTORY_BYTES) {
    return { runs: [], issues: [{ code: "history_too_large" }] };
  }
  return parseEvalHistory(fs.readFileSync(file, "utf8"));
}

function validateComparison(value) {
  try {
    const rebuilt = createEvalComparison({
      suite: value?.suite,
      corpusDigest: value?.corpusDigest,
      provider: value?.provider,
      model: value?.model,
      context: value?.declared,
      platform: value?.runtime?.platform,
      arch: value?.runtime?.arch,
      node: value?.runtime?.node,
    });
    return (
      rebuilt &&
      Object.values(value.runtime).every(nonempty) &&
      canonical(rebuilt) === canonical(value)
    );
  } catch {
    return false;
  }
}

function recordIssues(record, now, maxAgeMs) {
  if (!record || typeof record !== "object" || Array.isArray(record))
    return ["invalid_history_record"];
  const issues = [];
  if (record.schema !== EVAL_HISTORY_SCHEMA || !nonempty(record.runId))
    issues.push("legacy_or_missing_run_identity");
  if (record.dryRun !== false) issues.push("dry_run_or_missing_execution_mode");
  const epoch = Date.parse(record.ranAt);
  if (
    typeof record.ranAt !== "string" ||
    !Number.isFinite(epoch) ||
    new Date(epoch).toISOString() !== record.ranAt ||
    epoch > now ||
    now - epoch > maxAgeMs
  )
    issues.push("invalid_or_expired_evidence");
  if (!validateComparison(record.comparison))
    issues.push("missing_comparison_identity");
  const results = record.results;
  if (!Array.isArray(results) || results.length === 0)
    return [...issues, "missing_task_results"];
  const ids = new Set();
  let passed = 0;
  for (const result of results) {
    if (!result || !nonempty(result.id) || ids.has(result.id)) {
      issues.push("invalid_or_duplicate_task");
      continue;
    }
    ids.add(result.id);
    const execution = result.executionEvidence;
    if (
      typeof result.pass !== "boolean" ||
      typeof result.artifactCheckPassed !== "boolean" ||
      typeof result.executionSucceeded !== "boolean" ||
      result.agentOk !== result.executionSucceeded ||
      result.pass !== (result.artifactCheckPassed && result.executionSucceeded)
    )
      issues.push("inconsistent_task_verdict");
    if (
      !result.executionSucceeded ||
      result.error !== null ||
      execution?.protocol !== EVAL_EXECUTION_PROTOCOL ||
      execution.exitCode !== 0 ||
      execution.signal !== null ||
      execution.terminalVerified !== true
    )
      issues.push("execution_not_successful");
    if (execution?.observedFallback !== false)
      issues.push("fallback_or_missing_model_continuity");
    if (result.pass === true) passed += 1;
  }
  if (
    record.total !== results.length ||
    record.passed !== passed ||
    record.failed !== results.length - passed ||
    record.passRate !== passed / results.length
  )
    issues.push("inconsistent_task_totals");
  return issues;
}

/**
 * A local comparison gate. It does not attest model checkpoints, configuration
 * declarations, edited JSONL, hidden holdouts, or production release authority.
 * Append order selects the pair; timestamps cannot silently select older rows.
 */
export function evaluateStrictEvalGate(
  { runs = [], issues = [] } = {},
  {
    now = Date.now(),
    maxAgeMs = 7 * 24 * 60 * 60 * 1000,
    regressionThreshold = 0,
  } = {},
) {
  const reasons = issues.map((issue) => issue.code);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs <= 0 ||
    !Number.isFinite(regressionThreshold) ||
    regressionThreshold < 0 ||
    regressionThreshold > 1
  )
    reasons.push("invalid_gate_options");
  if (!Array.isArray(runs) || runs.length < 2) reasons.push("missing_baseline");
  const pair = Array.isArray(runs) ? runs.slice(-2) : [];
  for (const record of pair)
    reasons.push(...recordIssues(record, now, maxAgeMs));
  if (pair.length === 2) {
    const [baseline, candidate] = pair;
    if (
      baseline?.runId === candidate?.runId ||
      Date.parse(baseline?.ranAt) >= Date.parse(candidate?.ranAt)
    )
      reasons.push("duplicate_or_unordered_runs");
    if (canonical(baseline?.comparison) !== canonical(candidate?.comparison))
      reasons.push("comparison_identity_changed");
    const ids = (record) =>
      (Array.isArray(record?.results) ? record.results : [])
        .map((r) => r?.id)
        .sort();
    if (canonical(ids(baseline)) !== canonical(ids(candidate)))
      reasons.push("task_population_changed");
  }
  const uniqueReasons = [...new Set(reasons)];
  const base = {
    scope: "local-eval-comparison",
    productionAttested: false,
    baselineRunId: pair.length === 2 ? pair[0]?.runId || null : null,
    candidateRunId: pair.at(-1)?.runId || null,
  };
  if (uniqueReasons.length)
    return {
      ...base,
      status: "INSUFFICIENT_EVIDENCE",
      passed: false,
      reasons: uniqueReasons,
    };
  const trend = computeTrend(pair, { regressionThreshold });
  const failed = trend.regressed || pair[1].passed !== pair[1].total;
  return {
    ...base,
    status: failed ? "FAIL" : "PASS",
    passed: !failed,
    reasons: failed
      ? [trend.regressed ? "task_regression" : "candidate_tasks_failed"]
      : [],
    trend,
  };
}
