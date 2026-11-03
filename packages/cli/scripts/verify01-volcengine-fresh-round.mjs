import assert from "node:assert/strict";
import { loadPublicGeneratorProof } from "./verify01-public-generator-binding.mjs";

/** Explicit new full round, separate from the historical unfinished-task chain. */
export function assertFreshVolcengineRound({
  provider,
  packageSet,
  packageBinding,
  hosts,
  entries,
  sampleIds,
  revisionBinding,
  runAttempt,
  credentialPresent,
  repositoryRoot,
}) {
  assert.equal(provider, "volcengine");
  assert.equal(packageSet, "latest", "Fresh round requires public packages");
  assert.equal(hosts, "all", "Fresh round requires all three native hosts");
  assert.equal(entries, "all", "Fresh round requires all three entries");
  assert.equal(sampleIds, undefined, "Fresh round must cover all 45 samples");
  assert.equal(
    revisionBinding,
    null,
    "Fresh round uses original project inputs",
  );
  assert.equal(
    runAttempt,
    1,
    "Reconcile the previous live attempt before retrying",
  );
  assert.equal(
    credentialPresent,
    true,
    "Dedicated Volcengine round key is missing",
  );
  const manifest = JSON.parse(packageBinding.bytes.toString("utf8"));
  assert.deepEqual(manifest.freshVolcengineRound, {
    id: "volcengine-public139-20261103",
    taskCount: 36,
    firstRunCount: 9,
    repeatPreviouslyAccepted: true,
    historicalScoresUnchanged: true,
    formalSample: false,
  });
  assert.deepEqual(packageBinding.versions, {
    cli: "0.166.139",
    vscode: "0.37.175",
    jetbrains: "0.4.192",
    vscodeHost: "1.132.0",
    jetbrainsHost: "2025.2",
  });
  return loadPublicGeneratorProof(manifest, { repositoryRoot });
}
