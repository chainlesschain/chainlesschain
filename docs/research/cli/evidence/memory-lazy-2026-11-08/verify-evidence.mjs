import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const records = new Map();
for (const [name, entry] of Object.entries(manifest.files)) {
  const file = path.resolve(directory, entry.artifact);
  assert.ok(file.startsWith(path.join(directory, "raw") + path.sep));
  const compressed = fs.readFileSync(file);
  assert.equal(compressed.length, entry.compressedBytes, name);
  assert.equal(digest(compressed), entry.compressedSha256, name);
  const bytes = gunzipSync(compressed);
  assert.equal(bytes.length, entry.bytes, name);
  assert.equal(digest(bytes), entry.sha256, name);
  records.set(name, bytes);
}
const read = (name) =>
  JSON.parse(
    records
      .get(name)
      .toString("utf8")
      .replace(/^\uFEFF/u, ""),
  );
const checkSources = (sourceDigests) => {
  for (const [relative, sha] of Object.entries(sourceDigests)) {
    const source = manifest.sources[relative];
    assert.ok(source, relative);
    assert.equal(source.sha256, sha.replace(/^sha256:/u, ""));
    assert.equal(
      digest(
        gunzipSync(fs.readFileSync(path.join(directory, source.artifact))),
      ),
      source.sha256,
    );
  }
};

const counts = {
  queries: 0,
  recovery: 0,
  cancelled: 0,
  mixedRounds: 0,
  mutations: 0,
};
for (const [name, counter] of [
  ["query100-frozen.json", "queries"],
  ["recovery100-frozen.json", "recovery"],
]) {
  const report = read(name);
  assert.equal(report.complete, true);
  assert.equal(report.tiers.length, 3);
  assert.equal(report.samples, 100);
  for (const tier of report.tiers) {
    assert.equal(Object.keys(tier.groups).length, 2);
    for (const group of Object.values(tier.groups)) {
      assert.equal(group.complete, true);
      assert.equal(group.samples.length, 100);
      for (const sample of group.samples) {
        assert.equal(sample.count, 20);
        assert.equal(sample.rowsDigest, tier.expectedDigest);
        counts[counter]++;
      }
    }
  }
  const sourceDigests = {};
  for (const [key, sha] of Object.entries(report.implementationSha256)) {
    const relative =
      key === "benchmark.mjs"
        ? "memory-query-index-benchmark.mjs"
        : key === "fixture-generator.mjs"
          ? "persistent-capacity-benchmark.mjs"
          : key.startsWith("kernel/")
            ? "../../context-memory-kernel/lib/" + key.slice(7)
            : ["with-file-lock.js", "secure-file-identity.js"].includes(key)
              ? "../src/lib/" + key
              : "../src/lib/context-memory-kernel/" + key;
    sourceDigests[relative] = sha;
  }
  checkSources(sourceDigests);
}
assert.equal(
  read("query100.json").complete,
  false,
  "source-changing attempt must remain incomplete",
);

const stop = read("stop100-frozen.json");
assert.equal(stop.targetMet, true);
assert.equal(stop.tiers.length, 3);
for (const tier of stop.tiers) {
  assert.deepEqual(Object.keys(tier.modes).sort(), [
    "validate-disk",
    "verified-memory",
  ]);
  for (const mode of Object.values(tier.modes)) {
    assert.equal(mode.samples.length, 100);
    assert.equal(mode.authorityUnchanged, true);
    assert.equal(mode.lateSuccessfulCompletion, 0);
    for (const sample of mode.samples) {
      assert.equal(sample.outcome, "aborted");
      assert.equal(sample.lockReleased, true);
      assert.ok(sample.stopDeliveryDelayMs <= 500);
      assert.ok(sample.stopAcknowledgementMs <= 500);
      counts.cancelled++;
    }
  }
}
checkSources(stop.sourceDigests);
const mixed = read("mixed100-frozen.json");
assert.equal(mixed.complete, true);
assert.equal(mixed.tiers.length, 3);
for (const tier of mixed.tiers) {
  for (const field of [
    "complete",
    "finalAuditVerified",
    "finalDeletionVisibilityVerified",
    "lockReleased",
  ])
    assert.equal(tier[field], true);
  assert.equal(tier.rounds.length, 100);
  assert.equal(tier.finalActiveRecords, tier.count - 200);
  for (const round of tier.rounds) {
    assert.equal(round.generationsVerified, true);
    assert.equal(round.allEightOperationsOverlap, true);
    assert.equal(round.results.length, 8);
    assert.equal(round.results.filter((r) => r.role === "reader").length, 4);
    const changes = round.results.flatMap((r) => r.mutations || []);
    assert.equal(changes.length, 6);
    counts.mutations += changes.length;
    counts.mixedRounds++;
  }
}
checkSources(mixed.sourceDigests);
assert.deepEqual(counts, {
  queries: 600,
  recovery: 600,
  cancelled: 600,
  mixedRounds: 300,
  mutations: 1800,
});

assert.equal(read("encrypted-electron-probe.json").passed, false);
const preflight = read("encrypted-electron-probe-fixed.json");
assert.equal(preflight.passed, true);
assert.ok(Object.values(preflight.checks).every((value) => value === true));
for (const name of [
  "workspace-gui-diagnostic-20261108",
  "workspace-gui-lazy-20261108",
])
  assert.equal(read(name + "/journey.json").status, "failed");
const gui = read("workspace-gui-isolated-20261108/journey.json");
assert.equal(gui.status, "passed");
assert.equal(gui.workspace.status, "passed");
assert.equal(gui.isolatedWorkingDirectory, true);
assert.equal(gui.realBusinessAcceptance, false);
assert.equal(gui.installedProductAcceptance, false);
for (const field of [
  "error",
  "persistenceError",
  "watchdogExpired",
  "closeError",
  "diagnosticsError",
  "unexpectedFailure",
])
  assert.equal(gui[field], undefined);
const stages = new Map(
  gui.stages.map((stage) => [stage.name, Date.parse(stage.at)]),
);
for (const name of [
  "real-password-login-and-did",
  "native-cancel-no-write-and-single-create",
  "goal-native-confirmation-and-persisted-action-lineage",
  "workspace-memory-create-and-correct-through-vue",
  "workspace-memory-revoke-cancel-delete-and-persisted-body-free-history",
  "workspace-notice-real-center-mark-read-and-authorized-deep-link",
  "workspace-notice-dedup-silent-checks-and-quiet-policy-persistence",
  "description-success-does-not-clear-risk-or-complete-goal",
  "native-close-resolved",
])
  assert.ok(stages.has(name), name);
const stopMs =
  stages.get("no-new-checks-after-real-scheduled-interval") -
  stages.get("follow-up-ended-observing-real-70-seconds");
assert.ok(stopMs >= 70000);
assert.equal(gui.stopped.usage.checks, gui.afterStopObservation.usage.checks);
assert.deepEqual(gui.stopped.history, gui.afterStopObservation.history);
assert.match(gui.afterEndCheckRejection, /GOAL_MONITOR_NOT_ACTIVE/u);
const workspace = gui.workspace;
const first = workspace.created.items.find(
  (item) => item.record?.category === "user-fact",
);
const successor = workspace.corrected.items.find(
  (item) => item.record?.category === "execution-note",
);
assert.ok(first && successor);
assert.notEqual(first.memoryId, successor.memoryId);
assert.equal(
  workspace.corrected.items.find((item) => item.memoryId === first.memoryId)
    .record,
  null,
);
for (const state of ["revoked", "deleted"]) {
  const item = workspace[state].items.find(
    (row) => row.memoryId === successor.memoryId,
  );
  assert.equal(item.grantState, state);
  assert.equal(item.record, null);
}
assert.deepEqual(workspace.operations.items.map((item) => item.type).sort(), [
  "correct",
  "create",
  "delete",
  "revoke",
]);
assert.ok(
  workspace.operations.items.every((item) => item.status === "complete"),
);
const notice = workspace.noticeBeforeRead[0];
assert.equal(notice.is_read, 0);
assert.equal(
  workspace.noticeAfterRead.find((item) => item.id === notice.id).is_read,
  1,
);
assert.equal(
  workspace.noticeAfterRepeat.find((item) => item.id === notice.id).is_read,
  1,
);
assert.equal(workspace.opened.success, true);
assert.equal(workspace.opened.target.goalId, gui.goalId);
assert.equal(workspace.silentPolicy.mode, "silent");
assert.equal(workspace.silentStatus.history[0].result.riskTaskCount, 1);
assert.deepEqual(workspace.quietHoursPolicy.quietHours, {
  timeZone: "Asia/Shanghai",
  startMinute: 1320,
  endMinute: 480,
});
assert.equal(workspace.finalGoal.status, "active");
assert.equal(workspace.finalGoal.completion, null);
const guards = new Set([
  "Error: GOAL_EXTENSION_NOT_ADMITTED",
  "Error: ACTION_GOAL_NOT_ACTIVE",
  "Error: GOAL_MONITOR_NOT_ACTIVE",
]);
assert.ok(gui.ipcErrors.every((error) => guards.has(error.message)));
assert.equal(gui.dialogs.length, 3);
assert.equal(manifest.productionAdmission, false);
assert.equal(manifest.finalSourceSloVerified, false);
console.log(
  JSON.stringify({
    archivedFiles: records.size,
    sourceBindings: Object.keys(manifest.sources).length,
    ...counts,
    windowsGui: "passed",
    actualStopMs: stopMs,
    finalSourceSloVerified: false,
    productionAdmission: false,
  }),
);
