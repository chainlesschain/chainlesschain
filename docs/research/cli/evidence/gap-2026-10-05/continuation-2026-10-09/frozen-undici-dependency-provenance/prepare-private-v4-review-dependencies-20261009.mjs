import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { finished } from 'node:stream/promises';
import { Parser } from 'tar';
import { extractRegistryPackageFiles } from '../packages/cli/scripts/verify01-registry-content.mjs';

const output = path.resolve('.work/private-v4-review-dependencies-20261009-with-undici');
fs.mkdirSync(output);
fs.mkdirSync(path.join(output, 'tarballs'));
const lockPath = path.resolve('.work/frozen-source-closure-20261009/package-lock.json');
const lockBytes = fs.readFileSync(lockPath), lock = JSON.parse(lockBytes);
const digest = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const report = { schema: 'chainlesschain.frozen-native-review-dependencies/v1', projectCommit: 'b2aa3aba082873570e85dce39b00754e5504ff37', lockDigest: digest(lockBytes), formalSample: false, status: 'NOT_ADMITTED', lifecycleScriptsExecuted: false, packages: [], files: [] };
const save = () => fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
function download(url, target) {
  const run = spawnSync('curl.exe', ['-fL', '--retry', '2', '--max-time', '60', '--output', target, url], { encoding: 'utf8', windowsHide: true, timeout: 200000, maxBuffer: 1024 * 1024 });
  fs.writeFileSync(target + '.download.json', JSON.stringify({ url, status: run.status, stderr: run.stderr, error: run.error?.message ?? null }, null, 2) + '\n', { flag: 'wx' });
  if (run.status !== 0) throw new Error('Artifact download failed: ' + url);
  return fs.readFileSync(target);
}
try {
  for (const name of ['better-sqlite3', 'bindings', 'file-uri-to-path', 'undici']) {
    const key = 'node_modules/' + name, entry = lock.packages[key];
    if (!entry?.integrity || !entry.resolved?.startsWith('https://registry.npmjs.org/')) throw Error('Missing locked registry artifact');
    const artifactPath = path.join(output, 'tarballs', name + '-' + entry.version + '.tgz');
    const bytes = download(entry.resolved, artifactPath);
    const extracted = extractRegistryPackageFiles({ tarball: bytes, integrity: entry.integrity, packageName: name, packageVersion: entry.version });
    const packageJson = JSON.parse(extracted.files.find((file) => file.path === 'package.json').content);
    if (name === 'undici' && Object.keys(packageJson.dependencies || {}).length) throw Error('Undici has additional runtime dependencies requiring locked closure preparation');
    for (const file of extracted.files) {
      const relative = key + '/' + file.path, target = path.join(output, 'tree', relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, { flag: 'wx' });
      report.files.push({ path: relative, bytes: file.bytes, digest: file.digest, origin: 'locked-registry' });
    }
    report.packages.push({ path: key, name, version: entry.version, url: entry.resolved, integrity: entry.integrity, artifactDigest: extracted.artifactDigest, fileCount: extracted.fileCount });
    save();
  }
  const query = spawnSync('gh', ['api', 'repos/WiseLibs/better-sqlite3/releases/tags/v12.11.1'], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  if (query.status !== 0) throw Error('GitHub prebuild release metadata lookup failed: ' + query.stderr);
  fs.writeFileSync(path.join(output, 'github-release.json'), query.stdout, { flag: 'wx' });
  const release = JSON.parse(query.stdout);
  const matches = release.assets.filter((asset) => asset.name === 'better-sqlite3-v12.11.1-node-v127-win32-x64.tar.gz');
  if (release.tag_name !== 'v12.11.1' || matches.length !== 1) throw Error('Exact ABI127 release asset required');
  const asset = matches[0];
  if (asset.digest !== 'sha256:927b34496e946dc7c9a45636a03a039df72f10191ccc4960b8616d1a9319e45b' || asset.size !== 1039346) throw Error('Prebuild release metadata changed');
  const prebuildPath = path.join(output, 'tarballs', asset.name);
  const bytes = download(asset.browser_download_url, prebuildPath);
  if (digest(bytes) !== asset.digest || bytes.length !== asset.size) throw Error('Prebuild archive bytes differ from GitHub asset metadata');
  const expanded = gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 });
  const entries = [];
  const parser = new Parser({ strict: true, onReadEntry(entry) {
    const chunks = [], row = { name: entry.path, type: entry.type, size: entry.size, linkpath: entry.linkpath, content: null };
    entries.push(row);
    entry.on('data', (chunk) => chunks.push(chunk));
    entry.on('end', () => { row.content = Buffer.concat(chunks); });
  } });
  const done = finished(parser);
  parser.end(expanded);
  await done;
  const regular = [];
  for (const row of entries) {
    const name = row.name.replace(/^\.\//u, '').replace(/\/$/u, '');
    if (row.type === 'Directory' && ['build', 'build/Release'].includes(name) && !row.linkpath && row.size === 0) continue;
    if (row.type !== 'File' || name !== 'build/Release/better_sqlite3.node' || row.linkpath || !row.content || row.content.length !== row.size) throw Error('Unexpected prebuild archive entry: ' + row.name);
    regular.push(row);
  }
  if (regular.length !== 1 || regular[0].content.subarray(0, 2).toString() !== 'MZ') throw Error('Unique PE addon required');
  const relative = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node', target = path.join(output, 'tree', relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, regular[0].content, { flag: 'wx' });
  report.files.push({ path: relative, bytes: regular[0].content.length, digest: digest(regular[0].content), origin: 'github-release-prebuild' });
  report.prebuild = { repository: 'WiseLibs/better-sqlite3', tag: release.tag_name, assetId: asset.id, url: asset.browser_download_url, artifactDigest: asset.digest, artifactBytes: asset.size, nodeAbi: 127, platform: 'win32', arch: 'x64', signedAttestationAssessed: false };
  report.complete = true;
  save();
  console.log(JSON.stringify({ output, files: report.files.length, manifestDigest: digest(fs.readFileSync(path.join(output, 'manifest.json'))), complete: report.complete }));
} catch (error) {
  report.complete = false; report.error = error.message; save(); throw error;
}
