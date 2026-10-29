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
  assert.ok(!files.has(entry.name), "Duplicate logical artifact");
  const stored = fs.readFileSync(path.join(directory, entry.path));
  assert.equal(stored.length, entry.storedBytes);
  assert.equal(hash(stored), entry.storedDigest);
  const original = gunzipSync(stored);
  assert.equal(original.length, entry.originalBytes);
  assert.equal(hash(original), entry.originalDigest);
  files.set(entry.name, original);
}
const json = (name) => JSON.parse(files.get(name));
const unit = json("runtime-final-unit.json");
assert.equal(unit.success, true);
assert.equal(unit.testResults.length, 18);
assert.equal(unit.numTotalTests, 456);
assert.equal(unit.numPassedTests, 456);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
const e2e = json("runtime-final-e2e.json");
assert.equal(e2e.success, true);
assert.equal(e2e.testResults.length, 3);
assert.equal(e2e.numPendingTests, 0);
assert.equal(e2e.numTotalTests, 10);
assert.equal(e2e.numPassedTests, 10);
assert.equal(e2e.numFailedTests, 0);
assert.ok(
  json("local-static-checks.json").runs.every((run) => run.exitCode === 0),
);
assert.equal(json("egress-final.json").sourceReview.sourceReviewPassed, true);
const pack = json("cli-pack.json")[0];
assert.equal(pack.version, "0.166.132");
assert.equal(pack.files.length, json("pack-process.json").files);
assert.deepEqual(review.versions, {
  cli: "0.166.132",
  kernel: "0.1.11",
  openVsx: "0.37.170",
  jetbrains: "0.4.187",
});
assert.equal(review.published, false);
assert.equal(review.acceptance.automaticAccepted, 34);
assert.equal(review.acceptance.assistedDeliveries, 3);
const before = json("before-fix-local-e2e.json");
assert.equal(before.numFailedTests, 4);
assert.equal(before.numPassedTests, 0);
const oldGates = json("superseded7f/final-gates.json");
assert.equal(oldGates.source, "7f8ef64b4bd8b429f97d2e121c440143ed7ddf3b");
assert.ok(oldGates.rows.every((row) => row.status === "completed"));
for (const name of ["CLI CI", "IDE Extensions"])
  assert.equal(
    oldGates.rows.find((row) => row.workflow === name).conclusion,
    "cancelled",
  );
for (const name of ["CLI Strict Sandbox", "Context Memory Kernel CI"])
  assert.equal(
    oldGates.rows.find((row) => row.workflow === name).conclusion,
    "success",
  );
for (const id of ["123683988999", "123683989383"]) {
  const job = json("superseded7f/job-" + id + ".json");
  assert.equal(job.run_id, 40937542966);
  assert.equal(job.conclusion, "failure");
  assert.equal(job.head_sha, oldGates.source);
}
const args = process.argv.slice(2);
let checkedCommit = null;
if (args.length) {
  assert.equal(args.length, 2);
  assert.equal(args[0], "--commit");
  assert.match(args[1], /^[a-f0-9]{40}$/u);
  checkedCommit = args[1];
  for (const [file, digest] of Object.entries(review.sourceBindings)) {
    assert.ok(file.startsWith("packages/") && !file.includes(".."));
    const bytes = execFileSync("git", ["show", `${checkedCommit}:${file}`], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(hash(bytes), digest, file);
  }
}
console.log(
  JSON.stringify({
    status: "VERIFIED",
    files: files.size,
    unit: 456,
    realCliTests: 10,
    selectedSourceBindingsCheckedAt: checkedCommit,
    cloudGatesAttested: false,
    publicationAttested: false,
  }),
);
