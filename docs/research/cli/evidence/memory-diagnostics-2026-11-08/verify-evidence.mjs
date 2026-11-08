import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../../..");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const decode = (b) =>
  b[0] === 255 && b[1] === 254
    ? b.subarray(2).toString("utf16le")
    : b.toString("utf8").replace(/^\uFEFF/u, "");
const manifest = JSON.parse(
  fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
);
assert.equal(
  manifest.schema,
  "chainlesschain.memory-diagnostics-merge-evidence/v1",
);
assert.equal(manifest.merge.head, "5193dcf960a361a1178a7fbcd08736da1bc23c77");
assert.equal(
  manifest.merge.mergeHead,
  "d23e386a6ddd48087d769d5fd369c065024fec6d",
);
assert.equal(manifest.claims.providerCallsToRealModels, 0);
for (const [key, value] of Object.entries(manifest.claims))
  if (key !== "providerCallsToRealModels") assert.equal(value, false, key);
assert.equal(manifest.previousArchive.records, 24);
assert.equal(manifest.previousArchive.unchangedDuringArchival, true);
const records = new Map();
for (const [name, entry] of Object.entries(manifest.files)) {
  assert.match(entry.artifact, /^raw\/[a-f0-9]{64}\.gz$/u);
  const compressed = fs.readFileSync(path.join(directory, entry.artifact));
  assert.equal(compressed.length, entry.compressedBytes, name);
  assert.equal(sha(compressed), entry.compressedSha256, name);
  const bytes = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
  assert.equal(bytes.length, entry.bytes, name);
  assert.equal(sha(bytes), entry.sha256, name);
  const encoding =
    bytes[0] === 255 && bytes[1] === 254
      ? "utf-16le-bom"
      : bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191
        ? "utf-8-bom"
        : "utf-8";
  assert.equal(entry.encoding, encoding, name);
  records.set(name, bytes);
}
assert.equal(records.size, 13);
assert.deepEqual(
  fs.readdirSync(path.join(directory, "raw")).sort(),
  Object.values(manifest.files)
    .map((x) => path.basename(x.artifact))
    .sort(),
);
for (const [file, digest] of Object.entries(manifest.archiveFilesSha256)) {
  assert(["README.md", "verify-evidence.mjs"].includes(file));
  assert.equal(sha(fs.readFileSync(path.join(directory, file))), digest, file);
}
const text = (name) => {
  assert(records.has(name), name);
  return decode(records.get(name));
};
const json = (name) => JSON.parse(text(name));
const relative = (name) => {
  const i = name.lastIndexOf("/packages/cli/");
  assert(i >= 0, name);
  return name.slice(i + 1);
};
const expectedCounts = {
  "packages/cli/__tests__/integration/memory-dispatch-admission.test.js": 23,
  "packages/cli/__tests__/integration/semantic-memory-cancellation.test.js": 6,
  "packages/cli/__tests__/unit/agent-context-window-transport.test.js": 7,
  "packages/cli/__tests__/unit/agent-context-window.test.js": 9,
  "packages/cli/__tests__/unit/agent-core-stream-resilience.test.js": 29,
  "packages/cli/__tests__/unit/agent-core-stream-stall.test.js": 16,
  "packages/cli/__tests__/unit/agent-core-streaming.test.js": 13,
  "packages/cli/__tests__/unit/canonical-compaction-task-binding.test.js": 16,
  "packages/cli/__tests__/unit/canonical-compaction-usage.test.js": 23,
  "packages/cli/__tests__/unit/canonical-compaction-workflow.test.js": 11,
  "packages/cli/__tests__/unit/canonical-live-host-context.test.js": 9,
  "packages/cli/__tests__/unit/fallback-model.test.js": 46,
  "packages/cli/__tests__/unit/model-input-diagnostics.test.js": 12,
  "packages/cli/__tests__/unit/provider-context-image-transport.test.js": 5,
  "packages/cli/__tests__/unit/provider-request-admission.test.js": 14,
  "packages/cli/__tests__/unit/session-model-input-diagnostics.test.js": 7,
  "packages/cli/__tests__/unit/stream-retry-after.test.js": 59,
  "packages/cli/__tests__/unit/stream-retry-provider-verdict.test.js": 29,
  "packages/cli/__tests__/unit/stream-retry-transport-boundaries.test.js": 34,
  "packages/cli/__tests__/unit/stream-retry.test.js": 9,
  "packages/cli/__tests__/unit/sub-agent-context.test.js": 48,
};
function verifyVitest(report, total, files) {
  assert.equal(report.success, true);
  assert.equal(report.numTotalTests, total);
  assert.equal(report.numPassedTests, total);
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numPendingTests, 0);
  assert.equal(report.numTodoTests, 0);
  assert.equal(report.testResults.length, files);
  const assertions = new Map();
  const occurrences = new Map();
  for (const result of report.testResults) {
    const file = relative(result.name);
    assert.equal(result.status, "passed", file);
    for (const test of result.assertionResults) {
      const base = file + "\0" + test.fullName;
      const ordinal = occurrences.get(base) || 0;
      occurrences.set(base, ordinal + 1);
      const key = base + "\0" + ordinal;
      assert.equal(assertions.has(key), false, key);
      assert.equal(test.status, "passed", key);
      assert.equal(test.failureMessages.length, 0, key);
      assertions.set(key, test);
    }
  }
  assert.equal(assertions.size, total);
  return assertions;
}
const related = json("related425.json");
const all = verifyVitest(related, 425, 21);
assert.deepEqual(
  Object.fromEntries(
    related.testResults.map((r) => [
      relative(r.name),
      r.assertionResults.length,
    ]),
  ),
  expectedCounts,
);
assert.deepEqual(manifest.testCounts, expectedCounts);
const subsetReport = json("subset42.json");
const subset = verifyVitest(subsetReport, 42, 3);
assert.deepEqual(
  subsetReport.testResults.map((r) => relative(r.name)).sort(),
  [
    "packages/cli/__tests__/integration/memory-dispatch-admission.test.js",
    "packages/cli/__tests__/unit/model-input-diagnostics.test.js",
    "packages/cli/__tests__/unit/session-model-input-diagnostics.test.js",
  ].sort(),
);
for (const key of subset.keys())
  assert(all.has(key), "subset must not be counted as new coverage");
const newStages = [];
for (const stage of ["logical-input", "fetch-body"])
  for (const change of ["delete", "supersede"]) {
    const name =
      "canonical Memory final dispatch admission on real disk rejects " +
      change +
      " while awaiting model input diagnostic " +
      stage;
    const key =
      "packages/cli/__tests__/integration/memory-dispatch-admission.test.js\0" +
      name +
      "\0" +
      0;
    assert(all.has(key));
    assert(subset.has(key));
    newStages.push(name);
  }
const budget = text("budget108.tap");
assert.equal(manifest.files["budget108.tap"].encoding, "utf-16le-bom");
assert.equal(manifest.results.budget.format, "node-test-spec");
assert(
  !budget.includes("TAP version"),
  "Original file extension must not be mistaken for its protocol",
);
for (const [label, count] of [
  ["tests", 108],
  ["pass", 108],
  ["fail", 0],
  ["cancelled", 0],
  ["skipped", 0],
  ["todo", 0],
]) {
  assert.match(
    budget,
    new RegExp("^\\u2139 " + label + " " + count + "\\r?$", "mu"),
  );
}
const budgetStages = ["adapter-body", "governed-fetch-body"].map(
  (stage) =>
    "Memory deletion during " +
    stage +
    " diagnostic blocks dispatch without observer lock deadlock",
);
for (const name of budgetStages) {
  const lines = budget
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("\u2714 " + name + " ("));
  assert.equal(lines.length, 1, name);
}
const egress = json("egress89.json");
assert.equal(egress.sourceCommit, manifest.merge.head);
assert.equal(egress.sourceReview.sourceReviewPassed, true);
assert.deepEqual(egress.sourceReview.issues, []);
assert.deepEqual(egress.parseErrors, []);
assert.equal(egress.networkCandidates.length, 89);
assert.equal(egress.sourceReview.rows.length, 89);
assert.equal(new Set(egress.networkCandidates.map((r) => r.path)).size, 89);
assert.deepEqual(egress.unclassifiedCandidatePaths, []);
assert.equal(egress.callChainUnmappedCandidatePaths.length, 78);
assert.equal(egress.readiness.paidReady, false);
assert.equal(egress.runtimeCoverageVerified, false);
assert.equal(egress.sourceReview.runtimeCoverageVerified, false);
for (const candidate of egress.networkCandidates) {
  const row = egress.sourceReview.rows.find((r) => r.path === candidate.path);
  assert(row);
  assert.equal(row.status, "REVIEWED");
  assert.equal(row.digest, candidate.digest);
}
const cataloguePath =
  "packages/cli/scripts/budget-egress-reviewed-sources.json";
const catalogue = json("source:" + cataloguePath);
for (const file of [
  "packages/cli/src/lib/formal-budget-provider-scope.js",
  "packages/cli/src/lib/formal-budget-transport.js",
  "packages/cli/src/runtime/agent-core.js",
]) {
  const digest = "sha256:" + sha(records.get("source:" + file));
  assert.equal(
    catalogue.entries.find((e) => e.path === file).digest,
    digest,
    file,
  );
  assert.equal(
    egress.sourceReview.rows.find((e) => e.path === file).digest,
    digest,
    file,
  );
}
assert.equal(Object.keys(manifest.sources).length, 8);
for (const [file, source] of Object.entries(manifest.sources)) {
  assert.equal(sha(records.get("source:" + file)), source.sha256, file);
  if (process.argv.includes("--check-current-sources")) {
    const physical = path.resolve(root, file);
    assert(physical.startsWith(root + path.sep));
    assert.equal(sha(fs.readFileSync(physical)), source.sha256, file);
  }
}
const web = text("web-panel.log");
assert.equal(manifest.files["web-panel.log"].encoding, "utf-16le-bom");
assert.match(web, /built in \d+(?:\.\d+)?s/u);
assert.match(web, /\[build-web-panel\].*hash=[a-f0-9]{12}/u);
assert.equal(manifest.results.webPanel.standaloneExitCodeRecorded, false);
assert.deepEqual(manifest.results.related, {
  files: 21,
  passed: 425,
  failed: 0,
  skipped: 0,
});
assert.deepEqual(manifest.results.subset, {
  files: 3,
  passed: 42,
  includedInRelated: true,
});
assert.equal(manifest.results.budget.passed, 108);
assert.equal(manifest.results.budget.newStageCases, 2);
console.log(
  JSON.stringify(
    {
      verified: true,
      archived: records.size,
      sourceSnapshots: Object.keys(manifest.sources).length,
      relatedFiles: 21,
      relatedPassed: 425,
      subsetPassed: 42,
      subsetIncluded: true,
      budgetPassed: 108,
      newMemoryDiagnosticStageCases: newStages.length,
      newBudgetDiagnosticStageCases: budgetStages.length,
      egressCandidates: 89,
      classified: 89,
      callChainUnmapped: 78,
      webPanelBuildMarkerVerified: true,
      currentSourcesChecked: process.argv.includes("--check-current-sources"),
      scope:
        "Archive integrity and recorded results only; no test/build rerun, paid/OS/performance/production admission, or forced diagnostic-observer cancellation guarantee.",
    },
    null,
    2,
  ),
);
