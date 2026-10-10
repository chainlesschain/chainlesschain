import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractRegistryPackageFiles } from '../packages/cli/scripts/verify01-registry-content.mjs';
const execute = promisify(execFile);
const digest = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const planPath = path.resolve('.work/private-v4-cli-required-runtime-plan-20261009.json');
const planBytes = fs.readFileSync(planPath);
assert.equal(digest(planBytes), 'sha256:88541c676ffbe825bff459449b8122bd45734760d3eeeddad94d6eaa3be1dfc4');
const plan = JSON.parse(planBytes);
const lockBytes = fs.readFileSync(plan.frozenLock.path), lock = JSON.parse(lockBytes);
assert.equal(digest(lockBytes), plan.frozenLock.digest);
const output = path.resolve('.work/private-v4-cli-runtime-closure-20261009');
fs.mkdirSync(output); fs.mkdirSync(path.join(output, 'tarballs'));
fs.writeFileSync(path.join(output, 'required-runtime-plan.json'), planBytes, { flag: 'wx' });
const report = { schema: 'chainlesschain.private-v4-cli-runtime-closure/v1', status: 'NOT_ADMITTED', admissionEligible: false, formalSample: false, lockDigest: digest(lockBytes), planDigest: digest(planBytes), lifecycleScriptsExecuted: false, packageCodeExecuted: false, canonicalRuntimeLayoutProven: false, nativeOptionalBuildsGenerated: false, packages: [], files: [], mirrors: [], failures: [] };
const save = () => fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
function safe(relative) { assert.ok(!/[\\:*?<>|"\x00-\x1f]/u.test(relative) && relative.split('/').every((part) => part && part !== '.' && part !== '..')); return relative; }
function resolveDependency(from, name) {
  let cursor = from;
  for (;;) {
    const key = (cursor ? cursor + '/' : '') + 'node_modules/' + name;
    if (lock.packages[key]) return key;
    if (!cursor) throw Error('Missing locked dependency ' + from + ':' + name);
    cursor = path.posix.dirname(cursor); if (cursor === '.') cursor = '';
  }
}
const packagePaths = new Set(plan.registryPackages.map((row) => row.lockPath));
const extraSeeds = ['node_modules/better-sqlite3', ...plan.optionalAliasShadowConflicts.map((row) => row.expected)];
const extraQueue = [...extraSeeds];
while (extraQueue.length) {
  const key = safe(extraQueue.shift()); if (packagePaths.has(key)) continue;
  const entry = lock.packages[key]; assert.ok(entry && !entry.link && entry.integrity && entry.resolved?.startsWith('https://registry.npmjs.org/'));
  packagePaths.add(key);
  for (const name of Object.keys(entry.dependencies || {})) extraQueue.push(resolveDependency(key, name));
}
report.additionalSourceOnlySeeds = extraSeeds;
const prepared = path.resolve('.work/native-toolchain-prepare-2026-10-08-canonical-pairs');
const cache = new Map(JSON.parse(fs.readFileSync(path.join(prepared, 'registry-artifacts.json'))).artifacts.map((row) => [row.packagePath, path.join(prepared, 'tarballs', row.file)]));
const keys = [...packagePaths].sort();
let next = 0, completed = 0;
async function acquire(key, index) {
  const entry = lock.packages[key], name = key.slice(key.lastIndexOf('node_modules/') + 13);
  const target = path.join(output, 'tarballs', String(index).padStart(4, '0') + '.tgz');
  let artifact, cached = false;
  if (cache.has(key)) { artifact = fs.readFileSync(cache.get(key)); cached = true; }
  else {
    const response = await execute('curl.exe', ['-fL', '--retry', '2', '--max-time', '60', '--output', target, entry.resolved], { windowsHide: true, timeout: 200000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    fs.writeFileSync(target + '.download.json', JSON.stringify({ url: entry.resolved, stderr: response.stderr }, null, 2) + '\n', { flag: 'wx' });
    artifact = fs.readFileSync(target);
  }
  const extracted = extractRegistryPackageFiles({ tarball: artifact, integrity: entry.integrity, packageName: name, packageVersion: entry.version });
  if (cached) fs.writeFileSync(target, artifact, { flag: 'wx' });
  for (const row of extracted.files) {
    const relative = safe(key + '/' + row.path), file = path.join(output, 'tree', relative);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, row.content, { flag: 'wx' });
    report.files.push({ path: relative, bytes: row.bytes, digest: row.digest, lockPath: key, origin: 'locked-registry' });
  }
  report.packages.push({ path: key, name, version: entry.version, url: entry.resolved, integrity: entry.integrity, artifactDigest: extracted.artifactDigest, artifactPath: target, files: extracted.fileCount, bytes: extracted.contentBytes, hasInstallScript: Boolean(entry.hasInstallScript), requiredRuntime: plan.registryPackages.some((row) => row.lockPath === key), lifecycleExecuted: false });
  completed++; if (completed % 25 === 0 || completed === keys.length) { save(); console.log(JSON.stringify({ completed, packages: keys.length, files: report.files.length })); }
}
async function worker() { for (;;) { const index = next++; if (index >= keys.length) return; try { await acquire(keys[index], index); } catch (error) { report.failures.push({ packagePath: keys[index], error: error.message }); save(); throw error; } } }
try {
  const results = await Promise.allSettled(Array.from({ length: 4 }, worker));
  if (results.some((row) => row.status === 'rejected')) throw Error('One or more locked packages failed acquisition');
  const prior = path.resolve('.work/private-v4-review-dependencies-20261009-retry'), priorBytes = fs.readFileSync(path.join(prior, 'manifest.json'));
  assert.equal(digest(priorBytes), 'sha256:5d23e625547730f6dba7957fc73d5d692d2548f4d815c76b593cf92fe3e84baf');
  const original = JSON.parse(priorBytes), native = original.files.filter((row) => row.origin === 'github-release-prebuild');
  assert.equal(native.length, 1);
  for (const row of native) {
    const content = fs.readFileSync(path.join(prior, 'tree', row.path)); assert.equal(content.length, row.bytes); assert.equal(digest(content), row.digest);
    const file = path.join(output, 'tree', row.path); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, { flag: 'wx' }); report.files.push(row);
  }
  report.rootSqlitePrebuild = { ...original.prebuild, sourceManifestDigest: digest(priorBytes) };
  const closure = JSON.parse(fs.readFileSync('.work/frozen-source-closure-20261009/source-closure.json'));
  for (const link of closure.workspaceLinks) {
    const nested = report.files.filter((row) => row.path.startsWith(link.source + '/node_modules/'));
    for (const row of nested) {
      const relative = safe(link.nodeModulesPath + row.path.slice(link.source.length));
      const file = path.join(output, 'tree', relative), content = fs.readFileSync(path.join(output, 'tree', row.path));
      assert.equal(digest(content), row.digest); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, { flag: 'wx' });
      report.files.push({ ...row, path: relative, mirrorOf: row.path }); report.mirrors.push({ path: relative, origin: row.path, digest: row.digest });
    }
  }
  report.files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  assert.equal(new Set(report.files.map((row) => row.path.toLowerCase())).size, report.files.length);
  report.packages.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  report.zeroByteFiles = report.files.filter((row) => row.bytes === 0).map((row) => row.path);
  report.complete = true; report.totalBytes = report.files.reduce((sum, row) => sum + row.bytes, 0); save();
  console.log(JSON.stringify({ output, packages: report.packages.length, files: report.files.length, zeroByteFiles: report.zeroByteFiles.length, bytes: report.totalBytes, manifestDigest: digest(fs.readFileSync(path.join(output, 'manifest.json'))) }));
} catch (error) { report.complete = false; report.error = error.message; save(); throw error; }
