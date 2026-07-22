#!/usr/bin/env node

/**
 * Verify that a published IDE artifact is visible and downloadable from its
 * registry. This is intentionally a post-publish check: package metadata and
 * CI upload success do not prove that a marketplace indexed the version.
 */

const channel = process.argv[2];
const requestedVersion = process.argv[3] || null;

if (!['open-vsx', 'jetbrains'].includes(channel)) {
  console.error('usage: node scripts/verify-ide-marketplace.mjs <open-vsx|jetbrains> [version]');
  process.exit(2);
}

const version = requestedVersion || (channel === 'open-vsx' ? '0.0.0' : '0.0.0');
const endpoint =
  channel === 'open-vsx'
    ? 'https://open-vsx.org/api/chainlesschain/chainlesschain-ide'
    : 'https://plugins.jetbrains.com/api/plugins/32208/updates';

const response = await fetch(endpoint, {
  headers: { accept: 'application/json' },
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
  throw new Error(`${channel} registry returned HTTP ${response.status}`);
}
const payload = await response.json();

let record;
if (channel === 'open-vsx') {
  const latest = payload?.version;
  const listed = payload?.allVersions &&
    Object.prototype.hasOwnProperty.call(payload.allVersions, version);
  const versionResponse = await fetch(`${endpoint}/${encodeURIComponent(version)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!versionResponse.ok) {
    throw new Error(`Open VSX version endpoint returned HTTP ${versionResponse.status}`);
  }
  const versionPayload = await versionResponse.json();
  const downloadable = versionPayload?.downloadable === true;
  if (versionPayload?.version !== version || !downloadable || !listed) {
    throw new Error(
      `Open VSX mismatch: expected ${version}, version=${versionPayload?.version}, latest=${latest}, ` +
      `downloadable=${downloadable}, listed=${listed}`,
    );
  }
  record = { version, latest, downloadable, listed };
} else {
  const rows = Array.isArray(payload) ? payload : [];
  record = rows.find((row) => row?.version === version);
  if (!record || record.approve !== true || record.listed !== true || record.hidden === true) {
    throw new Error(
      `JetBrains Marketplace mismatch: expected listed approved visible ${version}`,
    );
  }
  record = {
    version: record.version,
    approve: record.approve,
    listed: record.listed,
    hidden: record.hidden,
  };
}

console.log(JSON.stringify({ channel, endpoint, ...record }));
