import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  isHistoricalRetry,
  loadHistoricalRetry,
} from "./verify01-volcengine-historical-retry.mjs";

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
export const VOLCENGINE_OUTPUT_HISTORY = Object.freeze([
  {
    runId: 41563424430,
    source: "e7788a09316abb6f637932ae09254a441168742e",
    path: "docs/research/cli/verify01-volcengine-139-20261103/full-e7788a0931/results.json",
    samples: 45,
  },
  {
    runId: 41574308573,
    source: "98bf47be5a72442cc7e2655dfbf3aebb7770d409",
    path: "docs/research/cli/verify01-volcengine-139-20261103/budget-retry/final-98bf47be5a/results.json",
    samples: 2,
  },
  {
    runId: 41576842146,
    source: "cc4cd3180f226a7365f97b26f37a8da3306c1b07",
    path: "docs/research/cli/verify01-volcengine-139-20261103/budget-retry/host-recovery/final-cc4cd3180f/results.json",
    samples: 1,
  },
]);

function readBoundEvidence(
  root,
  file,
  expectedDigest,
  prefix = VOLCENGINE_ZERO_REQUEST_ROOT,
) {
  assert.ok(file.startsWith(prefix + "/"));
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
  if (isHistoricalRetry(manifest)) {
    assert.equal(retry.modelTurns, 40);
    assert.equal(retry.physicalRequests, 48);
    assert.equal(retry.outputTokens, 393216);
    assert.equal(retry.outputPolicy, "model-maximum");
    assert.equal(retry.connectionAttemptTimeoutMs, 10000);
    assert.equal(retry.parallelToolCalls, null);
    assert.equal(retry.reviewChanges, true);
    return Object.freeze({
      modelTurns: 40,
      physicalRequests: 48,
      outputTokens: 393216,
      ordinaryDeadlineMs: 2400000,
      firstRunDeadlineMs: 3600000,
      connectionAttemptTimeoutMs: 10000,
      parallelToolCalls: null,
    });
  }
  const providerMaximum =
    retry.id === "volcengine-public139-model-output-20261103";
  if (providerMaximum) {
    assert.equal(
      retry.outputTokens,
      393216,
      "Use the authenticated model maximum, not an artificial test cap",
    );
    assert.equal(retry.outputPolicy, "model-maximum");
    assert.ok(Array.isArray(retry.outputHistory));
    assert.equal(retry.zeroRequestRecovery, undefined);
  } else {
    assert.equal(retry.id, "volcengine-public139-budget40-20261103");
    assert.ok([8192, 16384].includes(retry.outputTokens));
    assert.equal(retry.outputPolicy, undefined);
    assert.equal(retry.outputHistory, undefined);
    assert.equal(retry.modelMetadata, undefined);
  }
  assert.equal(retry.modelTurns, 40);
  assert.equal(retry.physicalRequests, 48);
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
  if (isHistoricalRetry(manifest))
    return loadHistoricalRetry(manifest, { repositoryRoot, plan, budgets });
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
  if (retry.outputPolicy === "model-maximum") {
    assert.equal(
      retry.modelMetadata?.path,
      "docs/research/cli/verify01-volcengine-139-20261103/provider-output/model-catalog.json",
    );
    const metadata = readBoundEvidence(
      root,
      retry.modelMetadata.path,
      retry.modelMetadata.digest,
      "docs/research/cli/verify01-volcengine-139-20261103/provider-output",
    );
    assert.equal(metadata.id, "deepseek-v4-flash-ga-260731");
    assert.equal(
      metadata.token_limits?.max_output_token_length,
      budgets.outputTokens,
    );
    assert.equal(retry.outputHistory.length, VOLCENGINE_OUTPUT_HISTORY.length);
    const latest = new Map();
    for (const [index, expected] of VOLCENGINE_OUTPUT_HISTORY.entries()) {
      const recorded = retry.outputHistory[index];
      assert.equal(recorded.runId, expected.runId);
      assert.equal(recorded.source, expected.source);
      assert.equal(recorded.path, expected.path);
      const report = readBoundEvidence(
        root,
        recorded.path,
        recorded.digest,
        "docs/research/cli/verify01-volcengine-139-20261103",
      );
      assert.equal(report.runId, expected.runId);
      assert.equal(report.executionSource, expected.source);
      assert.equal(report.provider, "volcengine");
      assert.equal(report.model, "deepseek-v4-flash-ga-260731");
      assert.equal(report.completeEvidence, true);
      assert.equal(report.samples.length, expected.samples);
      assert.equal(
        new Set(report.samples.map((row) => row.sampleId)).size,
        expected.samples,
      );
      for (const row of report.samples) {
        assert.ok(plan.samples.some((sample) => sample.id === row.sampleId));
        latest.set(row.sampleId, row);
      }
    }
    assert.equal(latest.size, 45);
    selected = [...latest.values()]
      .filter(
        (row) =>
          row.accepted !== true &&
          row.generationPassed === false &&
          row.broker?.errorCode === "DIAGNOSTIC_OUTPUT_TRUNCATED",
      )
      .map((row) => row.sampleId)
      .sort();
    assert.ok(selected.length > 0, "No unresolved output-truncated samples");
  }
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
