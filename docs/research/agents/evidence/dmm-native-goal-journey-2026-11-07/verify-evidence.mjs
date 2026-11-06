import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../../..");
const hash = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = (file) =>
  JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
const manifest = read("manifest.json");
for (const [file, expected] of Object.entries(manifest.files))
  assert.equal(hash(path.join(directory, file)), expected, file);
for (const [file, expected] of Object.entries(manifest.sources))
  assert.equal(hash(path.join(root, file)), expected, file);
const journey = read("journey.json");
assert.equal(manifest.guiSourceSha, journey.sourceSha);
assert.equal(journey.status, "passed");
assert.equal(journey.synthetic, true);
assert.equal(journey.setupSeeded, true);
assert.equal(journey.realBusinessAcceptance, false);
assert.equal(journey.platform, "win32");
assert.equal(
  journey.artifacts["dist/main/task/project-goal-auth-session.js"],
  hash(
    path.join(
      root,
      "desktop-app-vue/src/main/task/project-goal-auth-session.js",
    ),
  ),
);
assert.equal(
  journey.runnerSha256,
  hash(
    path.join(root, "desktop-app-vue/scripts/project-goal-native-journey.mjs"),
  ),
);
assert.deepEqual(
  journey.dialogs.map(({ title, button }) => [title, button]),
  [
    ["确认创建项目任务", "取消"],
    ["确认创建项目任务", "确认创建"],
    ["确认目标建议：修改描述", "确认修改"],
  ],
);
assert.equal(new Set(journey.dialogs.map((item) => item.pid)).size, 1);
assert.equal(
  journey.createRuns.runs.filter((item) => item.run.status === "succeeded")
    .length,
  1,
);
assert.equal(
  journey.createRuns.runs.filter((item) => item.run.status === "cancelled")
    .length,
  1,
);
for (const dialog of journey.dialogs) {
  assert.equal(dialog.expectedTextVerified, true);
  assert.equal(dialog.windowClass, "#32770");
  assert.equal(dialog.method, "Win32 BM_CLICK");
}
assert.equal(journey.fixture.rows, 1);
assert.equal(journey.fixture.nativeDbOwnedByTemporaryProfile, true);
assert.equal(journey.fixture.encryption.plaintextHeader, false);
assert.equal(journey.fixture.encryption.noKeyReadRejected, true);
assert.equal(journey.initialStatus.goal.schema, "chainlesschain.goal/v2");
assert.equal(journey.initialStatus.history[0].result.riskTaskCount, 1);
assert.equal(journey.intent.executionState, "succeeded");
assert.equal(journey.intent.intent.goalId, journey.goalId);
assert.equal(journey.intent.intent.runId, journey.intent.receipt.run.id);
const linked = journey.lineage.actionRuns.find(
  (item) => item.run.id === journey.intent.intent.runId,
);
assert.deepEqual(
  linked.evidence.map((item) => item.kind),
  [
    "project-risk-review",
    "project-goal-intent",
    "local-user-confirmation",
    "sqlite-task-description-update",
  ],
);
assert.equal(journey.afterActionStatus.history[0].result.riskTaskCount, 1);
assert.equal(journey.acceptance.reports[0].met, false);
assert.equal(journey.acceptance.goal.status, "active");
assert.equal(journey.stopped.goal.status, "abandoned");
assert.equal(Boolean(journey.stopped.monitor.enabled), false);
assert.equal(
  journey.stopped.usage.checks,
  journey.afterStopObservation.usage.checks,
);
assert.deepEqual(journey.stopped.history, journey.afterStopObservation.history);
assert.match(journey.afterEndCheckRejection, /GOAL_MONITOR_NOT_ACTIVE/);
const began = journey.stages.find(
  (item) => item.name === "follow-up-ended-observing-real-70-seconds",
);
const ended = journey.stages.find(
  (item) => item.name === "no-new-checks-after-real-scheduled-interval",
);
assert.ok(Date.parse(ended.at) - Date.parse(began.at) >= 70000);
const files = new Set();
let passed = 0;
for (const file of [
  "desktop-tests.json",
  "organization-tests.json",
  "renderer-tests.json",
]) {
  const report = read(file);
  assert.equal(report.success, true);
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numPendingTests, 0);
  for (const result of report.testResults) {
    assert.equal(result.status, "passed");
    assert.ok(!files.has(result.name), "Reports must not overlap");
    files.add(result.name);
  }
  passed += report.numPassedTests;
}
assert.equal(manifest.totals.files, files.size);
assert.equal(manifest.totals.passed, passed);
for (const file of ["failed-native-auth.json", "failed-acceptance-ipc.json"])
  assert.equal(read(file).status, "failed");
console.log(
  JSON.stringify({
    verified: true,
    files: files.size,
    passed,
    actualWindowsGui: true,
    synthetic: true,
    realBusinessAcceptance: false,
  }),
);
