import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { canonicalDigest } from '@chainlesschain/context-memory-kernel';

const candidate = '8b13129624d4b7fa5b122a4109151c574564448e';
const baseline = '22c0e4036cd08f6a205539c88fcdec47081af544';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
assert.equal(git('rev-parse', 'HEAD'), candidate);
assert.equal(git('status', '--porcelain'), '');
const sourceRoot = process.cwd();
const outputRoot = path.join(sourceRoot, '.work');
fs.mkdirSync(outputRoot, { recursive: true });
const sourceImport = (file) => import(pathToFileURL(path.join(sourceRoot, file)).href);
const { createDurableMemoryFixture, summarizeDurations } = await sourceImport('packages/cli/scripts/persistent-capacity-benchmark.mjs');
const { CliCanonicalMemoryService } = await sourceImport('packages/cli/src/lib/context-memory-kernel/memory-service.js');
const { SegmentedMemoryPort } = await sourceImport('packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js');
const shared = [
  'packages/cli/src/lib/context-memory-kernel/runtime.js',
  'packages/cli/src/lib/context-memory-kernel/segmented-memory-port.js',
  'packages/cli/src/lib/context-memory-kernel/authority.js',
  'packages/cli/src/lib/context-memory-kernel/privacy-purge-port.js',
  'packages/context-memory-kernel',
];
assert.equal(git('diff', '--name-only', baseline, candidate, '--', ...shared), '');
const serviceFile = 'packages/cli/src/lib/context-memory-kernel/memory-service.js';
assert.equal(git('diff', '--name-only', baseline, candidate, '--', 'packages/cli/src/lib/context-memory-kernel', 'packages/context-memory-kernel', 'packages/cli/scripts/persistent-capacity-benchmark.mjs'), serviceFile);
// Workspace package resolution walks up to the existing root installation.
// Check its actual bytes against the detached candidate, without new links.
const resolvedKernelRoot = path.dirname(fileURLToPath(import.meta.resolve('@chainlesschain/context-memory-kernel')));
const candidateRequire = createRequire(path.join(sourceRoot, 'packages/cli/package.json'));
assert.equal(fs.realpathSync(path.resolve(path.dirname(candidateRequire.resolve('@chainlesschain/context-memory-kernel')), '..')), fs.realpathSync(resolvedKernelRoot));
const kernelFiles = git('ls-tree', '-r', '--name-only', candidate, '--', 'packages/context-memory-kernel').split('\n');
const dependencyFiles = {};
for (const file of kernelFiles) {
  const relative = path.relative('packages/context-memory-kernel', file);
  const pinned = sha256(fs.readFileSync(path.join(sourceRoot, file)));
  assert.equal(sha256(fs.readFileSync(path.join(resolvedKernelRoot, relative))), pinned, `shared kernel dependency differs: ${file}`);
  dependencyFiles[relative] = pinned;
}
const original = execFileSync('git', ['show', `${baseline}:${serviceFile}`], { windowsHide: true });
const runtimeUrl = pathToFileURL(path.resolve('packages/cli/src/lib/context-memory-kernel/runtime.js')).href;
const relocated = original.toString('utf8').replace('from "./runtime.js"', `from ${JSON.stringify(runtimeUrl)}`);
assert.notEqual(relocated, original.toString('utf8'));
const baselineModule = path.resolve('.work/memory-service-baseline-22c0.mjs');
fs.writeFileSync(baselineModule, relocated);
const BaselineService = (await import(pathToFileURL(baselineModule).href)).CliCanonicalMemoryService;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-memory-delete-8b131-'));
const report = {
  schema: 'chainlesschain.memory-exact-delete-local-comparison/v1',
  sourceCommit: candidate, baselineCommit: baseline, recordedAt: new Date().toISOString(),
  sourceRoot, scriptSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
  sharedDependency: { root: resolvedKernelRoot, files: dependencyFiles },
  platform: process.platform, osRelease: os.release(), arch: process.arch, node: process.version,
  protocol: { tiers: [1000, 10000, 100000], samples: 11, alternatingPairOrder: true, concurrent: false, coldPageCache: false, defaultCanonicalStageChanged: false, snapshotImported: true, purgePorts: [], excludes: ['CLI process startup', 'legacy privacy-port cleanup', 'fixture setup', 'post-write audit verification'], performanceGate: false, productionQualified: false },
  sourceBlobs: Object.fromEntries([serviceFile, ...shared.filter(file => !file.endsWith('context-memory-kernel'))].map(file => [file, git('hash-object', file)])),
  baselineModule: { originalSha256: sha256(original), relocatedSha256: sha256(relocated), onlyRelocation: 'runtime import points at byte-identical candidate runtime; baseline service body retained' },
  tiers: [],
};

function service(Service, filePath) {
  const port = new SegmentedMemoryPort({ filePath });
  const instance = new Service({ memoryPort: port, memoryFilePath: filePath, env: { CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: 'canonical_default' }, purgePorts: [] });
  const counters = { read: 0, listRecords: 0, query: 0 };
  for (const method of Object.keys(counters)) {
    const invoke = port[method];
    port[method] = async function (...args) { counters[method] += 1; return invoke.apply(this, args); };
  }
  return { instance, port, counters, durations: [], receipts: [] };
}
try {
  for (const count of report.protocol.tiers) {
    const setupStarted = performance.now();
    let state = createDurableMemoryFixture(count);
    const ids = Object.keys(state.records).slice(0, report.protocol.samples);
    const fixtureDigest = state.digest;
    const auditDigest = canonicalDigest(state.events, 'persistent-capacity-audit/v1');
    const before = service(BaselineService, path.join(root, `baseline-${count}.json`));
    const after = service(CliCanonicalMemoryService, path.join(root, `candidate-${count}.json`));
    await before.port.importSnapshot(state);
    await after.port.importSnapshot(state);
    state = null;
    const setupMs = performance.now() - setupStarted;
    console.log(JSON.stringify({ phase: 'setup-complete', count, setupMs }));
    for (let i = 0; i < ids.length; i += 1) {
      for (const current of i % 2 ? [after, before] : [before, after]) {
        const started = performance.now();
        const receipt = await current.instance.delete(ids[i]);
        current.durations.push(performance.now() - started);
        assert.equal(receipt.status, 'purged');
        current.receipts.push({ status: receipt.status, digest: receipt.digest });
      }
      console.log(JSON.stringify({ phase: 'pair-complete', count, sample: i + 1 }));
    }
    const variants = [];
    for (const [name, current] of [['baseline', before], ['candidate', after]]) {
      if (name === 'candidate') {
        assert.equal(current.counters.listRecords, 0);
        assert.equal(current.counters.query, 0);
      } else {
        assert.equal(current.counters.listRecords, ids.length);
        assert.equal(current.counters.query, ids.length);
      }
      const counts = { ...current.counters };
      const snapshot = await new SegmentedMemoryPort({ filePath: current.port.filePath }).exportSnapshot();
      assert.equal(Object.keys(snapshot.records).length, count);
      assert.equal(snapshot.events.length, count + ids.length * 2);
      // Full kernel deletion also publishes two reconciliation-only updates.
      assert.equal(snapshot.storeRevision, count + ids.length * 4);
      assert.equal(Object.keys(snapshot.reconciliations).length, ids.length);
      assert.equal(canonicalDigest(snapshot.events.slice(0, count), 'persistent-capacity-audit/v1'), auditDigest);
      for (const id of ids) {
        assert.equal(snapshot.records[id].state, 'purged');
        assert.equal(snapshot.records[id].content, '');
      }
      assert.equal(Object.values(snapshot.records).filter(row => row.state === 'active').length, count - ids.length);
      variants.push({ name, timingsMs: current.durations, summary: summarizeDurations(current.durations), calls: counts, deletionReceipts: current.receipts, postWrite: { verified: true, recordCount: count, eventCount: snapshot.events.length, storeRevision: snapshot.storeRevision, reconciliationCount: ids.length, originalAuditPrefixVerified: true, selectedPurged: ids.length, untouchedActive: count - ids.length } });
    }
    report.tiers.push({ recordCount: count, fixtureDigest, originalAuditDigest: auditDigest, setupMs, variants });
    console.log(JSON.stringify({ phase: 'tier-complete', count, summaries: variants.map(v => ({ name: v.name, summary: v.summary, calls: v.calls })) }));
  }
  assert.equal(git('rev-parse', 'HEAD'), candidate);
  assert.equal(git('status', '--porcelain'), '');
  report.completedAt = new Date().toISOString();
  report.processPeakRssBytes = process.resourceUsage().maxRSS * 1024;
  report.retainedFixtureDirectory = root;
  const output = path.resolve('.work/memory-exact-delete-comparison-8b131.raw.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ phase: 'complete', output, sha256: sha256(fs.readFileSync(output)) }));
} catch (error) {
  report.failure = { message: error.message, recordedAt: new Date().toISOString() };
  report.retainedFixtureDirectory = root;
  fs.writeFileSync(path.join(outputRoot, 'memory-exact-delete-comparison-8b131.failed.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify({ phase: 'failed', retainedFixtureDirectory: root, message: error.message }));
  throw error;
}
