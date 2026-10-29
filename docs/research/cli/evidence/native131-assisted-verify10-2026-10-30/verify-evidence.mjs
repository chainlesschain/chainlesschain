import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

// Offline, read-only: no checker execution, network, model, or ledger mutation.
const root = path.dirname(fileURLToPath(import.meta.url));
const review = JSON.parse(fs.readFileSync(path.join(root, "review.json")));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitBytes = (commit, file) =>
  execFileSync("git", ["show", `${commit}:${file}`], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  });
const records = new Map();
for (const entry of review.entries) {
  assert.match(entry.storedPath, /^objects\/[a-f0-9]{64}\.gz$/);
  const packed = fs.readFileSync(path.join(root, entry.storedPath));
  assert.equal(packed.length, entry.storedBytes);
  assert.equal(sha(packed), entry.storedSha256);
  const raw = gunzipSync(packed);
  assert.equal(raw.length, entry.originalBytes);
  assert.equal(sha(raw), entry.originalSha256);
  const key = `${entry.version}/${entry.originalPath}`;
  assert.ok(!records.has(key), "duplicate artifact path");
  records.set(key, raw);
}
function bytes(version, suffix) {
  const matches = [...records].filter(
    ([key]) => key.startsWith(`${version}/`) && key.endsWith(suffix),
  );
  assert.equal(matches.length, 1, `ambiguous/missing ${version}:${suffix}`);
  return matches[0][1];
}
const json = (version, suffix) => JSON.parse(bytes(version, suffix));
const summaries = {};
for (const run of review.runs) {
  const v = run.version;
  const observed = json(v, "/observation.json");
  assert.equal(observed.expectedCommit, run.sourceCommit);
  assert.equal(observed.expectedTag, run.tag);
  assert.equal(observed.rows.length, 1);
  const row = observed.rows[0];
  assert.equal(String(row.id), run.runId);
  assert.equal(row.source, run.sourceCommit);
  assert.equal(row.branch, run.tag);
  assert.equal(row.status, "completed");
  assert.equal(row.conclusion, run.conclusion);
  assert.equal(row.event, "workflow_dispatch");
  const dispatch = json(v, "/dispatch.json");
  assert.equal(dispatch.commit, run.sourceCommit);
  assert.equal(dispatch.tag, run.tag);
  assert.equal(dispatch.newModelRequests, 0);
  const summary = json(v, "/_temp/assisted-verify10/summary.json");
  summaries[v] = summary;
  assert.equal(summary.pass, v === "v2");
  assert.equal(summary.kind, "assisted-non-native");
  assert.equal(summary.newModelRequests, 0);
  assert.equal(summary.originalNativeResult, "FAILED");
  assert.equal(summary.frozenProjectCommit, review.frozenProjectCommit);
  assert.equal(summary.imageId, review.imageId);
  for (const [file, digest] of Object.entries(summary.frozenBindings))
    assert.equal(sha(gitBytes(review.frozenProjectCommit, file)), digest);
  const payload = json(v, "/assisted-verify10-ci/manifest.json");
  for (const [file, digest] of Object.entries(payload.files))
    assert.equal(sha(bytes(v, `/assisted-verify10-ci/${file}`)), digest);
  for (const [key, raw] of records) {
    const prefix = `${v}/artifact/chainlesschain/chainlesschain/`;
    if (key.startsWith(prefix))
      assert.deepEqual(
        raw,
        gitBytes(run.sourceCommit, key.slice(prefix.length)),
      );
  }
  for (const [label, stage] of Object.entries(summary.stages)) {
    const raw = bytes(v, `/pack/acceptance-evidence/${stage.receipt}`);
    assert.equal(`sha256:${sha(raw)}`, stage.receiptDigest);
    const receipt = JSON.parse(raw);
    const kind = label === "setup" ? "setup" : "check";
    assert.equal(sha(bytes(v, `/verify-10-${kind}.mjs`)), stage.scriptDigest);
    assert.equal(receipt.stage, kind);
    assert.equal(receipt.taskId, "verify-10");
    assert.equal(receipt.pass, stage.pass);
    assert.equal(receipt.imageId, review.imageId);
    assert.equal(receipt.providerAssessed, false);
    assert.equal(receipt.productionAttested, false);
    assert.deepEqual(receipt.tests, stage.tests);
    assert.deepEqual(receipt.mutations, stage.mutations);
    const stdout = json(v, `/commands/stage-${label}.stdout.log`);
    assert.equal(stdout.receiptDigest, stage.receiptDigest);
    assert.equal(stdout.receipt, stage.receipt);
    if (label === "original") {
      const report = JSON.parse(receipt.executions.at(-1).stdout);
      assert.deepEqual(
        [report.numTotalTests, report.numPassedTests, report.numFailedTests],
        [6, 4, 2],
      );
      assert.equal(stage.pass, false);
    }
    if (label === "pagination-only" || (v === "v1" && label === "assisted")) {
      assert.equal(stage.pass, false);
      assert.equal(
        stage.detail,
        "candidate tests did not reject the behavioral mutant",
      );
      assert.deepEqual(stage.mutations, []);
      const last = receipt.executions.at(-1);
      const report = JSON.parse(last.stdout);
      assert.equal(last.exitCode, 0);
      assert.deepEqual(
        [report.numTotalTests, report.numPassedTests, report.numFailedTests],
        [6, 6, 0],
      );
    }
  }
}
const final = summaries.v2.stages.assisted;
assert.equal(final.pass, true);
assert.deepEqual(final.tests, [
  { kind: "baseline", total: 2, passed: 2, failed: 0 },
  { kind: "candidate", total: 6, passed: 6, failed: 0 },
]);
assert.equal(final.mutations.length, 1);
const source = gitBytes(
  review.frozenProjectCommit,
  "packages/cli/src/lib/background-agent-list-index.js",
).toString("utf8");
const needle = "parsed.inventoryDigest !== inventory.digest ||";
assert.equal(source.split(needle).length, 2);
assert.deepEqual(final.mutations[0], {
  name: "reuse-index-after-state-update",
  sourceSha256: sha(Buffer.from(source.replace(needle, "false ||"))),
  total: 6,
  passed: 5,
  failed: 1,
});
for (const [file, digest] of Object.entries(review.deliverables))
  assert.equal(sha(fs.readFileSync(path.join(root, file))), digest);
assert.deepEqual(
  fs.readFileSync(path.join(root, "corrected-verify-10.test.js")),
  bytes("v2", "/assisted-verify10-ci/repaired.test.js"),
);
assert.deepEqual(
  fs.readFileSync(path.join(root, "repair.patch")),
  bytes("v2", "/assisted-verify10-ci/repair.patch"),
);
assert.equal(review.assistedCompleted, 1);
assert.equal(review.nativeAccepted, 34);
assert.equal(review.nativeTotal, 45);
assert.equal(review.sourceRunResult, "FAILED");
console.log(
  JSON.stringify({
    verifiedFiles: records.size,
    cloudRuns: review.runs.map((r) => r.runId),
    assistedCompleted: 1,
    nativeAccepted: "34/45 unchanged",
    status: "VERIFIED",
  }),
);
