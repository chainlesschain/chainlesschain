import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const records = new Map();
for (const [name, entry] of Object.entries(manifest.files)) {
  const file = path.resolve(directory, entry.artifact);
  assert.ok(file.startsWith(path.join(directory, "raw") + path.sep));
  const compressed = fs.readFileSync(file);
  assert.equal(compressed.length, entry.compressedBytes, name);
  assert.equal(sha(compressed), entry.compressedSha256, name);
  const bytes = gunzipSync(compressed);
  assert.equal(bytes.length, entry.bytes, name);
  assert.equal(sha(bytes), entry.sha256, name);
  records.set(name, bytes);
}
const json = (name) => JSON.parse(records.get(name).toString("utf8"));
for (const [name, total, failed] of [
  ["before-initial.json", 16, 14],
  ["before-dispatch.json", 16, 14],
  ["before-scope-close.json", 7, 1],
  ["before-microtask-close.json", 8, 2],
  ["before-dispatch-errors.json", 12, 2],
  ["before-disabled-scope.json", 14, 1],
]) {
  const report = json(name);
  assert.equal(report.success, false, name);
  assert.equal(report.numTotalTests, total, name);
  assert.equal(report.numFailedTests, failed, name);
}
const failures = json("before-dispatch.json").testResults
  .flatMap((file) => file.assertionResults)
  .filter((test) => test.status === "failed");
assert.equal(failures.length, 14);
for (const test of failures) {
  const text = test.failureMessages.join("\n").replaceAll('\\"', '"');
  assert.ok(text.includes('"oldMarkerCaptured":true'), test.fullName);
  assert.ok(text.includes('"providerCalls":1') || text.includes("providerCalls: 1"), test.fullName);
}
const budgetBefore = json("before-budget-lock.json");
assert.equal(budgetBefore.node, "v24.12.0");
assert.equal(budgetBefore.modulesABI, "137");
assert.equal(budgetBefore.exitCode, 1);
assert.match(budgetBefore.stdout, /^# tests 3$/mu);
assert.match(budgetBefore.stdout, /^# pass 2$/mu);
assert.match(budgetBefore.stdout, /^# fail 1$/mu);

const related = json("after-related.json");
assert.equal(related.success, true);
assert.equal(related.testResults.length, 19);
assert.equal(related.numTotalTests, 402);
assert.equal(related.numPassedTests, 402);
assert.equal(related.numFailedTests, 0);
assert.equal(related.numPendingTests, 0);
const assertions = related.testResults.flatMap((file) => file.assertionResults);
assert.equal(assertions.length, 402);
assert.ok(assertions.every((test) => test.status === "passed"));
for (const [filename, count] of [
  ["memory-dispatch-admission.test.js", 19],
  ["provider-request-admission.test.js", 14],
]) {
  const result = related.testResults.find((file) => file.name.endsWith("/" + filename));
  assert.equal(result.assertionResults.length, count);
}
const budgetAfter = records.get("after-budget.tap").toString("utf8");
assert.match(budgetAfter, /^# tests 106$/mu);
assert.match(budgetAfter, /^# pass 106$/mu);
assert.match(budgetAfter, /^# fail 0$/mu);
assert.match(budgetAfter, /^# skipped 0$/mu);

const egress = json("egress-final.json");
assert.equal(egress.sourceReview.sourceReviewPassed, true);
assert.deepEqual(egress.sourceReview.issues, []);
assert.deepEqual(egress.parseErrors, []);
assert.equal(egress.readiness.paidReady, false);
assert.equal(egress.runtimeCoverageVerified, false);
const cataloguePath = "packages/cli/scripts/budget-egress-reviewed-sources.json";
const catalogue = JSON.parse(records.get("source:" + cataloguePath).toString("utf8"));
for (const source of [
  "packages/cli/src/lib/formal-budget-provider-scope.js",
  "packages/cli/src/lib/formal-budget-transport.js",
  "packages/cli/src/runtime/agent-core.js",
]) {
  const digest = "sha256:" + sha(records.get("source:" + source));
  assert.equal(catalogue.entries.find((entry) => entry.path === source).digest, digest);
  assert.equal(egress.sourceReview.rows.find((entry) => entry.path === source).digest, digest);
}
for (const [relative, source] of Object.entries(manifest.sources)) {
  assert.equal(sha(records.get("source:" + relative)), source.sha256);
  if (process.argv.includes("--check-current-sources")) {
    const file = path.resolve(root, relative);
    assert.ok(file.startsWith(root + path.sep));
    assert.equal(sha(fs.readFileSync(file)), source.sha256, relative);
  }
}
for (const key of ["paidReady", "runtimeCoverageVerified", "productionAdmission"]) assert.equal(manifest[key], false);
console.log(JSON.stringify({ archived: records.size, sourceSnapshots: Object.keys(manifest.sources).length, relatedPassed: 402, budgetPassed: 106, productionAdmission: false }));
