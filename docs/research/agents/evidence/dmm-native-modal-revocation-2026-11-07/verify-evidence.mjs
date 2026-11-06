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
  assert.equal(
    report.nativeDialogHelperSha256,
    sources["desktop-app-vue/scripts/lib/project-goal-native-dialog.cjs"],
  );
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
function optIn(report, expectedDialogs = 5) {
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
  assert.equal(report.dialogs.length, expectedDialogs);
}

function modal(report, clean = true) {
  if (clean) optIn(report, 11);
  else {
    assert.equal(report.status, "passed");
    assert.notEqual(report.sourceStatus, "");
    assert.equal(report.synthetic, true);
    assert.equal(report.realBusinessAcceptance, false);
    assert.equal(report.installedProductAcceptance, false);
    assert.equal(report.dialogs.length, 11);
  }
  if (clean)
    assert.equal(
      report.modalRevocationHelperSha256,
      sources[
        "desktop-app-vue/scripts/lib/project-goal-modal-revocation-journey.cjs"
      ],
    );
  assert.equal(report.modalRevocation.status, "passed");
  const cases = report.modalRevocation.cases;
  assert.equal(cases.length, 6);
  const ids = new Set(),
    runs = new Set();
  for (const item of cases) {
    ids.add(item.id);
    assert.equal(item.status, "passed");
    assert.equal(item.id, `${item.actionType}:${item.change}`);
    assert(
      ["task.create", "task.update-description"].includes(item.actionType),
    );
    assert(
      ["pause", "revoke-action", "same-did-reauthentication"].includes(
        item.change,
      ),
    );
    assert.equal(item.mutationVia, "actual public authenticated IPC");
    assert.equal(item.prepared.intent.goalId, report.goalId);
    assert.equal(item.prepared.intent.goalRevision, item.beforeGoal.revision);
    const receipt = item.nativeReceipt;
    assert.equal(receipt.method, "Win32 BM_CLICK");
    assert.equal(receipt.expectedTextVerified, true);
    assert.equal(
      receipt.button,
      item.actionType === "task.create"
        ? "\u786e\u8ba4\u521b\u5efa"
        : "\u786e\u8ba4\u4fee\u6539",
    );
    assert.equal(receipt.pid, report.nativePid ?? report.dialogs[0].pid);
    assert.deepEqual(receipt.beforeConcurrentOperation, item.modalObserved);
    const before = receipt.beforeConcurrentOperation,
      after = receipt.afterConcurrentOperation;
    assert.match(before.hwnd, /^[0-9]+$/u);
    for (const key of [
      "hwnd",
      "pid",
      "title",
      "button",
      "windowClass",
      "expectedTextVerified",
    ])
      assert.equal(before[key], after[key], `${item.id}:${key}`);
    assert.equal(before.windowClass, "#32770");
    assert.equal(before.expectedTextVerified, true);
    assert(Date.parse(before.observedAt) <= Date.parse(item.changeStartedAt));
    assert(
      Date.parse(item.changeStartedAt) <= Date.parse(item.changeFinishedAt),
    );
    assert(Date.parse(item.changeFinishedAt) <= Date.parse(after.observedAt));
    assert(Date.parse(after.observedAt) <= Date.parse(receipt.at));
    assert(
      report.dialogs.some((record) => canonical(record) === canonical(receipt)),
    );
    assert.deepEqual(item.beforeTasks, item.afterTasks);
    assert.equal(item.beforeTasks.length, 2);
    assert(item.beforeTasks.some((task) => task.taskId === report.taskId));
    const run = item.denied.receipt.run;
    assert.equal(run.status, "denied");
    assert.equal(run.actionType, item.actionType);
    assert.equal(run.id, item.denied.intent.runId);
    assert.equal(item.denied.intent.id, item.prepared.intent.id);
    assert.equal(
      run.invocationDigest,
      item.prepared.intent.preview.request.invocationDigest,
    );
    assert.equal(
      run.actionDigest,
      item.prepared.intent.preview.request.actionDigest,
    );
    assert.equal(run.executionRef, null);
    runs.add(run.id);
    for (const evidence of item.denied.receipt.evidence) {
      assert(
        !["sqlite-task-create", "sqlite-task-description-update"].includes(
          evidence.kind,
        ),
      );
      assert.equal(
        run.evidenceRefs.find((ref) => ref.id === evidence.id)?.digest,
        digest(evidence),
      );
    }
    const approvals = item.denied.receipt.evidence.filter((evidence) =>
      ["local-user-confirmation", "approval-gate-decision"].includes(
        evidence.kind,
      ),
    );
    assert.equal(approvals.length, 1);
    assert.equal(item.afterGoal.completion, null);
    if (item.change === "same-did-reauthentication") {
      assert.equal(item.changed.locked.actorDid, null);
      assert(item.changed.locked.generation > item.beforeAuth.generation);
      assert.equal(item.changed.restored.actorDid, item.beforeAuth.actorDid);
      assert.equal(item.beforeAuth.actorDid, item.beforeGoal.ownerRef);
      assert(item.changed.restored.generation > item.changed.locked.generation);
      assert.equal(
        item.changed.via,
        "actual public auth.logout and auth.verifyPassword IPC",
      );
      assert.equal(item.afterGoal.revision, item.beforeGoal.revision);
      assert.equal(
        item.afterGoal.controlGeneration,
        item.beforeGoal.controlGeneration,
      );
      assert.equal(approvals[0].kind, "approval-gate-decision");
      assert.equal(approvals[0].via, "confirm-error");
      assert.equal(approvals[0].decision, "deny");
    } else {
      assert(item.afterGoal.revision > item.beforeGoal.revision);
      assert(
        item.afterGoal.controlGeneration > item.beforeGoal.controlGeneration,
      );
      assert.equal(approvals[0].kind, "local-user-confirmation");
      assert.equal(approvals[0].via, "user-confirm");
      assert.equal(approvals[0].decision, "allow");
      if (item.change === "pause") {
        assert.equal(item.changed.goal.status, "paused");
        assert.equal(item.changed.monitor.enabled, 0);
      } else assert(!item.changed.allowedActionTypes.includes(item.actionType));
    }
  }
  assert.equal(ids.size, 6);
  assert.equal(runs.size, 6);
  assert.equal(
    report.dialogs.filter((receipt) => receipt.beforeConcurrentOperation)
      .length,
    6,
  );
  assert.equal(report.modalRevocation.afterRecovery.goal.status, "active");
  assert.equal(report.modalRevocation.afterRecovery.goal.completion, null);
  assert.equal(
    report.modalRevocation.afterRecovery.history[0].result.riskTaskCount,
    1,
  );
}
modal(read("local/candidate-passed/journey.json"));
modal(read("local/exploratory-passed/journey.json"), false);
const capture = read("local/source-readback.json");
assert.equal(capture.sourceSha, manifest.candidateSha);
assert.equal(capture.sourceStatus, "");
for (const key of [
  "runnerMatchesCandidate",
  "modalHelperMatchesCandidate",
  "nativeDriverMatchesCandidate",
  "artifactReadbackMatches",
])
  assert.equal(capture[key], true);
for (const file of [
  "local/boot-exploratory-failed/journey.json",
  "local/boot-candidate-failed/journey.json",
]) {
  const report = read(file);
  assert.equal(report.status, "failed");
  assert.equal(report.stages.length, 0);
  assert.equal(report.dialogs.length, 0);
  assert.match(
    report.error.message,
    /firstWindow: Target page, context or browser has been closed/u,
  );
}
const failedCandidate = read("local/boot-candidate-failed/journey.json");
assert.equal(failedCandidate.sourceSha, manifest.candidateSha);
assert.equal(failedCandidate.sourceStatus, "");
assert.equal(failedCandidate.nativePid, 27464);
const preparation = read("local/preparation-exploratory-failed/journey.json");
assert.equal(preparation.status, "failed");
assert.match(
  preparation.error.message,
  /exactly one current suggestion required/u,
);
assert(preparation.sourceStatus);
for (const [source, expected] of Object.entries(
  read("local/early-source/manifest.json"),
)) {
  const name = source.split("/").at(-1);
  assert.equal(
    hash(fs.readFileSync(path.join(directory, "local/early-source", name))),
    expected,
  );
}
const recovered = read(
  "local/recovered-exploratory-source/reconstruction.json",
);
assert.equal(recovered.runtimeRecordedHashMatched, true);
assert.equal(recovered.removedAssertionBlocks, 2);
assert.equal(recovered.inputCandidate, manifest.candidateSha);
const helper = fs.readFileSync(
  path.join(
    directory,
    "local/recovered-exploratory-source/project-goal-modal-revocation-journey.cjs",
  ),
);
assert.equal(hash(helper), recovered.sha256);
assert.equal(
  recovered.sha256,
  read("local/exploratory-passed/journey.json").modalRevocationHelperSha256,
);
const boot = read("local/startup-observations.json");
assert.equal(boot.rootCauseResolved, false);
assert.equal(boot.events.length, 2);
for (const event of boot.events) assert.equal(event.kind, "AppHangB1");
const preflight = read("local/encrypted-preflight.json");
assert.equal(preflight.passed, true);
assert(Object.values(preflight.checks).every((value) => value === true));
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
  const modalReport = manifest.guiReports.find((name) =>
    name.startsWith("ci/modal/"),
  );
  assert(modalReport);
  modal(read(modalReport));
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
