#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  listZipEntries,
  readZipEntry,
} from "../packages/vscode-extension/scripts/verify-vsix.mjs";

/**
 * Verify that a published IDE artifact is visible and downloadable from its
 * registry. This is intentionally a post-publish check: package metadata and
 * CI upload success do not prove that a marketplace indexed the version.
 */

class MarketplacePendingError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MarketplacePendingError";
    this.details = details;
  }
}

class MarketplaceFatalError extends Error {
  constructor(message) {
    super(message);
    this.name = "MarketplaceFatalError";
  }
}

if (process.argv[2] === "--self-test") {
  await runSelfTest();
  process.exit(0);
}

const channel = process.argv[2];
const requestedVersion = process.argv[3] || null;
let allowPending = false;
let artifactPath = null;
for (let index = 4; index < process.argv.length; index += 1) {
  const option = process.argv[index];
  if (option === "--allow-pending") {
    allowPending = true;
  } else if (option === "--artifact") {
    artifactPath = process.argv[index + 1] || null;
    index += 1;
    if (!artifactPath) {
      console.error("--artifact requires a file path");
      process.exit(2);
    }
  } else {
    console.error(`unknown option: ${option}`);
    process.exit(2);
  }
}

const retryAttempts = positiveInteger(
  process.env.CC_MARKETPLACE_VERIFY_ATTEMPTS,
  channel === "open-vsx" ? 30 : 12,
);
const retryDelayMs = positiveInteger(
  process.env.CC_MARKETPLACE_VERIFY_DELAY_MS,
  channel === "open-vsx" ? 20_000 : 10_000,
);

if (!["open-vsx", "jetbrains"].includes(channel)) {
  console.error(
    "usage: node scripts/verify-ide-marketplace.mjs <open-vsx|jetbrains> <version> " +
      "[--artifact <vsix-path>] [--allow-pending]",
  );
  process.exit(2);
}

if (!requestedVersion) {
  console.error("a marketplace version is required");
  process.exit(2);
}
if (allowPending && channel !== "jetbrains") {
  console.error("--allow-pending is supported only for JetBrains verification");
  process.exit(2);
}
if (artifactPath && channel !== "open-vsx") {
  console.error("--artifact is supported only for Open VSX verification");
  process.exit(2);
}

const version = requestedVersion;
const artifactBuffer = artifactPath ? await readFile(artifactPath) : null;
const artifactArchiveSha256 = artifactBuffer
  ? createHash("sha256").update(artifactBuffer).digest("hex")
  : null;
const artifactContentSha256 = artifactBuffer
  ? canonicalZipContentSha256(artifactBuffer)
  : null;
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

async function fetchText(url, label) {
  const response = await fetch(url, {
    headers: { accept: "text/plain, application/octet-stream" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchBuffer(url, label) {
  const response = await fetch(url, {
    headers: { accept: "application/octet-stream" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function canonicalEntriesSha256(entries) {
  const hash = createHash("sha256");
  hash.update("chainlesschain-vsix-content-v1\0");
  for (const [name, data] of [...entries].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const nameBuffer = Buffer.from(name, "utf8");
    const lengths = Buffer.alloc(12);
    lengths.writeUInt32BE(nameBuffer.length, 0);
    lengths.writeBigUInt64BE(BigInt(data.length), 4);
    hash.update(lengths);
    hash.update(nameBuffer);
    hash.update(data);
  }
  return hash.digest("hex");
}

function canonicalZipContentSha256(buffer) {
  const zipEntries = listZipEntries(buffer);
  return canonicalEntriesSha256(
    [...zipEntries].map(([name, entry]) => [name, readZipEntry(buffer, entry)]),
  );
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
    let registryArchiveSha256 = null;
    let registryContentSha256 = null;
    if (artifactBuffer) {
      const sha256Url = versionPayload?.files?.sha256;
      const downloadUrl = versionPayload?.files?.download;
      if (typeof sha256Url !== "string" || !sha256Url.startsWith("https://")) {
        throw new Error(
          "Open VSX version metadata has no HTTPS SHA-256 endpoint",
        );
      }
      if (
        typeof downloadUrl !== "string" ||
        !downloadUrl.startsWith("https://")
      ) {
        throw new Error(
          "Open VSX version metadata has no HTTPS download endpoint",
        );
      }
      const [registrySha256Text, registryBuffer] = await Promise.all([
        fetchText(sha256Url, "Open VSX SHA-256 endpoint"),
        fetchBuffer(downloadUrl, "Open VSX VSIX download"),
      ]);
      const declaredRegistrySha256 = registrySha256Text.trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(declaredRegistrySha256)) {
        throw new Error("Open VSX returned malformed SHA-256 metadata");
      }
      registryArchiveSha256 = createHash("sha256")
        .update(registryBuffer)
        .digest("hex");
      if (registryArchiveSha256 !== declaredRegistrySha256) {
        throw new Error(
          `Open VSX download SHA-256 mismatch: downloaded=${registryArchiveSha256}, declared=${declaredRegistrySha256}`,
        );
      }
      registryContentSha256 = canonicalZipContentSha256(registryBuffer);
      if (registryContentSha256 !== artifactContentSha256) {
        throw new Error(
          `Open VSX VSIX content mismatch: local=${artifactContentSha256}, registry=${registryContentSha256}`,
        );
      }
    }
    if (versionPayload?.version !== version || !downloadable || !listed) {
      throw new Error(
        `Open VSX mismatch: expected ${version}, version=${versionPayload?.version}, latest=${latest}, ` +
          `downloadable=${downloadable}, listed=${listed}`,
      );
    }
    return {
      status: "ready",
      version,
      latest,
      downloadable,
      listed,
      ...(registryArchiveSha256
        ? {
            registryArchiveSha256,
            localArchiveSha256: artifactArchiveSha256,
            contentSha256: registryContentSha256,
          }
        : {}),
    };
  }

  return classifyJetBrainsPayload(payload, version);
}

function classifyJetBrainsPayload(payload, expectedVersion) {
  if (!Array.isArray(payload)) {
    throw new MarketplaceFatalError(
      "JetBrains Marketplace returned a non-array updates payload",
    );
  }

  const marketplaceRecord = payload.find(
    (row) => row?.version === expectedVersion,
  );
  if (!marketplaceRecord) {
    throw new MarketplacePendingError(
      `JetBrains Marketplace has not exposed ${expectedVersion}; manual review may still be pending`,
      {
        version: expectedVersion,
        approve: null,
        listed: null,
        hidden: null,
        reason: "version-not-visible",
      },
    );
  }
  for (const field of ["approve", "listed", "hidden"]) {
    if (typeof marketplaceRecord[field] !== "boolean") {
      throw new MarketplaceFatalError(
        `JetBrains Marketplace version ${expectedVersion} has invalid ${field} metadata`,
      );
    }
  }
  if (marketplaceRecord.hidden === true) {
    throw new MarketplaceFatalError(
      `JetBrains Marketplace version ${expectedVersion} is hidden`,
    );
  }
  if (marketplaceRecord.approve !== true || marketplaceRecord.listed !== true) {
    throw new MarketplacePendingError(
      `JetBrains Marketplace version ${expectedVersion} is awaiting approval or listing`,
      {
        version: marketplaceRecord.version,
        approve: marketplaceRecord.approve ?? null,
        listed: marketplaceRecord.listed ?? null,
        hidden: marketplaceRecord.hidden ?? null,
        reason: "approval-or-listing-pending",
      },
    );
  }

  return {
    status: "ready",
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
    if (error instanceof MarketplaceFatalError) throw error;
    if (attempt === retryAttempts) {
      if (
        allowPending &&
        channel === "jetbrains" &&
        error instanceof MarketplacePendingError
      ) {
        record = {
          status: "pending",
          ...error.details,
          attempts: retryAttempts,
        };
        console.error(
          `[verify-ide-marketplace] ${error.message}; --allow-pending requested, reporting pending review without failing`,
        );
        break;
      }
      throw error;
    }
    console.error(
      `[verify-ide-marketplace] attempt ${attempt}/${retryAttempts} failed: ${error.message}; ` +
        `retrying in ${retryDelayMs}ms`,
    );
    await sleep(retryDelayMs);
  }
}

console.log(JSON.stringify({ channel, endpoint, ...record }));

async function runSelfTest() {
  const assert = (await import("node:assert/strict")).default;

  assert.deepEqual(
    classifyJetBrainsPayload(
      [{ version: "1.2.3", approve: true, listed: true, hidden: false }],
      "1.2.3",
    ),
    {
      status: "ready",
      version: "1.2.3",
      approve: true,
      listed: true,
      hidden: false,
    },
  );
  assert.throws(
    () => classifyJetBrainsPayload([], "1.2.3"),
    MarketplacePendingError,
  );
  assert.throws(
    () =>
      classifyJetBrainsPayload(
        [{ version: "1.2.3", approve: false, listed: false, hidden: false }],
        "1.2.3",
      ),
    MarketplacePendingError,
  );
  assert.throws(
    () =>
      classifyJetBrainsPayload(
        [{ version: "1.2.3", approve: true, listed: true, hidden: true }],
        "1.2.3",
      ),
    MarketplaceFatalError,
  );
  assert.throws(
    () => classifyJetBrainsPayload({ version: "1.2.3" }, "1.2.3"),
    MarketplaceFatalError,
  );
  assert.throws(
    () =>
      classifyJetBrainsPayload(
        [{ version: "1.2.3", approve: false, listed: false }],
        "1.2.3",
      ),
    MarketplaceFatalError,
  );
  assert.equal(positiveInteger("7", 3), 7);
  assert.equal(positiveInteger("0", 3), 3);
  const canonicalA = canonicalEntriesSha256([
    ["extension/b.txt", Buffer.from("two")],
    ["extension/a.txt", Buffer.from("one")],
  ]);
  const canonicalB = canonicalEntriesSha256([
    ["extension/a.txt", Buffer.from("one")],
    ["extension/b.txt", Buffer.from("two")],
  ]);
  const canonicalChanged = canonicalEntriesSha256([
    ["extension/a.txt", Buffer.from("one")],
    ["extension/b.txt", Buffer.from("changed")],
  ]);
  assert.equal(canonicalA, canonicalB);
  assert.notEqual(canonicalA, canonicalChanged);

  console.log("verify-ide-marketplace self-test: PASS");
}
