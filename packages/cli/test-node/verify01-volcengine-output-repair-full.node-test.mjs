import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  PUBLIC140_BASELINE_MANIFEST,
  PUBLIC140_LIMIT_PROOF,
  PUBLIC140_MODEL_METADATA,
  PUBLIC140_FIXED_FULL_BUDGETS,
  loadPublic140FullRound,
} from "../scripts/verify01-volcengine-public140-full.mjs";
import { nativeExecutionBudgets } from "../scripts/verify01-native-execution-budgets.mjs";
import {
  nativeProviderProfile,
  assertNativeProviderIdentity,
} from "../scripts/verify01-native-provider-profile.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const manifestPath =
  "docs/research/cli/verify01-package-sets/2026-11-03-volcengine-public140-full45-explicit-limits.json";
const read = (file) =>
  JSON.parse(fs.readFileSync(path.join(repository, file), "utf8"));
const manifest = read(manifestPath),
  baseline = read(PUBLIC140_BASELINE_MANIFEST);
const plan = read(
  "docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json",
);
const hash = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fixed-full140-"));
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proof = read(PUBLIC140_LIMIT_PROOF),
    prefix = path.posix.dirname(PUBLIC140_LIMIT_PROOF);
  for (const file of [
    PUBLIC140_BASELINE_MANIFEST,
    PUBLIC140_MODEL_METADATA,
    manifest.publicGeneratorProof.path,
    PUBLIC140_LIMIT_PROOF,
    ...Object.keys(proof.files).map((file) => prefix + "/" + file),
  ]) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repository, file), target);
  }
  return { root, manifest: structuredClone(manifest) };
}

test("corrected full45 keeps every original package byte, task project and allowance while binding the real internal-limit bug", () => {
  const selected = loadPublic140FullRound(manifest, {
    repositoryRoot: repository,
    plan,
  });
  assert.deepEqual(
    selected.selectedSampleIds,
    plan.samples.map((s) => s.id).sort(),
  );
  assert.equal(selected.selectedSampleIds.length, 45);
  assert.equal(Object.keys(selected.sampleIdsByGroup).length, 9);
  assert.deepEqual(selected.budgets, PUBLIC140_FIXED_FULL_BUDGETS);
  assert.equal(
    nativeExecutionBudgets(manifest).preserveExplicitOutputLimits,
    true,
  );
  assert.equal(
    nativeExecutionBudgets(baseline).preserveExplicitOutputLimits,
    undefined,
  );
  // Recorded before this repair in real public140 run41630636517 / verify10.
  assert.equal(
    hash(
      JSON.stringify(
        nativeProviderProfile("volcengine", {
          budgets: nativeExecutionBudgets(baseline),
        }).policy,
      ),
    ),
    "sha256:f38ba1d4c166229766cd78adfd38ccfc2413b21ad4f533ef7d87f5ec1bf10f69",
  );
  const profile = nativeProviderProfile("volcengine", {
    budgets: selected.budgets,
  });
  assert.equal(profile.policy.preserveExplicitOutputLimits, true);
  assert.equal(profile.policy.maximumAnswerTokens, 393216);
  assert.deepEqual(manifest.publicArtifacts, baseline.publicArtifacts);
  assert.equal(
    manifest.volcengineFullRound.normalizationRepair
      .outstandingUsageCarryForward[0].usageKnown,
    false,
  );
});

test("repair rejects changed package origin, missing policy, erased unknown usage and proof whose raw input contradicts its claim", (t) => {
  const f = fixture(t);
  for (const mutate of [
    (m) => delete m.volcengineFullRound.preserveExplicitOutputLimits,
    (m) => (m.volcengineFullRound.preserveExplicitOutputLimits = false),
    (m) => (m.origin.cli.tarball = "https://example.invalid/other.tgz"),
    (m) =>
      (m.volcengineFullRound.normalizationRepair.outstandingUsageCarryForward =
        []),
    (m) =>
      (m.volcengineFullRound.normalizationRepair.evidence.digest =
        hash("wrong")),
  ]) {
    const changed = structuredClone(f.manifest);
    mutate(changed);
    assert.throws(() =>
      loadPublic140FullRound(changed, { repositoryRoot: f.root, plan }),
    );
  }
  const proofFile = path.join(f.root, PUBLIC140_LIMIT_PROOF),
    proof = JSON.parse(fs.readFileSync(proofFile, "utf8"));
  const originalFile = path.join(
      path.dirname(proofFile),
      "request-3.original.json",
    ),
    original = JSON.parse(fs.readFileSync(originalFile, "utf8"));
  original.max_tokens = 4096;
  fs.writeFileSync(originalFile, JSON.stringify(original));
  proof.files["request-3.original.json"] = hash(fs.readFileSync(originalFile));
  fs.writeFileSync(proofFile, JSON.stringify(proof));
  f.manifest.volcengineFullRound.normalizationRepair.evidence.digest = hash(
    fs.readFileSync(proofFile),
  );
  assert.throws(() =>
    loadPublic140FullRound(f.manifest, { repositoryRoot: f.root, plan }),
  );
});

test("real workflow selects all45 repaired-policy deliveries and acceptance cells with no inference", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fixed-selector-"));
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "selection.txt");
  const workflow = fs.readFileSync(
    path.join(
      repository,
      ".github/workflows/verify01-native-task-campaign.yml",
    ),
    "utf8",
  );
  const script = workflow.match(
    /node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n          NODE/u,
  )?.[1];
  assert.ok(script);
  const mock = `const calls=[];globalThis.fetch=async (url,options)=>{calls.push(url);if(options?.method&&options.method!=='GET')throw Error('inference forbidden');if(url==='https://ark.cn-beijing.volces.com/api/v3/models'){if(options.headers.Authorization!=='Bearer offline-placeholder')throw Error('wrong credential source');return {ok:true,json:async()=>({data:[{id:'deepseek-v4-flash-ga-260731'}]})};}if(options?.headers?.Authorization)throw Error('credential egress');if(url==='https://registry.npmjs.org/chainlesschain/latest')return {ok:true,json:async()=>({version:'0.166.140'})};if(url==='https://open-vsx.org/api/chainlesschain/chainlesschain-ide/latest')return {ok:true,json:async()=>({version:'0.37.176'})};throw Error('unexpected network');};`;
  const run = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      mock +
        "\n" +
        script +
        "\nif(calls.length!==3)throw Error('missing metadata checks');",
    ],
    {
      cwd: repository,
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        NATIVE_PROVIDER: "volcengine",
        NATIVE_PACKAGE_SET_FILE: manifestPath,
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
  assert.equal(run.status, 0, run.stderr);
  const fields = Object.fromEntries(
    fs
      .readFileSync(output, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
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
  assert.equal(new Set(cells.map((c) => c.cell_id)).size, 45);
});

test("independent acceptance binds the corrected normalization policy and refuses old-policy substitution", () => {
  const source = "d".repeat(40),
    bytes = Buffer.from(JSON.stringify(manifest)),
    binding = {
      bytes,
      versions: manifest.versions,
      packageSetDigest: hash(bytes),
    };
  const budgets = nativeExecutionBudgets(manifest),
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
      { ...summary, executionBudgets: nativeExecutionBudgets(baseline) },
      "volcengine",
      source,
      binding,
      project,
    ),
  );
});
