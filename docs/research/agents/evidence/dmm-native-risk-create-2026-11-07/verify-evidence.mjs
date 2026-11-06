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
const digest = (value) => `sha256:${hash(canonical(value))}`;
const manifest = read("manifest.json");
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
function checkCreation(report, requireClean) {
  assert.equal(report.status, "passed");
  assert.equal(report.synthetic, true);
  assert.equal(report.realBusinessAcceptance, false);
  assert.equal(report.installedProductAcceptance, false);
  if (requireClean) {
    assert.equal(report.sourceSha, manifest.candidateSha);
    assert.equal(report.sourceStatus, "");
  }
  const sources = manifest.sourceSnapshots[manifest.candidateSha];
  assert.equal(
    report.runnerSha256,
    sources["desktop-app-vue/scripts/project-goal-native-journey.mjs"],
  );
  assert.equal(
    report.riskCreateHelperSha256,
    sources["desktop-app-vue/scripts/lib/project-goal-risk-create-journey.cjs"],
  );
  assert.equal(
    report.workspaceHelperSha256,
    sources["desktop-app-vue/scripts/lib/project-goal-workspace-journey.cjs"],
  );
  const result = report.riskCreate;
  assert.equal(result.status, "passed");
  assert.equal(result.originalTaskIds.length, 1);
  assert(result.originalTaskIds.includes(report.taskId));
  assert.equal(result.cancelled.receipt.run.actionType, "task.create");
  assert.equal(result.cancelled.receipt.run.status, "cancelled");
  assert(
    !result.cancelled.receipt.evidence.some(
      (item) => item.kind === "sqlite-task-create",
    ),
  );
  assert.equal(result.pauseResumes.length, 2);
  for (const pause of result.pauseResumes) {
    assert.equal(pause.before.status, "active");
    assert.equal(pause.paused.goal.status, "paused");
    assert.equal(pause.paused.monitor.enabled, 0);
    assert.equal(pause.resumed.status, "active");
    assert(pause.resumed.revision > pause.before.revision);
    assert(pause.resumed.controlGeneration > pause.before.controlGeneration);
    assert.equal(pause.resumed.schema, "chainlesschain.goal/v2");
  }
  assert.equal(
    result.stalePreviewRejection.via,
    "actual public authenticated IPC",
  );
  assert.match(
    result.stalePreviewRejection.error,
    /ACTION_GOAL_REVISION_CONFLICT/u,
  );
  const executed = result.executed;
  const run = executed.receipt.run;
  assert.equal(executed.executionState, "succeeded");
  assert.equal(run.actionType, "task.create");
  assert.equal(run.status, "succeeded");
  assert.equal(run.id, executed.intent.runId);
  assert.equal(executed.intent.goalId, report.goalId);
  assert.equal(executed.intent.taskType, "query_info");
  assert.equal(
    executed.intent.reviewDigest,
    digest(result.confirmPrepared.review),
  );
  assert.equal(
    executed.intent.preview.request.input.riskReview.id,
    executed.intent.reviewId,
  );
  assert.equal(result.lineage.review.id, executed.intent.reviewId);
  const linked = result.lineage.actionRuns.find(
    (item) => item.run.id === run.id,
  );
  assert(linked);
  assert.deepEqual(
    linked.evidence.map((item) => item.kind),
    [
      "project-risk-review",
      "project-goal-intent",
      "local-user-confirmation",
      "sqlite-task-create",
    ],
  );
  for (const item of linked.evidence)
    assert.equal(
      run.evidenceRefs.find((ref) => ref.id === item.id)?.digest,
      digest(item),
    );
  const mutation = linked.evidence.find(
    (item) => item.kind === "sqlite-task-create",
  );
  assert.equal(mutation.affectedRows, 1);
  assert.equal(mutation.createdTaskRef.id, result.createdTask.taskId);
  assert(!result.originalTaskIds.includes(result.createdTask.taskId));
  assert.equal(result.createdTask.projectId, report.projectId);
  assert.equal(result.createdTask.description, executed.intent.description);
  assert.equal(result.createdTask.status, "pending");
  assert.equal(result.replay.replayed, true);
  assert.deepEqual(result.replay.run, run);
  assert.equal(result.afterCreationStatus.history[0].result.riskTaskCount, 1);
  assert(
    result.afterCreationReview.evaluation.taskRefs.some(
      (ref) => ref.id === report.taskId,
    ),
  );
  const originalRisk = result.afterCreationReview.evaluation.tasks.find(
    (item) => item.taskRef.id === report.taskId,
  );
  assert(originalRisk);
  assert.equal(originalRisk.dueDate, report.fixture.dueDate);
  assert(originalRisk.reasonCodes.includes("OVERDUE_INCOMPLETE_TASK"));
  assert(
    JSON.stringify(result.afterCreationReview.evaluation).includes(
      "OVERDUE_INCOMPLETE_TASK",
    ),
  );
  assert.equal(result.afterCreationStatus.goal.status, "active");
  assert.equal(result.afterCreationStatus.goal.completion, null);
  assert.equal(report.workspace.status, "passed");
  assert.equal(report.acceptance.reports[0].met, false);
  assert.equal(report.acceptance.goal.status, "active");
  assert.equal(report.afterStopObservation.goal.status, "abandoned");
  assert.equal(report.afterStopObservation.monitor.enabled, 0);
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
  assert.equal(report.dialogs.length, 5);
  const creationDialogs = report.dialogs.filter(
    (item) => item.title === "确认目标建议：创建任务",
  );
  assert.deepEqual(
    creationDialogs.map((item) => item.button),
    ["取消", "确认创建"],
  );
  assert(creationDialogs.every((item) => item.expectedTextVerified === true));
}
for (const name of manifest.exploratoryReports)
  checkCreation(read(name), false);
for (const name of manifest.acceptedReports) checkCreation(read(name), true);
const capture = read("local-candidate/source-readback.json");
assert.equal(capture.sourceSha, manifest.candidateSha);
assert.equal(capture.sourceStatus, "");
for (const [name, value] of Object.entries(capture))
  if (typeof value === "boolean") assert.equal(value, true, name);
assert.equal(manifest.remoteRuns.length, 4);
for (const record of manifest.remoteRuns) {
  const run = read(record.file);
  assert.equal(run.databaseId, record.id);
  assert.equal(run.headSha, manifest.candidateSha);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  for (const job of run.jobs) assert.equal(job.conclusion, "success");
}
for (const [area, folder] of [
  ["creation", "dmm-native-goal-creation"],
  ["workspace", "dmm-native-goal-workspace"],
  ["baseline", "dmm-native-goal-journey"],
]) {
  const report = read(`ci/${area}/${folder}/journey.json`);
  assert.equal(report.sourceSha, manifest.candidateSha);
  assert.equal(report.sourceStatus, "");
  assert.equal(report.status, "passed");
  const probe = read(`ci/${area}/dmm-encrypted-goal-preflight.json`);
  assert.equal(probe.passed, true);
  assert(Object.values(probe.checks).every((value) => value === true));
  for (const [name, expected] of Object.entries(probe.sources))
    assert.equal(
      manifest.sourceSnapshots[manifest.candidateSha][name],
      expected,
    );
}
const platforms = [];
for (const platform of ["ubuntu-latest", "windows-latest", "macos-latest"]) {
  const folder = fs
    .readdirSync(path.join(directory, manifest.hostReports))
    .find(
      (name) => name.includes(platform) && name.includes(manifest.candidateSha),
    );
  assert(folder);
  const files = new Set(),
    tests = new Set();
  for (const name of [
    "dmm-host.json",
    "dmm-renderer.json",
    "dmm-organization-host.json",
  ]) {
    const report = read(`${manifest.hostReports}/${folder}/${name}`);
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
  assert.equal(tests.size, 958);
  platforms.push({ platform, files: files.size, passed: tests.size });
}
console.log(
  JSON.stringify({
    verified: true,
    candidateSha: manifest.candidateSha,
    acceptedReports: manifest.acceptedReports,
    platforms,
    synthetic: true,
    realBusinessAcceptance: false,
    installedProductAcceptance: false,
    liveModalPauseAcceptance: false,
    releaseApproval: false,
  }),
);
