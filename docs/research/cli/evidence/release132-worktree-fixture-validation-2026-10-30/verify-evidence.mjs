import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const directory = path.dirname(fileURLToPath(import.meta.url));
const review = JSON.parse(fs.readFileSync(path.join(directory, "review.json")));
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const files = new Map();
for (const entry of review.artifacts) {
  assert.match(entry.path, /^objects\/[a-f0-9]{64}\.gz$/u);
  assert.ok(!files.has(entry.name));
  const stored = fs.readFileSync(path.join(directory, entry.path));
  assert.equal(stored.length, entry.storedBytes);
  assert.equal(hash(stored), entry.storedDigest);
  const raw = gunzipSync(stored, { maxOutputLength: 64 * 1024 * 1024 });
  assert.equal(raw.length, entry.originalBytes);
  assert.equal(hash(raw), entry.originalDigest);
  files.set(entry.name, raw);
}
const json = (name) => JSON.parse(files.get(name));
const result = json("fixture-integration.json");
assert.equal(result.success, true);
assert.equal(result.numTotalTests, 1);
assert.equal(result.numPassedTests, 1);
assert.equal(result.numFailedTests, 0);
assert.equal(result.numPendingTests, 0);
const control = json("private-controls.json");
assert.equal(control.positive.exitCode, 0);
assert.equal(control.positive.cases, 5);
assert.equal(control.negative.exitCode, 1);
assert.equal(
  control.negative.failure,
  "CC_FIXTURE_UNEXPECTED_ERROR_AFTER_ABORT",
);
assert.ok(
  control.publication
    .filter((r) => r.mode.endsWith("no-clobber"))
    .every(
      (r) =>
        r.exit.code === 1 &&
        r.collisionPreserved === true &&
        r.pendingFiles.length === 0,
    ),
);
const job = json("original-ci-job.json");
assert.equal(job.head_sha, review.baseSource);
assert.equal(job.id, 123710924819);
assert.equal(job.run_id, 40947344227);
assert.equal(job.conclusion, "failure");
const gates = json("superseded-abbe-final-gates.json");
assert.equal(gates.source, review.baseSource);
assert.ok(gates.rows.every((r) => r.status === "completed"));
assert.equal(
  gates.rows.find((r) => r.workflow === "CLI CI").conclusion,
  "cancelled",
);
const component = json("runtime-component-check.json");
assert.equal(component.executionSource, review.baseSource);
assert.equal(component.allSelectedBytesUnchanged, true);
assert.equal(component.priorUnit, 456);
assert.equal(component.priorRealCliTests, 10);
assert.equal(component.executionRepeated, false);
assert.equal(review.productRuntimeChanged, false);
assert.equal(review.published, false);
assert.equal(review.acceptance.automaticAccepted, 34);
assert.equal(review.acceptance.assistedDeliveries, 3);
const args = process.argv.slice(2);
let commit = null;
if (args.length) {
  assert.equal(args.length, 2);
  assert.equal(args[0], "--commit");
  assert.match(args[1], /^[a-f0-9]{40}$/u);
  commit = args[1];
  for (const [file, digest] of Object.entries(review.sourceBindings)) {
    assert.ok(
      (file.startsWith("packages/") || file.startsWith(".github/workflows/")) &&
        !file.split("/").includes(".."),
    );
    const raw = execFileSync("git", ["show", commit + ":" + file], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(hash(raw), digest, file);
  }
}
console.log(
  JSON.stringify({
    status: "VERIFIED",
    files: files.size,
    integration: 1,
    scenarios: 5,
    priorRuntimeComponentExecution: review.baseSource,
    runtimeSuiteRepeated: false,
    selectedSourceBindingsCheckedAt: commit,
    cloudGatesAttested: false,
    publicationAttested: false,
  }),
);
