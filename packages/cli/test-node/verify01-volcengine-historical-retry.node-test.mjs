import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import {
  HISTORICAL_RETRY_ID,
  HISTORICAL_STATUS_PATH,
  HISTORICAL_PENDING,
  ORIGINAL_PROJECT,
  runtimeRepairBinding,
} from "../scripts/verify01-volcengine-historical-retry.mjs";
import {
  nativeExecutionBudgets,
  loadVolcengineBudgetRetry,
  DEFAULT_NATIVE_BUDGETS,
} from "../scripts/verify01-native-execution-budgets.mjs";
import { assertFreshVolcengineBudgetRetry } from "../scripts/verify01-volcengine-fresh-round.mjs";
import {
  nativeProviderProfile,
  assertNativeProviderIdentity,
} from "../scripts/verify01-native-provider-profile.mjs";
const repository = new URL("../../../", import.meta.url);
test("real workflow selector isolates the eleven frozen-project repair samples and never falls back to registry latest", (t) => {
  const f = fixture(t), root = fileURLToPath(repository);
  for (const name of ["historicalStatus", "modelMetadata"]) {
    const item = f.manifest.volcengineBudgetRetry[name];
    item.digest = hash(fs.readFileSync(path.join(root, item.path)));
  }
  const relative = `docs/research/cli/verify01-package-sets/offline-historical-${randomUUID()}.json`;
  const output = path.join(f.root, "selector.txt");
  fs.writeFileSync(path.join(root, relative), JSON.stringify(f.manifest), { flag: "wx" });
  t.after(() => fs.rmSync(path.join(root, relative), { force: true }));
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/verify01-native-task-campaign.yml"), "utf8");
  const script = workflow.match(/node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n          NODE/u)?.[1];
  assert.ok(script);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `globalThis.fetch = async url => { if (!String(url).endsWith('/api/v3/models')) throw new Error('unexpected public fallback'); return {ok:true,json:async()=>({data:[{id:'deepseek-v4-flash-ga-260731'}]})}; };\n${script}`], {
    cwd: root, encoding: "utf8", timeout: 30000, env: { ...process.env,
      NATIVE_PROVIDER: "volcengine", NATIVE_PACKAGE_SET_FILE: relative, NATIVE_PROJECT_REVISION_FILE: "",
      PACKAGE_SET_SELECTION: "prerelease", FRESH_VOLCENGINE_ROUND: "true", VOLCENGINE_CREDENTIAL_PRESENT: "true",
      VOLCENGINE_API_KEY: "offline-placeholder", HOST_SELECTION: "all", ENTRY_SELECTION: "all", SAMPLE_SELECTION: "",
      DELIVERY_RUN: "", DELIVERY_COMMIT: "", FETCH_DIAGNOSTICS: "false", GITHUB_RUN_ATTEMPT: "1", REVIEW_CHANGES: "true", GITHUB_OUTPUT: output,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = Object.fromEntries(fs.readFileSync(output, "utf8").trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
  const cells = JSON.parse(lines.matrix).include;
  assert.equal(cells.length, 11);
  assert.deepEqual(cells.map((row) => row.sample_ids).sort(), HISTORICAL_PENDING);
  assert.ok(cells.every((row) => row.sample_count === 1));
  assert.equal(JSON.parse(lines.acceptance_matrix).include.length, 11);
});
const plan = JSON.parse(
  fs.readFileSync(
    new URL(
      "docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
      repository,
    ),
    "utf8",
  ),
);
const hash = (v) => "sha256:" + createHash("sha256").update(v).digest("hex");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-history-retry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const record = (file, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), bytes);
    return { path: file, digest: hash(bytes) };
  };
  const versions = {
    cli: "0.166.139",
    vscode: "0.37.175",
    jetbrains: "0.4.192",
    vscodeHost: "1.132.0",
    jetbrainsHost: "2025.2",
  };
  const prepublication = {
    schema: "chainlesschain.verify01-prerelease-package-set/v1",
    repository: "chainlesschain/chainlesschain",
    workflow: ".github/workflows/verify01-prerelease-packages.yml",
    distribution: "prerelease-actions-artifact",
    sourceCommit: "a".repeat(40),
    artifactName: "verify01-prerelease-packages-" + "a".repeat(40),
    artifactDigest: hash("archive"),
    runId: 123,
    artifactId: 456,
    contextWindowTokens: 32768,
    published: false,
    files: Object.fromEntries(
      ["cli", "vscode", "jetbrains"].map((name, i) => [
        name,
        {
          file: `${name}-${versions[name]}.${["tgz", "vsix", "zip"][i]}`,
          digest: hash(name),
          integrity: "sha512-" + "a".repeat(86) + "==",
          bytes: 100001,
        },
      ]),
    ),
    cliSourceFiles: [
      "src/runtime/agent-core.js",
      "src/lib/read-file-loop-guard.js",
      "src/lib/coding-change-review-context.js",
      "src/runtime/tool-argument-recovery.js",
    ].map((file) => ({ file, digest: hash(file) })),
  };
  const history = {
    schema: "chainlesschain.volcengine-historical-cumulative-status/v1",
    provider: "volcengine",
    model: "deepseek-v4-flash-ga-260731",
    projectCommit: ORIGINAL_PROJECT,
    accepted: 34,
    remainingSampleIds: [...HISTORICAL_PENDING],
    samples: plan.samples.map((row) => ({
      sampleId: row.id,
      cumulativelyQualified: !HISTORICAL_PENDING.includes(row.id),
    })),
  };
  const manifest = {
    schema: "chainlesschain.native-package-set/v1",
    versions,
    prepublication,
    runtimeRepair: {
      id: HISTORICAL_RETRY_ID,
      runtimeSourceCommit: prepublication.sourceCommit,
      taskProjectCommit: ORIGINAL_PROJECT,
      taskInputsChanged: false,
      formalSample: false,
    },
    volcengineBudgetRetry: {
      id: HISTORICAL_RETRY_ID,
      modelTurns: 40,
      physicalRequests: 48,
      outputTokens: 393216,
      outputPolicy: "model-maximum",
      connectionAttemptTimeoutMs: 10000,
      parallelToolCalls: null,
      reviewChanges: true,
      historicalStatus: record(HISTORICAL_STATUS_PATH, history),
      selectedSampleIds: [...HISTORICAL_PENDING],
      modelMetadata: record(
        "docs/research/cli/verify01-volcengine-139-20261103/provider-output/model-catalog.json",
        {
          id: history.model,
          token_limits: { max_output_token_length: 393216 },
        },
      ),
    },
  };
  const options = () => ({
    provider: "volcengine",
    packageSet: "prerelease",
    packageBinding: { versions, bytes: Buffer.from(JSON.stringify(manifest)) },
    hosts: "all",
    entries: "all",
    sampleIds: undefined,
    revisionBinding: null,
    runAttempt: 1,
    credentialPresent: true,
    repositoryRoot: root,
    reviewChanges: true,
  });
  return { root, manifest, options };
}
test("historical retry selects exactly 11 unresolved IDs without repeating any of 34 successes", (t) => {
  const f = fixture(t);
  const result = assertFreshVolcengineBudgetRetry(f.options(), plan);
  assert.deepEqual(result.selectedSampleIds, HISTORICAL_PENDING);
  assert.equal(Object.values(result.sampleIdsByGroup).flat().length, 11);
  assert.equal(result.budgets.parallelToolCalls, null);
  assert.equal(result.budgets.connectionAttemptTimeoutMs, 10000);
  assert.deepEqual(nativeExecutionBudgets({}), DEFAULT_NATIVE_BUDGETS);
  for (const mutate of [
    (v) => v.volcengineBudgetRetry.selectedSampleIds.push("verify-01"),
    (v) => (v.volcengineBudgetRetry.historicalStatus.digest = hash("changed")),
    (v) => (v.runtimeRepair.runtimeSourceCommit = "b".repeat(40)),
    (v) => (v.runtimeRepair.taskInputsChanged = true),
    (v) => delete v.prepublication,
    (v) => (v.volcengineBudgetRetry.parallelToolCalls = false),
    (v) => (v.volcengineBudgetRetry.outputTokens = 8192),
  ]) {
    const changed = structuredClone(f.manifest);
    mutate(changed);
    assert.throws(() =>
      loadVolcengineBudgetRetry(changed, { repositoryRoot: f.root, plan }),
    );
  }
});
test("runtime repair rejects public fallback, changed tasks, missing review, host subsets and repeated paid attempt", (t) => {
  const f = fixture(t);
  for (const change of [
    { packageSet: "latest" },
    { provider: "openai" },
    { hosts: "linux" },
    { entries: "cli" },
    { sampleIds: ["verify-04"] },
    { revisionBinding: {} },
    { runAttempt: 2 },
    { credentialPresent: false },
    { reviewChanges: false },
  ])
    assert.throws(() =>
      assertFreshVolcengineBudgetRetry({ ...f.options(), ...change }, plan),
    );
  assert.throws(() =>
    runtimeRepairBinding(f.manifest, {
      provider: "volcengine",
      projectCommit: "b".repeat(40),
    }),
  );
});
test("delivery identity binds distinct runtime and frozen task source plus new provider policy", (t) => {
  const f = fixture(t),
    source = "c".repeat(40);
  const binding = {
    ...f.options().packageBinding,
    packageSetDigest: hash(f.options().packageBinding.bytes),
  };
  const budgets = nativeExecutionBudgets(f.manifest),
    profile = nativeProviderProfile("volcengine", { budgets });
  const summary = {
    executionSourceCommit: source,
    projectCommit: ORIGINAL_PROJECT,
    planDigest: "sha256:plan",
    runtimeRepair: f.manifest.runtimeRepair,
    prepublication: f.manifest.prepublication,
    executionBudgets: budgets,
    versions: binding.versions,
    packageSetDigest: binding.packageSetDigest,
    cohortKind: "volcengine-runtime-repair-frozen-project",
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
    projectCommit: ORIGINAL_PROJECT,
    planDigest: summary.planDigest,
    revisionBinding: null,
  };
  assertNativeProviderIdentity(summary, "volcengine", source, binding, project);
  for (const change of [
    { runtimeRepair: null },
    { cohortKind: "volcengine-native-diagnostic" },
    { projectCommit: "d".repeat(40) },
  ])
    assert.throws(() =>
      assertNativeProviderIdentity(
        { ...summary, ...change },
        "volcengine",
        source,
        binding,
        project,
      ),
    );
});
