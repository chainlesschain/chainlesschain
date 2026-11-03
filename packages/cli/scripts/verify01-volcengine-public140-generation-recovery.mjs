import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  PUBLIC140_VERSIONS,
  PUBLIC140_FIXED_FULL_BUDGETS,
  PUBLIC140_MODEL_METADATA,
  loadPublic140FullRound,
} from "./verify01-volcengine-public140-full.mjs";
export const PUBLIC140_GENERATION_RECOVERY_ID =
  "volcengine-public140-generation-recovery-20261103";
export const PUBLIC140_GENERATION_RECOVERY_BUDGETS = Object.freeze({
  ...PUBLIC140_FIXED_FULL_BUDGETS,
  allowInternalTextLength: true,
});
export const PUBLIC140_RECOVERY_BASE_PACKAGE =
  "docs/research/cli/verify01-package-sets/2026-11-03-volcengine-public140-full45-explicit-limits.json";
export const PUBLIC140_RECOVERY_BASE_REPORT =
  "docs/research/cli/verify01-volcengine-140-full-20261103/internal-output-repair/final-54d0064cab/results.json";
export const PUBLIC140_BOUNDARY_PROOF =
  "docs/research/cli/verify01-volcengine-140-full-20261103/internal-output-repair/diagnostics-internal-boundary/proof.json";
const source = "54d0064cab09ac1fe291d4d8b83bcb689a9c7d97",
  runId = 41638188839;
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
export function isPublic140GenerationRecovery(manifest) {
  return (
    manifest?.volcengineGenerationRecovery?.id ===
    PUBLIC140_GENERATION_RECOVERY_ID
  );
}
export function public140GenerationRecoveryBudgets(manifest, provider) {
  assert.ok(isPublic140GenerationRecovery(manifest));
  assert.equal(provider, "volcengine");
  assert.deepEqual(manifest.versions, PUBLIC140_VERSIONS);
  for (const field of [
    "prepublication",
    "runtimeRepair",
    "volcengineFullRound",
    "volcengineBudgetRetry",
    "freshVolcengineRound",
  ])
    assert.equal(manifest[field], undefined);
  const r = manifest.volcengineGenerationRecovery;
  assert.deepEqual(r, {
    id: PUBLIC140_GENERATION_RECOVERY_ID,
    projectCommit: "b2aa3aba082873570e85dce39b00754e5504ff37",
    model: "deepseek-v4-flash-ga-260731",
    reviewChanges: true,
    formalSample: false,
    historicalScoresUnchanged: true,
    outputPolicy: "model-maximum",
    ...PUBLIC140_GENERATION_RECOVERY_BUDGETS,
    baseline: {
      runId,
      executionSource: source,
      packageSet: r.baseline?.packageSet,
      report: r.baseline?.report,
    },
    modelMetadata: r.modelMetadata,
    normalizationEvidence: r.normalizationEvidence,
    selectedSampleIds: r.selectedSampleIds,
    outstandingUsageCarryForward: r.outstandingUsageCarryForward,
  });
  for (const [record, expected] of [
    [r.baseline.packageSet, PUBLIC140_RECOVERY_BASE_PACKAGE],
    [r.baseline.report, PUBLIC140_RECOVERY_BASE_REPORT],
    [r.modelMetadata, PUBLIC140_MODEL_METADATA],
    [r.normalizationEvidence, PUBLIC140_BOUNDARY_PROOF],
  ]) {
    assert.deepEqual(Object.keys(record ?? {}).sort(), ["digest", "path"]);
    assert.equal(record.path, expected);
    assert.match(record.digest ?? "", /^sha256:[a-f0-9]{64}$/u);
  }
  return PUBLIC140_GENERATION_RECOVERY_BUDGETS;
}
export function loadPublic140GenerationRecovery(
  manifest,
  { repositoryRoot, plan },
) {
  const budgets = public140GenerationRecoveryBudgets(manifest, "volcengine"),
    r = manifest.volcengineGenerationRecovery;
  const root = fs.realpathSync(repositoryRoot);
  const bound = (record) => {
    const file = path.join(root, record.path);
    assert.ok(!fs.lstatSync(file).isSymbolicLink());
    const rel = path.relative(root, fs.realpathSync(file));
    assert.ok(rel && !rel.startsWith("..") && !path.isAbsolute(rel));
    const bytes = fs.readFileSync(file);
    assert.equal(hash(bytes), record.digest);
    return JSON.parse(bytes.toString("utf8"));
  };
  const base = bound(r.baseline.packageSet);
  loadPublic140FullRound(base, { repositoryRoot, plan });
  for (const field of [
    "versions",
    "origin",
    "publicArtifacts",
    "publicGeneratorProof",
    "releaseSourceCommits",
    "diagnosticExecution",
  ])
    assert.deepEqual(manifest[field], base[field]);
  assert.deepEqual(r.modelMetadata, base.volcengineFullRound.modelMetadata);
  const report = bound(r.baseline.report);
  assert.equal(report.runId, runId);
  assert.equal(report.executionSource, source);
  assert.equal(report.total, 45);
  assert.equal(report.completeEvidence, true);
  assert.equal(report.packageSetDigest, r.baseline.packageSet.digest);
  assert.equal(report.provider, "volcengine");
  assert.equal(report.model, r.model);
  assert.deepEqual(report.versions, manifest.versions);
  assert.deepEqual(
    report.samples.map((s) => s.sampleId).sort(),
    plan.samples.map((s) => s.id).sort(),
  );
  const selected = report.samples
    .filter((s) => s.generationPassed === false)
    .map((s) => s.sampleId)
    .sort();
  assert.ok(selected.length > 0);
  assert.deepEqual(
    r.selectedSampleIds,
    selected,
    "Only generation failures may be replayed; accepted/semantic-only failures stay separate",
  );
  assert.ok(
    report.samples
      .filter((s) => selected.includes(s.sampleId))
      .every((s) => s.accepted === false),
  );
  const unknown = report.samples
    .flatMap((s) => {
      const b = s.broker ?? {},
        reserved = b.physicalRequestsStarted ?? 0,
        known = b.usageCompleteRequests ?? 0,
        notSent = b.errorCode === "DIAGNOSTIC_REQUEST_NOT_DISPATCHED" ? 1 : 0,
        count = reserved - known - notSent;
      assert.ok(count >= 0 && count <= 1);
      return count
        ? [
            {
              sampleId: s.sampleId,
              requestId: reserved,
              usageKnown: false,
              billedCost: null,
            },
          ]
        : [];
    })
    .sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  assert.deepEqual(
    r.outstandingUsageCarryForward,
    unknown,
    "Never erase or infer zero billing for dispatched unknown usage",
  );
  const proof = bound(r.normalizationEvidence);
  assert.equal(proof.runId, runId);
  assert.equal(proof.executionSource, source);
  assert.equal(proof.requestId, 15);
  assert.equal(proof.explicitInternalLimit, 2048);
  assert.equal(proof.finishReason, "length");
  assert.equal(proof.completionTokens, 2048);
  const boundaryArtifact = report.artifacts?.find(
    (a) => a.name === `verify01-native-delivery-win32-cli-verify-19-${source}`,
  );
  assert.equal(
    boundaryArtifact?.summaryDigest,
    proof.rawDeliverySummaryDigest,
    "Boundary evidence must belong to the selected full-round delivery",
  );
  const boundarySample = report.samples.find((s) => s.sampleId === "verify-19");
  assert.equal(boundarySample.generationPassed, false);
  assert.equal(boundarySample.broker.errorCode, "DIAGNOSTIC_OUTPUT_TRUNCATED");
  const prefix = path.posix.dirname(PUBLIC140_BOUNDARY_PROOF);
  const original = bound({
    path: prefix + "/request-15.original.json",
    digest: proof.files["request-15.original.json"],
  });
  const response = bound({
    path: prefix + "/response-15.json",
    digest: proof.files["response-15.json"],
  });
  assert.equal(original.max_tokens, 2048);
  assert.equal(original.tools?.length ?? 0, 0);
  assert.equal(response.choices[0].finish_reason, "length");
  assert.equal(response.usage.completion_tokens, 2048);
  const sampleIdsByGroup = {};
  for (const id of selected) {
    const sample = plan.samples.find((s) => s.id === id);
    (sampleIdsByGroup[sample.stratum.replace(/-volcengine$/u, "")] ||= []).push(
      id,
    );
  }
  return { budgets, selectedSampleIds: selected, sampleIdsByGroup };
}
export function assertPublic140GenerationRecoveryDispatch(options, plan) {
  assert.equal(options.provider, "volcengine");
  assert.equal(options.packageSet, "latest");
  assert.equal(options.hosts, "all");
  assert.equal(options.entries, "all");
  assert.equal(options.sampleIds, undefined);
  assert.equal(options.revisionBinding, null);
  assert.equal(options.runAttempt, 1);
  assert.equal(options.credentialPresent, true);
  assert.equal(options.reviewChanges, true);
  const manifest = JSON.parse(options.packageBinding.bytes.toString("utf8"));
  assert.deepEqual(options.packageBinding.versions, PUBLIC140_VERSIONS);
  return loadPublic140GenerationRecovery(manifest, {
    repositoryRoot: options.repositoryRoot,
    plan,
  });
}
