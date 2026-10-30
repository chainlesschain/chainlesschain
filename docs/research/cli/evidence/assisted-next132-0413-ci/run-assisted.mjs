import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const payload = path.dirname(fileURLToPath(import.meta.url));
const repository = process.cwd();
assert.equal(process.platform, 'linux');
assert.equal(process.version, 'v22.12.0');
assert.ok(process.argv[2], 'Explicit fresh output directory required');
const output = path.resolve(process.argv[2]);
assert.ok(!fs.existsSync(output));
fs.mkdirSync(output, {recursive: true});
const manifest = JSON.parse(fs.readFileSync(path.join(payload, 'manifest.json')));
const hash = b => createHash('sha256').update(b).digest('hex');
// Only operating-system/Docker plumbing reaches the checker; no provider env.
const env = Object.fromEntries(['PATH', 'TEMP', 'TMP', 'DOCKER_HOST', 'DOCKER_CONTEXT'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const summary = {kind: 'assisted-non-native', generationAssessment: 'NOT_PERFORMED', automaticAccepted: '34/45 unchanged', assistedAccepted: '3 unchanged', newModelRequests: 0, providerSecrets: 0, frozenProjectCommit: manifest.frozenProjectCommit, driverCommit: manifest.driverCommit, imageId: manifest.imageId, tasks: [], pass: false};
const commands = path.join(output, 'commands');
fs.mkdirSync(commands);
function verifyPayload() {
  for (const [file, expected] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(path.join(payload, file));
    assert.equal(bytes.length, expected.bytes, file);
    assert.equal(hash(bytes), expected.sha256, file);
  }
}
function command(label, executable, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(executable, args, {env, cwd: repository, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...options});
  fs.writeFileSync(path.join(commands, `${label}.stdout.log`), result.stdout || '');
  fs.writeFileSync(path.join(commands, `${label}.stderr.log`), result.stderr || '');
  fs.writeFileSync(path.join(commands, `${label}.process.json`), JSON.stringify({executable, args: label.includes('-stage-') ? ['--input-type=module', '--eval', '<exact manifest-bound original script>', '<frozen workspace>', '<deadline>'] : args, exitCode: result.status, signal: result.signal, error: result.error?.message || null, elapsedMs: Date.now() - started}, null, 2) + '\n');
  assert.equal(result.error, undefined, `${label}: process error`);
  assert.equal(result.status, 0, `${label}: process exit`);
  return result.stdout;
}
try {
  verifyPayload();
  assert.deepEqual(manifest.tasks.map(t => t.taskId), ['verify-04', 'verify-13']);
  const inspected = JSON.parse(command('image', 'docker', ['image', 'inspect', 'node:22.12.0-bookworm']))[0];
  assert.equal(inspected.Id, manifest.imageId);
  // Sequential independent workspaces: full original setup/check for each task.
  for (const task of manifest.tasks) {
    const {taskId, spec} = task;
    const taskOutput = path.join(output, taskId);
    const workspace = path.join(taskOutput, 'workspace');
    const pack = path.join(taskOutput, 'pack');
    fs.mkdirSync(workspace, {recursive: true}); fs.mkdirSync(pack);
    const result = {taskId, originalRunId: task.runId, stages: {}, pass: false};
    summary.tasks.push(result);
    const archive = path.join(taskOutput, 'frozen.tar');
    command(`${taskId}-archive`, 'git', ['archive', '--format=tar', `--output=${archive}`, manifest.frozenProjectCommit]);
    command(`${taskId}-extract`, 'tar', ['-xf', archive, '-C', workspace]);
    function frozen() {
      for (const [file, digest] of Object.entries(task.frozenFiles)) assert.equal(hash(fs.readFileSync(path.join(workspace, file))), digest, file);
    }
    frozen();
    const candidate = path.join(workspace, spec.expectedFiles[0]);
    assert.ok(!fs.existsSync(candidate));
    function stage(name) {
      const bytes = fs.readFileSync(path.join(payload, `${taskId}-${name}.mjs`));
      const originalSpec = JSON.parse(bytes.toString().match(/^const spec = (.+);$/m)[1]);
      assert.deepEqual(originalSpec, spec);
      // Original internal 10-minute stage cap remains unchanged.
      const stdout = command(`${taskId}-stage-${name}`, process.execPath, ['--input-type=module', '--eval', bytes.toString(), workspace, String(Date.now() + 20 * 60 * 1000)], {cwd: pack, timeout: 21 * 60 * 1000});
      const verdict = JSON.parse(stdout.trim());
      assert.match(verdict.receipt, new RegExp(`^${taskId}-${name}-[a-f0-9-]+\\.json$`));
      const receiptBytes = fs.readFileSync(path.join(pack, 'acceptance-evidence', verdict.receipt));
      assert.equal('sha256:' + hash(receiptBytes), verdict.receiptDigest);
      const receipt = JSON.parse(receiptBytes);
      result.stages[name] = {...verdict, scriptDigest: hash(bytes), tests: receipt.tests, mutations: receipt.mutations};
      assert.equal(receipt.scope, 'verify01-operator-acceptance');
      assert.equal(receipt.taskId, taskId); assert.equal(receipt.stage, name);
      assert.equal(receipt.isolation, 'docker'); assert.equal(receipt.imageId, manifest.imageId);
      assert.equal(receipt.providerAssessed, false); assert.equal(receipt.productionAttested, false);
      assert.equal(receipt.pass, verdict.pass); assert.equal(receipt.pass, true, receipt.detail);
      frozen();
      return receipt;
    }
    const baseline = {kind: 'baseline', total: task.baselineTotal, passed: task.baselineTotal, failed: 0};
    const setup = stage('setup');
    assert.deepEqual(setup.tests, [baseline]);
    fs.writeFileSync(candidate, fs.readFileSync(path.join(payload, taskId, 'corrected.test.js')), {flag: 'wx'});
    const checked = stage('check');
    assert.deepEqual(checked.tests, [baseline, {kind: 'candidate', total: 6, passed: 6, failed: 0}]);
    assert.equal(checked.mutations.length, 2);
    for (const [index, mutant] of checked.mutations.entries()) {
      assert.equal(mutant.name, task.mutants[index].name);
      assert.equal(mutant.sourceSha256, task.mutants[index].sourceSha256);
      assert.equal(mutant.total, 6); assert.equal(mutant.passed, 5); assert.equal(mutant.failed, 1);
    }
    assert.equal(hash(fs.readFileSync(candidate)), manifest.files[`${taskId}/corrected.test.js`].sha256);
    result.pass = true;
  }
  summary.pass = true;
} catch (error) {
  summary.failure = error.stack;
  process.exitCode = 1;
} finally {
  try { verifyPayload(); } catch (error) {summary.pass = false; summary.payloadFailure = error.stack; process.exitCode = 1;}
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({kind: summary.kind, pass: summary.pass, summary: path.join(output, 'summary.json')}));
}
