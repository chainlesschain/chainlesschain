import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Offline structural replay. --verify-git also checks exact production blobs;
// --raw-dir checks original, locally retained reports before redaction.
const args = process.argv.slice(2);
const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const receiptPath =
  args[0] && !args[0].startsWith("--")
    ? path.resolve(args.shift())
    : path.join(evidenceDir, "updater-readiness-eventloop-13095-7655.json");
const rawIndex = args.indexOf("--raw-dir");
const rawDir = rawIndex >= 0 ? path.resolve(args[rawIndex + 1]) : null;
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
assert.equal(
  receipt.schema,
  "chainlesschain.updater-readiness-eventloop-evidence/v1",
);
assert.equal(receipt.releaseGateEligible, false);
assert.equal(receipt.originalBroadTransactionTimeout.status, "open");
assert.equal(receipt.execution.readinessDeadlineChanged, false);
assert.equal(receipt.execution.originalTestDeadlinesChanged, false);
assert.equal(receipt.runs.length, 4);
assert.deepEqual(
  new Set(receipt.runs.map((run) => `${run.phase}:${run.mode}`)),
  new Set([
    "before:spawn-error",
    "before:early-exit",
    "after:spawn-error",
    "after:early-exit",
  ]),
);
const scripts = new Map();
for (const script of receipt.scripts) {
  assert.equal(Buffer.byteLength(script.content), script.bytes);
  assert.equal(sha256(script.content), script.archiveTimeSha256);
  scripts.set(script.id, script);
}
for (const [phase, source] of Object.entries(receipt.sources)) {
  assert.equal(source.readinessTimeoutMs, 30000);
  if (args.includes("--verify-git")) {
    const bytes = execFileSync(
      "git",
      ["show", `${source.commit}:${source.path}`],
      { cwd: path.resolve(evidenceDir, "../../../..") },
    );
    assert.equal(bytes.length, source.bytes, `${phase} source length`);
    assert.equal(sha256(bytes), source.sha256, `${phase} source binding`);
    assert.match(
      bytes.toString("utf8"),
      /WINDOWS_SIDECAR_READY_TIMEOUT_MS = 30_000/,
    );
  }
}
for (const run of receipt.runs) {
  const observation = run.observation;
  const source = receipt.sources[run.phase];
  const script = scripts.get(run.scriptId);
  assert.ok(script);
  assert.equal(sha256(JSON.stringify(observation)), run.observationSha256);
  assert.equal(observation.events[0].sourceSha256, source.sha256);
  assert.equal(observation.targetUnchanged, true);
  assert.equal(observation.stagedUnchanged, true);
  assert.equal(observation.lockExists, true);
  const rejected = observation.events.find(
    (event) => event.event === "schedule-rejected",
  );
  const terminal = observation.events.find(
    (event) =>
      event.event ===
      (run.mode === "spawn-error" ? "native-error" : "native-exit"),
  );
  assert.ok(rejected && terminal);
  assert.equal(rejected.code, "SIDECAR_NOT_READY");
  assert.equal(rejected.lockExists, true);
  assert.equal(terminal.code, run.mode === "spawn-error" ? "ENOENT" : 7);
  if (run.phase === "before") {
    assert.equal(observation.sourceCommit, source.commit);
    assert.equal(observation.productionChanges, false);
    assert.equal(observation.deadlinesChanged, false);
    assert.ok(rejected.elapsedMs >= 30000);
    assert.ok(terminal.elapsedMs > rejected.elapsedMs);
    assert.equal(
      rejected[
        run.mode === "spawn-error"
          ? "nativeErrorDelivered"
          : "nativeExitDelivered"
      ],
      false,
    );
  } else {
    for (const edge of ["Before", "After"]) {
      assert.equal(observation[`sourceCommit${edge}`], source.commit);
      assert.equal(observation[`sourceSha256${edge}`], source.sha256);
      assert.equal(observation[`trackedStatus${edge}`], "");
    }
    assert.equal(observation.probeSha256, script.archiveTimeSha256);
    assert.equal(observation.readinessTimeoutMs, 30000);
    assert.ok(rejected.elapsedMs < 5000);
    assert.ok(terminal.elapsedMs < rejected.elapsedMs);
    assert.equal(
      rejected[
        run.mode === "spawn-error"
          ? "nativeErrorDelivered"
          : "nativeExitDelivered"
      ],
      true,
    );
  }
  if (rawDir) {
    const raw = fs.readFileSync(path.join(rawDir, run.rawCapture.filename));
    assert.equal(raw.length, run.rawCapture.bytes);
    assert.equal(sha256(raw), run.rawCapture.sha256);
    const unredacted = JSON.parse(raw);
    delete unredacted.fixture;
    for (const event of unredacted.events) delete event.fixture;
    assert.deepEqual(unredacted, observation);
  }
}
console.log(
  JSON.stringify({
    status: "passed",
    runs: receipt.runs.length,
    gitBlobsVerified: args.includes("--verify-git"),
    rawReportsVerified: Boolean(rawDir),
    originalBroadTransactionTimeout: "open",
    releaseGateEligible: false,
  }),
);
