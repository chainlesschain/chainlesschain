import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { test } from "node:test";
import {
  advanceObservation,
  digest,
  main,
  runJson,
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

const byteDigest = (bytes) =>
  `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
function epochFixture(t, seconds = 600) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "verify01-observer-epoch-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "input");
  fs.mkdirSync(root);
  const producerRoot = path.join(directory, "source");
  const producer = path.join(
    producerRoot,
    "packages/cli/scripts/session-message-reliability-soak.mjs",
  );
  fs.mkdirSync(path.dirname(producer), { recursive: true });
  const producerBytes =
    "export function validateSessionMessageReliabilityEvidence() {}\n";
  fs.writeFileSync(producer, producerBytes);
  const actualBinding = {
    ...binding,
    schema: "chainlesschain.local-soak-process-binding/v2",
    sourceRoot: producerRoot,
    producerDigest: byteDigest(producerBytes),
    originalLaunchProofComplete: false,
  };
  const previous = advanceObservation(null, sample(), check(sample()), {
    now: origin + 60_000,
  });
  previous.bindingDigest = digest(actualBinding);
  previous.status = "OBSERVATION_REJECTED";
  previous.rejectedAt = new Date(origin + 75_000).toISOString();
  previous.reason = "PROCESS_PROOF_UNAVAILABLE";
  previous.rejectionEvents = [
    { rejectedAt: previous.rejectedAt, reason: previous.reason },
  ];
  previous.gaps = [
    { from: "known-prefix", to: "known-gap", reason: "prior gap" },
  ];
  previous.milestonesRecorded = [8];
  const files = {
    "binding-v2.json": JSON.stringify(actualBinding),
    "watch-v2-state.json": JSON.stringify(previous),
    "observer-v2.mjs": "// original observer bytes retained verbatim\n",
    "watch-v2-launch.json": JSON.stringify({
      processId: 123,
      sourceSha256: "old-observer",
    }),
    "watch-v2.stderr.log": "PROCESS_PROOF_UNAVAILABLE\n",
    "watch-v2.stdout.log": "",
    "live-report.json": JSON.stringify(sample(seconds)),
  };
  for (const [file, bytes] of Object.entries(files))
    fs.writeFileSync(path.join(root, file), bytes);
  return {
    directory,
    root,
    actualBinding,
    previous,
    files,
    output: path.join(directory, "new-epoch"),
    now: origin + seconds * 1000,
    proof: {
      processId: binding.processId,
      startIdentity: binding.startIdentity,
      executable: binding.executable,
      commandDigest: binding.commandDigest,
      bootIdentity: binding.bootIdentity,
    },
    assertInputUnchanged() {
      assert.deepEqual(fs.readdirSync(root).sort(), Object.keys(files).sort());
      for (const [file, bytes] of Object.entries(files))
        assert.equal(
          fs.readFileSync(path.join(root, file), "utf8"),
          bytes,
          file,
        );
    },
  };
}
const epochArgs = (fixture) => [
  "--root",
  fixture.root,
  "--state-root",
  fixture.output,
  "--once",
];
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

test("new epoch archives the rejected history and starts only after fresh complete process proof", async (t) => {
  const f = epochFixture(t);
  let now = f.now,
    proofs = 0;
  const state = await main(epochArgs(f), {
    clock: () => now,
    readProof(value) {
      assert.deepEqual(value, f.actualBinding);
      proofs++;
      now += 10_000;
      return f.proof;
    },
  });
  assert.equal(proofs, 1);
  assert.equal(state.status, "MONITORING");
  assert.equal(state.observedAt, new Date(now).toISOString());
  assert.equal(state.observerStartedAt, state.observedAt);
  assert.equal(state.unmonitoredPrefixSeconds, 610);
  assert.equal(state.monitoringCompleteFromLaunch, false);
  assert.equal(state.formalHostAcceptance, false);
  assert.equal(state.observationsCreated, false);
  assert.deepEqual(state.milestonesRecorded, []);
  assert.equal(state.epoch.previousObservationGap.from, f.previous.observedAt);
  assert.equal(state.epoch.previousObservationGap.to, state.observedAt);
  const archived = readJson(path.join(f.output, "epoch-origin.json"));
  assert.deepEqual(archived.previousState, f.previous);
  assert.equal(state.epoch.originDigest, digest(archived));
  for (const entry of archived.artifacts) {
    assert.equal(entry.byteDigest, byteDigest(f.files[entry.source]));
    assert.equal(
      fs.readFileSync(path.join(f.output, entry.archivedPath), "utf8"),
      f.files[entry.source],
    );
  }
  f.assertInputUnchanged();
  const outputBytes = fs.readFileSync(
    path.join(f.output, "watch-v2-state.json"),
  );
  await assert.rejects(main(epochArgs(f)), { code: "EEXIST" });
  assert.deepEqual(
    fs.readFileSync(path.join(f.output, "watch-v2-state.json")),
    outputBytes,
  );
  f.assertInputUnchanged();
});

for (const field of [
  "processId",
  "startIdentity",
  "executable",
  "commandDigest",
  "bootIdentity",
]) {
  test(`new epoch rejects changed ${field} without changing the original observation`, async (t) => {
    const f = epochFixture(t);
    await assert.rejects(
      main(epochArgs(f), {
        clock: () => f.now,
        readProof: () => ({
          ...f.proof,
          [field]: field === "processId" ? 43 : "different",
        }),
      }),
      { code: "PROCESS_IDENTITY_INVALID" },
    );
    const state = readJson(path.join(f.output, "watch-v2-state.json"));
    assert.equal(state.status, "OBSERVATION_REJECTED");
    assert.equal(state.previousEpochRejected, true);
    assert.equal(state.observedAt, undefined);
    f.assertInputUnchanged();
    await assert.rejects(main(epochArgs(f)), { code: "EEXIST" });
  });
}

test("process proof timeout retains bounded diagnostic details and refuses the new epoch", async (t) => {
  const f = epochFixture(t);
  const stderr = "CIM timed out\n".repeat(500);
  await assert.rejects(
    main(epochArgs(f), {
      clock: () => f.now,
      readProof() {
        let time = 0;
        return runJson("powershell.exe", ["fixture-only"], {
          kind: "windows-process-and-cim",
          clock: () => f.now + (time++ ? 15_000 : 0),
          execute(_executable, _args, options) {
            assert.equal(options.timeout, 15_000);
            assert.equal(options.windowsHide, true);
            return {
              status: null,
              signal: "SIGTERM",
              error: Object.assign(new Error("spawnSync ETIMEDOUT"), {
                code: "ETIMEDOUT",
              }),
              stdout: "partial",
              stderr,
            };
          },
        });
      },
    }),
    { code: "PROCESS_PROOF_UNAVAILABLE" },
  );
  const state = readJson(path.join(f.output, "watch-v2-state.json"));
  const failure = state.processProofFailure;
  assert.equal(failure.failureKind, "SUBPROCESS_FAILED");
  assert.equal(failure.commandKind, "windows-process-and-cim");
  assert.equal(failure.elapsedMs, 15_000);
  assert.equal(failure.timeoutMs, 15_000);
  assert.equal(failure.errorCode, "ETIMEDOUT");
  assert.equal(failure.exitCode, null);
  assert.equal(failure.signal, "SIGTERM");
  assert.equal(failure.stderrByteDigest, byteDigest(stderr));
  assert.equal(failure.stderrExcerpt.length, 4096);
  assert.equal(failure.stderrTruncated, true);
  assert.deepEqual(state.rejectionEvents[0].processProofFailure, failure);
  assert.equal(state.status, "OBSERVATION_REJECTED");
  assert.equal(state.observedAt, undefined);
  f.assertInputUnchanged();
});

for (const [name, result, kind] of [
  [
    "nonzero query exit",
    { status: 1, signal: null, stdout: "", stderr: "Access denied" },
    "SUBPROCESS_FAILED",
  ],
  [
    "signaled query",
    { status: 0, signal: "SIGTERM", stdout: "{}", stderr: "" },
    "SUBPROCESS_FAILED",
  ],
  [
    "invalid JSON",
    { status: 0, signal: null, stdout: "broken", stderr: "" },
    "INVALID_JSON",
  ],
]) {
  test(`process proof ${name} retains its cause`, () => {
    assert.throws(
      () => runJson("fixture", [], { execute: () => result }),
      (error) => {
        assert.equal(error.code, "PROCESS_PROOF_UNAVAILABLE");
        assert.equal(error.processProofFailure.failureKind, kind);
        assert.equal(error.processProofFailure.exitCode, result.status);
        assert.equal(
          error.processProofFailure.stdoutByteDigest,
          byteDigest(result.stdout),
        );
        return true;
      },
    );
  });
}

test("a checkpoint that goes stale during identity proof cannot start an epoch", async (t) => {
  const f = epochFixture(t);
  let now = f.now;
  await assert.rejects(
    main(epochArgs(f), {
      clock: () => now,
      readProof: () => {
        now += 91_000;
        return f.proof;
      },
    }),
    { code: "STALE_CHECKPOINT" },
  );
  assert.equal(
    readJson(path.join(f.output, "watch-v2-state.json")).status,
    "OBSERVATION_REJECTED",
  );
  f.assertInputUnchanged();
});

test("epoch output cannot alias or be nested inside its input directory", async (t) => {
  const f = epochFixture(t);
  for (const output of [f.root, path.join(f.root, "epoch")]) {
    await assert.rejects(
      main(["--root", f.root, "--state-root", output, "--once"]),
      { code: "EPOCH_OUTPUT_MUST_BE_OUTSIDE_INPUT" },
    );
  }
  const alias = path.join(f.directory, "alias");
  fs.symlinkSync(
    f.root,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    main([
      "--root",
      f.root,
      "--state-root",
      path.join(alias, "epoch"),
      "--once",
    ]),
    { code: "EPOCH_OUTPUT_MUST_BE_OUTSIDE_INPUT" },
  );
  f.assertInputUnchanged();
});

test("new epoch cannot reset recorded cycles or binding identity", async (t) => {
  const f = epochFixture(t);
  const report = sample(600);
  report.totals.cycles = 1;
  f.files["live-report.json"] = JSON.stringify(seal(report));
  fs.writeFileSync(
    path.join(f.root, "live-report.json"),
    f.files["live-report.json"],
  );
  await assert.rejects(
    main(epochArgs(f), { clock: () => f.now, readProof: () => f.proof }),
    { code: "EPOCH_OBSERVATION_REGRESSION" },
  );
  f.assertInputUnchanged();
  f.output = path.join(f.directory, "changed-binding-epoch");
  f.files["binding-v2.json"] = JSON.stringify({
    ...f.actualBinding,
    processId: 43,
  });
  fs.writeFileSync(
    path.join(f.root, "binding-v2.json"),
    f.files["binding-v2.json"],
  );
  await assert.rejects(
    main(epochArgs(f), { clock: () => f.now, readProof: () => f.proof }),
    { code: "EPOCH_BINDING_CHANGED" },
  );
  f.assertInputUnchanged();
});

test("a completed report cannot supply the fresh live identity needed to start a continuation", async (t) => {
  const f = epochFixture(t, 86_400);
  const report = sample(86_400);
  report.status = "passed";
  report.completedAt = report.checkpointedAt;
  report.source.finalClean = true;
  report.source.finalChangeCount = 0;
  f.files["live-report.json"] = JSON.stringify(seal(report));
  fs.writeFileSync(
    path.join(f.root, "live-report.json"),
    f.files["live-report.json"],
  );
  await assert.rejects(
    main(epochArgs(f), {
      clock: () => f.now,
      readProof: () => {
        throw new Error("unexpected proof");
      },
    }),
    { code: "EPOCH_REQUIRES_RUNNING_WORKLOAD" },
  );
  f.assertInputUnchanged();
});

test("milestones remain raw workload snapshots in the new epoch, with the full missing prefix", async (t) => {
  const f = epochFixture(t, 28_800);
  const state = await main(epochArgs(f), {
    clock: () => f.now,
    readProof: () => f.proof,
  });
  assert.deepEqual(state.milestonesRecorded, [8]);
  const milestone = readJson(
    path.join(f.output, "raw-checkpoint-v2-8h.metadata.json"),
  );
  assert.equal(milestone.unmonitoredPrefixSeconds, 28_800);
  assert.equal(milestone.monitoringCompleteFromLaunch, false);
  assert.equal(milestone.formalHostAcceptance, false);
  assert.equal(milestone.epoch.originDigest, state.epoch.originDigest);
  f.assertInputUnchanged();
});

test("a third epoch preserves the second rejection and its original epoch chain", async (t) => {
  const f = epochFixture(t);
  await main(epochArgs(f), { clock: () => f.now, readProof: () => f.proof });
  const priorOrigin = fs.readFileSync(path.join(f.output, "epoch-origin.json"));
  const statePath = path.join(f.output, "watch-v2-state.json");
  const previous = readJson(statePath);
  previous.status = "OBSERVATION_REJECTED";
  previous.rejectedAt = new Date(f.now + 1000).toISOString();
  previous.reason = "PROCESS_PROOF_UNAVAILABLE";
  fs.writeFileSync(statePath, JSON.stringify(previous));
  const priorBytes = fs.readFileSync(statePath);
  const next = path.join(f.directory, "third-epoch");
  const state = await main(
    [
      "--root",
      f.root,
      "--previous-epoch-root",
      f.output,
      "--state-root",
      next,
      "--once",
    ],
    { clock: () => f.now + 2000, readProof: () => f.proof },
  );
  assert.equal(state.epoch.previousRejectedAt, previous.rejectedAt);
  assert.equal(state.epoch.previousObservationGap.from, previous.observedAt);
  assert.equal(state.monitoringCompleteFromLaunch, false);
  assert.equal(state.unmonitoredPrefixSeconds, 602);
  assert.deepEqual(
    fs.readFileSync(path.join(next, "previous-epoch/epoch-origin.json")),
    priorOrigin,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(next, "previous-epoch/watch-v2-state.json")),
    priorBytes,
  );
  assert.deepEqual(fs.readFileSync(statePath), priorBytes);
  assert.deepEqual(
    fs.readFileSync(path.join(f.output, "epoch-origin.json")),
    priorOrigin,
  );
  f.assertInputUnchanged();
});
test("a foreign or changed prior epoch origin cannot start a third epoch", async (t) => {
  const f = epochFixture(t);
  await main(epochArgs(f), { clock: () => f.now, readProof: () => f.proof });
  const statePath = path.join(f.output, "watch-v2-state.json");
  const state = readJson(statePath);
  state.status = "OBSERVATION_REJECTED";
  state.rejectedAt = new Date(f.now).toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state));
  fs.appendFileSync(path.join(f.output, "epoch-origin.json"), " ");
  const originPath = path.join(f.output, "epoch-origin.json");
  const changed = readJson(originPath);
  changed.epochId = "foreign";
  fs.writeFileSync(originPath, JSON.stringify(changed));
  await assert.rejects(
    main(
      [
        "--root",
        f.root,
        "--previous-epoch-root",
        f.output,
        "--state-root",
        path.join(f.directory, "refused-third-epoch"),
        "--once",
      ],
      { clock: () => f.now, readProof: () => f.proof },
    ),
    { code: "PRIOR_EPOCH_ORIGIN_INVALID" },
  );
  f.assertInputUnchanged();
});
test("previous epoch selection and native helper require complete explicit options", async (t) => {
  const f = epochFixture(t);
  await assert.rejects(
    main(["--root", f.root, "--previous-epoch-root", f.output, "--once"]),
    { code: "NEW_EPOCH_REQUIRED" },
  );
  await assert.rejects(
    main(["--root", f.root, "--windows-proof-helper", "helper.exe", "--once"]),
    { code: "NATIVE_PROOF_PIN_REQUIRED" },
  );
  f.assertInputUnchanged();
});

test("resuming an existing epoch retains origin, gaps and the proof reader", async (t) => {
  const f = epochFixture(t);
  const first = await main(epochArgs(f), {
    clock: () => f.now,
    readProof: () => f.proof,
  });
  const resumed = await main(
    ["--root", f.root, "--resume-epoch-root", f.output, "--once"],
    { clock: () => f.now + 2000, readProof: () => f.proof },
  );
  assert.deepEqual(resumed.epoch, first.epoch);
  assert.equal(
    resumed.unmonitoredPrefixSeconds,
    first.unmonitoredPrefixSeconds,
  );
  assert.equal(resumed.monitoringCompleteFromLaunch, false);
  const readerPath = path.join(f.output, "proof-reader.json");
  const reader = readJson(readerPath);
  reader.windowsNativeProof = { executable: "untrusted" };
  fs.writeFileSync(readerPath, JSON.stringify(reader));
  await assert.rejects(
    main(["--root", f.root, "--resume-epoch-root", f.output, "--once"], {
      clock: () => f.now + 3000,
      readProof: () => f.proof,
    }),
    { code: "EPOCH_PROOF_READER_CHANGED" },
  );
  f.assertInputUnchanged();
});
test("a first-proof rejected epoch can be chained without inventing a successful observation", async (t) => {
  const f = epochFixture(t);
  await assert.rejects(
    main(epochArgs(f), {
      clock: () => f.now,
      readProof() {
        throw Object.assign(new Error("query failed"), {
          code: "PROCESS_PROOF_UNAVAILABLE",
        });
      },
    }),
    { code: "PROCESS_PROOF_UNAVAILABLE" },
  );
  const rejected = readJson(path.join(f.output, "watch-v2-state.json"));
  assert.equal(rejected.observedAt, undefined);
  assert.equal(rejected.epoch.firstObservedAt, null);
  assert.equal(rejected.bindingDigest, digest(f.actualBinding));
  const output = path.join(f.directory, "after-first-proof-failed");
  const state = await main(
    [
      "--root",
      f.root,
      "--previous-epoch-root",
      f.output,
      "--state-root",
      output,
      "--once",
    ],
    { clock: () => f.now + 2000, readProof: () => f.proof },
  );
  assert.equal(state.epoch.previousRejectedAt, rejected.rejectedAt);
  assert.equal(state.epoch.previousObservationGap.from, f.previous.observedAt);
  assert.equal(state.unmonitoredPrefixSeconds, 602);
  assert.deepEqual(
    fs.readFileSync(
      path.join(output, "previous-epoch/previous-epoch/watch-v2-state.json"),
    ),
    fs.readFileSync(path.join(f.root, "watch-v2-state.json")),
  );
  f.assertInputUnchanged();
});

test("resuming rejects changes to the observer dependency even with a recomputed origin digest", async (t) => {
  const f = epochFixture(t);
  await main(epochArgs(f), { clock: () => f.now, readProof: () => f.proof });
  const originFile = path.join(f.output, "epoch-origin.json");
  const changed = readJson(originFile);
  changed.atomicHelperByteDigest = `sha256:${"f".repeat(64)}`;
  fs.writeFileSync(originFile, JSON.stringify(changed));
  const stateFile = path.join(f.output, "watch-v2-state.json");
  const state = readJson(stateFile);
  state.epoch.originDigest = digest(changed);
  fs.writeFileSync(stateFile, JSON.stringify(state));
  await assert.rejects(
    main(["--root", f.root, "--resume-epoch-root", f.output, "--once"], {
      clock: () => f.now + 1000,
      readProof: () => f.proof,
    }),
    { code: "EPOCH_DEPENDENCY_CHANGED" },
  );
  f.assertInputUnchanged();
});
test("failure to publish rejection cannot replace the original process-proof failure", async (t) => {
  const f = epochFixture(t);
  const rename = fs.renameSync;
  const stateFile = path.join(
    fs.realpathSync(path.dirname(f.output)),
    path.basename(f.output),
    "watch-v2-state.json",
  );
  const original = Object.assign(new Error("actual query failure"), {
    code: "PROCESS_PROOF_UNAVAILABLE",
  });
  fs.renameSync = (temporary, destination) => {
    if (destination === stateFile)
      throw Object.assign(new Error("persistent sharing violation"), {
        code: "EPERM",
      });
    return rename(temporary, destination);
  };
  try {
    await assert.rejects(
      main(epochArgs(f), {
        clock: () => f.now,
        readProof: () => {
          throw original;
        },
      }),
      (error) => {
        assert.equal(error, original);
        assert.equal(error.failedReportPublication.code, "EPERM");
        assert.equal(
          error.failedReportPublication.publicationFailure.attempts,
          process.platform === "win32" ? 6 : 1,
        );
        const unpublished = readJson(
          error.failedReportPublication.publicationFailure.temporary,
        );
        assert.equal(unpublished.status, "OBSERVATION_REJECTED");
        assert.equal(unpublished.reason, "PROCESS_PROOF_UNAVAILABLE");
        return true;
      },
    );
  } finally {
    fs.renameSync = rename;
  }
  f.assertInputUnchanged();
});
