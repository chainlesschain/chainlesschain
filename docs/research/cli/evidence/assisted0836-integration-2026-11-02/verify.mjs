import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parse } from "acorn";

const root = new URL("../../../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const review = JSON.parse(
  readFileSync(new URL("review.json", import.meta.url), "utf8"),
);

function checked(binding) {
  const bytes = read(binding.path);
  assert.equal(hash(bytes), binding.sha256, binding.path);
  return bytes;
}

function syntax(bytes) {
  return JSON.stringify(
    parse(bytes.toString("utf8"), {
      sourceType: "module",
      ecmaVersion: "latest",
    }),
    function (key, value) {
      // Formatting may change node offsets and literal quote spelling.
      if (["start", "end"].includes(key)) return undefined;
      if (key === "raw" && this.type === "Literal") return undefined;
      return value;
    },
  );
}

assert.equal(review.scope, "modified-worktree-before-commit");
assert.equal(review.modelRequests, 0);
assert.equal(review.newNativeAcceptanceClaimed, false);
assert.deepEqual(
  review.candidates.map((row) => row.sampleId),
  ["verify-08", "verify-36"],
);
for (const row of review.candidates) {
  const original = checked(row.candidate);
  const installed = checked(row.installed);
  assert.equal(syntax(original), syntax(installed), row.sampleId);
  const result = JSON.parse(checked(row.acceptance));
  assert.equal(result.sampleId, row.sampleId);
  assert.equal(result.candidateDigest, row.candidate.sha256);
  assert.equal(result.passed, true);
  assert.equal(result.assisted, true);
  assert.equal(result.originalNativePassed, false);
  assert.equal(result.countedAsNativeGeneration, false);
  for (const name of ["setup", "check"]) {
    const stage = result.stages[name];
    assert.equal(stage.pass, true);
    const operator = checked(row.operators[name]);
    assert.equal(hash(gunzipSync(operator)), stage.operatorDigest);
    assert.equal(hash(checked(row.receipts[name])), stage.receiptDigest);
  }
  assert.equal(result.stages.check.mutations.length, 1);
  assert.ok(result.stages.check.mutations.every((row) => row.failed > 0));
}

for (const binding of review.sourceBindings) checked(binding);
const reportBytes = gunzipSync(checked(review.regression.report));
assert.equal(hash(reportBytes), review.regression.uncompressedSha256);
const report = JSON.parse(reportBytes);
assert.equal(report.success, true);
assert.equal(report.testResults.length, 10);
assert.equal(report.numTotalTests, 84);
assert.equal(report.numPassedTests, 84);
assert.equal(report.numFailedTests, 0);
assert.equal(report.numPendingTests, 0);
assert.equal(report.numTodoTests, 0);
for (const result of report.testResults) {
  assert.equal(result.status, "passed");
  assert.ok(result.assertionResults.every((row) => row.status === "passed"));
  const name = result.name.replaceAll("\\", "/");
  const marker = name.lastIndexOf("/packages/cli/__tests__/");
  assert.ok(marker >= 0);
  assert.ok(
    review.sourceBindings.some((row) => row.path === name.slice(marker + 1)),
  );
}
console.log(
  "VERIFIED_OFFLINE: 2 formatting-only installs; 10 files, 84/84; no model requests",
);
