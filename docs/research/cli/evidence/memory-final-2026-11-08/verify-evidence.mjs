import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const root = path.dirname(fileURLToPath(import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tagged = (bytes) => "sha256:" + sha(bytes);
const parse = (bytes) =>
  JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, ""));
const manifest = parse(fs.readFileSync(path.join(root, "manifest.json")));
assert.equal(manifest.schema, "chainlesschain.memory-two-commit-evidence/v1");
const BASE = "727c64962fb2ea9e20447d7b59b459a13e0625d6";
const COMPOUND = "698b87d79720c75809e830fa826437e021569a1c";
const COUNTS = [1000, 10000, 100000];
assert.equal(manifest.baseline.head, BASE);
assert.equal(manifest.compound.head, COMPOUND);
for (const flag of [
  "currentAdmissionHeadSloVerified",
  "fullDependencyClosureVerified",
  "semanticQualityVerified",
  "crossPlatformVerified",
  "paidReady",
  "productionAdmission",
])
  assert.equal(manifest.claims[flag], false, flag);
assert.equal(manifest.claims.providerCalls, 0);
assert.equal(manifest.historicalGitAudit.files, 1946);
assert.equal(manifest.historicalGitAudit.rerunByOfflineVerifier, false);
const blobs = new Map();
let compressedBytes = 0,
  originalBytes = 0;
for (const blob of manifest.blobs) {
  assert.match(blob.path, /^raw\/[a-f0-9]{64}\.gz$/u);
  assert.equal(blobs.has(blob.sha256), false);
  const compressed = fs.readFileSync(path.join(root, blob.path));
  assert.equal(compressed.length, blob.gzipBytes);
  assert.equal(sha(compressed), blob.gzipSha256);
  const bytes = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
  assert.equal(bytes.length, blob.bytes);
  assert.equal(sha(bytes), blob.sha256);
  blobs.set(blob.sha256, bytes);
  compressedBytes += compressed.length;
  originalBytes += bytes.length;
}
const artifacts = new Map();
for (const artifact of manifest.artifacts) {
  assert.equal(artifacts.has(artifact.id), false);
  assert(blobs.has(artifact.sha256));
  artifacts.set(artifact.id, blobs.get(artifact.sha256));
}
const bytes = (id) => {
  assert(artifacts.has(id), id);
  return artifacts.get(id);
};
const json = (id) => parse(bytes(id));
for (const [file, digest] of Object.entries(manifest.archiveFilesSha256)) {
  assert(["README.md", "verify-evidence.mjs"].includes(file));
  assert.equal(sha(fs.readFileSync(path.join(root, file))), digest, file);
}
assert.deepEqual(
  fs.readdirSync(path.join(root, "raw")).sort(),
  manifest.blobs.map((x) => path.basename(x.path)).sort(),
);
function stats(samples, field, rounded = true) {
  const values = samples
    .map((s) => (typeof s === "number" ? s : s[field]))
    .sort((a, b) => a - b);
  assert(values.length > 0);
  assert(values.every((v) => Number.isFinite(v) && v >= 0));
  const number = (v) => (rounded ? Number(v.toFixed(3)) : v);
  const at = (p) =>
    number(values[Math.max(0, Math.ceil(values.length * p) - 1)]);
  return {
    samples: values.length,
    minMs: number(values[0]),
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    maxMs: number(values.at(-1)),
  };
}
const sourceCheck = (bindings, file, digest) => {
  assert(Object.hasOwn(bindings, file), file);
  assert.equal(
    sha(bytes(bindings[file])),
    digest.replace(/^sha256:/u, ""),
    file,
  );
};
const queryPath = (key) =>
  key === "benchmark.mjs"
    ? "packages/cli/scripts/memory-query-index-benchmark.mjs"
    : key === "fixture-generator.mjs"
      ? "packages/cli/scripts/persistent-capacity-benchmark.mjs"
      : key.startsWith("kernel/")
        ? "packages/context-memory-kernel/lib/" + key.slice(7)
        : ["with-file-lock.js", "secure-file-identity.js"].includes(key)
          ? "packages/cli/src/lib/" + key
          : "packages/cli/src/lib/context-memory-kernel/" + key;
const queue = json("baseline/queue.json");
const identity = json("baseline/source-identity.json");
const audit = json("baseline/independent-audit.json");
assert.equal(queue.head, BASE);
assert.equal(queue.complete, true);
assert.equal(queue.stages.length, 5);
assert.deepEqual(
  queue.stages.map((s) => s.name),
  ["node-contracts", "query100", "stop100", "recovery100", "mixed100"],
);
for (const stage of queue.stages) {
  assert.equal(stage.status, "passed");
  assert.equal(stage.exitCode, 0);
  assert.equal(stage.signal, null);
}
assert.equal(identity.head, BASE);
assert.equal(identity.clean, true);
assert.equal(identity.node, "v22.20.0");
assert.equal(identity.providerCalls, 0);
assert.equal(identity.fullDependencyClosureVerified, false);
assert.equal(Object.keys(identity.fileDigests).length, 1945);
assert.equal(audit.sourceFiles, 1946);
assert.equal(audit.head, BASE);
assert.equal(audit.baselineComplete, true);
assert.equal(audit.currentMergedHeadSloVerified, false);
assert.deepEqual(audit.lineEndingOnly, [
  "packages/cli/scripts/build-windows-sandbox-helper.ps1",
  "packages/cli/scripts/governed-learning-windows-secure-pipe-broker.ps1",
]);
for (const [file, artifact] of Object.entries(manifest.baseline.sources))
  sourceCheck(manifest.baseline.sources, file, identity.fileDigests[file]);
sourceCheck(
  manifest.supplementalSources,
  "package-lock.json",
  identity.packageLockSha256,
);
assert.match(
  identity.kernelProbe.resolved,
  /cli-ide-memory-validation-20261108\/packages\/context-memory-kernel\/index\.mjs$/u,
);
assert.match(
  bytes("baseline/node-contracts.log").toString("utf8"),
  /# pass 55\r?\n/u,
);
assert.match(
  bytes("baseline/node-contracts.log").toString("utf8"),
  /# fail 0\r?\n/u,
);
assert.match(
  bytes("baseline/node-contracts.log").toString("utf8"),
  /# skipped 0\r?\n/u,
);
const referenced = new Set();
const summary = {
  baselineHead: BASE,
  compoundHead: COMPOUND,
  queries: 0,
  recovery: 0,
  cancelled: 0,
  mixedRounds: 0,
  mutations: 0,
  compoundSamples: 0,
  compoundSemanticCases: 0,
  queryP95Ms: [],
  recoveryP95Ms: [],
  stopP95Ms: [],
  mixedP95Ms: [],
  compoundP95Ms: [],
};
for (const [name, counter, expectedModes] of [
  ["query100.json", "queries", ["cold", "hot"]],
  ["recovery100.json", "recovery", ["corrupt", "rebuild"]],
]) {
  const report = json("baseline/" + name);
  assert.equal(report.complete, true);
  assert.equal(report.sourceHead, BASE);
  assert.equal(report.workingTree, "clean");
  assert.equal(report.samples, 100);
  assert.equal(report.node, identity.node);
  assert.equal(report.platform, "win32");
  assert.equal(report.arch, "x64");
  assert.equal(report.cacheMode, "validate-disk");
  assert.equal(report.indexLayout, "bundle");
  assert.equal(report.performanceThresholds, null);
  assert.deepEqual(report.counts, COUNTS);
  assert.deepEqual(
    report.tiers.map((t) => t.count),
    COUNTS,
  );
  for (const [key, digest] of Object.entries(report.implementationSha256)) {
    const file = queryPath(key);
    referenced.add(file);
    sourceCheck(manifest.baseline.sources, file, digest);
  }
  for (const tier of report.tiers) {
    assert.deepEqual(Object.keys(tier.groups).sort(), expectedModes);
    const result = { count: tier.count };
    for (const [mode, group] of Object.entries(tier.groups)) {
      assert.equal(group.complete, true);
      assert.equal(group.samples.length, 100);
      assert.deepEqual(stats(group.samples, "durationMs"), group.latency);
      for (const sample of group.samples) {
        assert.equal(sample.count, 20);
        assert.equal(sample.rowsDigest, tier.expectedDigest);
        assert(
          Number.isSafeInteger(sample.authorityReads) &&
            sample.authorityReads > 0,
        );
        summary[counter]++;
      }
      result[mode] = group.latency.p95Ms;
    }
    summary[counter === "queries" ? "queryP95Ms" : "recoveryP95Ms"].push(
      result,
    );
  }
}
function relativeSources(report) {
  for (const [key, digest] of Object.entries(report.sourceDigests)) {
    const file = path.posix.normalize(
      path.posix.join("packages/cli/scripts", key),
    );
    referenced.add(file);
    sourceCheck(manifest.baseline.sources, file, digest);
  }
  assert.equal(report.environment.node, identity.node);
  assert.equal(report.environment.platform, "win32");
  assert.equal(report.environment.arch, "x64");
  assert.equal(report.providerCalls, 0);
}
const stop = json("baseline/stop100.json");
relativeSources(stop);
assert.equal(stop.targetMet, true);
assert.equal(stop.samplesPerCase, 100);
assert.deepEqual(
  stop.tiers.map((t) => t.count),
  COUNTS,
);
for (const tier of stop.tiers) {
  assert.deepEqual(Object.keys(tier.modes).sort(), [
    "validate-disk",
    "verified-memory",
  ]);
  for (const [mode, group] of Object.entries(tier.modes)) {
    assert.equal(group.samples.length, 100);
    assert.equal(group.authorityUnchanged, true);
    assert.equal(group.acknowledged, 100);
    assert.equal(group.lateSuccessfulCompletion, 0);
    assert.equal(group.targetMet, true);
    assert.deepEqual(
      stats(group.samples, "stopDeliveryDelayMs"),
      group.stopDeliveryDelay,
    );
    assert.deepEqual(
      stats(group.samples, "stopAcknowledgementMs"),
      group.stopAcknowledgement,
    );
    for (const sample of group.samples) {
      assert.equal(sample.outcome, "aborted");
      assert.equal(sample.lockReleased, true);
      assert.equal(sample.scheduledStopMs, 10);
      assert.equal(sample.completedBeforeStopDeadline, false);
      assert(
        sample.stopDeliveryDelayMs <= stop.target.maximumStopDeliveryDelayMs,
      );
      assert(
        sample.stopAcknowledgementMs <=
          stop.target.maximumStopAcknowledgementMs,
      );
      summary.cancelled++;
    }
    summary.stopP95Ms.push({
      count: tier.count,
      mode,
      delivery: group.stopDeliveryDelay.p95Ms,
      acknowledgement: group.stopAcknowledgement.p95Ms,
    });
  }
}
const mixed = json("baseline/mixed100.json");
relativeSources(mixed);
assert.equal(mixed.complete, true);
assert.equal(mixed.stage, "complete");
assert.equal(mixed.concurrency, 8);
assert.equal(mixed.roundsPerTier, 100);
assert.deepEqual(
  mixed.tiers.map((t) => t.count),
  COUNTS,
);
for (const tier of mixed.tiers) {
  for (const key of [
    "complete",
    "finalAuditVerified",
    "finalDeletionVisibilityVerified",
    "lockReleased",
  ])
    assert.equal(tier[key], true);
  assert.equal(tier.rounds.length, 100);
  assert.equal(tier.finalRevision, tier.count + 600);
  assert.equal(tier.finalActiveRecords, tier.count - 200);
  const allMutations = tier.rounds.flatMap((r) =>
    r.results.flatMap((x) => x.mutations || []),
  );
  assert.deepEqual(
    allMutations.map((m) => m.storeRevision).sort((a, b) => a - b),
    Array.from({ length: 600 }, (_, i) => tier.count + i + 1),
  );
  for (const [i, round] of tier.rounds.entries()) {
    assert.equal(round.generationsVerified, true);
    assert.equal(round.allEightOperationsOverlap, true);
    assert.equal(round.results.length, 8);
    assert(
      Math.max(...round.results.map((x) => x.startedAt)) <=
        Math.min(...round.results.map((x) => x.finishedAt)),
    );
    assert.deepEqual(round.results.map((r) => r.role).sort(), [
      "deleter",
      "deleter",
      "reader",
      "reader",
      "reader",
      "reader",
      "writer",
      "writer",
    ]);
    assert.equal(round.operationsPerSecond, 8000 / round.durationMs);
    const mutations = round.results.flatMap((r) => r.mutations || []);
    assert.equal(mutations.length, 6);
    for (const result of round.results) {
      assert.equal(result.lifecycle.phase, "closed");
      assert(result.lifecycle.spawnedAt <= result.lifecycle.readyAt);
      for (const lock of result.locks) {
        assert.equal(lock.locked, true);
        assert(lock.waitMs >= 0);
      }
      if (result.role !== "reader") continue;
      assert(
        result.storeRevision >= tier.count + i * 6 &&
          result.storeRevision <= tier.count + (i + 1) * 6,
      );
      assert.equal(result.rows.length, 20);
      assert.equal(new Set(result.rows.map((r) => r.memoryId)).size, 20);
      for (const row of result.rows) {
        const latest = allMutations
          .filter(
            (m) =>
              m.memoryId === row.memoryId &&
              m.storeRevision <= result.storeRevision,
          )
          .sort((a, b) => b.storeRevision - a.storeRevision)[0];
        if (latest) {
          assert(!["deleted", "purged"].includes(latest.state));
          assert.equal(row.digest, latest.recordDigest);
        }
      }
    }
    summary.mixedRounds++;
    summary.mutations += mutations.length;
  }
  assert.deepEqual(stats(tier.rounds, "durationMs"), tier.wall);
  assert.deepEqual(
    stats(
      tier.rounds.flatMap((r) => r.results.filter((x) => x.role === "reader")),
      "durationMs",
    ),
    tier.read,
  );
  assert.deepEqual(
    stats(
      tier.rounds.flatMap((r) => r.results.flatMap((x) => x.locks)),
      "waitMs",
    ),
    tier.lockWait,
  );
  assert.equal(
    tier.operationsPerSecond,
    (8000 * 100) / tier.rounds.reduce((sum, r) => sum + r.durationMs, 0),
  );
  summary.mixedP95Ms.push({
    count: tier.count,
    read: tier.read.p95Ms,
    lockWait: tier.lockWait.p95Ms,
    operationsPerSecond: tier.operationsPerSecond,
  });
}
assert.equal(referenced.size, 17);
assert.equal(Object.keys(manifest.baseline.sources).length, 17);
const compound = json("compound/compound100.json");
const pipeline = json("compound/pipeline-state.json");
assert.equal(pipeline.status, "passed");
assert.equal(pipeline.exitCode, 0);
assert.equal(pipeline.head, COMPOUND);
assert.equal(pipeline.providerCalls, 0);
assert(
  Date.parse(pipeline.measurementStartedAt) >= Date.parse(queue.finishedAt),
);
for (const flag of [
  "complete",
  "sampleMatrixComplete",
  "cleanupComplete",
  "gitStable",
  "sourceStable",
])
  assert.equal(compound[flag], true);
assert.equal(compound.stage, "complete");
assert.equal(compound.sourceHead, COMPOUND);
assert.equal(compound.workingTree, "clean");
assert.equal(compound.gitIdentity.sourceHead, COMPOUND);
assert.equal(compound.gitIdentity.workingTree, "clean");
assert.equal(compound.workingTreeStatusSha256, tagged(""));
assert.equal(compound.gitIdentity.workingTreeStatusSha256, tagged(""));
assert.equal(compound.performanceAccepted, false);
assert.equal(compound.performanceThresholds, null);
assert.equal(compound.loadContext, "unspecified");
assert.equal(compound.workerTimeoutMs, 120000);
assert.equal(compound.samples, 100);
assert.deepEqual(compound.counts, COUNTS);
assert.equal(
  compound.sourceIdentityHash,
  tagged(JSON.stringify(compound.sourceIdentity)),
);
assert.equal(compound.sourceIdentity.node.version, identity.node);
assert.equal(
  compound.sourceIdentity.node.executableSha256,
  "sha256:" + identity.nodeExecutableSha256,
);
assert.equal(compound.sourceIdentity.node.platform, "win32");
assert.equal(compound.sourceIdentity.node.arch, "x64");
assert.equal(compound.sourceIdentity.kernel.version, "0.1.11");
assert.equal(compound.sourceIdentity.kernel.repositoryBytesVerified, true);
assert.equal(
  compound.sourceIdentity.dependencyCoverage.fullDependencyClosureVerified,
  false,
);
assert.equal(
  compound.sourceIdentity.dependencyCoverage.thirdPartyDependenciesFrozen,
  false,
);
assert.equal(Object.keys(compound.sourceIdentity.localSha256).length, 55);
assert.equal(Object.keys(compound.sourceIdentity.kernel.sha256).length, 18);
for (const [file, digest] of Object.entries(
  compound.sourceIdentity.localSha256,
))
  sourceCheck(manifest.compound.sources, file, digest);
for (const [file, digest] of Object.entries(
  compound.sourceIdentity.kernel.sha256,
))
  sourceCheck(
    manifest.compound.sources,
    "packages/context-memory-kernel/" + file,
    digest,
  );
assert.equal(Object.keys(manifest.compound.sources).length, 73);
assert.equal(
  json(manifest.compound.sources["packages/context-memory-kernel/package.json"])
    .version,
  "0.1.11",
);
assert.equal(
  sha(
    bytes(
      manifest.compound.sources["packages/context-memory-kernel/package.json"],
    ),
  ),
  identity.fileDigests["packages/context-memory-kernel/package.json"],
);
const semanticCases = [
  "empty-scopes",
  "empty-states",
  "empty-tags",
  "unknown-category",
  "unknown-tags",
  "wildcard-sink",
  "exact-scope",
  "global-null",
  "global-omitted",
  "default-includes-candidate",
  "tombstones-hidden",
  "tombstones-visible",
];
assert.deepEqual(
  compound.tiers.map((t) => t.count),
  COUNTS,
);
for (const tier of compound.tiers) {
  assert.equal(tier.complete, true);
  assert.equal(tier.finalAuditVerified, true);
  assert.equal(tier.setup.setupComplete, true);
  assert.equal(tier.oracle.fullAuthorityVerified, true);
  assert.equal(tier.oracle.recordCount, tier.count);
  assert.equal(tier.setup.fixture.count, tier.count);
  assert.equal(tier.oracle.storeRevision, tier.setup.fixture.storeRevision);
  assert.equal(tier.oracle.recordsDigest, tier.setup.fixture.recordsDigest);
  assert.deepEqual(
    tier.semantics.cases.map((c) => c.name),
    semanticCases,
  );
  for (const flag of [
    "equivalentCursorVerified",
    "changedPageSizeVerified",
    "finalAuditVerified",
    "manifestUnchanged",
  ])
    assert.equal(tier.semantics[flag], true);
  assert.equal(tier.semantics.invalidCursorCases, 4);
  assert.equal(tier.semantics.allPages.noDuplicates, true);
  assert.equal(tier.semantics.allPages.fullOracleVerified, true);
  assert.equal(
    tier.semantics.allPages.records,
    tier.groups["category-narrow"].matchingCount,
  );
  summary.compoundSemanticCases += tier.semantics.cases.length;
  assert.deepEqual(Object.keys(tier.groups), [
    "category-narrow",
    "tag-narrow",
    "cold-continuation",
  ]);
  const result = { count: tier.count };
  for (const [name, group] of Object.entries(tier.groups)) {
    assert.equal(group.complete, true);
    assert.equal(group.samplesComplete, true);
    assert.equal(group.samples.length, 100);
    const oracle = tier.oracle.scenarios.find((s) => s.name === name);
    assert(oracle);
    assert.equal(group.expectedDigest, oracle.expectedDigest);
    assert.equal(group.matchingCount, oracle.matchingCount);
    assert.deepEqual(group.query, oracle.query);
    assert.deepEqual(stats(group.samples, "durationMs", false), group.latency);
    for (const [i, sample] of group.samples.entries()) {
      assert.equal(sample.round, i + 1);
      assert.equal(sample.scenario, name);
      assert.equal(sample.serviceCalls, 1);
      assert.equal(sample.initialCompiledIndexCount, 0);
      assert.equal(sample.oracleVerified, true);
      assert.equal(sample.manifestUnchanged, true);
      assert.deepEqual(sample.query, group.query);
      assert.equal(sample.offset, oracle.offset);
      assert.equal(sample.storeRevision, tier.oracle.storeRevision);
      assert.equal(sample.entries.length, oracle.expectedCount);
      assert.equal(sample.rowsDigest, tagged(JSON.stringify(sample.entries)));
      assert.equal(sample.rowsDigest, oracle.expectedDigest);
      assert.equal(Boolean(sample.nextCursor), oracle.expectedHasNext);
      if (sample.nextCursor) {
        const cursor = parse(Buffer.from(sample.nextCursor, "base64url"));
        assert.equal(cursor.schema, "chainlesschain.memory-list-cursor/v1");
        assert.equal(
          cursor.digest,
          tagged(
            JSON.stringify({
              schema: cursor.schema,
              binding: cursor.binding,
              after: cursor.after,
            }),
          ),
        );
        assert.equal(cursor.after.memoryId, sample.entries.at(-1).id);
        assert.equal(cursor.after.updatedAt, sample.entries.at(-1).updated_at);
        assert.equal(
          cursor.after.importance,
          sample.entries.at(-1).importance / 5,
        );
      }
      if (name === "cold-continuation")
        assert.equal(
          sample.query.cursor,
          tier.groups["category-narrow"].samples[0].nextCursor,
        );
      summary.compoundSamples++;
    }
    result[name] = group.latency.p95Ms;
  }
  summary.compoundP95Ms.push(result);
}
assert.equal(summary.queries, 600);
assert.equal(summary.recovery, 600);
assert.equal(summary.cancelled, 600);
assert.equal(summary.mixedRounds, 300);
assert.equal(summary.mutations, 1800);
assert.equal(summary.compoundSamples, 900);
assert.equal(summary.compoundSemanticCases, 36);
assert.deepEqual(summary.queryP95Ms, audit.queryLatency);
assert.deepEqual(summary.recoveryP95Ms, audit.recoveryLatency);
for (const [i, value] of summary.mixedP95Ms.entries())
  assert.deepEqual(value, {
    count: audit.mixedLatency[i].count,
    read: audit.mixedLatency[i].readP95,
    lockWait: audit.mixedLatency[i].lockWaitP95,
    operationsPerSecond: audit.mixedLatency[i].operationsPerSecond,
  });
assert.deepEqual(summary, manifest.summary);
console.log(
  JSON.stringify(
    {
      verified: true,
      artifacts: manifest.artifacts.length,
      uniqueGzipBlobs: blobs.size,
      compressedBytes,
      originalBytes,
      ...summary,
      verifierScope:
        "Archived bytes, source subset bindings, recorded sample/result consistency and recomputed summaries only. No benchmark, Git-1946 audit, full disk oracle, native journey, or dependency-closure rerun.",
      claims: manifest.claims,
    },
    null,
    2,
  ),
);
