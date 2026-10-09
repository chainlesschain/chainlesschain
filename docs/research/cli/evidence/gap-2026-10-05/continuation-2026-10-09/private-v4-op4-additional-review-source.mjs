import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const output = 'docs/research/cli/evidence/gap-2026-10-05/continuation-2026-10-09';
const index = JSON.parse(fs.readFileSync('.work/windows-private-v4-final-matrix-index.json', 'utf8'));
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const describe = file => { const bytes = fs.readFileSync(file); return { bytes: bytes.length, digest: digest(bytes) }; };
const expected = index.producerSnapshots;
assert.equal(expected.length, 12);
const currentReviewer = describe('packages/cli/scripts/windows-node-private-v4-result.mjs');
const producerReviewer = expected.find(row => row.name === 'windows-node-private-v4-result.mjs');
assert.notEqual(currentReviewer.digest, producerReviewer.digest);
for (const row of expected) {
  if (row.name === producerReviewer.name) continue;
  const directory = /\.(?:cpp|h|cjs)$/.test(row.name) ? 'packages/cli/scripts/diagnostics' : 'packages/cli/scripts';
  assert.deepEqual(describe(path.join(directory, row.name)), { bytes: row.bytes, digest: row.digest });
}
const reportFiles = [index.baselineReport, index.fullBaselineReport,
  ...[...index.completedFinalMutants, ...index.survivedFinalMutants].map(row => row.report)];
// The failed first attempt remains a failure and is checked separately below.
const failedFirstPath = '.work/windows-private-v4-20261009-final-mutant-12/report.json';
if (!reportFiles.some(row => path.resolve(row.path) === path.resolve(failedFirstPath)))
  reportFiles.push({ path: path.resolve(failedFirstPath), ...describe(failedFirstPath) });
assert.equal(reportFiles.length, 13);
const reviewed = [];
for (const capture of reportFiles) {
  const bytes = fs.readFileSync(capture.path);
  assert.equal(bytes.length, capture.bytes);
  assert.equal(digest(bytes), capture.digest);
  const report = JSON.parse(bytes);
  const sourceRows = [...report.sources, report.driver, report.validatorSource, report.dependencyValidatorSource];
  assert.equal(sourceRows.length, 12);
  for (const row of sourceRows) {
    const producer = expected.find(item => item.name === path.basename(row.path));
    assert.ok(producer);
    assert.equal(row.bytes, producer.bytes);
    assert.equal(row.digest, producer.digest);
    assert.deepEqual(describe(row.path), { bytes: row.bytes, digest: row.digest });
  }
  const host = JSON.parse(report.execution.stdout);
  const successfulTerminationRows = (host.creationLedger || []).filter(row =>
    row.kind === 'vitest-worker' && row.exit === 1 && row.terminationRequested === true &&
    row.terminationCallSucceeded === true);
  for (const row of successfulTerminationRows) assert.equal(row.terminationCallError, 0);
  reviewed.push({ path: capture.path, bytes: bytes.length, digest: capture.digest,
    mode: report.mode, producerSourcesRetainedAndEqual: 12,
    successfulOp4Rows: successfulTerminationRows.length,
    allSuccessfulTerminationErrorsAreZero: true,
    producerReviewValidation: report.reviewValidation,
    host: { completed: host.completed, rootExit: host.rootExit,
      cleanupConfirmed: host.cleanupConfirmed, jobActiveProcesses: host.jobActiveProcesses,
      profileDeleted: host.profileDeleted } });
}
const value = { scope: 'additional-op4-error-field-and-producer-source-consistency',
  producerValidator: producerReviewer, additionalReviewer: currentReviewer,
  fullInspectorRerun: false, dependenciesRewalked: false, nativeRerun: false,
  baselineByteBindingUpdated: false, reviewed, formalSample: false,
  admissionEligible: false, fullFrozenReviewCompleted: false,
  recordedAt: new Date().toISOString() };
fs.writeFileSync(path.join(output, 'private-v4-op4-additional-review.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ reports: reviewed.length, producerSources: 12,
  successfulOp4Rows: reviewed.reduce((sum,row) => sum + row.successfulOp4Rows,0),
  producerValidatorDigest: producerReviewer.digest, additionalReviewerDigest: currentReviewer.digest }));
