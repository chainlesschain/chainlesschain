#!/usr/bin/env node

/**
 * Verify that a published IDE artifact is visible and downloadable from its
 * registry. This is intentionally a post-publish check: package metadata and
 * CI upload success do not prove that a marketplace indexed the version.
 */

const channel = process.argv[2];
const requestedVersion = process.argv[3] || null;
const retryAttempts = positiveInteger(
  process.env.CC_MARKETPLACE_VERIFY_ATTEMPTS,
  12,
);
const retryDelayMs = positiveInteger(
  process.env.CC_MARKETPLACE_VERIFY_DELAY_MS,
  10_000,
);

if (!["open-vsx", "jetbrains"].includes(channel)) {
  console.error(
    "usage: node scripts/verify-ide-marketplace.mjs <open-vsx|jetbrains> [version]",
  );
  process.exit(2);
}

const version =
  requestedVersion || (channel === "open-vsx" ? "0.0.0" : "0.0.0");
const endpoint =
  channel === "open-vsx"
    ? "https://open-vsx.org/api/chainlesschain/chainlesschain-ide"
    : "https://plugins.jetbrains.com/api/plugins/32208/updates";

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function inspectMarketplace() {
  const payload = await fetchJson(endpoint, `${channel} registry`);

  if (channel === "open-vsx") {
    const latest = payload?.version;
    const listed =
      payload?.allVersions &&
      Object.prototype.hasOwnProperty.call(payload.allVersions, version);
    const versionPayload = await fetchJson(
      `${endpoint}/${encodeURIComponent(version)}`,
      "Open VSX version endpoint",
    );
    const downloadable = versionPayload?.downloadable === true;
    if (versionPayload?.version !== version || !downloadable || !listed) {
      throw new Error(
        `Open VSX mismatch: expected ${version}, version=${versionPayload?.version}, latest=${latest}, ` +
          `downloadable=${downloadable}, listed=${listed}`,
      );
    }
    return { version, latest, downloadable, listed };
  }

  const rows = Array.isArray(payload) ? payload : [];
  const marketplaceRecord = rows.find((row) => row?.version === version);
  if (
    !marketplaceRecord ||
    marketplaceRecord.approve !== true ||
    marketplaceRecord.listed !== true ||
    marketplaceRecord.hidden === true
  ) {
    throw new Error(
      `JetBrains Marketplace mismatch: expected listed approved visible ${version}`,
    );
  }
  return {
    version: marketplaceRecord.version,
    approve: marketplaceRecord.approve,
    listed: marketplaceRecord.listed,
    hidden: marketplaceRecord.hidden,
  };
}

let record;
for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
  try {
    record = await inspectMarketplace();
    break;
  } catch (error) {
    if (attempt === retryAttempts) throw error;
    console.error(
      `[verify-ide-marketplace] attempt ${attempt}/${retryAttempts} failed: ${error.message}; ` +
        `retrying in ${retryDelayMs}ms`,
    );
    await sleep(retryDelayMs);
  }
}

console.log(JSON.stringify({ channel, endpoint, ...record }));
