import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// Read-only verification of actual archived outputs. No reruns or networking.
const root = path.dirname(fileURLToPath(import.meta.url));
const review = JSON.parse(fs.readFileSync(path.join(root, "review.json")));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (sha, file) =>
  execFileSync("git", ["show", `${sha}:${file}`], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  });
const records = new Map();
for (const item of review.entries) {
  assert.match(item.storedPath, /^objects\/[a-f0-9]{64}\.gz$/);
  const packed = fs.readFileSync(path.join(root, item.storedPath));
  assert.equal(hash(packed), item.storedSha256);
  assert.equal(packed.length, item.storedBytes);
  const bytes = gunzipSync(packed);
  assert.equal(hash(bytes), item.originalSha256);
  assert.equal(bytes.length, item.originalBytes);
  assert.ok(!records.has(item.originalPath));
  records.set(item.originalPath, bytes);
}
function raw(suffix) {
  const matches = [...records].filter(([file]) => file.endsWith(suffix));
  assert.equal(matches.length, 1, suffix);
  return matches[0][1];
}
const json = (suffix) => JSON.parse(raw(suffix));
const metadata = json("artifact-metadata.json");
assert.equal(String(metadata.id), review.artifactId);
assert.equal(String(metadata.workflow_run.id), review.runId);
assert.equal(metadata.workflow_run.head_sha, review.sourceCommit);
assert.equal(metadata.workflow_run.head_branch, review.tag);
const observed = json("observation.json");
assert.equal(observed.rows.length, 1);
assert.equal(String(observed.rows[0].id), review.runId);
assert.equal(observed.rows[0].source, review.sourceCommit);
assert.equal(observed.rows[0].branch, review.tag);
assert.equal(observed.rows[0].status, "completed");
assert.equal(observed.rows[0].conclusion, review.conclusion);
assert.equal(observed.rows[0].attempt, 1);
const originalReceipt = [...records].filter(([file]) =>
  file.startsWith("original-native/verify-09-check-"),
);
assert.equal(originalReceipt.length, 1);
const originalCheck = JSON.parse(originalReceipt[0][1]);
assert.equal(originalCheck.pass, false);
assert.deepEqual(originalCheck.tests, [
  { kind: "baseline", total: 11, passed: 11, failed: 0 },
]);
const originalReport = JSON.parse(originalCheck.executions.at(-1).stdout);
assert.deepEqual(
  [
    originalReport.numTotalTests,
    originalReport.numPassedTests,
    originalReport.numFailedTests,
  ],
  [6, 5, 1],
);
const summary = json("/_temp/assisted-verify09/summary.json");
assert.equal(summary.kind, "assisted-non-native");
assert.equal(summary.newModelRequests, 0);
assert.equal(summary.originalNativeResult, "FAILED");
assert.equal(summary.pass, review.assistedPassed);
assert.equal(summary.frozenProjectCommit, review.frozenProjectCommit);
for (const [file, digest] of Object.entries(summary.frozenBindings))
  assert.equal(hash(git(review.frozenProjectCommit, file)), digest);
for (const [file, bytes] of records) {
  const prefix = "artifact/chainlesschain/chainlesschain/";
  if (file.startsWith(prefix))
    assert.deepEqual(
      bytes,
      git(review.sourceCommit, file.slice(prefix.length)),
    );
}
for (const [label, stage] of Object.entries(summary.stages)) {
  const bytes = raw(`/pack/acceptance-evidence/${stage.receipt}`);
  assert.equal(`sha256:${hash(bytes)}`, stage.receiptDigest);
  const receipt = JSON.parse(bytes);
  assert.equal(receipt.taskId, "verify-09");
  assert.equal(receipt.pass, stage.pass);
  assert.equal(receipt.imageId, review.imageId);
  assert.deepEqual(receipt.tests, stage.tests);
  assert.deepEqual(receipt.mutations, stage.mutations);
  assert.equal(receipt.providerAssessed, false);
  assert.equal(receipt.productionAttested, false);
  assert.equal(
    hash(raw(`/verify-09-${label === "setup" ? "setup" : "check"}.mjs`)),
    stage.scriptDigest,
  );
  const stdout = json(`/commands/stage-${label}.stdout.log`);
  assert.equal(stdout.receiptDigest, stage.receiptDigest);
  if (label === "original" || label === "clone-only") {
    const last = receipt.executions.at(-1);
    const report = JSON.parse(last.stdout);
    assert.equal(stage.pass, false);
    assert.deepEqual(stage.mutations, []);
    assert.deepEqual(
      [report.numTotalTests, report.numPassedTests, report.numFailedTests],
      label === "original" ? [6, 5, 1] : [6, 6, 0],
    );
    if (label === "clone-only")
      assert.equal(
        stage.detail,
        "candidate tests did not reject the behavioral mutant",
      );
  }
}
if (review.assistedPassed) {
  const final = summary.stages.assisted;
  assert.deepEqual(final.tests, [
    { kind: "baseline", total: 11, passed: 11, failed: 0 },
    { kind: "candidate", total: 6, passed: 6, failed: 0 },
  ]);
  assert.equal(final.mutations.length, 1);
  const source = git(
    review.frozenProjectCommit,
    "packages/cli/src/lib/session-history-origins.js",
  ).toString("utf8");
  const needle = "source?.sourceRef.digest === item.sourceRef.digest &&";
  assert.equal(source.split(needle).length, 2);
  assert.deepEqual(final.mutations[0], {
    name: "trust-tampered-source-digest",
    sourceSha256: hash(
      Buffer.from(source.replace(needle, "Boolean(source) &&")),
    ),
    total: 6,
    passed: 5,
    failed: 1,
  });
}
assert.equal(review.nativeAccepted, "34/45 unchanged");
for (const [file, digest] of Object.entries(review.deliverables))
  assert.equal(hash(fs.readFileSync(path.join(root, file))), digest);
assert.deepEqual(
  fs.readFileSync(path.join(root, "corrected-verify-09.test.js")),
  raw("/assisted-verify09-ci/repaired.test.js"),
);
console.log(
  JSON.stringify({
    files: records.size,
    run: review.runId,
    assistedPassed: review.assistedPassed,
    nativeAccepted: review.nativeAccepted,
    status: "VERIFIED",
  }),
);
