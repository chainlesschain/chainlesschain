import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const digest = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const prepared = path.resolve('.work/native-toolchain-prepare-2026-10-08-canonical-pairs/tree');
const source = path.resolve('.work/frozen-source-closure-20261009');
const dependencyRoot = path.resolve('.work/private-v4-cli-runtime-closure-20261009');
const dependencyBytes = fs.readFileSync(path.join(dependencyRoot, 'manifest.json'));
assert.equal(digest(dependencyBytes), 'sha256:5bfc483de04a94957f1a979eee01f3079f613afd192f15dfd1fd203ac04d4db9');
const dependencies = JSON.parse(dependencyBytes), closureBytes = fs.readFileSync(path.join(source, 'source-closure.json')), closure = JSON.parse(closureBytes);
assert.equal(digest(closureBytes), 'sha256:b8a63ab9af6e4d9be9469af2c07416d350b5a1f70301b40d8f89ffbc0f1ea658');
const files = new Map(), directories = new Set(['control', 'workspace', 'workspace/adapter', 'workspace/tree']), conflicts = [];
function parents(relative) { let cursor = path.posix.dirname(relative); while (cursor !== '.') { directories.add(cursor); cursor = path.posix.dirname(cursor); } }
function add(relative, row) {
  const key = relative.toLowerCase(), previous = files.get(key);
  if (previous) {
    previous.digest ||= digest(fs.readFileSync(previous.source));
    const nextDigest = row.digest || digest(fs.readFileSync(row.source));
    if (previous.path !== relative || previous.bytes !== row.bytes || previous.digest !== nextDigest) conflicts.push({ path: relative, old: previous.digest, new: nextDigest, before: previous.source, after: row.source });
  } else { files.set(key, { path: relative, ...row }); parents(relative); }
}
function scan(directory, prefix) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink()); const actual = path.join(directory, entry.name), relative = prefix + '/' + entry.name;
    if (entry.isDirectory()) { directories.add(relative); scan(actual, relative); }
    else { const stat = fs.statSync(actual); assert.ok(stat.isFile() && stat.nlink === 1); add(relative, { bytes: stat.size, source: actual }); }
  }
}
scan(prepared, 'workspace/tree');
for (const row of closure.files) add('workspace/tree/' + row.path, { ...row, source: path.join(source, row.path) });
for (const link of closure.workspaceLinks) for (const row of closure.files) {
  if (!row.path.startsWith(link.source + '/')) continue;
  const suffix = row.path.slice(link.source.length + 1);
  if (/^(?:__tests__|tests?|scripts|docs|examples|benchmarks|\.github)\//u.test(suffix)) continue;
  add('workspace/tree/' + link.nodeModulesPath + '/' + suffix, { ...row, source: path.join(source, row.path) });
}
for (const row of dependencies.files) add('workspace/tree/' + row.path, { ...row, source: path.join(dependencyRoot, 'tree', row.path) });
for (const name of ['node.exe', 'check.cjs', 'review-vitest.config.mjs']) add('control/' + name, { bytes: name === 'node.exe' ? 87074816 : 0, digest: null, source: null });
for (const name of ['windows-node-private-v4.node', 'esbuild-private-shim.dll', 'windows-node-private-v4-preload.cjs', 'windows-node-private-v4-identity.cjs']) add('workspace/adapter/' + name, { bytes: 0, digest: null, source: null });
add('workspace/entry.js', { bytes: 24, digest: null, source: null });
const result = { formalSample: false, admissionEligible: false, inputManifestDigest: digest(dependencyBytes), files: files.size, directories: directories.size, guardNodesBeforeActorManifests: files.size + directories.size, fileBytesLowerBound: [...files.values()].reduce((sum, row) => sum + row.bytes, 0), conflicts, mirroredWorkspacePackages: closure.workspaceLinks.length, scope: 'Simulates existing prepared tree, all frozen Git files, runtime workspace mirrors, full dependency overlay and fixed control/adapter; mutable scratch excluded' };
fs.writeFileSync('.work/private-v4-cli-runtime-closure-20261009/preflight.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
assert.equal(conflicts.length, 0);
