import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const input = path.resolve('.work/private-v4-review-dependencies-20261009-with-undici');
const output = path.resolve('.work/private-v4-review-dependencies-20261009-runtime-subset');
const bytes = fs.readFileSync(path.join(input, 'manifest.json'));
const digest = (value) => 'sha256:' + createHash('sha256').update(value).digest('hex');
assert.equal(digest(bytes), 'sha256:a6a470a2a7439954afb71c2205552ffc8f34836b62351f9a778309569cd39129');
const manifest = JSON.parse(bytes);
const omission = 'node_modules/undici/lib/llhttp/.gitkeep';
const empty = manifest.files.filter((row) => row.bytes === 0);
assert.equal(empty.length, 1); assert.equal(empty[0].path, omission); assert.equal(empty[0].digest, digest(Buffer.alloc(0)));
assert.ok(manifest.files.some((row) => row.bytes > 0 && row.path.startsWith('node_modules/undici/lib/llhttp/')));
fs.mkdirSync(output);
for (const name of ['github-release.json']) fs.copyFileSync(path.join(input, name), path.join(output, name), fs.constants.COPYFILE_EXCL);
const files = [];
for (const row of manifest.files) {
  assert.ok(row.path.startsWith('node_modules/') && row.path.split('/').every((part) => part && part !== '.' && part !== '..') && !/[\\:]/u.test(row.path));
  const source = path.join(input, 'tree', row.path), stat = fs.lstatSync(source), content = fs.readFileSync(source);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1); assert.equal(content.length, row.bytes); assert.equal(digest(content), row.digest);
  if (row.path === omission) continue;
  const target = path.join(output, 'tree', row.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content, { flag: 'wx' }); files.push(row);
}
const value = { ...manifest, schema: 'chainlesschain.frozen-native-review-runtime-subset/v1', files, runtimeSubset: true, packageContentComplete: false, parentManifest: { path: path.join(input, 'manifest.json'), digest: digest(bytes), bytes: bytes.length }, omissions: [{ ...empty[0], reason: 'Empty npm package bookkeeping file; original archive and complete package manifest retained; no executable bytes omitted' }], derivedWithoutPackageExecution: true };
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, files: files.length, manifestDigest: digest(fs.readFileSync(path.join(output, 'manifest.json'))), omission }));
