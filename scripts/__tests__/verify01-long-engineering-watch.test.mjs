import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  advanceObservation,
  digest,
  main,
  validateProcessProof,
  validateSnapshot,
} from "../verify01-long-engineering-watch.mjs";

const origin = Date.parse("2026-10-13T00:00:00Z");
const binding = {
  sourceCommit: "a".repeat(40),
  platform: "win32",
  architecture: "x64",
  nodeVersion: "v22.12.0",
  reportStartedAt: new Date(origin).toISOString(),
  processId: 42,
  startIdentity: "original-process-start",
  executable: "C:\\node.exe",
  commandDigest: "sha256:command",
  bootIdentity: "windows-process-start",
};
function seal(report) {
  delete report.evidenceDigest;
  report.evidenceDigest = digest(report);
  return report;
}
function sample(seconds = 60) {
  return seal({
    schema: "chainlesschain.session-message-reliability-soak/v1",
    status: "running",
    releaseCommit: binding.sourceCommit,
    headSha: binding.sourceCommit,
    expectedSha: binding.sourceCommit,
    exactShaVerified: true,
    qualifyingEvidence: false,
    source: { clean: true, changeCount: 0 },
    runner: {
      platform: "win32",
      architecture: "x64",
      nodeVersion: "v22.12.0",
      operatingSystem: "windows",
    },
    execution: { provider: "local" },
    profile: { mode: "formal", durationSeconds: 86_400 },
    startedAt: binding.reportStartedAt,
    checkpointedAt: new Date(origin + seconds * 1_000).toISOString(),
    continuousDurationSeconds: seconds,
    violations: [],
    totals: {
      cycles: seconds,
      lostMessages: 0,
      duplicateEffects: 0,
      custodyDuplicateEffects: 0,
      invariantViolations: 0,
    },
  });
}
function check(report, options = {}) {
  return validateSnapshot(report, binding, {
    now: origin + report.continuousDurationSeconds * 1_000,
    ...options,
  });
}

test("observing a live report preserves the unmonitored prefix and local scope", () => {
  const report = sample();
  const state = advanceObservation(null, report, check(report), {
    now: origin + 60_000,
  });
  assert.equal(state.unmonitoredPrefixSeconds, 60);
  assert.equal(state.monitoringCompleteFromLaunch, false);
  assert.equal(state.formalHostAcceptance, false);
  assert.equal(state.observationsCreated, false);
});
test("one second cannot become a completed 24 hour workload", () => {
  const report = sample(1);
  report.status = "passed";
  report.completedAt = report.checkpointedAt;
  report.source.finalClean = true;
  report.source.finalChangeCount = 0;
  assert.throws(() => check(seal(report)), { code: "COMPLETION_INCOMPLETE" });
});
test("a changed report is rejected before any checkpoint can be recorded", () => {
  const report = sample();
  report.continuousDurationSeconds = 86_400;
  assert.throws(() => check(report), { code: "EVIDENCE_DIGEST_INVALID" });
});
test("a recomputed digest cannot legitimize another schema", () => {
  const report = sample();
  report.schema = "unrelated-report";
  assert.throws(() => check(seal(report)), { code: "SCHEMA_INVALID" });
});
test("future and stale checkpoints are rejected even with correct digests", () => {
  const report = sample(86_400);
  assert.throws(() => check(report, { now: origin + 60_000 }), {
    code: "CHECKPOINT_TIME_INVALID",
  });
  assert.throws(() => check(sample(), { now: origin + 151_000 }), {
    code: "STALE_CHECKPOINT",
  });
});
test("another platform or start time cannot reuse a launch binding", () => {
  const wrongPlatform = sample();
  wrongPlatform.runner.platform = "darwin";
  assert.throws(() => check(seal(wrongPlatform)), {
    code: "RUNTIME_IDENTITY_INVALID",
  });
  const wrongStart = sample();
  wrongStart.startedAt = new Date(origin + 30_000).toISOString();
  assert.throws(() => check(seal(wrongStart)), {
    code: "START_IDENTITY_INVALID",
  });
});
test("completed local reports require the producer's final validator", () => {
  const report = sample(86_400);
  report.status = "passed";
  report.completedAt = report.checkpointedAt;
  report.source.finalClean = true;
  report.source.finalChangeCount = 0;
  seal(report);
  assert.throws(() => check(report), { code: "FINAL_VALIDATOR_REQUIRED" });
  assert.throws(
    () =>
      check(report, {
        validateCompleted() {
          throw new Error("long-offline recovery missing");
        },
      }),
    /long-offline recovery missing/u,
  );
  let calls = 0;
  const checked = check(report, {
    validateCompleted(value, options) {
      calls += 1;
      assert.equal(value, report);
      assert.equal(options.requireQualifying, false);
    },
  });
  const state = advanceObservation(null, report, checked, {
    now: origin + 86_400_000,
  });
  assert.equal(calls, 1);
  assert.equal(state.status, "WORKLOAD_REPORT_VALIDATED_NONQUALIFYING");
  assert.equal(state.processExitVerified, false);
});
test("process ID recycling and changed commands cannot reuse a process binding", () => {
  const proof = {
    processId: 42,
    startIdentity: binding.startIdentity,
    executable: binding.executable,
    commandDigest: binding.commandDigest,
    bootIdentity: binding.bootIdentity,
  };
  validateProcessProof(binding, proof);
  assert.throws(
    () =>
      validateProcessProof(binding, { ...proof, startIdentity: "recycled" }),
    { code: "PROCESS_IDENTITY_INVALID" },
  );
  assert.throws(
    () =>
      validateProcessProof(binding, {
        ...proof,
        commandDigest: "another-command",
      }),
    { code: "PROCESS_IDENTITY_INVALID" },
  );
});
test("persisted observer state retains gaps across restart", () => {
  const first = sample();
  let state = advanceObservation(null, first, check(first), {
    now: origin + 60_000,
  });
  const afterGap = sample(241);
  state = advanceObservation(
    JSON.parse(JSON.stringify(state)),
    afterGap,
    check(afterGap),
    { now: origin + 241_000 },
  );
  assert.equal(state.gaps.length, 1);
  const later = sample(301);
  state = advanceObservation(
    JSON.parse(JSON.stringify(state)),
    later,
    check(later),
    { now: origin + 301_000 },
  );
  assert.equal(state.gaps.length, 1);
  assert.equal(state.unmonitoredPrefixSeconds, 60);
  assert.equal(state.monitoringCompleteFromLaunch, false);
});
test("backwards observations and rewritten checkpoint bytes are rejected", () => {
  const first = sample(120);
  const state = advanceObservation(null, first, check(first), {
    now: origin + 120_000,
  });
  const older = sample(60);
  assert.throws(
    () =>
      advanceObservation(state, older, check(older), { now: origin + 180_000 }),
    { code: "OBSERVATION_REGRESSION" },
  );
  const rewritten = sample(120);
  rewritten.totals.cycles += 1;
  seal(rewritten);
  assert.throws(
    () =>
      advanceObservation(state, rewritten, check(rewritten), {
        now: origin + 180_000,
      }),
    { code: "CHECKPOINT_REWRITTEN" },
  );
});
test("a read error replaces old MONITORING with an explicit rejection", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "verify01-observer-read-error-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const report = sample();
  const previous = advanceObservation(null, report, check(report), {
    now: origin + 60_000,
  });
  previous.gaps.push({
    from: "earlier",
    to: "later",
    reason: "known previous gap",
  });
  previous.milestonesRecorded.push(8);
  fs.writeFileSync(
    path.join(root, "watch-v2-state.json"),
    JSON.stringify(previous),
  );
  await assert.rejects(main(["--root", root, "--once"]), /ENOENT/u);
  const status = JSON.parse(
    fs.readFileSync(path.join(root, "watch-v2-state.json"), "utf8"),
  );
  assert.equal(status.status, "OBSERVATION_REJECTED");
  assert.equal(status.reason, "ENOENT");
  assert.equal(status.formalHostAcceptance, false);
  assert.equal(status.unmonitoredPrefixSeconds, 60);
  assert.deepEqual(status.gaps, previous.gaps);
  assert.deepEqual(status.milestonesRecorded, [8]);
  await assert.rejects(main(["--root", root, "--once"]), {
    code: "PREVIOUS_OBSERVATION_REJECTED",
  });
  const repeated = JSON.parse(
    fs.readFileSync(path.join(root, "watch-v2-state.json"), "utf8"),
  );
  assert.equal(repeated.status, "OBSERVATION_REJECTED");
  assert.equal(repeated.rejectedAt, status.rejectedAt);
  assert.equal(repeated.rejectionEvents.length, 2);
  assert.deepEqual(repeated.gaps, previous.gaps);
});
test("a rejected state cannot silently resume through the pure update API", () => {
  const report = sample();
  const previous = advanceObservation(null, report, check(report), {
    now: origin + 60_000,
  });
  previous.status = "OBSERVATION_REJECTED";
  assert.throws(
    () =>
      advanceObservation(previous, report, check(report), {
        now: origin + 61_000,
      }),
    { code: "PREVIOUS_OBSERVATION_REJECTED" },
  );
});
