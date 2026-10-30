import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

// Offline: no original work directory, dist, Git, credentials or network needed.
const base = path.dirname(fileURLToPath(import.meta.url));
const sha = b => createHash('sha256').update(b).digest('hex');
const review = JSON.parse(fs.readFileSync(path.join(base, 'review.json')));
const B = '458d92e6c837074cf119512bf2b40cde4b95f7a2';
const A = '0d57ebfea919ae941a36a1f11a9ee10964722120';
const runtime = '772fcdbda85bcf91df95bfced5b476dcf4c74614';
const stamp = '20261030-031009-458d92e6c8-docs';
const entries = new Map();
const objects = new Set();
for (const a of review.artifacts) {
  assert.match(a.object, /^objects\/[a-f0-9]{64}\.gz$/);
  assert.ok(!entries.has(a.logicalPath), 'Duplicate artifact');
  const compressed = fs.readFileSync(path.join(base, a.object));
  assert.equal(compressed.length, a.compressedBytes);
  assert.equal(sha(compressed), a.compressedSha256);
  const raw = gunzipSync(compressed);
  assert.equal(raw.length, a.contentBytes);
  assert.equal(sha(raw), a.contentSha256);
  assert.equal(a.object, `objects/${a.contentSha256}.gz`);
  entries.set(a.logicalPath, raw);
  objects.add(a.object);
}
const raw = p => { assert.ok(entries.has(p), `Missing ${p}`); return entries.get(p); };
const json = p => JSON.parse(raw(p));
const source = json('source.json');
assert.equal(source.source, B);
assert.equal(source.releaseSource, runtime);
assert.equal(source.evidenceCommit, A);
assert.equal(source.status, 'ROOT_REVIEWED_READY');
assert.equal(sha(raw('release-publication.json')), source.publicationSha256);
for (const [name, digest] of Object.entries(source.reviewedDeploymentScripts)) {
  assert.equal(sha(raw(name)), digest);
}
const deploy = json('deploy-process.json');
assert.equal(deploy.source, B);
assert.equal(deploy.observedSource, B);
assert.equal(deploy.sourceBindingSha256, sha(raw('source.json')));
assert.equal(deploy.exitCode, 0);
assert.equal(deploy.stamp, stamp);
assert.equal(deploy.state, 'deployed_requires_server_and_public_readback');
const prefix = review.finalReadbackDirectory + '/';
const report = json(prefix + 'readback.json');
assert.equal(report.source, B);
assert.equal(report.releaseSource, runtime);
assert.equal(report.evidenceCommit, A);
assert.equal(report.stamp, stamp);
assert.equal(report.serverManifestVerified, true);
assert.equal(json(prefix + 'server-process.json').exitCode, 0);
const serverLog = raw(prefix + 'server-manifest-check.log').toString();
assert.equal(serverLog.split(/\r?\n/).filter(l => l.endsWith(': OK')).length, 4245);
assert.equal(report.httpsTransport.redirectsAllowed, false);
assert.deepEqual(report.httpsTransport.dnsEvidence, json('dns-a-records-for-readback.json'));
assert.equal(report.httpsTransport.dnsEvidence.records.length, 3);
for (const d of report.httpsTransport.dnsEvidence.records) assert.equal(d.ipv4, '47.111.5.128');
const links = json('rendered-link-checks.json');
assert.equal(links.source, B);
assert.equal(links.evidenceCommit, A);
assert.equal(links.checked.length, 13);
const expected = { docs: [2022, 665, 5], design: [902, 292, 2], www: [45, 20, 6] };
assert.deepEqual(report.sites.map(s => s.site).sort(), Object.keys(expected).sort());
let newFiles = 0, pages = 0, requests = 0;
function transport(name, host) {
  const t = json(prefix + name + '.https-transport.json');
  assert.equal(t.http_code, 200);
  assert.equal(t.exitcode, 0);
  assert.equal(t.remote_ip, '47.111.5.128');
  assert.equal(t.ssl_verify_result, 0);
  assert.equal(t.num_redirects, 0);
  assert.equal(t.method, 'GET');
  assert.equal(new URL(t.url).protocol, 'https:');
  assert.equal(new URL(t.url).hostname, host);
  assert.equal(t.size_download, raw(prefix + name).length);
  const attempts = json(prefix + name + '.https-read-attempts.json');
  assert.equal(attempts.method, 'GET');
  assert.equal(attempts.url, t.url);
  assert.ok(attempts.attempts.length >= 1 && attempts.attempts.length <= 3);
  assert.equal(attempts.attempts.at(-1).exitCode, 0);
  for (const a of attempts.attempts.slice(0, -1)) assert.ok([7, 28, 52, 56].includes(a.exitCode));
  requests++;
}
for (const site of report.sites) {
  const [count, html, samples] = expected[site.site];
  const buildName = `build-${site.site}-process.json`;
  const build = json(buildName);
  assert.equal(build.source, B);
  assert.equal(build.releaseSource, runtime);
  assert.equal(build.evidenceCommit, A);
  assert.equal(build.sourceBindingSha256, sha(raw('source.json')));
  assert.equal(build.exitCode, 0);
  assert.equal(build.sourceStable, true);
  assert.equal(build.buildOutputVerified, true);
  assert.equal(build.files.length, count);
  assert.equal(build.htmlPages, html);
  assert.equal(deploy.builds.find(b => b.site === site.site).receiptSha256, sha(raw(buildName)));
  const meta = json(prefix + `${site.site}-deployment-source.json`);
  assert.deepEqual(meta, site.deployment);
  assert.equal(meta.sourceHeadCommit, B);
  assert.equal(meta.sourceStatus, 'clean-commit');
  assert.equal(meta.stamp, stamp);
  assert.equal(meta.newFiles, count);
  assert.equal(meta.newHtmlPages, html);
  assert.ok(serverLog.includes(JSON.stringify(meta)), 'Server metadata must match public metadata');
  const manifest = raw(prefix + `${site.site}-deployment-files.sha256`);
  assert.equal(sha(manifest), site.checksumManifestSha256);
  const hashes = new Map();
  for (const line of manifest.toString().trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  (?:\.\/)?(.+)$/.exec(line);
    assert.ok(match);
    assert.ok(!hashes.has(match[2]));
    hashes.set(match[2], match[1]);
  }
  for (const file of build.files) assert.equal(hashes.get(file.path), file.sha256);
  assert.equal(site.newFileHashesMatched, count);
  assert.equal(site.sampledPages.length, samples);
  const host = `${site.site}.chainlesschain.com`;
  transport(`${site.site}-deployment-source.json`, host);
  transport(`${site.site}-deployment-files.sha256`, host);
  for (const page of site.sampledPages) {
    const name = `${site.site}-page-${page.path.replaceAll('/', '__')}`;
    const bytes = raw(prefix + name);
    const local = build.files.find(f => f.path === page.path);
    const checked = links.checked.find(f => f.site === site.site && f.path === page.path);
    assert.ok(local && checked);
    assert.equal(page.status, 200);
    assert.equal(page.matchesLocalBuild, true);
    for (const record of [local, checked, page]) {
      assert.equal(record.sha256, sha(bytes));
      assert.equal(record.bytes, bytes.length);
    }
    transport(name, host);
    pages++;
  }
  newFiles += count;
}
assert.equal(review.newFileHashesMatched, newFiles);
assert.equal(review.publicSampledPages, pages);
assert.equal(review.serverManifestEntriesIncludingRetained, 4245);
assert.deepEqual(review.taskAcceptance, { accepted: 34, total: 45, installedAssisted: 3, newAccepted: 0, newModelRequests: 0 });
assert.equal(review.previousReadbackDirectories.length, 3);
assert.equal(json('deployment-approval-review-block.json').processStarted, false);
console.log(JSON.stringify({ status: 'VERIFIED_OFFLINE', artifacts: entries.size, uniqueObjects: objects.size, documentationSource: B, stamp, newFileHashesMatched: newFiles, publicSampledPages: pages, httpsRequestsVerified: requests, serverManifestEntriesIncludingRetained: 4245 }));
