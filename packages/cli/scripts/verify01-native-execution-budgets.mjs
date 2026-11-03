import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const DEFAULT_NATIVE_BUDGETS = Object.freeze({
  modelTurns: 20,
  physicalRequests: 24,
  outputTokens: 8192,
  ordinaryDeadlineMs: 1200000,
  firstRunDeadlineMs: 1800000,
});
export const VOLCENGINE_BUDGET_BASELINE =
  "docs/research/cli/verify01-volcengine-139-20261103/baseline-e7788a0931/results.json";
export const VOLCENGINE_ZERO_REQUEST_ROOT =
  "docs/research/cli/verify01-volcengine-139-20261103/budget-retry/attempt-98bf47be5a";

function readBoundEvidence(root, file, expectedDigest) {
  assert.ok(file.startsWith(VOLCENGINE_ZERO_REQUEST_ROOT + "/"));
  assert.match(expectedDigest ?? "", /^sha256:[a-f0-9]{64}$/u);
  const resolved = path.join(root, file);
  assert.ok(!fs.lstatSync(resolved).isSymbolicLink());
  const relative = path.relative(root, fs.realpathSync(resolved));
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
  );
  const bytes = fs.readFileSync(resolved);
  assert.equal(
    "sha256:" + createHash("sha256").update(bytes).digest("hex"),
    expectedDigest,
  );
  return JSON.parse(bytes.toString("utf8"));
}

export function nativeExecutionBudgets(manifest, provider = "volcengine") {
  const retry = manifest?.volcengineBudgetRetry;
  if (retry === undefined) return DEFAULT_NATIVE_BUDGETS;
  assert.equal(provider, "volcengine", "Expanded budget is Volcengine-only");
  assert.equal(retry.id, "volcengine-public139-budget40-20261103");
  assert.equal(retry.modelTurns, 40);
  assert.equal(retry.physicalRequests, 48);
  assert.ok([8192, 16384].includes(retry.outputTokens));
  return Object.freeze({
    modelTurns: 40,
    physicalRequests: 48,
    outputTokens: retry.outputTokens,
    ordinaryDeadlineMs: 2400000,
    firstRunDeadlineMs: 3600000,
  });
}

export function isBudgetLimitedNativeSample(row, outputTokens) {
  if (row.accepted === true || row.generationPassed !== false) return false;
  return (
    row.modelFailure === "iteration-budget-exhausted" ||
    /remaining model requests|not completed independent review/u.test(
      row.modelError || "",
    ) ||
    (outputTokens > 8192 &&
      row.broker?.errorCode === "DIAGNOSTIC_OUTPUT_TRUNCATED")
  );
}

export function loadVolcengineBudgetRetry(manifest, { repositoryRoot, plan }) {
  const retry = manifest?.volcengineBudgetRetry;
  if (retry === undefined) return null;
  const budgets = nativeExecutionBudgets(manifest);
  assert.equal(retry.baselineRunId, 41563424430);
  assert.equal(
    retry.baselineSource,
    "e7788a09316abb6f637932ae09254a441168742e",
  );
  assert.equal(retry.baselineResultsPath, VOLCENGINE_BUDGET_BASELINE);
  assert.match(retry.baselineResultsDigest ?? "", /^sha256:[a-f0-9]{64}$/u);
  const root = fs.realpathSync(repositoryRoot);
  const file = path.join(root, VOLCENGINE_BUDGET_BASELINE);
  assert.ok(!fs.lstatSync(file).isSymbolicLink());
  const relative = path.relative(root, fs.realpathSync(file));
  assert.ok(
    relative &&
      relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative),
  );
  const bytes = fs.readFileSync(file);
  assert.equal(
    "sha256:" + createHash("sha256").update(bytes).digest("hex"),
    retry.baselineResultsDigest,
  );
  const baseline = JSON.parse(bytes.toString("utf8"));
  assert.equal(baseline.runId, retry.baselineRunId);
  assert.equal(baseline.executionSource, retry.baselineSource);
  assert.equal(baseline.provider, "volcengine");
  assert.equal(baseline.model, "deepseek-v4-flash-ga-260731");
  assert.ok(
    baseline.completeEvidence === true ||
      (baseline.completeGenerationEvidence === true &&
        baseline.samples.every((row) => row.deliveryAvailable === true)),
    "Complete generation evidence is required before any budget retry",
  );
  const expected = plan.samples.map((row) => row.id).sort();
  assert.equal(expected.length, 45);
  assert.deepEqual(
    baseline.samples.map((row) => row.sampleId).sort(),
    expected,
  );
  let selected = baseline.samples
    .filter((row) => isBudgetLimitedNativeSample(row, budgets.outputTokens))
    .map((row) => row.sampleId)
    .sort();
  assert.ok(selected.length > 0, "No remaining budget-limited samples");
  if (retry.zeroRequestRecovery) {
    const recovery = retry.zeroRequestRecovery;
    assert.equal(recovery.runId, 41574308573);
    assert.equal(recovery.source, "98bf47be5a72442cc7e2655dfbf3aebb7770d409");
    const prior = readBoundEvidence(
      root,
      recovery.summaryPath,
      recovery.summaryDigest,
    );
    const broker = readBoundEvidence(
      root,
      recovery.brokerSummaryPath,
      recovery.brokerSummaryDigest,
    );
    assert.equal(prior.executionSourceCommit, recovery.source);
    assert.deepEqual(prior.executionBudgets, budgets);
    assert.equal(prior.modelTransport.provider, "volcengine");
    assert.equal(prior.modelTransport.model, "deepseek-v4-flash-ga-260731");
    assert.equal(prior.samples.length, 1);
    const sample = prior.samples[0];
    assert.ok(selected.includes(sample.sampleId));
    assert.equal(sample.generationPassed, false);
    assert.ok(sample.failure, "Only an observed host failure qualifies");
    for (const receipt of [broker, sample.broker]) {
      assert.equal(
        receipt.physicalRequestsStarted,
        0,
        "Never repeat paid inference as a startup retry",
      );
      assert.equal(receipt.usageCompleteRequests, 0);
      assert.equal(receipt.tasks.length, 1);
      assert.equal(receipt.tasks[0].taskId, sample.sampleId);
      assert.equal(receipt.tasks[0].requests, 0);
    }
    selected = [sample.sampleId];
  }
  assert.deepEqual(
    [...retry.selectedSampleIds].sort(),
    selected,
    "Retry only the observed budget-limited failures",
  );
  assert.equal(new Set(retry.selectedSampleIds).size, selected.length);
  const sampleIdsByGroup = {};
  for (const id of selected) {
    const sample = plan.samples.find((row) => row.id === id);
    const group = sample.stratum.replace(/-volcengine$/u, "");
    (sampleIdsByGroup[group] ||= []).push(id);
  }
  return { budgets, selectedSampleIds: selected, sampleIdsByGroup };
}
