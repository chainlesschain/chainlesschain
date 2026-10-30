import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const root = path.dirname(fileURLToPath(import.meta.url));
const hash = b => createHash('sha256').update(b).digest('hex');
const review = JSON.parse(fs.readFileSync(path.join(root, 'review.json')));
const files = new Map();
for (const a of review.artifacts) {
  assert.match(a.object, /^objects\/[a-f0-9]{64}\.gz$/); assert.ok(!files.has(a.logicalPath));
  const compressed = fs.readFileSync(path.join(root, a.object)), raw = gunzipSync(compressed);
  assert.equal(hash(compressed), a.compressedSha256); assert.equal(compressed.length, a.compressedBytes);
  assert.equal(hash(raw), a.contentSha256); assert.equal(raw.length, a.contentBytes);
  assert.equal(a.object, `objects/${hash(raw)}.gz`); files.set(a.logicalPath, raw);
}
const raw = p => { assert.ok(files.has(p), p); return files.get(p); };
const json = p => JSON.parse(raw(p));
const old = json('frozen/archive-manifest.json');
assert.equal(old.files.length, 53);
assert.equal(old.state, 'PRIVATE_NOT_COMMITTED_OR_INSTALLED');
assert.equal(old.assistedInstalled, 3);
assert.equal(old.runId, 40982291969);
assert.equal(old.commit, '817844899753040cd6917a5b00b1ba5b03b32cb3');
assert.equal(old.frozenProject, 'b2aa3aba082873570e85dce39b00754e5504ff37');
for (const f of old.files) {
  assert.equal(hash(raw('frozen/' + f.path)), f.originalSha256);
  const a = review.artifacts.find(a => a.logicalPath === 'frozen/' + f.path);
  assert.equal(a.compressedSha256, f.storedSha256);
}
assert.equal('sha256:' + hash(raw('frozen/download/artifact.zip')), old.artifact.digest);
const run = json('frozen/github/run.json'); assert.equal(run.id, old.runId); assert.equal(run.conclusion, 'success'); assert.equal(run.head_sha, old.commit);
const payload = 'frozen/artifact/chainlesschain/chainlesschain/docs/research/cli/evidence/assisted-next132-0413-ci/';
const manifest = json(payload + 'manifest.json');
for (const [p, f] of Object.entries(manifest.files)) { assert.equal(hash(raw(payload + p)), f.sha256); assert.equal(raw(payload + p).length, f.bytes); }
let frozenReports = 0;
function tests(report, total, passed, failed) {
  assert.equal(report.numTotalTests, total); assert.equal(report.numPassedTests, passed); assert.equal(report.numFailedTests, failed);
  assert.equal(report.numPendingTests, 0); assert.equal(report.numTodoTests || 0, 0); assert.equal(report.numRuntimeErrorTestSuites || 0, 0);
  assert.equal(report.success, failed === 0);
  assert.equal(report.testResults.flatMap(t => t.assertionResults).length, total);
}
for (const task of manifest.tasks) {
  const baseline = task.taskId === 'verify-04' ? 22 : 13;
  for (const stage of ['setup', 'check']) {
    const prefix = `frozen/artifact/_temp/assisted-next132-0413/${task.taskId}/pack/acceptance-evidence/${task.taskId}-${stage}-`;
    const matches = [...files.keys()].filter(p => p.startsWith(prefix)); assert.equal(matches.length, 1);
    const receipt = json(matches[0]); assert.equal(receipt.pass, true); assert.equal(receipt.isolation, 'docker'); assert.equal(receipt.imageId, manifest.imageId);
    assert.deepEqual(receipt.tests[0], { kind: 'baseline', total: baseline, passed: baseline, failed: 0 });
    if (stage === 'check') {
      assert.deepEqual(receipt.tests[1], { kind: 'candidate', total: 6, passed: 6, failed: 0 }); assert.equal(receipt.mutations.length, 2);
      for (const [i, mutant] of receipt.mutations.entries()) { assert.equal(mutant.name, task.mutants[i].name); assert.equal(mutant.sourceSha256, task.mutants[i].sourceSha256); assert.equal(mutant.failed, 1); assert.equal(mutant.passed, 5); }
    }
    const reports = receipt.executions.flatMap(e => { try { const r = JSON.parse(e.stdout); return typeof r.numTotalTests === 'number' ? [{ r, e }] : []; } catch { return []; } });
    assert.equal(reports.length, stage === 'setup' ? 1 : 4);
    for (const [i, { r, e }] of reports.entries()) { const mutant = i > 1; tests(r, i === 0 ? baseline : 6, i === 0 ? baseline : mutant ? 5 : 6, mutant ? 1 : 0); assert.equal(e.exitCode, mutant ? 1 : 0); frozenReports++; }
  }
}
tests(json('compatibility/runs/verify-04/stdout.json'), 28, 27, 1);
tests(json('compatibility/runs/verify-13/stdout.json'), 19, 19, 0);
tests(json('adaptation/runs/verify-04-current-main-regression/stdout.json'), 28, 28, 0);
tests(json('adaptation/runs/verify-13-current-main-regression/stdout.json'), 19, 19, 0);
for (const name of ['merge-short-and-long-request-price-buckets', 'drop-cache-tokens-from-request-threshold']) {
  const p = `adaptation/runs/verify-04-mutant-${name}/`;
  tests(json(p + 'stdout.json'), 6, 5, 1); assert.equal(json(p + 'process.json').exitCode, 1);
}
const original04 = raw(payload + 'verify-04/corrected.test.js').toString();
assert.equal(raw('adaptation/verify-04/install.test.js').toString().replace('        cacheEvidence: "missing",\n', ''), original04);
assert.deepEqual(raw('adaptation/verify-13/install.test.js'), raw(payload + 'verify-13/corrected.test.js'));
const binding = json('current-binding-and-formatting.json');
assert.equal(binding.currentSource, review.source); assert.equal(binding.mismatches, 0); assert.equal(binding.dependencyFiles.length, 59);
const previous = json('compatibility/current-source-bindings.json');
for (const f of binding.dependencyFiles) { const old = previous.files.find(p => p.path === f.path); assert.ok(old); assert.equal(f.sha256, old.sha256); assert.equal(f.bytes, old.bytes); }
for (const c of binding.formatter.candidates) { assert.equal(c.onlyPrettier, true); assert.equal(hash(raw(`adaptation/${c.taskId}/install.test.js`)), c.candidateSha256); assert.equal(hash(raw(`installed/${c.taskId}.test.js`)), c.installedSha256); }
const local = json('local/process.json'); assert.equal(local.source, review.source); assert.equal(local.sourceState, 'modified-worktree-before-commit'); assert.equal(local.exitCode, 0); assert.equal(local.signal, null); assert.equal(local.error, null);
tests(json('local/stdout.json'), 63, 63, 0); assert.equal(json('local/stdout.json').testResults.length, 8);
for (const id of ['verify-04', 'verify-13']) { const b = local.bindings.find(f => f.path.endsWith('/' + id + '.test.js')); assert.equal(hash(raw(`installed/${id}.test.js`)), b.sha256); }
const workflow = raw('installed/cli-ci.yml').toString();
for (const id of ['04', '07', '09', '10', '13']) assert.ok(workflow.includes(`__tests__/verify-${id}.test.js`));
assert.equal(review.taskAcceptance.automaticAccepted, 34); assert.equal(review.taskAcceptance.installedAssisted, 5);
assert.equal(review.cloudCompatibility, 'PENDING_EXACT_COMMIT_CLI_CI');
assert.deepEqual(raw('helpers/verify.mjs'), fs.readFileSync(fileURLToPath(import.meta.url)));
console.log(JSON.stringify({ status: 'VERIFIED_OFFLINE', artifacts: files.size, objects: new Set(review.artifacts.map(a => a.object)).size, frozenDockerVitestReports: frozenReports, originalCompatibility: '04 27/28, 13 19/19', adaptedCompatibility: '04 28/28, 13 19/19, two intended mutants rejected', currentWorktree: '8 files, 63/63, zero skipped', dependencyBindings: 59, automaticAccepted: '34/45', installedAssisted: 5, cloudCompatibility: review.cloudCompatibility }));
