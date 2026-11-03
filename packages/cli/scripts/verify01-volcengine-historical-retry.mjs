import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { prereleasePackageBinding } from "./verify01-prerelease-package-set.mjs";

export const HISTORICAL_RETRY_ID =
  "volcengine-historical11-runtime-repair-20261103";
export const HISTORICAL_STATUS_PATH =
  "docs/research/cli/verify01-volcengine-139-20261103/history-reconciliation/cumulative-status.json";
export const ORIGINAL_PROJECT = "b2aa3aba082873570e85dce39b00754e5504ff37";
export const HISTORICAL_PENDING = Object.freeze([
  "first-run-darwin-cli",
  "first-run-darwin-jetbrains",
  "verify-04",
  "verify-07",
  "verify-08",
  "verify-09",
  "verify-10",
  "verify-11",
  "verify-13",
  "verify-19",
  "verify-30",
]);
export function isHistoricalRetry(manifest) {
  return manifest?.volcengineBudgetRetry?.id === HISTORICAL_RETRY_ID;
}

/** Runtime source may differ only under this explicit frozen-project repair identity. */
export function runtimeRepairBinding(
  manifest,
  { provider, projectCommit, revisionBinding = null },
) {
  if (!isHistoricalRetry(manifest)) {
    assert.equal(manifest?.runtimeRepair, undefined);
    return null;
  }
  assert.equal(provider, "volcengine");
  assert.equal(projectCommit, ORIGINAL_PROJECT);
  assert.equal(revisionBinding, null);
  const candidate = prereleasePackageBinding(manifest);
  assert.ok(
    candidate,
    "Historical runtime repair requires bound unpublished artifacts",
  );
  assert.deepEqual(manifest.runtimeRepair, {
    id: HISTORICAL_RETRY_ID,
    runtimeSourceCommit: candidate.sourceCommit,
    taskProjectCommit: ORIGINAL_PROJECT,
    taskInputsChanged: false,
    formalSample: false,
  });
  for (const required of [
    "src/runtime/tool-argument-recovery.js",
    "src/lib/read-file-loop-guard.js",
  ])
    assert.ok(candidate.cliSourceFiles.some((row) => row.file === required));
  return structuredClone(manifest.runtimeRepair);
}

function boundJson(root, record, expectedPath) {
  assert.equal(record?.path, expectedPath);
  assert.match(record.digest ?? "", /^sha256:[a-f0-9]{64}$/u);
  const file = path.join(root, expectedPath);
  assert.ok(!fs.lstatSync(file).isSymbolicLink());
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
  );
  const bytes = fs.readFileSync(file);
  assert.equal(
    "sha256:" + createHash("sha256").update(bytes).digest("hex"),
    record.digest,
  );
  return JSON.parse(bytes.toString("utf8"));
}
export function loadHistoricalRetry(
  manifest,
  { repositoryRoot, plan, budgets },
) {
  assert.ok(isHistoricalRetry(manifest));
  runtimeRepairBinding(manifest, {
    provider: "volcengine",
    projectCommit: plan.commitSha,
  });
  const retry = manifest.volcengineBudgetRetry;
  assert.equal(retry.reviewChanges, true);
  const history = boundJson(
    repositoryRoot,
    retry.historicalStatus,
    HISTORICAL_STATUS_PATH,
  );
  assert.equal(
    history.schema,
    "chainlesschain.volcengine-historical-cumulative-status/v1",
  );
  assert.equal(history.provider, "volcengine");
  assert.equal(history.model, "deepseek-v4-flash-ga-260731");
  assert.equal(history.projectCommit, ORIGINAL_PROJECT);
  assert.equal(history.accepted, 34);
  assert.equal(
    history.samples.filter((row) => row.cumulativelyQualified === true).length,
    34,
  );
  assert.deepEqual(
    history.samples.map((row) => row.sampleId).sort(),
    plan.samples.map((row) => row.id).sort(),
  );
  const selected = history.samples
    .filter((row) => row.cumulativelyQualified === false)
    .map((row) => row.sampleId)
    .sort();
  assert.deepEqual(selected, HISTORICAL_PENDING);
  assert.deepEqual(history.remainingSampleIds, selected);
  assert.deepEqual(retry.selectedSampleIds, selected);
  const metadata = boundJson(
    repositoryRoot,
    retry.modelMetadata,
    "docs/research/cli/verify01-volcengine-139-20261103/provider-output/model-catalog.json",
  );
  assert.equal(metadata.id, history.model);
  assert.equal(
    metadata.token_limits.max_output_token_length,
    budgets.outputTokens,
  );
  const sampleIdsByGroup = {};
  for (const id of selected) {
    const sample = plan.samples.find((row) => row.id === id);
    (sampleIdsByGroup[sample.stratum.replace(/-volcengine$/u, "")] ||= []).push(
      id,
    );
  }
  return { budgets, selectedSampleIds: selected, sampleIdsByGroup };
}
