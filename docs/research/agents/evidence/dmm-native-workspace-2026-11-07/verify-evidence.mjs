import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../../..");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const manifest = read("manifest.json");
assert(["in-progress", "passed"].includes(manifest.phase));
if (manifest.phase === "passed")
  assert(manifest.successfulWorkspaceReports.length > 0);
for (const [name, expected] of Object.entries(manifest.files))
  assert.equal(
    hash(fs.readFileSync(path.join(directory, name))),
    expected,
    name,
  );
for (const [sha, files] of Object.entries(manifest.sourceSnapshots)) {
  assert.match(sha, /^[a-f0-9]{40}$/u);
  for (const [name, expected] of Object.entries(files)) {
    assert(!name.includes(":") && !name.startsWith("-"));
    assert.equal(
      hash(
        execFileSync("git", ["show", `${sha}:${name}`], {
          cwd: root,
          maxBuffer: 16 * 1024 * 1024,
        }),
      ),
      expected,
      `${sha}:${name}`,
    );
  }
}
for (const [name, passed, failed] of [
  ["dmm-memory-clone-before.json", 19, 1],
  ["dmm-notification-wrapper-before.json", 30, 2],
  ["dmm-notice-keepalive-before.json", 22, 1],
  ["dmm-workspace-host-after.json", 372, 33],
  ["dmm-workspace-host-native-permissions.json", 405, 0],
  ["dmm-workspace-renderer-keepalive.json", 293, 0],
]) {
  const report = read(name);
  assert.equal(report.numPassedTests, passed, name);
  assert.equal(report.numFailedTests, failed, name);
  assert.equal(report.success, failed === 0, name);
}
for (const name of manifest.exploratoryFailures) {
  const report = read(name);
  assert.equal(report.status, "failed", name);
  assert.equal(report.synthetic, true, name);
  assert.equal(report.realBusinessAcceptance, false, name);
}
const checkWorkspace = (report, documentationChangesOnly = false) => {
  assert.equal(report.status, "passed");
  assert.equal(report.sourceSha, manifest.runtimeCandidateSha);
  if (documentationChangesOnly) {
    for (const line of report.sourceStatus.split("\n").filter(Boolean))
      assert.match(
        line.trim(),
        /^(?:M|\?\?)\s+docs\/research\/agents\/evidence\/dmm-native-workspace-2026-11-07\//u,
      );
  } else assert.equal(report.sourceStatus, "");
  assert.equal(report.synthetic, true);
  assert.equal(report.realBusinessAcceptance, false);
  assert.equal(report.installedProductAcceptance, false);
  const sources = manifest.sourceSnapshots[report.sourceSha];
  assert.equal(
    report.runnerSha256,
    sources["desktop-app-vue/scripts/project-goal-native-journey.mjs"],
  );
  assert.equal(
    report.workspaceHelperSha256,
    sources["desktop-app-vue/scripts/lib/project-goal-workspace-journey.cjs"],
  );
  assert.equal(
    report.intent.intent.reviewDigest,
    `sha256:${hash(canonical(report.intentSourceReview))}`,
  );
  assert.equal(report.lineage.review.id, report.intent.intent.reviewId);
  const action = report.lineage.actionRuns.find(
    (item) => item.run.id === report.intent.receipt.run.id,
  );
  assert(action);
  assert.deepEqual(
    action.evidence.map((item) => item.kind),
    [
      "project-risk-review",
      "project-goal-intent",
      "local-user-confirmation",
      "sqlite-task-description-update",
    ],
  );
  const workspace = report.workspace;
  assert.equal(workspace.status, "passed");
  assert.equal(workspace.created.items.filter((item) => item.record).length, 1);
  assert.equal(
    workspace.corrected.items.filter((item) => item.record).length,
    1,
  );
  assert(workspace.revoked.items.every((item) => item.record === null));
  assert(workspace.deleted.items.every((item) => item.record === null));
  assert(workspace.deleted.items.some((item) => item.grantState === "deleted"));
  assert.deepEqual(workspace.operations.items.map((item) => item.type).sort(), [
    "correct",
    "create",
    "delete",
    "revoke",
  ]);
  assert(
    workspace.operations.items.every((item) => item.status === "complete"),
  );
  for (const item of [...workspace.created.items, ...workspace.corrected.items])
    if (item.record)
      assert(
        !JSON.stringify(workspace.operations).includes(item.record.content),
      );
  assert.equal(workspace.opened.success, true);
  assert.equal(workspace.opened.target.goalId, report.goalId);
  assert.equal(workspace.opened.target.projectId, report.projectId);
  assert(workspace.noticeAfterRead.some((row) => row.is_read === 1));
  assert.equal(workspace.silentPolicy.mode, "silent");
  assert.equal(workspace.silentStatus.history[0].result.riskTaskCount, 1);
  assert.deepEqual(workspace.quietHoursPolicy.quietHours, {
    timeZone: "Asia/Shanghai",
    startMinute: 1320,
    endMinute: 480,
  });
  assert.equal(workspace.finalGoal.status, "active");
  assert.equal(workspace.finalGoal.completion, null);
  assert.equal(report.afterStopObservation.goal.status, "abandoned");
  assert.equal(
    report.afterStopObservation.usage.checks,
    report.stopped.usage.checks,
  );
  const start = report.stages.find(
    (item) => item.name === "follow-up-ended-observing-real-70-seconds",
  );
  const end = report.stages.find(
    (item) => item.name === "no-new-checks-after-real-scheduled-interval",
  );
  assert(Date.parse(end.at) - Date.parse(start.at) >= 70_000);
};
for (const name of manifest.successfulWorkspaceReports)
  checkWorkspace(read(name));
for (const name of manifest.localWorkspaceReports || [])
  checkWorkspace(read(name), true);
if (manifest.localWorkspaceReports?.length) {
  const capture = read("local-workspace/source-readback.json");
  assert.equal(capture.sourceSha, manifest.runtimeCandidateSha);
  for (const [name, value] of Object.entries(capture))
    if (typeof value === "boolean") assert.equal(value, true, name);
}
for (const record of manifest.remoteRuns) {
  const run = read(record.file);
  assert.equal(run.databaseId, record.id);
  assert.equal(run.headSha, record.sha);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, record.conclusion);
  for (const job of run.jobs) assert.equal(job.conclusion, record.conclusion);
}
if (manifest.phase === "passed") {
  assert.equal(manifest.currentRemoteRunIds.length, 4);
  for (const id of manifest.currentRemoteRunIds) {
    const run = manifest.remoteRuns.find((item) => item.id === id);
    assert(run);
    assert.equal(run.sha, manifest.runtimeCandidateSha);
    assert.equal(run.conclusion, "success");
  }
  for (const [area, name] of [
    ["goal", "dmm-native-goal-journey"],
    ["transfer", "dmm-native-goal-transfer"],
  ]) {
    const report = read(`ci-8ec/${area}/${name}/journey.json`);
    assert.equal(report.sourceSha, manifest.runtimeCandidateSha);
    assert.equal(report.sourceStatus, "");
    assert.equal(report.status, "passed");
  }
  for (const area of ["workspace", "goal", "transfer"]) {
    const probe = read(`ci-8ec/${area}/dmm-encrypted-goal-preflight.json`);
    assert.equal(probe.passed, true);
    assert(Object.values(probe.checks).every((value) => value === true));
    for (const [name, expected] of Object.entries(probe.sources))
      assert.equal(
        manifest.sourceSnapshots[manifest.runtimeCandidateSha][name],
        expected,
      );
  }
}
const platformResults = [];
for (const set of manifest.platformReportSets) {
  for (const platform of ["ubuntu-latest", "windows-latest", "macos-latest"]) {
    const folder = fs
      .readdirSync(path.join(directory, set.directory))
      .find((name) => name.includes(platform) && name.includes(set.sha));
    assert(folder);
    const files = new Set(),
      tests = new Set();
    for (const name of [
      "dmm-host.json",
      "dmm-renderer.json",
      "dmm-organization-host.json",
    ]) {
      const report = read(`${set.directory}/${folder}/${name}`);
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
    assert.equal(tests.size, set.passed);
    platformResults.push({
      sha: set.sha,
      platform,
      files: files.size,
      passed: tests.size,
    });
  }
}
console.log(
  JSON.stringify({
    verified: true,
    phase: manifest.phase,
    files: Object.keys(manifest.files).length,
    candidate: manifest.runtimeCandidateSha,
    successfulWorkspaceReports: manifest.successfulWorkspaceReports,
    platformResults,
    synthetic: true,
    realBusinessAcceptance: false,
    installedProductAcceptance: false,
    overnightDeliveryAcceptance: false,
    releaseApproval: false,
  }),
);
