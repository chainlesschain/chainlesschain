import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../../../..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decoded = (bytes) =>
  bytes[0] === 255 && bytes[1] === 254
    ? bytes.subarray(2).toString("utf16le")
    : bytes.toString("utf8").replace(/^\uFEFF/, "");
const artifacts = new Map();
for (const item of manifest.artifacts) {
  assert(!artifacts.has(item.id), `duplicate artifact ${item.id}`);
  assert.match(item.archive, /^raw\/[a-zA-Z0-9._-]+\.gz$/);
  const compressed = fs.readFileSync(path.join(directory, item.archive));
  assert.equal(compressed.length, item.gzipBytes, item.id);
  assert.equal(sha(compressed), item.gzipSha256, item.id);
  const bytes = gunzipSync(compressed);
  assert.equal(bytes.length, item.bytes, item.id);
  assert.equal(sha(bytes), item.sha256, item.id);
  artifacts.set(item.id, { item, bytes, text: decoded(bytes) });
  if (
    process.argv.includes("--check-current-sources") &&
    item.kind === "source"
  ) {
    assert(
      item.sourcePath.startsWith("packages/cli/") &&
        !item.sourcePath.includes(".."),
    );
    assert.equal(
      sha(fs.readFileSync(path.join(repository, item.sourcePath))),
      item.sha256,
      `current source ${item.sourcePath}`,
    );
  }
}
assert.equal(artifacts.size, 22);
assert.equal(
  manifest.artifacts.filter((item) => item.kind === "source").length,
  11,
);
const json = (id) => JSON.parse(artifacts.get(id).text);
const source = (id) => artifacts.get(id).text;
function vitest(id, total, passed, failed, files) {
  const report = json(id);
  assert.equal(report.numTotalTests, total, id);
  assert.equal(report.numPassedTests, passed, id);
  assert.equal(report.numFailedTests, failed, id);
  assert.equal(report.numPendingTests, 0, id);
  assert.equal(report.numTodoTests, 0, id);
  assert.equal(report.success, failed === 0, id);
  assert.equal(report.testResults.length, files, id);
  const tests = report.testResults.flatMap((file) => {
    assert.equal(
      file.status,
      file.assertionResults.some((test) => test.status === "failed")
        ? "failed"
        : "passed",
    );
    return file.assertionResults.map((test) => {
      assert.equal(typeof test.fullName, "string");
      assert(test.fullName.length > 0);
      assert(["passed", "failed"].includes(test.status));
      if (test.status === "failed") assert(test.failureMessages.length > 0);
      return {
        ...test,
        file: file.name.replaceAll("\\", "/").split("/packages/cli/").at(-1),
      };
    });
  });
  assert.equal(tests.length, total, id);
  assert.equal(
    tests.filter((test) => test.status === "passed").length,
    passed,
    id,
  );
  assert.equal(
    tests.filter((test) => test.status === "failed").length,
    failed,
    id,
  );
  return tests;
}
const redRepl = vitest("repl-before", 2, 1, 1, 1);
vitest("repl-verified", 2, 2, 0, 1);
const greenRepl = vitest("repl-recorded", 2, 2, 0, 1);
const redStop = vitest("stop-before", 15, 12, 3, 1);
const intermediate = vitest("stop-intermediate", 46, 45, 1, 3);
const environmental = vitest("related-wsl-failure", 599, 597, 2, 23);
const finalTests = vitest("related-final", 599, 599, 0, 23);
const signatures = (tests) =>
  tests.map((test) => `${test.file}\0${test.fullName}`).sort();
assert.deepEqual(signatures(environmental), signatures(finalTests));
assert.deepEqual(signatures(redRepl), signatures(greenRepl));
for (const test of environmental.filter((test) => test.status === "failed"))
  assert.match(
    test.failureMessages.join("\n"),
    /WSL[\s\S]*execvpe\(\/bin\/bash\) failed/,
  );
assert.match(
  intermediate.find((test) => test.status === "failed").title,
  /keeps body and cancellation bound/,
);
for (const boundary of [
  "logical-input",
  "request-body",
  "formal-scope",
  "late-rejection",
]) {
  const title = `settles ${boundary} cancellation before observer release without late dispatch`;
  assert.equal(
    finalTests.filter(
      (test) => test.title === title && test.status === "passed",
    ).length,
    1,
  );
  if (boundary !== "late-rejection")
    assert.equal(redStop.find((test) => test.title === title).status, "failed");
}
for (const title of [
  "rejects an already stopped request before its diagnostic observer or transport",
  "keeps the ordinary injected transport path when diagnostics are disabled",
  "keeps body and cancellation bound to the captured request while the observer awaits",
])
  assert.equal(
    finalTests.filter(
      (test) => test.title === title && test.status === "passed",
    ).length,
    1,
  );
const redFailure = redRepl
  .find((test) => test.status === "failed")
  .failureMessages.join("\n");
const redStart = redFailure.indexOf('{"disabled":');
const redEnd = redFailure.indexOf("}: expected", redStart);
assert(redStart >= 0 && redEnd > redStart, "red receipt present");
const redReceipt = JSON.parse(redFailure.slice(redStart, redEnd + 1));
const enabledMarkers = [
  { hasOldMarker: true, hasNewMarker: false },
  { hasOldMarker: false, hasNewMarker: true },
  { hasOldMarker: false, hasNewMarker: true },
];
const markers = (receipt) =>
  receipt.requests.map(({ hasOldMarker, hasNewMarker }) => ({
    hasOldMarker,
    hasNewMarker,
  }));
assert.equal(redReceipt.disabled, true);
assert.deepEqual(markers(redReceipt), enabledMarkers);
const greenReceipts = source("repl-receipts")
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));
assert.equal(greenReceipts.length, 2);
assert.deepEqual(greenReceipts.map((receipt) => receipt.disabled).sort(), [
  false,
  true,
]);
for (const receipt of [redReceipt, ...greenReceipts]) {
  assert.equal(receipt.requests.length, 3);
  assert.deepEqual(receipt.serverErrors, []);
  assert.equal(receipt.encryptedDatabaseInstallationVerified, false);
  assert.match(receipt.terminal, /emulated stdin isTTY/);
  assert.notEqual(receipt.seed.revision, receipt.replacement.revision);
  for (const phase of ["beforeResume", "afterResume"]) {
    assert.equal(receipt[phase].sessions.length, 1);
    const session = receipt[phase].sessions[0];
    assert.equal(session.verified, true);
    assert.equal(session.hasOldMarker, false);
    assert.equal(session.hasNewMarker, false);
    assert(session.eventCount > 0);
    assert.equal(session.userTurns, phase === "beforeResume" ? 2 : 3);
  }
  assert.equal(
    receipt.beforeResume.sessions[0].id,
    receipt.afterResume.sessions[0].id,
  );
  assert(receipt.stages.includes("response-3"));
  assert.equal(
    receipt.stages.filter((stage) => stage === "clean-exit").length,
    2,
  );
}
for (const receipt of greenReceipts)
  assert.deepEqual(
    markers(receipt),
    receipt.disabled
      ? Array.from({ length: 3 }, () => ({
          hasOldMarker: false,
          hasNewMarker: false,
        }))
      : enabledMarkers,
  );
const tap = source("budget-final");
assert.match(tap, /^TAP version 13/m);
assert.equal((tap.match(/^\s*ok \d+ - /gm) || []).length, 108);
assert.equal((tap.match(/^\s*not ok \d+/gm) || []).length, 0);
for (const [label, count] of [
  ["tests", 108],
  ["pass", 108],
  ["fail", 0],
  ["cancelled", 0],
  ["skipped", 0],
  ["todo", 0],
])
  assert.match(tap, new RegExp(`^# ${label} ${count}\\r?$`, "m"));
assert.match(
  tap,
  /^ok \d+ - transport timeout ends a held final-body diagnostic before release and retains unknown liability\r?$/m,
);
assert.match(source("test-budget"), /timeoutMs: 2000/);
const egress = json("egress");
assert.equal(egress.readiness.paidReady, false);
assert.equal(egress.runtimeCoverageVerified, false);
assert.equal(egress.sourceReview.sourceReviewPassed, true);
assert.deepEqual(egress.parseErrors, []);
assert.deepEqual(egress.unclassifiedCandidatePaths, []);
assert.equal(egress.networkCandidates.length, 89);
assert.equal(egress.sourceReview.rows.length, 89);
assert.equal(egress.callChainUnmappedCandidatePaths.length, 78);
for (const candidate of egress.networkCandidates) {
  const rows = egress.sourceReview.rows.filter(
    (row) => row.path === candidate.path,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "REVIEWED");
  assert.equal(rows[0].digest, candidate.digest);
  assert.equal(typeof rows[0].category, "string");
}
// Three digest links: review catalogue plus the two changed transport sources.
assert.equal(
  egress.sourceReview.digest,
  `sha256:${artifacts.get("review-catalogue").item.sha256}`,
);
for (const id of ["provider-scope", "transport"]) {
  const item = artifacts.get(id).item;
  assert.equal(
    egress.sourceReview.rows.find((row) => row.path === item.sourcePath).digest,
    `sha256:${item.sha256}`,
  );
}
assert.match(source("web-panel"), /built in [\d.]+s/);
assert.match(source("web-panel"), /\[build-web-panel\][^\r\n]*hash=/);
assert.equal(
  manifest.sourceIdentity.parentCommit,
  "7c5d559255070f9ad1e23c454a616091899c7c29",
);
assert.equal(manifest.sourceIdentity.uncommittedSnapshot, true);
for (const value of Object.values(manifest.admission))
  assert.equal(value, false);
console.log(
  JSON.stringify(
    {
      verified: true,
      artifacts: artifacts.size,
      sourceSnapshots: 11,
      relatedTests: 599,
      relatedFiles: 23,
      budgetTests: 108,
      replTests: 2,
      greenReceipts: 2,
      egressClassified: 89,
      egressCallChainUnmapped: 78,
      sourceDigestLinks: 3,
      currentSourcesChecked: process.argv.includes("--check-current-sources"),
      baselineFailuresPreserved: true,
      paidReady: false,
    },
    null,
    2,
  ),
);
