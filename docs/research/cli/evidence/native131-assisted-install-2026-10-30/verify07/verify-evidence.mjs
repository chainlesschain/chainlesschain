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
  file.startsWith("original-native/verify-07-check-"),
);
assert.equal(originalReceipt.length, 1);
const originalCheck = JSON.parse(originalReceipt[0][1]);
assert.equal(originalCheck.pass, false);
assert.deepEqual(originalCheck.tests, [
  { kind: "baseline", total: 39, passed: 39, failed: 0 },
]);
assert.equal(originalCheck.detail, "acceptance requires executed test cases");
assert.deepEqual(originalCheck.mutations, []);
const summary = json("/_temp/assisted-cli07/summary.json");
const originalSummary = json("original-native/acceptance-summary.json");
for (const stage of ["setup", "check"])
  assert.equal(
    originalSummary.samples[0][stage].scriptDigest,
    `sha256:${hash(raw(`/verify-07-${stage}.mjs`))}`,
  );
assert.equal(raw("/original.test.js").length, 27);
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
  assert.equal(receipt.taskId, "verify-07");
  assert.equal(receipt.pass, stage.pass);
  assert.equal(receipt.imageId, review.imageId);
  assert.deepEqual(receipt.tests, stage.tests);
  assert.deepEqual(receipt.mutations, stage.mutations);
  if (label === "assisted") {
    const reports = receipt.executions.filter((run) =>
      run.command.includes("--reporter=json"),
    );
    assert.equal(reports.length, 4);
    for (const [index, run] of reports.entries()) {
      const report = JSON.parse(run.stdout);
      assert.deepEqual(
        [report.numTotalTests, report.numPassedTests, report.numFailedTests],
        [
          [39, 39, 0],
          [4, 4, 0],
          [4, 3, 1],
          [4, 2, 2],
        ][index],
      );
      assert.equal(run.exitCode, index < 2 ? 0 : 1);
    }
  }
  assert.equal(receipt.providerAssessed, false);
  assert.equal(receipt.productionAttested, false);
  assert.equal(
    hash(raw(`/verify-07-${label === "setup" ? "setup" : "check"}.mjs`)),
    stage.scriptDigest,
  );
  const stdout = json(`/commands/stage-${label}.stdout.log`);
  assert.equal(stdout.receiptDigest, stage.receiptDigest);
  if (label === "original") {
    assert.equal(stage.pass, false);
    assert.equal(stage.detail, "acceptance requires executed test cases");
    assert.deepEqual(stage.tests, [
      { kind: "baseline", total: 39, passed: 39, failed: 0 },
    ]);
    assert.deepEqual(stage.mutations, []);
  }
}

if (review.assistedPassed) {
  const final = summary.stages.assisted;
  assert.deepEqual(final.tests, [
    { kind: "baseline", total: 39, passed: 39, failed: 0 },
    { kind: "candidate", total: 4, passed: 4, failed: 0 },
  ]);
  assert.equal(final.mutations.length, 2);
  const source = git(
    review.frozenProjectCommit,
    "packages/cli/src/lib/session-transcript-history.js",
  ).toString("utf8");
  const spec = JSON.parse(
    raw("/verify-07-check.mjs")
      .toString("utf8")
      .match(/^const spec = (.+);$/m)[1],
  );
  for (const [index, mutant] of spec.mutants.entries()) {
    assert.equal(source.split(mutant.find).length, 2);
    assert.deepEqual(final.mutations[index], {
      name: mutant.name,
      sourceSha256: hash(
        Buffer.from(source.replace(mutant.find, mutant.replace)),
      ),
      total: 4,
      passed: index === 0 ? 3 : 2,
      failed: index === 0 ? 1 : 2,
    });
  }
}
assert.equal(review.nativeAccepted, "34/45 unchanged");
for (const [file, digest] of Object.entries(review.deliverables))
  assert.equal(hash(fs.readFileSync(path.join(root, file))), digest);
assert.deepEqual(
  fs.readFileSync(path.join(root, "corrected-verify-07.test.js")),
  raw("/assisted-cli07-ci/repaired.test.js"),
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
