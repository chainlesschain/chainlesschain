import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const bytes = (n) => fs.readFileSync(path.join(dir, n));
const read = (n) => JSON.parse(bytes(n));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const manifest = read("manifest.json");
for (const f of manifest.artifacts) {
  const b = bytes(f.name);
  assert.equal(b.length, f.bytes);
  assert.equal(sha(b), f.sha256);
}
const q = read("query-recovery100.json");
assert.equal(q.complete, true);
assert.equal(q.sourceHead, manifest.sourceHead);
assert.equal(q.workingTree, "clean");
assert.equal(
  sha(bytes("query-recovery100.json")),
  read("query-live-audit.json").reportSha256,
);
assert.deepEqual(q.counts, [1000, 10000, 100000]);
let queries = 0;
for (const t of q.tiers)
  for (const name of ["cold", "hot", "rebuild", "corrupt"]) {
    const g = t.groups[name];
    assert.equal(g.complete, true);
    assert.equal(g.samples.length, 100);
    for (const s of g.samples) {
      assert.equal(s.count, 20);
      assert.equal(s.rowsDigest, t.expectedDigest);
      assert.ok(Number.isFinite(s.durationMs) && s.durationMs >= 0);
      queries++;
    }
    const sorted = g.samples.map((s) => s.durationMs).sort((a, b) => a - b);
    assert.ok(Math.abs(sorted[94] - g.latency.p95Ms) <= 0.00051);
  }
assert.equal(queries, 1200);
const stop = read("stop100.json");
assert.equal(
  sha(bytes("stop100.json")),
  read("stop100-audit.json").reportSha256,
);
assert.equal(stop.targetMet, true);
assert.deepEqual(
  stop.tiers.map((t) => t.count),
  [1000, 10000, 100000],
);
let stops = 0,
  aborted = 0,
  early = 0;
for (const t of stop.tiers)
  for (const name of ["validate-disk", "verified-memory"]) {
    const g = t.modes[name];
    assert.equal(g.samples.length, 100);
    assert.equal(g.authorityUnchanged, true);
    assert.equal(g.lateSuccessfulCompletion, 0);
    for (const s of g.samples) {
      assert.equal(s.lockReleased, true);
      assert.ok(
        Number.isFinite(s.stopDeliveryDelayMs) && s.stopDeliveryDelayMs <= 500,
      );
      if (s.outcome === "aborted") {
        aborted++;
        assert.equal(s.resultCount, null);
        assert.ok(
          Number.isFinite(s.stopAcknowledgementMs) &&
            s.stopAcknowledgementMs <= 500,
        );
      } else {
        assert.equal(s.outcome, "completed");
        assert.equal(s.completedBeforeStopDeadline, true);
        early++;
      }
      stops++;
    }
  }
assert.equal(stops, 600);
assert.equal(aborted, 580);
assert.equal(early, 20);
const raw = zlib.gunzipSync(bytes("mixed100.json.gz"));
assert.equal(sha(raw), read("mixed100-audit.json").reportSha256);
const mixed = JSON.parse(raw);
assert.equal(mixed.complete, true);
assert.equal(mixed.stage, "complete");
assert.equal(mixed.concurrency, 8);
assert.deepEqual(
  mixed.tiers.map((t) => t.count),
  [1000, 10000, 100000],
);
let rounds = 0,
  workers = 0;
for (const t of mixed.tiers) {
  assert.equal(t.rounds.length, 100);
  assert.equal(t.finalAuditVerified, true);
  assert.equal(t.finalDeletionVisibilityVerified, true);
  assert.equal(t.lockReleased, true);
  assert.equal(t.finalActiveRecords, t.count - 200);
  let revision = t.count;
  for (const r of t.rounds) {
    assert.equal(r.allEightOperationsOverlap, true);
    assert.equal(r.generationsVerified, true);
    assert.equal(r.results.length, 8);
    assert.equal(r.results.filter((s) => s.role === "reader").length, 4);
    const prior = revision;
    const ms = r.results
      .flatMap((s) => s.mutations || [])
      .sort((a, b) => a.storeRevision - b.storeRevision);
    assert.equal(ms.length, 6);
    for (const m of ms) assert.equal(m.storeRevision, ++revision);
    assert.ok(
      Math.max(...r.results.map((s) => s.startedAt)) <
        Math.min(...r.results.map((s) => s.finishedAt)),
    );
    for (const s of r.results) {
      assert.equal(s.lifecycle.phase, "closed");
      assert.ok(s.lifecycle.closedAt >= s.lifecycle.resultAt);
      if (s.role === "reader") {
        assert.ok(s.storeRevision >= prior && s.storeRevision <= revision);
        assert.equal(s.rows.length, 20);
        for (const m of ms.filter((m) => m.storeRevision <= s.storeRevision)) {
          const row = s.rows.find((row) => row.memoryId === m.memoryId);
          if (["deleted", "purged"].includes(m.state))
            assert.equal(row, undefined);
          else if (row) assert.equal(row.digest, m.recordDigest);
        }
      }
      workers++;
    }
    rounds++;
  }
  assert.equal(revision, t.finalRevision);
}
assert.equal(rounds, 300);
assert.equal(workers, 2400);
const compoundBytes = zlib.gunzipSync(bytes("compound100.json.gz"));
const compoundReport = JSON.parse(compoundBytes);
assert.equal(
  "sha256:" + sha(compoundBytes),
  read("compound100-audit.json").reportSha256,
);
for (const key of [
  "complete",
  "cleanupComplete",
  "sourceStable",
  "gitStable",
  "sampleMatrixComplete",
])
  assert.equal(compoundReport[key], true, key);
assert.equal(compoundReport.sourceHead, manifest.sourceHead);
assert.equal(
  compoundReport.sourceIdentityHash,
  "sha256:" + sha(JSON.stringify(compoundReport.sourceIdentity)),
);
assert.deepEqual(compoundReport.counts, [1000, 10000, 100000]);
let compoundTotal = 0;
for (const tier of compoundReport.tiers) {
  assert.equal(tier.complete, true);
  assert.equal(tier.finalAuditVerified, true);
  assert.equal(tier.oracle.fullAuthorityVerified, true);
  assert.equal(tier.oracle.recordsDigest, tier.setup.fixture.recordsDigest);
  const sem = tier.semantics;
  for (const key of [
    "finalAuditVerified",
    "manifestUnchanged",
    "equivalentCursorVerified",
    "changedPageSizeVerified",
  ])
    assert.equal(sem[key], true, key);
  assert.equal(sem.invalidCursorCases, 4);
  assert.equal(sem.allPages.noDuplicates, true);
  assert.equal(sem.allPages.fullOracleVerified, true);
  for (const name of ["category-narrow", "tag-narrow", "cold-continuation"]) {
    const group = tier.groups[name],
      oracle = tier.oracle.scenarios.find((s) => s.name === name);
    assert.equal(group.complete, true);
    assert.equal(group.samplesComplete, true);
    assert.equal(group.samples.length, 100);
    assert.deepEqual(group.query, oracle.query);
    for (let i = 0; i < group.samples.length; i++) {
      const row = group.samples[i];
      assert.equal(row.round, i + 1);
      assert.equal(row.scenario, name);
      assert.equal(
        row.rowsDigest,
        "sha256:" + sha(JSON.stringify(row.entries)),
      );
      assert.equal(row.rowsDigest, oracle.expectedDigest);
      assert.equal(row.entries.length, oracle.expectedCount);
      assert.equal(row.storeRevision, tier.setup.fixture.storeRevision);
      assert.deepEqual(row.query, oracle.query);
      assert.equal(Boolean(row.nextCursor), oracle.expectedHasNext);
      assert.equal(row.oracleVerified, true);
      assert.equal(row.manifestUnchanged, true);
      compoundTotal++;
    }
    const sorted = group.samples.map((s) => s.durationMs).sort((a, b) => a - b);
    assert.ok(Math.abs(sorted[94] - group.latency.p95Ms) < 0.000001);
  }
}
assert.equal(compoundTotal, 900);
console.log(
  JSON.stringify({
    verified: true,
    artifacts: manifest.artifacts.length,
    sourceHead: manifest.sourceHead,
    querySamples: queries,
    stopSamples: stops,
    actualAborts: aborted,
    completedBeforeDeadline: early,
    mixedRounds: rounds,
    workerResults: workers,
    compoundSamples: compoundTotal,
    boundary: manifest.boundary,
  }),
);
