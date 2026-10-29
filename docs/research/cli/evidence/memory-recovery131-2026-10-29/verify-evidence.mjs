import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

// Offline evidence verification only: never imports or runs the benchmark.
const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../../../..");
const measuredCommit = "98c4be4a76e22b127518b1ea1116dabdfb95dd10";
const releaseCommit = "c9d0bab231850697df38f2d476c2dd974cbcb6c0";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (bytes) =>
  JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, ""));
const gitBytes = (commit, file) =>
  execFileSync("git", ["show", `${commit}:${file}`], {
    cwd: repository,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
const names = [
  "candidate131-recovery100.json",
  "candidate131-recovery100.log",
  "candidate131-recovery100-process.json",
];
let review;
if (process.argv.includes("--archive")) {
  assert.ok(
    !fs.existsSync(path.join(directory, "review.json")),
    "Do not overwrite existing evidence",
  );
  fs.mkdirSync(path.join(directory, "raw"), { recursive: true });
  const artifacts = names.map((name) => {
    const original = fs.readFileSync(
      path.join(repository, ".work/memory-query-bundle", name),
    );
    const stored = gzipSync(original, { level: 9 });
    assert.deepEqual(gunzipSync(stored), original);
    const archivedPath = `raw/${name}.gz`;
    fs.writeFileSync(path.join(directory, archivedPath), stored, {
      flag: "wx",
    });
    return {
      originalPath: `.work/memory-query-bundle/${name}`,
      archivedPath,
      originalBytes: original.length,
      originalSha256: hash(original),
      storedBytes: stored.length,
      storedSha256: hash(stored),
      encoding: "gzip",
    };
  });
  review = {
    schema: "chainlesschain.memory-recovery131-archive/v1",
    archivedAt: new Date().toISOString(),
    measuredCommit,
    releaseCommit,
    artifacts,
  };
} else {
  review = readJson(fs.readFileSync(path.join(directory, "review.json")));
}
const originals = review.artifacts.map((entry) => {
  const stored = fs.readFileSync(path.join(directory, entry.archivedPath));
  assert.equal(stored.length, entry.storedBytes);
  assert.equal(hash(stored), entry.storedSha256);
  const original = gunzipSync(stored);
  assert.equal(original.length, entry.originalBytes);
  assert.equal(hash(original), entry.originalSha256);
  return original;
});
const report = readJson(originals[0]);
const log = originals[1].toString("utf8");
const receipt = readJson(originals[2]);
assert.equal(report.schema, "chainlesschain.memory-query-index-measurement/v1");
assert.equal(report.sourceHead, measuredCommit);
assert.equal(report.workingTree, "clean");
assert.equal(report.platform, "win32");
assert.equal(report.arch, "x64");
assert.equal(report.node, "v22.22.2");
assert.equal(report.complete, true);
assert.equal(report.samples, 100);
assert.deepEqual(report.counts, [1000, 10000, 100000]);
assert.deepEqual(report.modes, ["rebuild", "corrupt"]);
assert.equal(report.cacheMode, "validate-disk");
assert.equal(report.indexLayout, "bundle");
assert.deepEqual(report.query, { category: "category-7", limit: 20 });
assert.equal(report.performanceThresholds, null);
assert.equal(receipt.exitCode, 0);
assert.equal(receipt.signal, null);
assert.equal(receipt.error, null);
assert.equal(receipt.sourcesStable, true);
assert.deepEqual(receipt.sourceBefore, receipt.sourceAfter);
assert.equal(Object.keys(receipt.sourceBefore).length, 15);
assert.equal(report.tiers.length, 3);
const round = (number) => Math.round(number * 1000) / 1000;
const groups = [];
for (const [tierIndex, tier] of report.tiers.entries()) {
  assert.equal(tier.count, report.counts[tierIndex]);
  assert.match(tier.expectedDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(Object.keys(tier.groups), report.modes);
  for (const [mode, group] of Object.entries(tier.groups)) {
    assert.equal(group.complete, true);
    assert.equal(group.samples.length, 100);
    for (const [index, sample] of group.samples.entries()) {
      assert.equal(
        sample.rowsDigest,
        tier.expectedDigest,
        `${tier.count}/${mode}/${index + 1}: oracle digest`,
      );
      assert.equal(
        sample.count,
        20,
        `${tier.count}/${mode}/${index + 1}: row count`,
      );
      for (const field of [
        "durationMs",
        "authorityReads",
        "authorityBytes",
        "indexReadOpens",
        "bundleReadOpens",
        "directoryChecks",
        "peakRssBytes",
        "rssBytes",
        "heapUsedBytes",
        "eventLoopDelayMaxMs",
      ]) {
        assert.ok(
          Number.isFinite(sample[field]) && sample[field] >= 0,
          `${tier.count}/${mode}/${index + 1}: ${field}`,
        );
      }
    }
    const durations = group.samples
      .map((sample) => sample.durationMs)
      .sort((a, b) => a - b);
    const percentile = (fraction) =>
      round(durations[Math.ceil(durations.length * fraction) - 1]);
    assert.deepEqual(group.latency, {
      samples: 100,
      minMs: round(durations[0]),
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: round(durations.at(-1)),
    });
    assert.deepEqual(group.authorityReads, [
      ...new Set(group.samples.map((sample) => sample.authorityReads)),
    ]);
    assert.deepEqual(group.authorityBytes, [
      ...new Set(group.samples.map((sample) => sample.authorityBytes)),
    ]);
    assert.equal(
      group.peakRssBytes,
      Math.max(...group.samples.map((sample) => sample.peakRssBytes)),
    );
    assert.ok(log.includes(`${tier.count} ${mode}: 100/100`));
    groups.push({
      count: tier.count,
      mode,
      sampleCount: 100,
      complete: true,
      oracleDigest: tier.expectedDigest,
      oracleDigestMatches: 100,
      rowCountMatches: 100,
      latencyRecomputed: true,
      latency: group.latency,
      authorityReads: group.authorityReads,
      authorityReadBytes: group.authorityBytes,
      peakRssBytes: group.peakRssBytes,
    });
  }
}
const aliases = {
  "with-file-lock.js": "packages/cli/src/lib/with-file-lock.js",
  "secure-file-identity.js": "packages/cli/src/lib/secure-file-identity.js",
  "kernel/canonical.js": "packages/context-memory-kernel/lib/canonical.js",
  "kernel/contracts.js": "packages/context-memory-kernel/lib/contracts.js",
  "fixture-generator.mjs":
    "packages/cli/scripts/persistent-capacity-benchmark.mjs",
  "benchmark.mjs": "packages/cli/scripts/memory-query-index-benchmark.mjs",
};
const bound = new Map(
  Object.entries(receipt.sourceBefore).map(([file, digest]) => [
    file,
    { digest, wrapperBeforeAfter: true, benchmarkChecks: false },
  ]),
);
for (const [alias, digest] of Object.entries(report.implementationSha256)) {
  const file =
    aliases[alias] || `packages/cli/src/lib/context-memory-kernel/${alias}`;
  const previous = bound.get(file);
  if (previous) assert.equal(previous.digest, digest);
  bound.set(file, {
    digest,
    wrapperBeforeAfter: previous?.wrapperBeforeAfter || false,
    benchmarkChecks: true,
  });
}
assert.equal(bound.size, 16);
const sourceBindings = [...bound]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, value]) => {
    const measuredBytes = gitBytes(measuredCommit, file);
    const releaseBytes = gitBytes(releaseCommit, file);
    assert.equal(
      hash(measuredBytes),
      value.digest,
      `Measured source binding: ${file}`,
    );
    assert.deepEqual(
      releaseBytes,
      measuredBytes,
      `Release source differs: ${file}`,
    );
    return {
      path: file,
      sha256: value.digest,
      wrapperBeforeAfter: value.wrapperBeforeAfter,
      benchmarkGroupAndCompletionChecks: value.benchmarkChecks,
      measuredGitBlobMatches: true,
      releaseGitBlobMatches: true,
    };
  });
const validation = {
  measuredCommit,
  releaseCommit,
  observedWorkingTreeAtMeasurementStart: report.workingTree,
  platform: report.platform,
  arch: report.arch,
  node: report.node,
  startedAt: receipt.startedAt,
  endedAt: receipt.endedAt,
  processExitCode: receipt.exitCode,
  complete: true,
  totalSamples: groups.reduce((sum, group) => sum + group.sampleCount, 0),
  allSampleOracleDigestsMatch: true,
  allSampleRowCountsMatch: true,
  groups,
  sourceBindings,
  boundary:
    "Offline verification of existing Windows measurements, not a new benchmark or new-release-commit full SLO. Oracle comparisons use the recorded full-fixture expected digest. Wrapper before/after covers 15 sources; benchmark group/tier/completion checks cover 13 sources, including secure-file-identity.js. Source checks do not establish continuous stability between observations. authorityReads/authorityBytes are read instrumentation, not independent per-sample raw-authority hashing. No paid or release admission is granted.",
};
assert.equal(validation.totalSamples, 600);
if (process.argv.includes("--archive")) {
  review.validation = validation;
  fs.writeFileSync(
    path.join(directory, "review.json"),
    JSON.stringify(review, null, 2) + "\n",
    { flag: "wx" },
  );
} else {
  assert.deepEqual(validation, review.validation);
}
console.log(
  JSON.stringify({
    status: "VERIFIED",
    artifacts: review.artifacts.length,
    samples: validation.totalSamples,
    groups: groups.length,
    sources: sourceBindings.length,
    measuredCommit,
    releaseCommit,
    paidRequests: 0,
    newBenchmarkRuns: 0,
  }),
);
