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
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = read("manifest.json");
const sources = manifest.sourceSnapshots[manifest.candidateSha];
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`;
const digest = (value) => `sha256:${hash(canonical(value))}`;
for (const [name, expected] of Object.entries(manifest.files))
  assert.equal(
    hash(fs.readFileSync(path.join(directory, name))),
    expected,
    name,
  );
for (const [name, expected] of Object.entries(sources)) {
  assert(!name.startsWith("-") && !name.includes(":"));
  assert.equal(
    hash(
      execFileSync("git", ["show", `${manifest.candidateSha}:${name}`], {
        cwd: root,
        maxBuffer: 16 * 1024 * 1024,
      }),
    ),
    expected,
    name,
  );
}
function common(report) {
  assert.equal(report.status, "passed");
  assert.equal(report.sourceSha, manifest.candidateSha);
  assert.equal(report.sourceStatus, "");
  assert.equal(report.synthetic, true);
  assert.equal(report.realBusinessAcceptance, false);
  assert.equal(report.installedProductAcceptance, false);
  assert.equal(
    report.runnerSha256,
    sources["desktop-app-vue/scripts/project-goal-native-journey.mjs"],
  );
  assert.equal(
    report.artifacts["dist/main/task/project-goal-feature-policy.js"],
    sources["desktop-app-vue/src/main/task/project-goal-feature-policy.js"],
  );
}
function defaultOff(report) {
  common(report);
  assert.equal(report.scenario, "default-off");
  const off = report.defaultOff;
  assert.equal(
    off.helperSha256,
    sources["desktop-app-vue/scripts/lib/project-goal-default-off-journey.cjs"],
  );
  assert.deepEqual(off.feature, { enabled: false, startupOptInRequired: true });
  assert.equal(off.before.startupFlagAbsent, true);
  assert.deepEqual(off.before, off.after);
  assert.deepEqual(off.before.goalTables, []);
  assert.equal(off.before.personalSchedulerDirectory, false);
  assert.equal(off.before.organizationSchedulerDirectory, false);
  assert.equal(off.before.task.id, report.taskId);
  assert.equal(off.before.taskCount, 1);
  assert(off.observationMs >= 70_000);
  assert.equal(off.probes.length, 4);
  for (const probe of off.probes)
    assert.match(probe.error, /GOAL_FEATURE_DISABLED/u);
  assert.deepEqual(
    report.dialogs.map((item) => item.button),
    ["取消", "确认创建"],
  );
  assert(report.dialogs.every((item) => item.expectedTextVerified));
  assert.equal(
    report.createRuns.runs.filter(
      (item) => (item.run ?? item).status === "succeeded",
    ).length,
    1,
  );
}
function optIn(report) {
  common(report);
  assert.equal(report.scenario, "explicit-opt-in");
  const result = report.riskCreate;
  assert.equal(result.status, "passed");
  assert.equal(result.cancelled.receipt.run.status, "cancelled");
  assert.equal(result.originalTaskIds.length, 1);
  assert(result.originalTaskIds.includes(report.taskId));
  assert.equal(result.pauseResumes.length, 2);
  for (const pause of result.pauseResumes) {
    assert.equal(pause.paused.goal.status, "paused");
    assert.equal(pause.paused.monitor.enabled, 0);
    assert(pause.resumed.revision > pause.before.revision);
    assert(pause.resumed.controlGeneration > pause.before.controlGeneration);
  }
  assert.match(
    result.stalePreviewRejection.error,
    /ACTION_GOAL_REVISION_CONFLICT/u,
  );
  const executed = result.executed,
    run = executed.receipt.run;
  assert.equal(run.status, "succeeded");
  assert.equal(run.actionType, "task.create");
  assert.equal(executed.intent.goalId, report.goalId);
  assert.equal(executed.intent.runId, run.id);
  assert.equal(
    executed.intent.reviewDigest,
    digest(result.confirmPrepared.review),
  );
  const linked = result.lineage.actionRuns.find(
    (item) => item.run.id === run.id,
  );
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
  const creation = linked.evidence.find(
    (item) => item.kind === "sqlite-task-create",
  );
  assert.equal(creation.affectedRows, 1);
  assert.equal(creation.createdTaskRef.id, result.createdTask.taskId);
  assert(!result.originalTaskIds.includes(result.createdTask.taskId));
  assert.equal(result.createdTask.status, "pending");
  assert.equal(result.replay.replayed, true);
  assert.deepEqual(result.replay.run, run);
  const risk = result.afterCreationReview.evaluation.tasks.find(
    (item) => item.taskRef.id === report.taskId,
  );
  assert.equal(risk.dueDate, report.fixture.dueDate);
  assert(risk.reasonCodes.includes("OVERDUE_INCOMPLETE_TASK"));
  assert.equal(report.workspace.status, "passed");
  assert.equal(report.acceptance.reports[0].met, false);
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
}
defaultOff(read("local/default-off/journey.json"));
optIn(read("local/opt-in/journey.json"));
const capture = read("local/source-readback.json");
assert.equal(capture.sourceSha, manifest.candidateSha);
assert.equal(capture.sourceStatus, "");
assert.equal(capture.runnerMatchesCandidate, true);
assert.equal(capture.buildArtifactReadbackMatches, true);
for (const [file, failed] of Object.entries({
  "business-actions.json": 1,
  "organization-workflow-final.json": 2,
  "organization-workflow-corrected.json": 1,
}))
  assert.equal(read(`local/tests/${file}`).numFailedTests, failed);
for (const file of [
  "business-actions-renderer.json",
  "organization-authority.json",
  "organization-renderer.json",
  "bridge-and-policy-final.json",
  "bridge-drain-final.json",
  "organization-workflow-passed.json",
  "cli-legacy-off.json",
]) {
  const report = read(`local/tests/${file}`);
  assert.equal(report.numFailedTests, 0, file);
  assert.equal(report.numPendingTests, 0, file);
  assert.equal(report.numPassedTests, report.numTotalTests, file);
}
if (!process.argv.includes("--local")) {
  assert.equal(manifest.remoteRuns.length, 5);
  assert.equal(manifest.guiReports.length, 5);
  for (const record of manifest.remoteRuns) {
    const run = read(record.file);
    assert.equal(run.id, record.id);
    assert.equal(run.head_sha, manifest.candidateSha);
    assert.equal(run.status, "completed");
    assert.equal(run.conclusion, "success");
    const jobs = read(record.jobs).jobs;
    assert(jobs.length > 0);
    for (const job of jobs) assert.equal(job.conclusion, "success");
    const artifacts = read(record.artifacts).artifacts;
    assert(artifacts.length > 0);
    for (const artifact of artifacts) {
      assert.equal(artifact.expired, false);
      assert(artifact.name.includes(manifest.candidateSha));
    }
  }
  const off = manifest.guiReports.filter((name) =>
    name.includes("default-off"),
  );
  assert.equal(off.length, 1);
  defaultOff(read(off[0]));
  const creation = manifest.guiReports.find(
    (name) => name.includes("creation/") && !name.includes("default-off"),
  );
  assert(creation);
  optIn(read(creation));
  for (const name of manifest.guiReports) {
    const report = read(name);
    assert.equal(report.sourceSha, manifest.candidateSha);
    assert.equal(report.sourceStatus, "");
    assert.equal(report.status, "passed");
  }
  const preflights = Object.keys(manifest.files).filter((name) =>
    name.endsWith("dmm-encrypted-goal-preflight.json"),
  );
  assert.equal(preflights.length, 4);
  for (const name of preflights) {
    const probe = read(name);
    assert.equal(probe.passed, true);
    assert(Object.values(probe.checks).every((value) => value === true));
    for (const [source, expected] of Object.entries(probe.sources))
      assert.equal(sources[source], expected, `${name}:${source}`);
  }
  const platforms = [];
  for (const platform of ["ubuntu-latest", "windows-latest", "macos-latest"]) {
    const folder = fs
      .readdirSync(path.join(directory, "ci/host"))
      .find(
        (name) =>
          name.includes(platform) && name.includes(manifest.candidateSha),
      );
    assert(folder, platform);
    const files = new Set(),
      tests = new Set();
    for (const name of [
      "dmm-host.json",
      "dmm-renderer.json",
      "dmm-organization-host.json",
      "dmm-organization-renderer.json",
    ]) {
      const report = read(`ci/host/${folder}/${name}`);
      assert.equal(report.numFailedTests, 0, `${platform}/${name}`);
      assert.equal(report.numPendingTests, 0);
      assert.equal(report.numTotalTests, report.numPassedTests);
      for (const file of report.testResults) {
        const normalized = file.name
          .replaceAll("\\", "/")
          .split("/desktop-app-vue/")
          .at(-1);
        files.add(normalized);
        for (const test of file.assertionResults) {
          assert.equal(test.status, "passed");
          tests.add(`${normalized}:${test.fullName}`);
        }
      }
    }
    assert.equal(files.size, manifest.expectedUniqueFiles, platform);
    assert.equal(tests.size, manifest.expectedUniqueTests, platform);
    platforms.push({ platform, files: files.size, tests: tests.size });
  }
  console.log(
    JSON.stringify({
      remoteRuns: manifest.remoteRuns.length,
      guiReports: manifest.guiReports.length,
      platforms,
    }),
  );
}
console.log(
  JSON.stringify({
    candidateSha: manifest.candidateSha,
    originalFiles: Object.keys(manifest.files).length,
    localOnly: process.argv.includes("--local"),
    verified: true,
  }),
);
