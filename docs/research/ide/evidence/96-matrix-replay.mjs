// Run from any directory: node docs/research/ide/evidence/96-matrix-replay.mjs
// Reads only the compact archive. Omitted artifact bytes require the full-download verifier.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { canonicalJson, sha256Buffer as hash } from '../../../../scripts/ide-journey-evidence.mjs';
import { assertNativeTranscriptEvidence } from '../../../../packages/jetbrains-plugin/scripts/native-transcript-evidence.mjs';
const require = createRequire(import.meta.url);
const { verifyStreamingProfile } = require('../../../../packages/vscode-extension/test/extension-host/driver/streaming-profile.cjs');
const readBytes = name => fs.readFileSync(new URL(name, import.meta.url));
const read = name => JSON.parse(readBytes(name));
const commit = '96cbf6ba5631d5ef855e3cdc41801d837142e62b';
const receipt = read('96-matrix-receipt.json');
const envelopes = read('96-matrix-envelopes.json');
const metrics = read('96-matrix-metrics.json');
const hosts = read('96-matrix-hosts.json');
const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
for (const value of [receipt, envelopes, metrics, hosts]) {
  assert.equal(value.releaseCommit, commit);
  assert.equal(value.workflowRun, '37054226885');
}
assert.equal(receipt.schema, 'cc-ide96-archive-receipt/v1');
assert.equal(envelopes.schema, 'cc-ide96-archived-envelopes/v1');
assert.equal(metrics.schema, 'cc-ide96-archived-metrics/v1');
assert.equal(hosts.schema, 'cc-ide96-host-summary/v1');
assert.equal(receipt.status, 'verified');
assert.equal(hosts.status, 'verified');
assert.deepEqual(receipt.files.map(f => f.path).sort(), [
  '96-matrix-envelopes.json', '96-matrix-metrics.json', '96-matrix-hosts.json',
  '96-matrix-verify-downloaded.mjs', '96-matrix-replay.mjs',
].sort());
for (const file of receipt.files) {
  const bytes = readBytes(file.path);
  assert.equal(bytes.length, file.bytes, file.path);
  assert.equal(hash(bytes), file.sha256, file.path);
}
// Refuse silently changed verifier dependencies, even if their current checks still pass.
for (const source of hosts.verifierSources) {
  assert.equal(hash(fs.readFileSync(new URL('../../../../' + source.path, import.meta.url))), source.sha256, source.path);
}
assert.equal(envelopes.envelopes.length, 18);
assert.equal(hosts.hosts.length, 18);
const byPath = new Map();
let artifactRecords = 0;
for (const record of envelopes.envelopes) {
  assert.ok(!byPath.has(record.path));
  const bytes = Buffer.from(record.sourceText);
  assert.equal(bytes.length, record.sourceBytes);
  assert.equal(hash(bytes), record.sourceSha256);
  const e = JSON.parse(record.sourceText);
  assert.equal(e.schema, 'chainlesschain.ide-journey-evidence');
  assert.equal(e.schemaVersion, 2);
  assert.equal(e.releaseCommit, commit);
  assert.equal(e.result, 'passed');
  assert.equal(e.evidenceComplete, true);
  assert.deepEqual(e.incidents, []);
  const { evidenceDigest, ...core } = e;
  assert.equal(hash(canonicalJson(core)), evidenceDigest);
  const artifacts = e.artifacts.filter(a => a.path).map(({ kind, name = null, path, sha256, bytes }) => ({ kind, name, path, sha256, bytes })).sort((a, b) => a.path.localeCompare(b.path));
  assert.equal(hash(canonicalJson(artifacts)), e.artifactBundleDigest);
  assert.equal(new Set(e.artifacts.map(a => a.path)).size, e.artifacts.length);
  const summaries = hosts.hosts.filter(h => h.envelope === record.path);
  assert.equal(summaries.length, 1);
  const h = summaries[0];
  assert.equal(h.status, 'verified');
  assert.deepEqual(h.issues, []);
  assert.deepEqual(h.host, e.host);
  assert.equal(h.journeyId, e.journeyId);
  assert.equal(h.evidenceDigest, e.evidenceDigest);
  assert.equal(h.artifactBundleDigest, e.artifactBundleDigest);
  assert.equal(h.artifactCount, e.artifacts.length);
  artifactRecords += e.artifacts.length;
  byPath.set(record.path, { e, h });
}
assert.equal(artifactRecords, 628);
assert.equal(receipt.boundArtifactRecords, artifactRecords);
const counts = { vscodeProfiles: 0, jetbrainsProfiles: 0, vscodeUpdates: 0, vscodeFrames: 0, jetbrainsUpdates: 0, jetbrainsEdtTasks: 0, vscodeNeedsInput: 0, jetbrainsNeedsInput: 0 };
const seen = new Set();
assert.equal(metrics.records.length, 24);
for (const record of metrics.records) {
  const key = record.host.envelope + ':' + record.kind;
  assert.ok(!seen.has(key)); seen.add(key);
  const linked = byPath.get(record.host.envelope); assert.ok(linked);
  const { e, h } = linked;
  assert.deepEqual(record.host, { ...e.host, journeyId: e.journeyId, envelope: h.envelope });
  assert.ok(e.artifacts.some(a => canonicalJson(a) === canonicalJson(record.boundArtifact)));
  const bytes = Buffer.from(record.sourceText);
  assert.equal(bytes.length, record.archivedBytes);
  assert.equal(hash(bytes), record.archivedSha256);
  const value = record.kind === 'needs-input' ? record.sourceText.trim().split(/\r?\n/).map(JSON.parse) : JSON.parse(record.sourceText);
  assert.equal(hash(canonicalJson(value)), record.normalizedDataSha256);
  const projected = record.kind === 'needs-input' && e.host.name === 'vscode';
  if (projected) {
    assert.equal(record.sourceSha256, record.boundArtifact.sha256);
    assert.equal(record.sourceBytes, record.boundArtifact.bytes);
  } else {
    assert.equal(record.archivedSha256, record.boundArtifact.sha256);
    assert.equal(record.archivedBytes, record.boundArtifact.bytes);
    if (record.kind !== 'jetbrains-native-v1') {
      assert.equal(record.sourceSha256, record.archivedSha256);
      assert.equal(record.sourceBytes, record.archivedBytes);
    }
  }
  if (record.kind === 'vscode-stream-v2') {
    assert.equal(value.schema, 'cc-ide-host-streaming-profile/v2');
    assert.equal(value.renderer, 'installed-vsix-production-streaming-transcript');
    assert.equal(value.fixtureOutput, true);
    assert.equal(value.performanceGate, false);
    assert.equal(value.warmupCases, 1);
    assert.equal(value.hostPlatform, e.host.operatingSystem);
    assert.equal(value.hostArchitecture, e.host.architecture);
    assert.deepEqual(value.cases.map(c => c.chars), [10000, 100000, 200000]);
    value.cases.forEach(verifyStreamingProfile);
    value.cases.forEach((c, i) => {
      for (const [field, measured] of Object.entries(h.streaming.cases[i])) assert.deepEqual(c[field], measured, field);
      counts.vscodeUpdates += c.samples;
      counts.vscodeFrames += c.frameSamples;
    });
    counts.vscodeProfiles++;
  } else if (record.kind === 'jetbrains-native-v1') {
    assert.equal(value.runToken, '[REDACTED]');
    // ONLY bypass the removed UUID syntax: this placeholder is never evidence of a measured identity.
    const summary = assertNativeTranscriptEvidence({ ...value, runToken: '00000000-0000-4000-8000-000000000000' }, { processId: h.jvmProcessIds.initial, ideVersion: e.host.version });
    assert.deepEqual(summary, h.streaming);
    for (const c of summary.cases) {
      for (const flag of ['selectionPreserved', 'selectionViewportPreserved', 'userScrollPreserved', 'followedBeforeSelection', 'followedAfterResume', 'streamedPlainThenStyled']) assert.equal(c[flag], true);
      counts.jetbrainsEdtTasks += c.sampledEdtTasks;
    }
    counts.jetbrainsUpdates += value.cases.reduce((n, c) => n + c.samples.length, 0);
    counts.jetbrainsProfiles++;
  } else {
    assert.equal(record.kind, 'needs-input');
    const samples = value.filter(r => r.metric === 'needs-input-visible');
    assert.equal(samples.length, 100);
    samples.forEach((s, i) => {
      assert.equal(s.sample, i + 1); assert.equal(s.sampleCount, 100); assert.equal(s.thresholdMs, 2000);
      assert.ok(Number.isFinite(s.latencyMs) && s.latencyMs >= 0);
    });
    const measuredP95 = p95(samples.map(s => s.latencyMs));
    assert.ok(measuredP95 < 2000);
    assert.equal(h.needsInput.p95LatencyMs, measuredP95);
    assert.equal(h.needsInput.samples, 100);
    if (e.host.name === 'vscode') {
      assert.ok(value.every(r => r.phase === 'initial'));
      const summary = value.filter(r => r.metric === 'needs-input-visible-summary');
      assert.equal(summary.length, 1); assert.equal(value.length, 101);
      assert.deepEqual(summary[0], h.needsInput);
      assert.equal(summary[0].warmupSamples, 1);
      counts.vscodeNeedsInput += samples.length;
    } else {
      assert.equal(e.host.name, 'jetbrains');
      assert.ok(value.every(r => r.host === 'jetbrains'));
      const readiness = value.filter(r => r.metric === 'needs-input-readiness');
      assert.ok(readiness.length >= 40 && readiness.length <= 75);
      let streak = 0;
      readiness.forEach((s, i) => {
        assert.equal(s.sample, i + 1); assert.equal(s.minimumSampleCount, 40); assert.equal(s.maximumSampleCount, 75);
        assert.equal(s.thresholdMs, 2000); assert.equal(s.requiredConsecutivePassingSamples, 10);
        assert.ok(Number.isFinite(s.latencyMs) && s.latencyMs >= 0);
        streak = s.latencyMs < 2000 ? streak + 1 : 0;
        assert.equal(s.consecutivePassingSamples, streak);
        if (s.sample >= 40 && streak >= 10) assert.equal(i, readiness.length - 1);
      });
      assert.ok(streak >= 10); assert.equal(readiness.length, 40);
      assert.equal(h.needsInput.readinessSamples, readiness.length);
      const q = value.filter(r => r.metric === 'workbench-quiescence'); assert.equal(q.length, 1);
      for (const [field, expected] of Object.entries({ state: 'done', dispatchEnabled: true, replyEnabled: false, stableProbes: 4, requiredStableProbes: 4, probeIntervalMs: 250 })) assert.equal(q[0][field], expected);
      assert.ok(value.indexOf(q[0]) > value.indexOf(readiness.at(-1)));
      assert.ok(value.indexOf(samples[0]) > value.indexOf(q[0]));
      assert.equal(value.length, readiness.length + 1 + samples.length);
      counts.jetbrainsNeedsInput += samples.length;
    }
  }
}
assert.deepEqual(counts, { vscodeProfiles: 6, jetbrainsProfiles: 6, vscodeUpdates: 1152, vscodeFrames: 1134, jetbrainsUpdates: 1152, jetbrainsEdtTasks: 1170, vscodeNeedsInput: 600, jetbrainsNeedsInput: 600 });
assert.deepEqual(receipt.sampleCoverage, hosts.sampleCoverage);
assert.equal(hosts.sampleCoverage.vscode.totalUpdateSamples, counts.vscodeUpdates);
assert.equal(hosts.sampleCoverage.vscode.totalFrameIntervals, counts.vscodeFrames);
assert.equal(hosts.sampleCoverage.jetbrains.totalUpdateSamples, counts.jetbrainsUpdates);
assert.equal(hosts.sampleCoverage.jetbrains.totalSampledEdtTasksIncludingFinalize, counts.jetbrainsEdtTasks);
console.log(JSON.stringify({ status: 'verified', commit, envelopes: byPath.size, boundArtifactRecords: artifactRecords, archivedMetricRecords: metrics.records.length, ...counts, exclusions: ['Redacted native run-token syntax and identity are excluded from compact replay.', 'Omitted screenshot/log/binary bytes and complete VS CDP ledgers require full-download verification.', ...receipt.limitations] }, null, 2));
