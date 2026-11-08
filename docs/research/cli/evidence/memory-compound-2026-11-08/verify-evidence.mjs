import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const records = new Map();
for (const [name, entry] of Object.entries(manifest.files)) {
  const file = path.resolve(directory, entry.artifact);
  assert.ok(file.startsWith(path.join(directory, "raw") + path.sep));
  const compressed = fs.readFileSync(file);
  assert.equal(compressed.length, entry.compressedBytes);
  assert.equal(digest(compressed), entry.compressedSha256);
  const bytes = gunzipSync(compressed);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(digest(bytes), entry.sha256);
  records.set(name, bytes);
}
const report = JSON.parse(records.get("preflight").toString("utf8"));
assert.equal(report.sourceHead, manifest.measurementHead);
assert.equal(report.workingTree, "includes-uncommitted-files");
assert.equal(report.loadContext, "parallel-preflight");
for (const key of ["complete", "cleanupComplete", "sourceStable", "gitStable"])
  assert.equal(report[key], true);
for (const key of ["sampleMatrixComplete", "performanceAccepted"]) {
  assert.equal(report[key], false);
  assert.equal(manifest[key], false);
}
assert.equal(
  report.sourceIdentity.dependencyCoverage.fullDependencyClosureVerified,
  false,
);
assert.equal(
  report.sourceIdentity.dependencyCoverage.thirdPartyDependenciesFrozen,
  false,
);
assert.deepEqual(report.counts, [1000]);
assert.equal(report.samples, 1);
assert.equal(report.tiers.length, 1);
const tier = report.tiers[0];
assert.equal(tier.complete, true);
assert.equal(tier.finalAuditVerified, true);
assert.equal(tier.setup.fixture.eventCount, 1482);
assert.equal(tier.semantics.cases.length, 12);
assert.deepEqual(tier.semantics.allPages, {
  pages: 3,
  records: 74,
  noDuplicates: true,
  fullOracleVerified: true,
});
assert.deepEqual(Object.keys(tier.groups).sort(), [
  "category-narrow",
  "cold-continuation",
  "tag-narrow",
]);
let samples = 0;
for (const group of Object.values(tier.groups)) {
  assert.equal(group.complete, true);
  assert.equal(group.samplesComplete, true);
  assert.equal(group.samples.length, 1);
  for (const sample of group.samples) {
    assert.equal(sample.rowsDigest, group.expectedDigest);
    assert.equal(sample.oracleVerified, true);
    assert.equal(sample.manifestUnchanged, true);
    assert.equal(sample.storeRevision, tier.setup.fixture.storeRevision);
    assert.equal(sample.serviceCalls, 1);
    assert.equal(sample.initialCompiledIndexCount, 0);
    assert.equal(sample.entries.length, 20);
    samples++;
  }
}
for (const name of [
  "memory-compound-query-benchmark.mjs",
  "memory-compound-query-fixture.mjs",
]) {
  const relative = "packages/cli/scripts/" + name;
  assert.equal(
    "sha256:" + digest(records.get(relative)),
    report.sourceIdentity.localSha256[relative],
  );
}
console.log(
  JSON.stringify({
    archivedFiles: records.size,
    runtimeSourceBindings: 2,
    functionalSamples: samples,
    sampleMatrixComplete: false,
    performanceAccepted: false,
  }),
);
