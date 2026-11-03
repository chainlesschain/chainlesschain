import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadPublicGeneratorProof } from "./verify01-public-generator-binding.mjs";

export const PUBLIC140_FULL_ID = "volcengine-public140-full45-20261103";
export const PUBLIC140_FIXED_FULL_ID =
  "volcengine-public140-full45-explicit-limits-20261103";
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
export const PUBLIC140_FIXED_FULL_BUDGETS = Object.freeze({
  ...PUBLIC140_FULL_BUDGETS,
  preserveExplicitOutputLimits: true,
});
export const PUBLIC140_BASELINE_MANIFEST =
  "docs/research/cli/verify01-package-sets/2026-11-03-volcengine-public140-full45.json";
export const PUBLIC140_LIMIT_PROOF =
  "docs/research/cli/verify01-volcengine-140-full-20261103/diagnostics-output-limits/proof.json";
const baselineDigest =
  "sha256:9df4efc5365ed381684a1990009c4b162ec96ae9ce229df13d4b583860a3559c";
const baselineSource = "eb50e4f42778d6be457595cc0f39fcada025d5f0";
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");

export function isPublic140FullRound(manifest) {
  return [PUBLIC140_FULL_ID, PUBLIC140_FIXED_FULL_ID].includes(
    manifest?.volcengineFullRound?.id,
  );
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
  const fixed = full.id === PUBLIC140_FIXED_FULL_ID;
  const budgets = fixed ? PUBLIC140_FIXED_FULL_BUDGETS : PUBLIC140_FULL_BUDGETS;
  assert.deepEqual(full, {
    id: full.id,
    projectCommit: project,
    model,
    taskCount: 36,
    firstRunCount: 9,
    repeatPreviouslyAccepted: true,
    historicalScoresUnchanged: true,
    formalSample: false,
    reviewChanges: true,
    outputPolicy: "model-maximum",
    ...budgets,
    modelMetadata: full.modelMetadata,
    ...(fixed
      ? {
          normalizationRepair: {
            baselineRunId: 41630636517,
            baselineExecutionSource: baselineSource,
            baselinePackageSet: {
              path: PUBLIC140_BASELINE_MANIFEST,
              digest: baselineDigest,
            },
            evidence: full.normalizationRepair?.evidence,
            preserveAllOriginalPackageBytes: true,
            outstandingUsageCarryForward: [
              {
                runId: 41630636517,
                sampleId: "first-run-linux-vscode",
                requestId: 3,
                billedCost: null,
                usageKnown: false,
              },
            ],
          },
        }
      : {}),
  });
  assert.deepEqual(Object.keys(full.modelMetadata ?? {}).sort(), [
    "digest",
    "path",
  ]);
  assert.equal(full.modelMetadata.path, PUBLIC140_MODEL_METADATA);
  assert.match(full.modelMetadata.digest ?? "", /^sha256:[a-f0-9]{64}$/u);
  if (fixed) {
    assert.deepEqual(
      Object.keys(full.normalizationRepair.evidence ?? {}).sort(),
      ["digest", "path"],
    );
    assert.equal(
      full.normalizationRepair.evidence?.path,
      PUBLIC140_LIMIT_PROOF,
    );
    assert.match(
      full.normalizationRepair.evidence?.digest ?? "",
      /^sha256:[a-f0-9]{64}$/u,
    );
  }
  return budgets;
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
  if (manifest.volcengineFullRound.id === PUBLIC140_FIXED_FULL_ID) {
    const bound = (record) => {
      const target = path.join(root, record.path);
      assert.ok(!fs.lstatSync(target).isSymbolicLink());
      const rel = path.relative(root, fs.realpathSync(target));
      assert.ok(rel && !rel.startsWith("..") && !path.isAbsolute(rel));
      const data = fs.readFileSync(target);
      assert.equal(hash(data), record.digest);
      return JSON.parse(data.toString("utf8"));
    };
    const repair = manifest.volcengineFullRound.normalizationRepair;
    const baseline = bound(repair.baselinePackageSet);
    assert.equal(baseline.volcengineFullRound.id, PUBLIC140_FULL_ID);
    for (const field of [
      "versions",
      "origin",
      "publicArtifacts",
      "publicGeneratorProof",
      "releaseSourceCommits",
      "diagnosticExecution",
    ])
      assert.deepEqual(
        manifest[field],
        baseline[field],
        "Only output normalization changes between these full rounds",
      );
    assert.deepEqual(
      manifest.volcengineFullRound.modelMetadata,
      baseline.volcengineFullRound.modelMetadata,
    );
    const proof = bound(repair.evidence);
    assert.equal(proof.runId, 41630636517);
    assert.equal(proof.executionSource, baselineSource);
    assert.equal(proof.originalInternalOutputBudget, 2048);
    assert.equal(proof.effectiveOutputBudgetBeforeFix, 393216);
    assert.deepEqual(proof.unresolvedDispatchedRequestIds, [3]);
    const prefix = path.posix.dirname(PUBLIC140_LIMIT_PROOF);
    const original = bound({
      path: prefix + "/request-3.original.json",
      digest: proof.files["request-3.original.json"],
    });
    const effective = bound({
      path: prefix + "/request-3.effective.json",
      digest: proof.files["request-3.effective.json"],
    });
    assert.equal(original.max_tokens, 2048);
    assert.equal(original.tools?.length ?? 0, 0);
    assert.equal(effective.max_tokens, 393216);
    assert.equal(original.model, model);
    assert.equal(effective.model, model);
  }
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
