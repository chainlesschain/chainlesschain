import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PUBLIC140_MODEL_METADATA } from "../scripts/verify01-volcengine-public140-full.mjs";
import { SOL_TOKEN_BUDGET_REFERENCE } from "../scripts/verify01-sol-relative-token-budget.mjs";
import {
  PUBLIC140_GENERATION_RECOVERY_ID,
  PUBLIC140_GENERATION_RECOVERY_BUDGETS,
  PUBLIC140_RECOVERY_BASE_PACKAGE,
  PUBLIC140_RECOVERY_BASE_REPORT,
  PUBLIC140_BOUNDARY_PROOF,
  loadPublic140GenerationRecovery,
  assertPublic140GenerationRecoveryDispatch,
} from "../scripts/verify01-volcengine-public140-generation-recovery.mjs";
import {
  nativeExecutionBudgets,
  loadVolcengineBudgetRetry,
} from "../scripts/verify01-native-execution-budgets.mjs";
import {
  nativeProviderProfile,
  assertNativeProviderIdentity,
} from "../scripts/verify01-native-provider-profile.mjs";
import { nativeProviderCells } from "../scripts/verify01-native-round-matrix.mjs";
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const bytes = (file) => fs.readFileSync(path.join(repository, file));
const read = (file) => JSON.parse(bytes(file).toString("utf8"));
const hash = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
const plan = read(
  "docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
);
const selected = [
  "first-run-linux-cli",
  "first-run-linux-vscode",
  "verify-11",
  "verify-19",
].sort();
function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-generation-recovery-"),
  );
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = read(PUBLIC140_RECOVERY_BASE_PACKAGE),
    oldProof = base.volcengineFullRound.normalizationRepair.evidence.path;
  for (const file of [
    PUBLIC140_RECOVERY_BASE_PACKAGE,
    base.volcengineFullRound.normalizationRepair.baselinePackageSet.path,
    base.publicGeneratorProof.path,
    PUBLIC140_MODEL_METADATA,
    oldProof,
    path.posix.dirname(oldProof) + "/request-3.original.json",
    path.posix.dirname(oldProof) + "/request-3.effective.json",
    PUBLIC140_BOUNDARY_PROOF,
    path.posix.dirname(PUBLIC140_BOUNDARY_PROOF) + "/request-15.original.json",
    path.posix.dirname(PUBLIC140_BOUNDARY_PROOF) + "/response-15.json",
  ]) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repository, file), target);
  }
  const record = (file, value) => {
    const data = Buffer.from(JSON.stringify(value));
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    return { path: file, digest: hash(data) };
  };
  const report = {
    runId: 41638188839,
    executionSource: "54d0064cab09ac1fe291d4d8b83bcb689a9c7d97",
    total: 45,
    completeEvidence: true,
    provider: "volcengine",
    model: "deepseek-v4-flash-ga-260731",
    versions: base.versions,
    packageSetDigest: hash(bytes(PUBLIC140_RECOVERY_BASE_PACKAGE)),
    samples: plan.samples.map((s) => ({
      sampleId: s.id,
      generationPassed: !selected.includes(s.id),
      accepted: !selected.includes(s.id) && s.id !== "verify-10",
      broker: {
        physicalRequestsStarted: s.id === "first-run-linux-vscode" ? 3 : 1,
        usageCompleteRequests:
          s.id === "first-run-linux-cli"
            ? 0
            : s.id === "first-run-linux-vscode"
              ? 2
              : 1,
        errorCode:
          s.id === "first-run-linux-cli"
            ? "DIAGNOSTIC_REQUEST_NOT_DISPATCHED"
            : s.id === "verify-19"
              ? "DIAGNOSTIC_OUTPUT_TRUNCATED"
              : null,
      },
    })),
  };
  report.artifacts = [
    {
      name: "verify01-native-delivery-win32-cli-verify-19-54d0064cab09ac1fe291d4d8b83bcb689a9c7d97",
      summaryDigest: read(PUBLIC140_BOUNDARY_PROOF).rawDeliverySummaryDigest,
    },
  ];
  const manifest = structuredClone(base);
  delete manifest.volcengineFullRound;
  manifest.volcengineGenerationRecovery = {
    id: PUBLIC140_GENERATION_RECOVERY_ID,
    projectCommit: plan.commitSha,
    model: report.model,
    reviewChanges: true,
    formalSample: false,
    historicalScoresUnchanged: true,
    outputPolicy: "sol-relative-bounded",
    solBudgetReference: SOL_TOKEN_BUDGET_REFERENCE,
    ...PUBLIC140_GENERATION_RECOVERY_BUDGETS,
    baseline: {
      runId: report.runId,
      executionSource: report.executionSource,
      packageSet: {
        path: PUBLIC140_RECOVERY_BASE_PACKAGE,
        digest: hash(bytes(PUBLIC140_RECOVERY_BASE_PACKAGE)),
      },
      report: record(PUBLIC140_RECOVERY_BASE_REPORT, report),
    },
    modelMetadata: base.volcengineFullRound.modelMetadata,
    normalizationEvidence: {
      path: PUBLIC140_BOUNDARY_PROOF,
      digest: hash(bytes(PUBLIC140_BOUNDARY_PROOF)),
    },
    selectedSampleIds: selected,
    outstandingUsageCarryForward: [
      {
        sampleId: "first-run-linux-vscode",
        requestId: 3,
        usageKnown: false,
        billedCost: null,
      },
    ],
  };
  const options = () => ({
    provider: "volcengine",
    packageSet: "latest",
    hosts: "all",
    entries: "all",
    sampleIds: undefined,
    revisionBinding: null,
    runAttempt: 1,
    credentialPresent: true,
    reviewChanges: true,
    repositoryRoot: root,
    packageBinding: {
      versions: manifest.versions,
      bytes: Buffer.from(JSON.stringify(manifest)),
    },
  });
  return { root, manifest, report, record, options };
}

test("generation recovery selects only source-bound full-round generation failures and keeps all prior successes", (t) => {
  const f = fixture(t),
    r = assertPublic140GenerationRecoveryDispatch(f.options(), plan);
  assert.deepEqual(r.selectedSampleIds, selected);
  assert.equal(
    r.selectedSampleIds.includes("verify-10"),
    false,
    "semantic-only failure must not be silently repeated",
  );
  assert.deepEqual(
    loadVolcengineBudgetRetry(f.manifest, { repositoryRoot: f.root, plan }),
    r,
  );
  assert.deepEqual(
    nativeExecutionBudgets(f.manifest),
    PUBLIC140_GENERATION_RECOVERY_BUDGETS,
  );
  const rows = ["win32", "linux", "darwin"].flatMap((platform) =>
    ["cli", "vscode", "jetbrains"].map((entry) => ({
      group: platform + "-" + entry,
      entry,
      os: "offline",
    })),
  );
  const cells = nativeProviderCells(rows, plan, undefined, "volcengine", {
    isolateAllSamples: true,
    sampleIdsByGroup: r.sampleIdsByGroup,
  });
  assert.equal(cells.length, selected.length);
  assert.deepEqual(cells.map((c) => c.sample_ids).sort(), selected);
  assert.ok(cells.every((c) => c.sample_count === 1));
});

test("recovery rejects scope/version/transport substitution, an incomplete baseline and erased unknown usage", (t) => {
  const f = fixture(t);
  for (const mutate of [
    (m) => m.volcengineGenerationRecovery.selectedSampleIds.push("verify-10"),
    (m) => m.volcengineGenerationRecovery.selectedSampleIds.pop(),
    (m) => (m.volcengineGenerationRecovery.outstandingUsageCarryForward = []),
    (m) =>
      (m.volcengineGenerationRecovery.outstandingUsageCarryForward[0].billedCost = 0),
    (m) => (m.versions.cli = "0.166.139"),
    (m) => (m.origin.cli.tarball = "https://example.invalid/other.tgz"),
    (m) => delete m.volcengineGenerationRecovery.allowInternalTextLength,
    (m) =>
      (m.volcengineGenerationRecovery.normalizationEvidence.digest =
        hash("wrong")),
    (m) => (m.volcengineFullRound = {}),
  ]) {
    const changed = structuredClone(f.manifest);
    mutate(changed);
    assert.throws(() =>
      loadPublic140GenerationRecovery(changed, {
        repositoryRoot: f.root,
        plan,
      }),
    );
  }
  f.report.completeEvidence = false;
  f.manifest.volcengineGenerationRecovery.baseline.report = f.record(
    PUBLIC140_RECOVERY_BASE_REPORT,
    f.report,
  );
  assert.throws(() =>
    loadPublic140GenerationRecovery(f.manifest, {
      repositoryRoot: f.root,
      plan,
    }),
  );
});

test("recovery cannot accept an operator subset, revised project, repeated attempt or missing review/key", (t) => {
  const f = fixture(t);
  for (const changed of [
    { hosts: "linux" },
    { entries: "cli" },
    { sampleIds: ["verify-19"] },
    { revisionBinding: {} },
    { runAttempt: 2 },
    { credentialPresent: false },
    { reviewChanges: false },
    { provider: "openai" },
    { packageSet: "prerelease" },
  ])
    assert.throws(() =>
      assertPublic140GenerationRecoveryDispatch(
        { ...f.options(), ...changed },
        plan,
      ),
    );
});

test("delivery identity binds the narrow internal-text policy without changing historical full45 policies", (t) => {
  const f = fixture(t),
    budgets = nativeExecutionBudgets(f.manifest),
    profile = nativeProviderProfile("volcengine", { budgets }),
    source = "e".repeat(40),
    binding = {
      ...f.options().packageBinding,
      packageSetDigest: hash(f.options().packageBinding.bytes),
    };
  assert.equal(profile.policy.allowInternalTextLength, true);
  assert.equal(profile.policy.maximumAnswerTokens, 16384);
  assert.equal(profile.policy.maximumTaskTokens, 1966080);
  assert.equal(profile.policy.maximumTaskOutputTokens, 393216);
  assert.equal(profile.policy.maximumInternalSummaryTokens, 4096);
  assert.equal(
    nativeProviderProfile("volcengine", {
      budgets: nativeExecutionBudgets(read(PUBLIC140_RECOVERY_BASE_PACKAGE)),
    }).policy.allowInternalTextLength,
    undefined,
  );
  const summary = {
    executionSourceCommit: source,
    projectCommit: plan.commitSha,
    planDigest: "sha256:plan",
    executionBudgets: budgets,
    versions: binding.versions,
    packageSetDigest: binding.packageSetDigest,
    cohortKind: "volcengine-native-diagnostic",
    modelTransport: {
      provider: profile.provider,
      model: profile.model,
      endpoint: profile.policy.endpoint,
      policyDigest: hash(JSON.stringify(profile.policy)),
      defaultThinkingPreserved: false,
      formalSample: false,
    },
  };
  summary.executionIdentityDigest = hash(
    JSON.stringify({
      sourceSha: source,
      taskPlanDigest: summary.planDigest,
      versions: summary.versions,
      packageSetDigest: summary.packageSetDigest,
      modelTransport: summary.modelTransport,
    }),
  );
  const project = {
    projectCommit: plan.commitSha,
    planDigest: summary.planDigest,
    revisionBinding: null,
  };
  assertNativeProviderIdentity(summary, "volcengine", source, binding, project);
  assert.throws(() =>
    assertNativeProviderIdentity(
      {
        ...summary,
        executionBudgets: nativeExecutionBudgets(
          read(PUBLIC140_RECOVERY_BASE_PACKAGE),
        ),
      },
      "volcengine",
      source,
      binding,
      project,
    ),
  );
});

test("the user's hold prevents a new paid generation dispatch even with an otherwise valid recovery manifest", (t) => {
  const f = fixture(t);
  f.record(
    "docs/research/cli/verify01-volcengine-140-full-20261103/execution-policy.json",
    { newRetestsHeld: true },
  );
  assert.throws(
    () => assertPublic140GenerationRecoveryDispatch(f.options(), plan),
    /User has held new retests/u,
  );
});
