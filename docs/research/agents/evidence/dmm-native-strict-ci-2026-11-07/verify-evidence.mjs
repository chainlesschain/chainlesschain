import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../../..");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = read("manifest.json");
for (const [name, expected] of Object.entries(manifest.files)) {
  assert.equal(
    digest(fs.readFileSync(path.join(directory, name))),
    expected,
    name,
  );
}
// Historical reports bind to their own source commit, even on a later docs head.
// Never replace a recorded source hash with a hash of the current working tree.
for (const [sha, files] of Object.entries(manifest.sourceSnapshots)) {
  assert.match(sha, /^[a-f0-9]{40}$/u);
  for (const [name, expected] of Object.entries(files)) {
    assert(!name.startsWith("-") && !name.includes(":"));
    const bytes = execFileSync("git", ["show", `${sha}:${name}`], {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(digest(bytes), expected, `${sha}:${name}`);
  }
}
const failures = read("failed-runs.json").runs;
assert.equal(failures.length, 4);
for (const run of failures) {
  assert.equal(run.conclusion, "failure");
  assert(manifest.sourceSnapshots[run.headSha]);
}
for (const name of ["goal", "transfer"]) {
  const result = read(`failures-947/${name}-journey.json`);
  assert.equal(result.status, "failed");
  assert.equal(result.sourceSha, manifest.originalCandidateSha);
  assert.equal(result.synthetic, true);
  assert.equal(result.realBusinessAcceptance, false);
  const runner = `desktop-app-vue/scripts/project-goal-${name === "goal" ? "native" : "transfer-native"}-journey.mjs`;
  assert.equal(
    result.runnerSha256,
    manifest.sourceSnapshots[result.sourceSha][runner],
  );
}
assert.match(
  fs.readFileSync(path.join(directory, "preflight-module-error.txt"), "utf8"),
  /ERR_MODULE_NOT_FOUND.*ajv.*2020\.js/u,
);
const reproduction = read("workspace-prune-repro.json");
assert.equal(reproduction.syntheticLocalPackages, true);
assert.equal(reproduction.network, false);
assert.equal(reproduction.lifecycleScripts, false);
assert.equal(reproduction.afterRootCi, true);
assert.equal(reproduction.afterChildWorkspaceCi, false);
assert.equal(reproduction.afterRootWorkspaceCiAgain, true);
const local = read("local-encrypted-preflight-fixed-reporter.json");
assert.equal(local.passed, true);
assert(Object.values(local.checks).every((value) => value === true));
for (const [name, expected] of Object.entries(local.sources)) {
  assert.equal(
    manifest.sourceSnapshots[manifest.fixedCandidateSha][name],
    expected,
  );
}
const expectedFailure = read("reporter-expected-failure.json");
assert.equal(expectedFailure.passed, false);
assert.match(expectedFailure.error.message, /ENOENT/u);
for (const [name, expected] of Object.entries(expectedFailure.sources)) {
  assert.equal(
    manifest.sourceSnapshots[manifest.fixedCandidateSha][name],
    expected,
  );
}
for (const record of manifest.remoteRuns || []) {
  const run = read(record.file);
  assert.equal(run.databaseId, record.id);
  assert.equal(run.headSha, record.sha);
  assert.equal(run.status, record.status);
  assert.equal(run.conclusion, record.conclusion);
  assert.equal(run.headSha, manifest.fixedCandidateSha);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  for (const job of run.jobs) assert.equal(job.conclusion, "success");
}

// Independently verify the archived Ed25519 receipt with its public descriptor.
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const transfer = read(
  "candidate-transfer/dmm-native-goal-transfer/journey.json",
);
const goal = read("candidate-goal/dmm-native-goal-journey/journey.json");
for (const [name, result, runner] of [
  ["transfer", transfer, "project-goal-transfer-native-journey.mjs"],
  ["goal", goal, "project-goal-native-journey.mjs"],
]) {
  assert.equal(result.sourceSha, manifest.fixedCandidateSha);
  assert.equal(result.sourceStatus, "");
  assert.equal(result.status, "passed");
  assert.equal(result.synthetic, true);
  assert.equal(result.realBusinessAcceptance, false);
  assert.equal(
    result.runnerSha256,
    manifest.sourceSnapshots[result.sourceSha][
      `desktop-app-vue/scripts/${runner}`
    ],
  );
  const preflight = read(`candidate-${name}/dmm-encrypted-goal-preflight.json`);
  assert.equal(preflight.passed, true);
  assert(Object.values(preflight.checks).every((value) => value === true));
  for (const [file, expected] of Object.entries(preflight.sources)) {
    assert.equal(manifest.sourceSnapshots[result.sourceSha][file], expected);
  }
}
assert.equal(transfer.installedProductAcceptance, false);
assert.equal(transfer.native.length, 22);
assert.equal(transfer.cli.length, 9);
assert.equal(transfer.pickerProbe.actualSelectedExpectedPath, true);
assert.equal(transfer.pickerProbe.open.actualSelectedExpectedPath, true);
assert.equal(transfer.originalSha256, transfer.restoredSha256);
assert.equal(transfer.imported.goal.status, "paused");
assert.equal(transfer.imported.goal.completion, null);
assert.deepEqual(transfer.imported.goal.keyResults, transfer.source.keyResults);
for (const key of [
  "allowedActionTypes",
  "authorizationRefs",
  "memoryRefs",
  "triggerRefs",
])
  assert.deepEqual(transfer.imported.goal[key], []);
assert.equal(transfer.roundTripGoalCount, 0);
assert.equal(transfer.finalGoalCount, 1);
const { signature, ...payload } = transfer.cancellation;
assert.equal(payload.targetId, transfer.target.id);
assert.equal(
  payload.targetDigest,
  `sha256:${digest(canonical(transfer.target))}`,
);
assert.equal(payload.state, "cancelled");
assert(
  verify(
    null,
    Buffer.from(`sha256:${digest(canonical(payload))}`),
    createPublicKey({
      key: Buffer.from(transfer.target.publicKey, "base64"),
      format: "der",
      type: "spki",
    }),
    Buffer.from(signature, "base64"),
  ),
);
assert.equal(
  transfer.reexportedCancellationSha256,
  digest(JSON.stringify(transfer.cancellation, null, 2)),
);
assert.equal(
  transfer.changedTargetRefusal.errorCode,
  "GOAL_TRANSFER_ROLLBACK_HAS_CHANGES",
);
assert.equal(transfer.changedTargetRefusal.sourceStillFrozen, true);
assert.equal(transfer.changedTargetRefusal.cancellationFileAbsent, true);
assert.deepEqual(
  transfer.changedTargetRefusal.before,
  transfer.changedTargetRefusal.after,
);
assert(transfer.changedTargetRefusal.revised.revision > 1);
const forgery = transfer.cli.find(
  (item) => item.args.includes("restore-transfer") && item.code === 1,
);
assert.match(
  forgery.stdout + forgery.stderr,
  /GOAL_TRANSFER_CANCELLATION_INVALID/u,
);
assert.equal(goal.acceptance.goal.status, "active");
assert(goal.acceptance.reports.every((report) => report.met === false));
assert.equal(goal.afterStopObservation.goal.status, "abandoned");
assert.equal(goal.afterStopObservation.monitor.enabled, 0);
assert.equal(goal.afterStopObservation.usage.checks, goal.stopped.usage.checks);
const stopStart = goal.stages.find(
  (stage) => stage.name === "follow-up-ended-observing-real-70-seconds",
);
const stopEnd = goal.stages.find(
  (stage) => stage.name === "no-new-checks-after-real-scheduled-interval",
);
assert(Date.parse(stopEnd.at) - Date.parse(stopStart.at) >= 70_000);
const platformResults = [];
for (const platform of ["ubuntu-latest", "windows-latest", "macos-latest"]) {
  const base = `candidate-host/dmm-project-host-${platform}-${manifest.fixedCandidateSha}-1`;
  const files = new Set();
  const tests = new Set();
  for (const name of [
    "dmm-host.json",
    "dmm-renderer.json",
    "dmm-organization-host.json",
  ]) {
    const report = read(`${base}/${name}`);
    assert.equal(report.success, true);
    assert.equal(report.numFailedTests, 0);
    assert.equal(report.numPendingTests, 0);
    for (const file of report.testResults) {
      const relative = file.name
        .replaceAll("\\", "/")
        .split("/desktop-app-vue/")
        .at(-1);
      files.add(relative);
      for (const test of file.assertionResults) {
        assert.equal(test.status, "passed");
        tests.add(`${relative}\0${test.fullName}`);
      }
    }
  }
  assert.equal(files.size, 52);
  assert.equal(tests.size, 954);
  platformResults.push({ platform, files: files.size, passed: tests.size });
}
console.log(
  JSON.stringify({
    verified: true,
    archivedFailures: failures.length,
    files: Object.keys(manifest.files).length,
    sourceSnapshots: Object.keys(manifest.sourceSnapshots),
    remoteRuns: manifest.remoteRuns || [],
    platformResults,
    cleanSourceNativeJourneys: 2,
    synthetic: true,
    realBusinessAcceptance: false,
    installedProductAcceptance: false,
    releaseApproval: false,
  }),
);
