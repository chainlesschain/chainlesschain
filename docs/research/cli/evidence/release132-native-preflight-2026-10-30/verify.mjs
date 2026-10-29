import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../../../..");
const sha = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const review = JSON.parse(fs.readFileSync(path.join(directory, "review.json")));
assert.equal(review.published, false);
assert.equal(review.artifacts.length, 11);
const raw = new Map();
for (const artifact of review.artifacts) {
  assert.match(artifact.path, /^objects\/[a-f0-9]{64}\.gz$/);
  assert.ok(!raw.has(artifact.name));
  const stored = fs.readFileSync(path.join(directory, artifact.path));
  assert.equal(stored.length, artifact.storedBytes);
  assert.equal(sha(stored), artifact.storedDigest);
  const bytes = gunzipSync(stored, { maxOutputLength: 10 * 1024 * 1024 });
  assert.equal(bytes.length, artifact.originalBytes);
  assert.equal(sha(bytes), artifact.originalDigest);
  raw.set(artifact.name, bytes);
}
const json = (name) => JSON.parse(raw.get(name));
const gates = json("failed-source-gate-observation.json");
assert.equal(gates.source, review.baseSource);
assert.equal(gates.rows[0].conclusion, "failure");
assert.deepEqual(gates.rows[0].counts, {
  success: 70,
  skipped: 1,
  failure: 2,
});
assert.equal(
  sha(raw.get("failed-windows-job.log")),
  "sha256:ff530c8325faba6eccabe9d4264d8feb267dc58e758ec67aacaf1cbe49cde953",
);
for (const node of ["2212", "2222"]) {
  const receipt = json(`local-preflight-node${node}.json`);
  assert.equal(receipt.exitCode, 0);
  assert.equal(receipt.sourceStable, true);
  assert.equal(receipt.sourceKind, "modified-worktree-before-commit");
  assert.deepEqual(receipt.before, receipt.after);
  assert.equal(receipt.args.length, 13);
  for (const line of ["# tests 110", "# pass 110", "# fail 0", "# skipped 0"]) {
    assert.ok(receipt.summary.includes(line));
    assert.ok(
      raw
        .get(`local-preflight-node${node}.stdout.log`)
        .toString("utf8")
        .includes(line),
    );
  }
}
const contracts = json("release-workflow-contract.json");
assert.equal(contracts.success, true);
assert.equal(contracts.numTotalTests, 26);
assert.equal(contracts.numPassedTests, 26);
assert.equal(contracts.numFailedTests, 0);
const components = review.runtimeComponentCheck;
const reference = fs.readFileSync(path.join(repository, components.reference));
assert.equal(sha(reference), components.referenceDigest);
assert.deepEqual(
  JSON.parse(reference).sourceBindings,
  components.componentBindings,
);
assert.equal(Object.keys(components.componentBindings).length, 24);
assert.equal(components.executionRepeated, false);
if (process.argv.includes("--check-source")) {
  for (const [file, digest] of Object.entries({
    ...components.componentBindings,
    ...review.sourceBindings,
  }))
    assert.equal(
      sha(fs.readFileSync(path.join(repository, file))),
      digest,
      file,
    );
}
console.log(
  JSON.stringify({
    status: "ARCHIVE_VERIFIED",
    artifacts: raw.size,
    sourceChecked: process.argv.includes("--check-source"),
    cloudSuccessClaimed: false,
    published: false,
  }),
);
