import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const root = process.cwd();
const rawPath = path.join(root, '.work/memory-exact-delete-comparison-8b131.raw.json');
const bytes = fs.readFileSync(rawPath);
const report = JSON.parse(bytes);
const measured = '8b13129624d4b7fa5b122a4109151c574564448e';
const release = '736784f9994e71525c2c61026663995fe7ee199e';
const relatedRelease = '8458a0a5027d1a844e382f8ad5624894745d1ef1';
assert.equal(report.sourceCommit, measured);
assert.equal(git('rev-parse', 'HEAD'), measured);
assert.equal(git('status', '--porcelain'), '');
assert.equal(git('rev-parse', `${measured}:packages`), git('rev-parse', `${release}:packages`));
assert.equal(git('rev-parse', `${measured}:packages`), git('rev-parse', `${relatedRelease}:packages`));
assert.equal(hash(bytes), '0006470d8ec807400e429449b9dbe70886d7c163ebd2fee93dad94184ca15b42');
assert.equal(hash(fs.readFileSync('C:/code/chainlesschain/.work/memory-exact-delete-benchmark-8b131.mjs')), report.scriptSha256);
assert.equal(hash(fs.readFileSync('.work/memory-service-baseline-22c0.mjs')), report.baselineModule.relocatedSha256);
for (const [file, digest] of Object.entries(report.sourceBlobs)) assert.equal(git('rev-parse', `${measured}:${file}`), digest);
for (const [file, digest] of Object.entries(report.sharedDependency.files)) assert.equal(hash(fs.readFileSync(path.join(report.sharedDependency.root, file))), digest);
assert.deepEqual(report.tiers.map(tier => tier.recordCount), [1000, 10000, 100000]);
const rows = [];
for (const tier of report.tiers) {
  assert.deepEqual(tier.variants.map(variant => variant.name), ['baseline', 'candidate']);
  for (const variant of tier.variants) {
    assert.equal(variant.timingsMs.length, 11);
    assert(variant.timingsMs.every(value => Number.isFinite(value) && value > 0));
    const ordered = [...variant.timingsMs].sort((a, b) => a - b);
    const p50Ms = Number(ordered[5].toFixed(3));
    const p95Ms = Number(ordered[10].toFixed(3));
    assert.equal(variant.summary.p50Ms, p50Ms);
    assert.equal(variant.summary.p95Ms, p95Ms);
    assert.equal(variant.summary.samples, 11);
    assert.equal(variant.deletionReceipts.length, 11);
    assert(variant.deletionReceipts.every(receipt => receipt.status === 'purged' && /^sha256:[0-9a-f]{64}$/.test(receipt.digest)));
    assert.deepEqual(variant.calls, variant.name === 'baseline' ? { read: 11, listRecords: 11, query: 11 } : { read: 22, listRecords: 0, query: 0 });
    assert.deepEqual(variant.postWrite, { verified: true, recordCount: tier.recordCount, eventCount: tier.recordCount + 22, storeRevision: tier.recordCount + 44, reconciliationCount: 11, originalAuditPrefixVerified: true, selectedPurged: 11, untouchedActive: tier.recordCount - 11 });
    rows.push({ records: tier.recordCount, variant: variant.name, samples: 11, p50Ms, p95Ms, calls: variant.calls });
  }
}
const method = {
  measuredCommit: measured,
  releaseCommitWithIdenticalPackages: release,
  relatedReleaseCommit: relatedRelease,
  relatedReleaseSourceEquivalence: {
    packagesTree: git('rev-parse', `${relatedRelease}:packages`),
    identicalToMeasured: true,
    scope: 'Identical packages Git tree only; actual measurement remains at measuredCommit and does not establish hosted release gates for the related commit',
  },
  packagesTree: git('rev-parse', `${measured}:packages`),
  rawPath,
  rawSha256: hash(bytes),
  readbackAt: new Date().toISOString(),
  hardwareObservedAtReadback: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
  method: {
    realService: 'CliCanonicalMemoryService.delete(memoryId), canonical_default, SegmentedMemoryPort, purgePorts=[]',
    baselineService: 'Unmodified 22c0 service body with only runtime.js import relocation to the byte-identical candidate runtime',
    samples: '11 alternating baseline/candidate pairs at each tier; distinct full IDs selected from the same synthetic snapshot; fresh store for each variant/tier; all timings retained',
    quantiles: 'nearest-rank; at n=11 p95/p99 equal max, not a statistical confidence bound',
    included: 'ID resolution, actual kernel deletion transitions, two reconciliation-only commits, durable shard/manifest writes and returned deletion receipt',
    excluded: report.protocol.excludes,
    validation: 'After timing, reopen each store; +4 revisions and +2 events per delete, original audit prefix digest, purged content, reconciliation count, untouched active count checked',
    limitations: ['Windows x64 local host only', 'Warm OS page cache; no cache clearing or forced GC', 'One sequential Node process; no claim that external host load was controlled', 'No CLI startup or legacy privacy-port cleanup measurement', 'Synthetic fixture is a capacity comparison, not real project effectiveness', 'No target-hardware/global SLO or hosted-release-gate claim'],
  },
  readbackChecksPassed: true,
  productionQualified: false,
  rows,
};
const output = path.join(root, '.work/memory-exact-delete-comparison-8b131.method.json');
fs.writeFileSync(output, JSON.stringify(method, null, 2) + '\n');
console.log(JSON.stringify({ output, rawSha256: method.rawSha256, rows }, null, 2));
