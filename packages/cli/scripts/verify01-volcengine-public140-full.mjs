import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadPublicGeneratorProof } from "./verify01-public-generator-binding.mjs";

export const PUBLIC140_FULL_ID = "volcengine-public140-full45-20261103";
export const PUBLIC140_VERSIONS = Object.freeze({
  cli: "0.166.140",
  vscode: "0.37.176",
  jetbrains: "0.4.193",
  vscodeHost: "1.132.0",
  jetbrainsHost: "2025.2",
});
export const PUBLIC140_FULL_BUDGETS = Object.freeze({
  modelTurns: 40,
  physicalRequests: 48,
  outputTokens: 393216,
  ordinaryDeadlineMs: 2400000,
  firstRunDeadlineMs: 3600000,
  connectionAttemptTimeoutMs: 10000,
  parallelToolCalls: null,
});
export const PUBLIC140_MODEL_METADATA =
  "docs/research/cli/verify01-volcengine-140-full-20261103/model-catalog.json";
const project = "b2aa3aba082873570e85dce39b00754e5504ff37";
const model = "deepseek-v4-flash-ga-260731";

export function isPublic140FullRound(manifest) {
  return manifest?.volcengineFullRound?.id === PUBLIC140_FULL_ID;
}
export function public140FullBudgets(manifest, provider) {
  assert.ok(isPublic140FullRound(manifest));
  assert.equal(provider, "volcengine");
  assert.deepEqual(manifest.versions, PUBLIC140_VERSIONS);
  assert.equal(
    manifest.prepublication,
    undefined,
    "Use the public CLI/VS Code and bound official IDE release bytes",
  );
  assert.equal(manifest.runtimeRepair, undefined);
  assert.equal(manifest.volcengineBudgetRetry, undefined);
  assert.equal(manifest.freshVolcengineRound, undefined);
  const full = manifest.volcengineFullRound;
  assert.deepEqual(full, {
    id: PUBLIC140_FULL_ID,
    projectCommit: project,
    model,
    taskCount: 36,
    firstRunCount: 9,
    repeatPreviouslyAccepted: true,
    historicalScoresUnchanged: true,
    formalSample: false,
    reviewChanges: true,
    outputPolicy: "model-maximum",
    ...PUBLIC140_FULL_BUDGETS,
    modelMetadata: full.modelMetadata,
  });
  assert.deepEqual(Object.keys(full.modelMetadata ?? {}).sort(), [
    "digest",
    "path",
  ]);
  assert.equal(full.modelMetadata.path, PUBLIC140_MODEL_METADATA);
  assert.match(full.modelMetadata.digest ?? "", /^sha256:[a-f0-9]{64}$/u);
  return PUBLIC140_FULL_BUDGETS;
}
export function loadPublic140FullRound(manifest, { repositoryRoot, plan }) {
  const budgets = public140FullBudgets(manifest, "volcengine");
  assert.equal(plan.commitSha, project);
  assert.equal(plan.samples.length, 45);
  assert.equal(new Set(plan.samples.map((s) => s.id)).size, 45);
  assert.equal(plan.samples.filter((s) => s.kind === "task").length, 36);
  assert.equal(plan.samples.filter((s) => s.kind === "first-run").length, 9);
  const root = fs.realpathSync(repositoryRoot),
    file = path.join(root, PUBLIC140_MODEL_METADATA);
  assert.ok(!fs.lstatSync(file).isSymbolicLink());
  const relative = path.relative(root, fs.realpathSync(file));
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
  );
  const bytes = fs.readFileSync(file);
  assert.equal(
    "sha256:" + createHash("sha256").update(bytes).digest("hex"),
    manifest.volcengineFullRound.modelMetadata.digest,
  );
  const metadata = JSON.parse(bytes.toString("utf8"));
  assert.equal(metadata.id, model);
  assert.equal(
    metadata.token_limits?.max_output_token_length,
    budgets.outputTokens,
  );
  loadPublicGeneratorProof(manifest, { repositoryRoot });
  const selectedSampleIds = plan.samples.map((s) => s.id).sort(),
    sampleIdsByGroup = {};
  for (const sample of plan.samples)
    (sampleIdsByGroup[sample.stratum.replace(/-volcengine$/u, "")] ||= []).push(
      sample.id,
    );
  assert.equal(Object.keys(sampleIdsByGroup).length, 9);
  assert.ok(Object.values(sampleIdsByGroup).every((ids) => ids.length === 5));
  return { budgets, selectedSampleIds, sampleIdsByGroup };
}
export function assertPublic140FullDispatch(options, plan) {
  assert.equal(options.provider, "volcengine");
  assert.equal(options.packageSet, "latest");
  assert.equal(options.hosts, "all");
  assert.equal(options.entries, "all");
  assert.equal(
    options.sampleIds,
    undefined,
    "A full 45-sample round cannot be filtered",
  );
  assert.equal(
    options.revisionBinding,
    null,
    "Original task project identity is retained",
  );
  assert.equal(
    options.runAttempt,
    1,
    "Reconcile all paid requests before another dispatch",
  );
  assert.equal(
    options.credentialPresent,
    true,
    "Dedicated Volcengine key required",
  );
  assert.equal(options.reviewChanges, true);
  const manifest = JSON.parse(options.packageBinding.bytes.toString("utf8"));
  assert.deepEqual(options.packageBinding.versions, PUBLIC140_VERSIONS);
  return loadPublic140FullRound(manifest, {
    repositoryRoot: options.repositoryRoot,
    plan,
  });
}
