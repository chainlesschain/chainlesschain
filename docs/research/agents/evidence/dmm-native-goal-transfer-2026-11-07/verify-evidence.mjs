import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../../..");
const require = createRequire(import.meta.url);
const { validateGoalTransfer, verifyGoalTransferCancellation } = require(
  path.join(root, "packages/session-core/lib/goal-transfer-contract.js"),
);
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
const hash = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const manifest = read("manifest.json");
for (const [file, expected] of Object.entries(manifest.files))
  assert.equal(hash(path.join(directory, file)), expected, file);
for (const [file, expected] of Object.entries(manifest.sources))
  assert.equal(hash(path.join(root, file)), expected, file);
const journey = read("journey.json");
assert.equal(journey.status, "passed");
assert.equal(journey.sourceSha, manifest.runtimeSourceSha);
assert.equal(
  journey.runnerSha256,
  hash(
    path.join(
      root,
      "desktop-app-vue/scripts/project-goal-transfer-native-journey.mjs",
    ),
  ),
);
assert.equal(journey.synthetic, true);
assert.equal(journey.realBusinessAcceptance, false);
assert.equal(journey.installedProductAcceptance, false);
assert.equal(journey.pickerProbe.changedDefaultFilename, true);
assert.equal(journey.pickerProbe.actualSelectedExpectedPath, true);
assert.equal(journey.pickerProbe.open.actualSelectedExpectedPath, true);
assert.equal(journey.pickerProbe.businessFileWritten, false);
assert.equal(new Set(journey.native.map((item) => item.pid)).size, 1);
assert.equal(journey.native.length, 22);
for (const native of journey.native) {
  if (native.file) {
    assert.equal(native.filenameVerified, true);
    assert.equal(
      native.method,
      "Win32 filename WM_CHAR + WM_GETTEXT + BM_CLICK",
    );
    assert.ok(!native.file.startsWith("..") && !path.isAbsolute(native.file));
  } else {
    assert.equal(native.expectedTextVerified, true);
    assert.equal(native.method, "Win32 BM_CLICK");
  }
}
assert.equal(journey.frozen.state, "frozen");
assert.equal(journey.originalSha256, journey.restoredSha256);
assert.equal(
  hash(path.join(directory, "original-backup.json")),
  journey.originalSha256,
);
assert.equal(
  hash(path.join(directory, "restored-source.json")),
  journey.restoredSha256,
);
assert.equal(journey.imported.record.source.id, journey.source.id);
assert.equal(journey.imported.goal.status, "paused");
assert.equal(journey.imported.goal.completion, null);
assert.notEqual(journey.imported.goal.id, journey.source.id);
assert.deepEqual(journey.imported.goal.keyResults, journey.source.keyResults);
for (const key of [
  "allowedActionTypes",
  "authorizationRefs",
  "memoryRefs",
  "triggerRefs",
])
  assert.deepEqual(journey.imported.goal[key], []);
assert.equal(journey.cancelled.state, "cancelled");
assert.equal(journey.restored.state, "restored");
assert.equal(journey.roundTripGoalCount, 0);
const packet = validateGoalTransfer(read("transfer.json"));
assert.deepEqual(packet.target, journey.target);
assert.equal(
  createHash("sha256").update(packet.backup).digest("hex"),
  journey.originalSha256,
);
assert.deepEqual(
  verifyGoalTransferCancellation(read("cancellation.json"), packet.target),
  journey.cancellation,
);
assert.equal(
  journey.reexportedCancellationSha256,
  hash(path.join(directory, "cancellation-reexport.json")),
);
assert.equal(
  hash(path.join(directory, "cancellation.json")),
  journey.reexportedCancellationSha256,
);
assert.equal(
  journey.changedTargetRefusal.errorCode,
  "GOAL_TRANSFER_ROLLBACK_HAS_CHANGES",
);
assert.equal(journey.changedTargetRefusal.nativeConfirmationAttempted, true);
assert.equal(journey.changedTargetRefusal.cancellationFileAbsent, true);
assert.equal(journey.changedTargetRefusal.sourceStillFrozen, true);
assert.ok(journey.changedTargetRefusal.revised.revision > 1);
assert.deepEqual(
  journey.changedTargetRefusal.before,
  journey.changedTargetRefusal.after,
);
assert.equal(journey.finalGoalCount, 1);
const forgery = journey.cli.find(
  (item) => item.args.includes("restore-transfer") && item.code === 1,
);
assert.match(
  forgery.stdout + forgery.stderr,
  /GOAL_TRANSFER_CANCELLATION_INVALID/,
);
assert.equal(journey.cli.filter((item) => item.code !== 0).length, 3);
for (const name of [
  "failed-caption-cache.json",
  "failed-picker-readiness.json",
  "failed-open-control.json",
])
  assert.equal(read(name).status, "failed");

// Parent matrices are separate evidence at their own exact SHA. The GUI's
// observed lockfile drift is retained; it does not approve the stricter gates.
const parentSha = "1fa51166b6391b178f8ceba75526b42b349bccf6";
const observations = read("parent-ci/runs.json");
for (const { run } of observations.observations) {
  assert.equal(run.headSha, parentSha);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  for (const job of run.jobs) assert.equal(job.conclusion, "success");
}
const parentGui = read("parent-ci/goal-journey.json");
assert.equal(parentGui.sourceSha, parentSha);
assert.equal(parentGui.status, "passed");
assert.match(parentGui.sourceStatus, /M package-lock\.json/);
assert.deepEqual(
  parentGui.stopped.history,
  parentGui.afterStopObservation.history,
);
const parentResults = [];
for (const platform of ["ubuntu-latest", "windows-latest", "macos-latest"]) {
  const files = new Set(),
    tests = new Set();
  for (const reportName of [
    "dmm-host.json",
    "dmm-renderer.json",
    "dmm-organization-host.json",
  ]) {
    const report = read(`parent-ci/${platform}/${reportName}`);
    assert.equal(report.success, true);
    assert.equal(report.numFailedTests, 0);
    assert.equal(report.numPendingTests, 0);
    for (const file of report.testResults) {
      const name = file.name
        .replaceAll("\\", "/")
        .split("/desktop-app-vue/")
        .at(-1);
      files.add(name);
      for (const test of file.assertionResults) {
        assert.equal(test.status, "passed");
        tests.add(name + "\0" + test.fullName);
      }
    }
  }
  assert.equal(files.size, 52);
  assert.equal(tests.size, 954);
  parentResults.push({ platform, files: files.size, passed: tests.size });
}
for (const file of [
  ".github/workflows/dmm-native-goal-journey.yml",
  ".github/workflows/dmm-native-goal-transfer.yml",
]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.match(source, /npm ci --legacy-peer-deps/);
  assert.match(source, /git diff --cached --exit-code/);
  assert.match(
    source,
    /Recheck source identity after runtime preparation and build/,
  );
  assert.doesNotMatch(source, /uses: \.\/\.github\/actions\/setup-node-deps/);
}
console.log(
  JSON.stringify({
    verified: true,
    nativeTransfer: true,
    exactByteRestore: true,
    revisedTargetRollbackRefused: true,
    parentResults,
    synthetic: true,
    installedProductAcceptance: false,
    realBusinessAcceptance: false,
    stricterCurrentRemoteGates: "separate; inspect remote-checks.json",
  }),
);
