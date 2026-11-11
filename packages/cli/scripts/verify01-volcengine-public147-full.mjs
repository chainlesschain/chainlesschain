import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadPublicGeneratorProof } from "./verify01-public-generator-binding.mjs";
import { PUBLIC140_FIXED_FULL_BUDGETS } from "./verify01-volcengine-public140-full.mjs";

export const PUBLIC147_FULL_ID = "volcengine-public147-full45-20261111";
export const PUBLIC147_VERSIONS = Object.freeze({
  cli: "0.166.147",
  vscode: "0.37.186",
  jetbrains: "0.4.201",
  vscodeHost: "1.132.0",
  jetbrainsHost: "2025.2",
});
export const PUBLIC147_MODEL_METADATA =
  "docs/research/cli/verify01-volcengine-147-full-20261111/model-catalog.json";
export const PUBLIC147_FULL_BUDGETS = PUBLIC140_FIXED_FULL_BUDGETS;
const project = "b2aa3aba082873570e85dce39b00754e5504ff37";
const model = "deepseek-v4-flash-ga-260731";
const groups = ["win32", "linux", "darwin"].flatMap((host) =>
  ["cli", "vscode", "jetbrains"].map((entry) => `${host}-${entry}`),
);

export function isPublic147FullRound(manifest) {
  return manifest?.volcengineFullRound?.id === PUBLIC147_FULL_ID;
}

/** A new round has its own identity; the historical .140 declaration is unchanged. */
export function public147FullBudgets(manifest, provider) {
  assert.equal(provider, "volcengine");
  assert.ok(isPublic147FullRound(manifest));
  assert.deepEqual(manifest.versions, PUBLIC147_VERSIONS);
  for (const key of [
    "prepublication",
    "runtimeRepair",
    "volcengineBudgetRetry",
    "freshVolcengineRound",
    "volcengineGenerationRecovery",
  ])
    assert.equal(
      manifest[key],
      undefined,
      "A new public full round cannot claim another treatment",
    );
  assert.equal(manifest.diagnosticExecution?.contextWindowTokens, 32768);
  const full = manifest.volcengineFullRound;
  assert.deepEqual(full, {
    id: PUBLIC147_FULL_ID,
    projectCommit: project,
    model,
    taskCount: 36,
    firstRunCount: 9,
    repeatPreviouslyAccepted: true,
    historicalScoresUnchanged: true,
    formalSample: false,
    reviewChanges: true,
    outputPolicy: "model-maximum",
    ...PUBLIC147_FULL_BUDGETS,
    modelMetadata: full.modelMetadata,
  });
  assert.deepEqual(Object.keys(full.modelMetadata ?? {}).sort(), [
    "digest",
    "path",
  ]);
  assert.equal(full.modelMetadata.path, PUBLIC147_MODEL_METADATA);
  assert.match(full.modelMetadata.digest ?? "", /^sha256:[a-f0-9]{64}$/u);
  return PUBLIC147_FULL_BUDGETS;
}

export function loadPublic147FullRound(manifest, { repositoryRoot, plan }) {
  const budgets = public147FullBudgets(manifest, "volcengine");
  assert.equal(plan.commitSha, project);
  const expected = [
    ...Array.from(
      { length: 36 },
      (_, n) => `verify-${String(n + 1).padStart(2, "0")}`,
    ),
    ...groups.map((group) => `first-run-${group}`),
  ].sort();
  assert.deepEqual(plan.samples.map((row) => row.id).sort(), expected);
  const sampleIdsByGroup = Object.fromEntries(
    groups.map((group) => [group, []]),
  );
  for (const row of plan.samples) {
    const task = /^verify-(\d{2})$/u.exec(row.id);
    const group = task
      ? groups[(Number(task[1]) - 1) % groups.length]
      : row.id.slice("first-run-".length);
    assert.equal(row.kind, task ? "task" : "first-run");
    assert.equal(
      row.stratum,
      `${group}-volcengine`,
      "Original task allocation must be preserved",
    );
    sampleIdsByGroup[group].push(row.id);
  }
  assert.ok(Object.values(sampleIdsByGroup).every((rows) => rows.length === 5));
  const root = fs.realpathSync(repositoryRoot);
  const file = path.join(root, PUBLIC147_MODEL_METADATA);
  assert.ok(!fs.lstatSync(file).isSymbolicLink());
  const relative = path.relative(root, fs.realpathSync(file));
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
  );
  const bytes = fs.readFileSync(file);
  assert.equal(
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    manifest.volcengineFullRound.modelMetadata.digest,
  );
  const metadata = JSON.parse(bytes.toString("utf8"));
  assert.equal(metadata.id, model);
  assert.equal(
    metadata.token_limits?.max_output_token_length,
    budgets.outputTokens,
  );
  loadPublicGeneratorProof(manifest, { repositoryRoot });
  return { budgets, selectedSampleIds: expected, sampleIdsByGroup };
}

export function assertPublic147FullDispatch(options, plan) {
  for (const [key, value] of Object.entries({
    provider: "volcengine",
    packageSet: "latest",
    hosts: "all",
    entries: "all",
    sampleIds: undefined,
    revisionBinding: null,
    runAttempt: 1,
    credentialPresent: true,
    reviewChanges: true,
  }))
    assert.equal(
      options[key],
      value,
      `Full-round dispatch constraint failed: ${key}`,
    );
  assert.deepEqual(options.packageBinding.versions, PUBLIC147_VERSIONS);
  return loadPublic147FullRound(
    JSON.parse(options.packageBinding.bytes.toString("utf8")),
    { repositoryRoot: options.repositoryRoot, plan },
  );
}
