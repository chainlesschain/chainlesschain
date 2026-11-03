import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  PUBLIC140_FULL_ID,
  PUBLIC140_VERSIONS,
  PUBLIC140_FULL_BUDGETS,
  PUBLIC140_MODEL_METADATA,
  loadPublic140FullRound,
} from "../scripts/verify01-volcengine-public140-full.mjs";
import { assertFreshVolcengineRound } from "../scripts/verify01-volcengine-fresh-round.mjs";
import {
  nativeExecutionBudgets,
  DEFAULT_NATIVE_BUDGETS,
  loadVolcengineBudgetRetry,
} from "../scripts/verify01-native-execution-budgets.mjs";
import {
  assertNativeProviderIdentity,
  nativeProviderProfile,
} from "../scripts/verify01-native-provider-profile.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const plan = JSON.parse(
  fs.readFileSync(
    path.join(
      repositoryRoot,
      "docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
    ),
    "utf8",
  ),
);
const hash = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-full140-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const record = (relative, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), bytes);
    return { path: relative, digest: hash(bytes) };
  };
  const source = "a".repeat(40);
  const proof = {
    cli: { version: PUBLIC140_VERSIONS.cli, status: "verified-public", source },
    ide: {
      vscode: {
        version: PUBLIC140_VERSIONS.vscode,
        status: "verified-public",
        source,
      },
      jetbrains: {
        version: PUBLIC140_VERSIONS.jetbrains,
        status: "verified-public",
        source,
      },
    },
  };
  const manifest = {
    schema: "chainlesschain.native-package-set/v1",
    versions: { ...PUBLIC140_VERSIONS },
    releaseSourceCommits: { cli: source, openVsx: source, jetbrains: source },
    publicGeneratorProof: record(
      "docs/research/cli/evidence/release900140-public/publication.json",
      proof,
    ),
    volcengineFullRound: {
      id: PUBLIC140_FULL_ID,
      projectCommit: plan.commitSha,
      model: "deepseek-v4-flash-ga-260731",
      taskCount: 36,
      firstRunCount: 9,
      repeatPreviouslyAccepted: true,
      historicalScoresUnchanged: true,
      formalSample: false,
      reviewChanges: true,
      outputPolicy: "model-maximum",
      ...PUBLIC140_FULL_BUDGETS,
      modelMetadata: record(PUBLIC140_MODEL_METADATA, {
        id: "deepseek-v4-flash-ga-260731",
        token_limits: { max_output_token_length: 393216 },
      }),
    },
  };
  const options = () => ({
    provider: "volcengine",
    packageSet: "latest",
    packageBinding: {
      versions: manifest.versions,
      bytes: Buffer.from(JSON.stringify(manifest)),
    },
    hosts: "all",
    entries: "all",
    sampleIds: undefined,
    revisionBinding: null,
    runAttempt: 1,
    credentialPresent: true,
    reviewChanges: true,
    repositoryRoot: root,
  });
  return { root, manifest, options };
}

test("public140 repeats every original task and first run across nine groups, preserving historical policy", (t) => {
  const f = fixture(t),
    result = assertFreshVolcengineRound(f.options(), plan);
  assert.deepEqual(
    result.selectedSampleIds,
    plan.samples.map((s) => s.id).sort(),
  );
  assert.equal(result.selectedSampleIds.length, 45);
  assert.equal(Object.keys(result.sampleIdsByGroup).length, 9);
  assert.ok(
    Object.values(result.sampleIdsByGroup).every((ids) => ids.length === 5),
  );
  assert.deepEqual(nativeExecutionBudgets(f.manifest), PUBLIC140_FULL_BUDGETS);
  assert.deepEqual(
    loadVolcengineBudgetRetry(f.manifest, { repositoryRoot: f.root, plan }),
    result,
  );
  assert.deepEqual(nativeExecutionBudgets({}), DEFAULT_NATIVE_BUDGETS);
  assert.equal(
    nativeProviderProfile("volcengine", { budgets: result.budgets })
      .defaultThinkingPreserved,
    false,
  );
});

test("full140 rejects subset, repeated attempt, revised task source, missing review or credential", (t) => {
  const f = fixture(t);
  for (const changed of [
    { provider: "openai" },
    { packageSet: "prerelease" },
    { hosts: "linux" },
    { entries: "cli" },
    { sampleIds: ["verify-04"] },
    { revisionBinding: {} },
    { runAttempt: 2 },
    { credentialPresent: false },
    { reviewChanges: false },
  ])
    assert.throws(() =>
      assertFreshVolcengineRound({ ...f.options(), ...changed }, plan),
    );
});

test("full140 rejects changed budgets, mixed legacy policies, altered model metadata or publication proof", (t) => {
  const f = fixture(t);
  for (const mutate of [
    (m) => (m.versions.cli = "0.166.139"),
    (m) => (m.volcengineFullRound.outputTokens = 8192),
    (m) => (m.volcengineFullRound.parallelToolCalls = false),
    (m) => (m.volcengineFullRound.modelTurns = 20),
    (m) => (m.volcengineFullRound.repeatPreviouslyAccepted = false),
    (m) => (m.volcengineFullRound.historicalScoresUnchanged = false),
    (m) => (m.volcengineFullRound.modelMetadata.digest = hash("changed")),
    (m) => (m.publicGeneratorProof.digest = hash("changed")),
    (m) => (m.prepublication = {}),
    (m) => (m.runtimeRepair = {}),
    (m) => (m.volcengineBudgetRetry = {}),
    (m) => (m.freshVolcengineRound = {}),
  ]) {
    const changed = structuredClone(f.manifest);
    mutate(changed);
    assert.throws(() =>
      loadPublic140FullRound(changed, { repositoryRoot: f.root, plan }),
    );
  }
  const metadata = path.join(f.root, PUBLIC140_MODEL_METADATA);
  fs.writeFileSync(
    metadata,
    JSON.stringify({
      id: "deepseek-v4-flash-ga-260731",
      token_limits: { max_output_token_length: 8192 },
    }),
  );
  f.manifest.volcengineFullRound.modelMetadata.digest = hash(
    fs.readFileSync(metadata),
  );
  assert.throws(() =>
    loadPublic140FullRound(f.manifest, { repositoryRoot: f.root, plan }),
  );
  for (const changed of [
    { ...plan, commitSha: "b".repeat(40) },
    { ...plan, samples: plan.samples.slice(1) },
    {
      ...plan,
      samples: plan.samples.map((s, i) => (i === 1 ? plan.samples[0] : s)),
    },
  ])
    assert.throws(() =>
      loadPublic140FullRound(f.manifest, {
        repositoryRoot: f.root,
        plan: changed,
      }),
    );
});

test("real workflow emits exactly45 isolated deliveries and acceptance cells and performs metadata GETs only", (t) => {
  const f = fixture(t);
  // Keep existing authenticated metadata intact; install only ephemeral missing fixtures.
  for (const item of [
    f.manifest.publicGeneratorProof,
    f.manifest.volcengineFullRound.modelMetadata,
  ]) {
    const target = path.join(repositoryRoot, item.path);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(
        path.join(f.root, item.path),
        target,
        fs.constants.COPYFILE_EXCL,
      );
      t.after(() => fs.rmSync(target, { force: true }));
    }
    item.digest = hash(fs.readFileSync(target));
  }
  const relative = `docs/research/cli/verify01-package-sets/offline-full140-${randomUUID()}.json`;
  fs.writeFileSync(
    path.join(repositoryRoot, relative),
    JSON.stringify(f.manifest),
    { flag: "wx" },
  );
  t.after(() =>
    fs.rmSync(path.join(repositoryRoot, relative), { force: true }),
  );
  const output = path.join(f.root, "selection.txt");
  const workflow = fs.readFileSync(
    path.join(
      repositoryRoot,
      ".github/workflows/verify01-native-task-campaign.yml",
    ),
    "utf8",
  );
  const script = workflow.match(
    /node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n          NODE/u,
  )?.[1];
  assert.ok(script);
  const mock = `const seen=[]; globalThis.fetch=async (url,init)=>{ seen.push(url); if(init?.method && init.method!=='GET') throw new Error('non-GET forbidden'); if(String(url).endsWith('/api/v3/models')) { if(init.headers.Authorization!=='Bearer offline-placeholder') throw new Error('dedicated auth missing'); return {ok:true,json:async()=>({data:[{id:'deepseek-v4-flash-ga-260731'}]})}; } if(init?.headers?.Authorization) throw new Error('credential egress'); if(url==='https://registry.npmjs.org/chainlesschain/latest') return {ok:true,json:async()=>({version:'0.166.140'})}; if(url==='https://open-vsx.org/api/chainlesschain/chainlesschain-ide/latest') return {ok:true,json:async()=>({version:'0.37.176'})}; throw new Error('inference or unexpected network'); };`;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      mock +
        "\n" +
        script +
        "\nif(seen.length!==3) throw new Error('missing latest checks');",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        NATIVE_PROVIDER: "volcengine",
        NATIVE_PACKAGE_SET_FILE: relative,
        NATIVE_PROJECT_REVISION_FILE: "",
        PACKAGE_SET_SELECTION: "latest",
        FRESH_VOLCENGINE_ROUND: "true",
        VOLCENGINE_CREDENTIAL_PRESENT: "true",
        VOLCENGINE_API_KEY: "offline-placeholder",
        HOST_SELECTION: "all",
        ENTRY_SELECTION: "all",
        SAMPLE_SELECTION: "",
        DELIVERY_RUN: "",
        DELIVERY_COMMIT: "",
        FETCH_DIAGNOSTICS: "false",
        GITHUB_RUN_ATTEMPT: "1",
        REVIEW_CHANGES: "true",
        GITHUB_OUTPUT: output,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const fields = Object.fromEntries(
    fs
      .readFileSync(output, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  const cells = JSON.parse(fields.matrix).include,
    acceptance = JSON.parse(fields.acceptance_matrix).include;
  assert.equal(cells.length, 45);
  assert.equal(acceptance.length, 45);
  assert.deepEqual(
    cells.map((c) => c.sample_ids).sort(),
    plan.samples.map((s) => s.id).sort(),
  );
  assert.ok(cells.every((c) => c.sample_count === 1));
  assert.equal(new Set(cells.map((c) => c.cell_id)).size, 45);
  assert.deepEqual(
    acceptance.map((c) => c.sample_ids).sort(),
    cells.map((c) => c.sample_ids).sort(),
  );
});

test("acceptance rejects full-round policy identity downgrade", (t) => {
  const f = fixture(t),
    source = "c".repeat(40),
    binding = {
      ...f.options().packageBinding,
      packageSetDigest: hash(f.options().packageBinding.bytes),
    };
  const budgets = nativeExecutionBudgets(f.manifest),
    profile = nativeProviderProfile("volcengine", { budgets });
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
      { ...summary, executionBudgets: DEFAULT_NATIVE_BUDGETS },
      "volcengine",
      source,
      binding,
      project,
    ),
  );
  assert.throws(() =>
    assertNativeProviderIdentity(
      {
        ...summary,
        modelTransport: {
          ...summary.modelTransport,
          defaultThinkingPreserved: true,
        },
      },
      "volcengine",
      source,
      binding,
      project,
    ),
  );
});
