#!/usr/bin/env node
/** Read-only VERIFY-01 preparation/collection checks; never executes a task. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createEvalComparison,
  EVAL_EXECUTION_PROTOCOL,
  evalDigest,
  evalHistoryRecordIssues,
  readEvalHistory,
} from "../src/lib/eval/evidence.js";
import {
  buildOutcomeReport,
  outcomeDigest,
  validateOutcomePlan,
} from "../src/lib/eval/outcomes.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_BYTES = 16 * 1024 * 1024;
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function index(rows, key, label) {
  requireValue(Array.isArray(rows), `${label} must be an array`);
  const result = new Map();
  for (const row of rows) {
    requireValue(
      typeof row?.[key] === "string" &&
        row[key].length > 0 &&
        !result.has(row[key]),
      `${label}: missing or duplicate ${key}`,
    );
    result.set(row[key], row);
  }
  return result;
}
function relativeFile(value) {
  requireValue(
    typeof value === "string" &&
      value.length > 0 &&
      !/[\\:\u0000]/u.test(value) &&
      !value.startsWith("/") &&
      value.split("/").every((part) => part && !/[. ]$/u.test(part)),
    "review paths must be exact relative files",
  );
  return value;
}
function readBytes(file) {
  const descriptor = fs.openSync(file, "r");
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    requireValue(
      before.isFile() && before.size <= BigInt(MAX_BYTES),
      "input must be a regular file within 16 MiB",
    );
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      const size = fs.readSync(
        descriptor,
        bytes,
        count,
        bytes.length - count,
        null,
      );
      if (!size) break;
      count += size;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    requireValue(
      count === Number(before.size) &&
        ["dev", "ino", "size", "mtimeNs", "ctimeNs"].every(
          (key) => before[key] === after[key],
        ),
      "input changed during read",
    );
    return bytes.subarray(0, count);
  } finally {
    fs.closeSync(descriptor);
  }
}
const readJson = (file) => JSON.parse(readBytes(file).toString("utf8"));

export function validateVerify01Bundle({
  plan,
  catalog,
  bindings,
  expectedPlanDigest,
}) {
  const samples = validateOutcomePlan(plan);
  requireValue(
    DIGEST.test(expectedPlanDigest || "") &&
      outcomeDigest(plan) === expectedPlanDigest,
    "frozen plan digest mismatch",
  );
  requireValue(
    catalog?.schema === "chainlesschain.verify01-task-catalog/v1" &&
      catalog.projectCommit === plan.commitSha,
    "catalog project SHA mismatch",
  );
  const tasks = index(catalog.tasks, "id", "catalog tasks");
  requireValue(
    tasks.size === 36 && samples.size === 45,
    "VERIFY-01 requires all 36 tasks and 45 samples",
  );
  const taskSamples = [...samples.values()].filter(
    (sample) => sample.kind === "task",
  );
  requireValue(
    taskSamples.length === 36 &&
      new Set(taskSamples.map((sample) => sample.taskId)).size === 36,
    "task population is incomplete or duplicated",
  );
  for (const task of tasks.values()) {
    requireValue(
      task.status === "NOT_RUN" &&
        typeof task.prompt === "string" &&
        task.prompt.length > 0,
      "frozen task definition changed",
    );
    requireValue(
      Array.isArray(task.sourcePaths) &&
        Array.isArray(task.expectedFiles) &&
        task.expectedFiles.length > 0,
      "task paths are required",
    );
    [...task.sourcePaths, ...task.expectedFiles].forEach(relativeFile);
  }
  for (const sample of samples.values()) {
    requireValue(
      tasks.has(sample.taskId),
      "sample task is absent from catalog",
    );
    const comparison = bindings?.comparisons?.[sample.stratum];
    requireValue(
      comparison &&
        outcomeDigest(comparison) === sample.comparisonDigest &&
        comparison.corpusDigest === outcomeDigest(catalog),
      "catalog/comparison digest mismatch",
    );
    const rebuilt = createEvalComparison({
      ...comparison,
      context: comparison.declared,
      ...comparison.runtime,
    });
    requireValue(
      outcomeDigest(rebuilt) === outcomeDigest(comparison),
      "invalid frozen comparison",
    );
  }
  return { tasks, samples };
}

/** Review is operator configuration, not proof of independent human review. */
export function validateVerify01Review(
  bundle,
  { review, expectedReviewDigest, projectCommit, readReviewedFile },
) {
  const { tasks, samples } = validateVerify01Bundle(bundle);
  requireValue(
    DIGEST.test(expectedReviewDigest || "") &&
      outcomeDigest(review) === expectedReviewDigest,
    "review digest mismatch",
  );
  requireValue(
    projectCommit === bundle.catalog.projectCommit &&
      review.projectCommit === projectCommit,
    "review/project SHA mismatch",
  );
  requireValue(
    review.planDigest === bundle.expectedPlanDigest &&
      review.catalogDigest === outcomeDigest(bundle.catalog),
    "review frozen identity mismatch",
  );
  const reviewed = index(review.tasks, "taskId", "review tasks");
  requireValue(
    reviewed.size === tasks.size &&
      [...tasks.keys()].every((id) => reviewed.has(id)),
    "review tasks omitted or outside catalog",
  );
  const protectedPaths = new Set();
  for (const [id, entry] of reviewed) {
    const task = tasks.get(id);
    requireValue(
      Array.isArray(entry.allowedChangedPaths) &&
        new Set(entry.allowedChangedPaths).size ===
          entry.allowedChangedPaths.length,
      "review allowed paths missing or duplicated",
    );
    const declared = new Set([...task.expectedFiles, ...task.sourcePaths]);
    requireValue(
      task.expectedFiles.every((file) =>
        entry.allowedChangedPaths.includes(file),
      ),
      "review omits expected deliverable",
    );
    for (const file of entry.allowedChangedPaths)
      requireValue(
        declared.has(relativeFile(file)),
        "review expands task change surface",
      );
    for (const kind of ["setup", "check"]) {
      const artifact = entry[kind];
      relativeFile(artifact?.path);
      requireValue(
        DIGEST.test(artifact?.digest || ""),
        `review ${kind} digest required`,
      );
      requireValue(
        typeof readReviewedFile === "function" &&
          evalDigest(readReviewedFile(artifact.path)) === artifact.digest,
        `reviewed ${kind} file changed`,
      );
      protectedPaths.add(artifact.path.toLowerCase());
    }
  }
  for (const entry of reviewed.values())
    requireValue(
      entry.allowedChangedPaths.every((file) => !protectedPaths.has(file.toLowerCase())),
      "reviewed evaluator must not be an allowed task edit",
    );
  return { tasks, samples, reviewed };
}

/** Validate imported existing Eval records; never mint terminal/provider facts. */
export function validateVerify01Collection(
  bundle,
  preparation,
  { sampleIds, history, observations, now = Date.now() },
) {
  const { samples, reviewed } = validateVerify01Review(bundle, preparation);
  requireValue(
    Array.isArray(sampleIds) &&
      sampleIds.length > 0 &&
      new Set(sampleIds).size === sampleIds.length &&
      sampleIds.every((id) => samples.has(id)),
    "selected samples missing, duplicate or outside plan",
  );
  const observed = index(observations, "sampleId", "observations");
  requireValue(
    observed.size === sampleIds.length &&
      sampleIds.every((id) => observed.has(id)),
    "selected observations omitted or unexpected",
  );
  requireValue(
    Array.isArray(history?.issues) && history.issues.length === 0,
    "Eval history contains parse issues",
  );
  const runs = index(history?.runs, "runId", "Eval history");
  const used = new Set();
  const report = buildOutcomeReport(
    { plan: bundle.plan, history, observations },
    { now, expectedPlanDigest: bundle.expectedPlanDigest },
  );
  for (const id of sampleIds) {
    const sample = samples.get(id);
    const observation = observed.get(id);
    if (
      sample.kind === "first-run" &&
      observation.runId === null &&
      observation.firstRun?.stages?.tool?.passed === false
    ) {
      const row = report.rows.find((item) => item.sampleId === id);
      const failureReasons = new Set([
        "task_not_successful", "first_run_not_completed", "budget_exceeded", "manual_repair",
        ...(observation.cost === null ? ["missing_or_invalid_cost"] : []),
      ]);
      requireValue(
        row.failureCause && row.reasons.every((reason) => failureReasons.has(reason)),
        "invalid first-run early-stop evidence",
      );
      continue;
    }
    const run = runs.get(observation.runId);
    requireValue(
      run && run.label === bundle.plan.commitSha,
      "collected run SHA mismatch or missing run",
    );
    requireValue(
      outcomeDigest(run.comparison) === sample.comparisonDigest,
      "collected comparison mismatch",
    );
    const issues = evalHistoryRecordIssues(
      run,
      now,
      Math.max(1, now - Date.parse(bundle.plan.window.start)),
    ).filter((issue) => issue !== "execution_not_successful");
    requireValue(
      issues.length === 0,
      `invalid Eval record: ${issues.join(",")}`,
    );
    const result = run.results.find((row) => row.id === sample.taskId);
    requireValue(
      result?.executionEvidence?.terminalVerified === true &&
        result.executionEvidence.protocol === EVAL_EXECUTION_PROTOCOL,
      "collected task has no verified terminal",
    );
    const key = JSON.stringify([run.runId, sample.taskId]);
    requireValue(!used.has(key), "task execution reused across samples");
    used.add(key);
    const cost = result.totalCostUsd;
    requireValue(
      (cost === null || (Number.isFinite(cost) && cost >= 0)) &&
        observation.cost === cost,
      "unknown or mismatched cost must not become zero",
    );
    requireValue(
      Array.isArray(result.changedFiles) &&
        new Set(result.changedFiles).size === result.changedFiles.length,
      "changed-file inventory missing or duplicated",
    );
    const allowed = reviewed.get(sample.taskId).allowedChangedPaths;
    requireValue(
      result.changedFiles.every((file) => allowed.includes(relativeFile(file))),
      "collected task changed an unreviewed path",
    );
    requireValue(
      Array.isArray(result.unrelatedChanges) &&
        result.unrelatedChanges.length === 0,
      "collected task has unreviewed edits",
    );
  }
  for (const run of runs.values())
    for (const result of run.results)
      requireValue(
        used.has(JSON.stringify([run.runId, result.id])),
        "unbound Eval result outside selected samples",
      );
  return report;
}

function main() {
  const { values } = parseArgs({
    options: {
      "plan-dir": { type: "string" },
      "plan-digest": { type: "string" },
      review: { type: "string" },
      "review-digest": { type: "string" },
      "review-root": { type: "string" },
      "project-sha": { type: "string" },
      history: { type: "string" },
      observations: { type: "string" },
      samples: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Read-only VERIFY-01 checks; no task, shell or model execution.\n--plan-dir DIR --plan-digest sha256:...\nOptional preparation: --review FILE --review-digest sha256:... --review-root DIR --project-sha SHA\nOptional existing collection: --history JSONL --observations JSON --samples id,id\nExit 0: local validation only; 2: missing preparation/insufficient outcome; 1: invalid input.",
    );
    return;
  }
  requireValue(values["plan-dir"], "--plan-dir is required");
  const directory = path.resolve(values["plan-dir"]);
  const bundle = {
    plan: readJson(path.join(directory, "plan.json")),
    catalog: readJson(path.join(directory, "tasks.json")),
    bindings: readJson(path.join(directory, "comparison-bindings.json")),
    expectedPlanDigest: values["plan-digest"],
  };
  requireValue(
    readBytes(path.join(directory, "plan.sha256")).toString("utf8").trim() ===
      bundle.expectedPlanDigest,
    "pinned plan digest differs from plan.sha256",
  );
  validateVerify01Bundle(bundle);
  let preparation;
  if (values.review) {
    requireValue(values["review-root"], "--review-root is required");
    const root = fs.realpathSync(values["review-root"]);
    preparation = {
      review: readJson(values.review),
      expectedReviewDigest: values["review-digest"],
      projectCommit: values["project-sha"],
      readReviewedFile(file) {
        const resolved = fs.realpathSync(path.join(root, relativeFile(file)));
        const relative = path.relative(root, resolved);
        requireValue(
          relative &&
            !relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative),
          "review file escapes review root",
        );
        return readBytes(resolved);
      },
    };
    validateVerify01Review(bundle, preparation);
  }
  if (values.history || values.observations || values.samples) {
    requireValue(
      preparation && values.history && values.observations && values.samples,
      "collection requires preparation, history, observations and selected samples",
    );
    const report = validateVerify01Collection(bundle, preparation, {
      sampleIds: values.samples.split(","),
      history: readEvalHistory(values.history),
      observations: readJson(values.observations),
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.status === "INSUFFICIENT_EVIDENCE") process.exitCode = 2;
  } else {
    console.log(
      JSON.stringify(
        {
          scope: "verify01-read-only-preparation",
          productionAttested: false,
          executionStatus: "NOT_RUN",
          planDigest: bundle.expectedPlanDigest,
          reviewValidated: Boolean(preparation),
          report: buildOutcomeReport(
            { plan: bundle.plan, history: { runs: [], issues: [] } },
            { expectedPlanDigest: bundle.expectedPlanDigest },
          ),
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(`VERIFY-01 collection rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
