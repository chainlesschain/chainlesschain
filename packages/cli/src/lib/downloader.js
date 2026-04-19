import {
  createWriteStream,
  existsSync,
  unlinkSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execSync } from "node:child_process";
import ora from "ora";
import { GITHUB_RELEASES_URL } from "../constants.js";
import { getBinDir, ensureDir } from "./paths.js";
import { getPlatform, getArch } from "./platform.js";
import logger from "./logger.js";

// Platform-specific asset matching patterns
const ASSET_PATTERNS = {
  win32: { x64: /chainlesschain.*win32.*x64.*\.zip$/i },
  darwin: {
    x64: /chainlesschain.*darwin.*x64.*\.zip$/i,
    arm64: /chainlesschain.*darwin.*arm64.*\.zip$/i,
  },
  linux: { x64: /chainlesschain.*linux.*x64.*\.zip$/i },
};

export async function downloadRelease(version, options = {}) {
  const binDir = ensureDir(getBinDir());

  // Check if we already have an extracted app
  if (!options.force && hasExtractedApp(binDir)) {
    logger.info("Application already installed");
    return binDir;
  }

  const { url: assetUrl, name: assetName } = options.url
    ? { url: options.url, name: "download.zip" }
    : await resolveAssetUrl(version);

  const destPath = join(binDir, assetName);
  const spinner = ora(`Downloading ${assetName}...`).start();

  try {
    const response = await fetch(assetUrl, {
      headers: { Accept: "application/octet-stream" },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(
        `Download failed: HTTP ${response.status} ${response.statusText}`,
      );
    }

    const totalBytes = parseInt(
      response.headers.get("content-length") || "0",
      10,
    );
    let downloadedBytes = 0;

    const reader = response.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        downloadedBytes += value.byteLength;
        if (totalBytes > 0) {
          const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          spinner.text = `Downloading ${assetName}... ${pct}% (${formatBytes(downloadedBytes)}/${formatBytes(totalBytes)})`;
        }
        controller.enqueue(value);
      },
    });

    const nodeStream = Readable.fromWeb(stream);
    await pipeline(nodeStream, createWriteStream(destPath));

    spinner.succeed(
      `Downloaded ${assetName} (${formatBytes(downloadedBytes)})`,
    );

    // Extract zip
    if (destPath.endsWith(".zip")) {
      const extractSpinner = ora("Extracting...").start();
      try {
        extractZip(destPath, binDir);
        unlinkSync(destPath);
        extractSpinner.succeed("Extracted and ready");
      } catch (err) {
        extractSpinner.fail(`Extraction failed: ${err.message}`);
        throw err;
      }
    }

    return binDir;
  } catch (err) {
    spinner.fail(`Download failed: ${err.message}`);
    if (existsSync(destPath)) {
      unlinkSync(destPath);
    }
    throw err;
  }
}

async function resolveAssetUrl(version) {
  // Try exact version first, then fall back to latest release
  const tagName = `v${version}`;
  let release = await fetchRelease(`${GITHUB_RELEASES_URL}/tags/${tagName}`);

  if (!release) {
    logger.info(`Release ${tagName} not found, fetching latest release...`);
    release = await fetchRelease(`${GITHUB_RELEASES_URL}/latest`);
  }

  if (!release) {
    throw new Error("No releases found on GitHub");
  }

  logger.info(`Using release ${release.tag_name}`);

  // Match asset by platform/arch pattern
  const p = getPlatform();
  const a = getArch();
  const patterns = ASSET_PATTERNS[p];
  if (!patterns) {
    throw new Error(`Unsupported platform: ${p}`);
  }
  const pattern = patterns[a];
  if (!pattern) {
    throw new Error(`Unsupported architecture: ${a} on ${p}`);
  }

  const asset = release.assets.find((ast) => pattern.test(ast.name));
  if (!asset) {
    const available = release.assets.map((ast) => ast.name).join(", ");
    throw new Error(
      `No matching asset for ${p}/${a} in release ${release.tag_name}. Available: ${available}`,
    );
  }

  return { url: asset.browser_download_url, name: asset.name };
}

async function fetchRelease(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!response.ok) return null;
  return response.json();
}

function extractZip(zipPath, destDir) {
  const p = getPlatform();
  if (p === "win32") {
    // Use PowerShell on Windows
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
      { stdio: "ignore" },
    );
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: "ignore" });
  }
}

function hasExtractedApp(binDir) {
  if (!existsSync(binDir)) return false;
  try {
    const files = readdirSync(binDir, { recursive: true });
    return files.some(
      (f) =>
        (typeof f === "string" ? f : f.toString())
          .toLowerCase()
          .includes("chainlesschain") &&
        ((typeof f === "string" ? f : f.toString()).endsWith(".exe") ||
          !(typeof f === "string" ? f : f.toString()).includes(".")),
    );
  } catch {
    return false;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export { resolveAssetUrl, formatBytes };

// =====================================================================
// downloader V2 governance overlay (iter27)
// =====================================================================
export const DLGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const DLGOV_DOWNLOAD_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  FETCHING: "fetching",
  FETCHED: "fetched",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _dlgovPTrans = new Map([
  [
    DLGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      DLGOV_PROFILE_MATURITY_V2.ACTIVE,
      DLGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    DLGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      DLGOV_PROFILE_MATURITY_V2.STALE,
      DLGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    DLGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      DLGOV_PROFILE_MATURITY_V2.ACTIVE,
      DLGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [DLGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _dlgovPTerminal = new Set([DLGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _dlgovJTrans = new Map([
  [
    DLGOV_DOWNLOAD_LIFECYCLE_V2.QUEUED,
    new Set([
      DLGOV_DOWNLOAD_LIFECYCLE_V2.FETCHING,
      DLGOV_DOWNLOAD_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    DLGOV_DOWNLOAD_LIFECYCLE_V2.FETCHING,
    new Set([
      DLGOV_DOWNLOAD_LIFECYCLE_V2.FETCHED,
      DLGOV_DOWNLOAD_LIFECYCLE_V2.FAILED,
      DLGOV_DOWNLOAD_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [DLGOV_DOWNLOAD_LIFECYCLE_V2.FETCHED, new Set()],
  [DLGOV_DOWNLOAD_LIFECYCLE_V2.FAILED, new Set()],
  [DLGOV_DOWNLOAD_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _dlgovPsV2 = new Map();
const _dlgovJsV2 = new Map();
let _dlgovMaxActive = 6,
  _dlgovMaxPending = 15,
  _dlgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _dlgovStuckMs = 60 * 1000;
function _dlgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _dlgovCheckP(from, to) {
  const a = _dlgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid dlgov profile transition ${from} → ${to}`);
}
function _dlgovCheckJ(from, to) {
  const a = _dlgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid dlgov download transition ${from} → ${to}`);
}
function _dlgovCountActive(owner) {
  let c = 0;
  for (const p of _dlgovPsV2.values())
    if (p.owner === owner && p.status === DLGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _dlgovCountPending(profileId) {
  let c = 0;
  for (const j of _dlgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === DLGOV_DOWNLOAD_LIFECYCLE_V2.QUEUED ||
        j.status === DLGOV_DOWNLOAD_LIFECYCLE_V2.FETCHING)
    )
      c++;
  return c;
}
export function setMaxActiveDlgovProfilesPerOwnerV2(n) {
  _dlgovMaxActive = _dlgovPos(n, "maxActiveDlgovProfilesPerOwner");
}
export function getMaxActiveDlgovProfilesPerOwnerV2() {
  return _dlgovMaxActive;
}
export function setMaxPendingDlgovDownloadsPerProfileV2(n) {
  _dlgovMaxPending = _dlgovPos(n, "maxPendingDlgovDownloadsPerProfile");
}
export function getMaxPendingDlgovDownloadsPerProfileV2() {
  return _dlgovMaxPending;
}
export function setDlgovProfileIdleMsV2(n) {
  _dlgovIdleMs = _dlgovPos(n, "dlgovProfileIdleMs");
}
export function getDlgovProfileIdleMsV2() {
  return _dlgovIdleMs;
}
export function setDlgovDownloadStuckMsV2(n) {
  _dlgovStuckMs = _dlgovPos(n, "dlgovDownloadStuckMs");
}
export function getDlgovDownloadStuckMsV2() {
  return _dlgovStuckMs;
}
export function _resetStateDownloaderGovV2() {
  _dlgovPsV2.clear();
  _dlgovJsV2.clear();
  _dlgovMaxActive = 6;
  _dlgovMaxPending = 15;
  _dlgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _dlgovStuckMs = 60 * 1000;
}
export function registerDlgovProfileV2({ id, owner, mirror, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_dlgovPsV2.has(id)) throw new Error(`dlgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    mirror: mirror || "default",
    status: DLGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _dlgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateDlgovProfileV2(id) {
  const p = _dlgovPsV2.get(id);
  if (!p) throw new Error(`dlgov profile ${id} not found`);
  const isInitial = p.status === DLGOV_PROFILE_MATURITY_V2.PENDING;
  _dlgovCheckP(p.status, DLGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _dlgovCountActive(p.owner) >= _dlgovMaxActive)
    throw new Error(`max active dlgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = DLGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleDlgovProfileV2(id) {
  const p = _dlgovPsV2.get(id);
  if (!p) throw new Error(`dlgov profile ${id} not found`);
  _dlgovCheckP(p.status, DLGOV_PROFILE_MATURITY_V2.STALE);
  p.status = DLGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveDlgovProfileV2(id) {
  const p = _dlgovPsV2.get(id);
  if (!p) throw new Error(`dlgov profile ${id} not found`);
  _dlgovCheckP(p.status, DLGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = DLGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchDlgovProfileV2(id) {
  const p = _dlgovPsV2.get(id);
  if (!p) throw new Error(`dlgov profile ${id} not found`);
  if (_dlgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal dlgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getDlgovProfileV2(id) {
  const p = _dlgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listDlgovProfilesV2() {
  return [..._dlgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createDlgovDownloadV2({ id, profileId, url, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_dlgovJsV2.has(id))
    throw new Error(`dlgov download ${id} already exists`);
  if (!_dlgovPsV2.has(profileId))
    throw new Error(`dlgov profile ${profileId} not found`);
  if (_dlgovCountPending(profileId) >= _dlgovMaxPending)
    throw new Error(
      `max pending dlgov downloads for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    url: url || "",
    status: DLGOV_DOWNLOAD_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _dlgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function fetchingDlgovDownloadV2(id) {
  const j = _dlgovJsV2.get(id);
  if (!j) throw new Error(`dlgov download ${id} not found`);
  _dlgovCheckJ(j.status, DLGOV_DOWNLOAD_LIFECYCLE_V2.FETCHING);
  const now = Date.now();
  j.status = DLGOV_DOWNLOAD_LIFECYCLE_V2.FETCHING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeDownloadDlgovV2(id) {
  const j = _dlgovJsV2.get(id);
  if (!j) throw new Error(`dlgov download ${id} not found`);
  _dlgovCheckJ(j.status, DLGOV_DOWNLOAD_LIFECYCLE_V2.FETCHED);
  const now = Date.now();
  j.status = DLGOV_DOWNLOAD_LIFECYCLE_V2.FETCHED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failDlgovDownloadV2(id, reason) {
  const j = _dlgovJsV2.get(id);
  if (!j) throw new Error(`dlgov download ${id} not found`);
  _dlgovCheckJ(j.status, DLGOV_DOWNLOAD_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = DLGOV_DOWNLOAD_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelDlgovDownloadV2(id, reason) {
  const j = _dlgovJsV2.get(id);
  if (!j) throw new Error(`dlgov download ${id} not found`);
  _dlgovCheckJ(j.status, DLGOV_DOWNLOAD_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = DLGOV_DOWNLOAD_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getDlgovDownloadV2(id) {
  const j = _dlgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listDlgovDownloadsV2() {
  return [..._dlgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleDlgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _dlgovPsV2.values())
    if (
      p.status === DLGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _dlgovIdleMs
    ) {
      p.status = DLGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckDlgovDownloadsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _dlgovJsV2.values())
    if (
      j.status === DLGOV_DOWNLOAD_LIFECYCLE_V2.FETCHING &&
      j.startedAt != null &&
      t - j.startedAt >= _dlgovStuckMs
    ) {
      j.status = DLGOV_DOWNLOAD_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getDownloaderGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(DLGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _dlgovPsV2.values()) profilesByStatus[p.status]++;
  const downloadsByStatus = {};
  for (const v of Object.values(DLGOV_DOWNLOAD_LIFECYCLE_V2))
    downloadsByStatus[v] = 0;
  for (const j of _dlgovJsV2.values()) downloadsByStatus[j.status]++;
  return {
    totalDlgovProfilesV2: _dlgovPsV2.size,
    totalDlgovDownloadsV2: _dlgovJsV2.size,
    maxActiveDlgovProfilesPerOwner: _dlgovMaxActive,
    maxPendingDlgovDownloadsPerProfile: _dlgovMaxPending,
    dlgovProfileIdleMs: _dlgovIdleMs,
    dlgovDownloadStuckMs: _dlgovStuckMs,
    profilesByStatus,
    downloadsByStatus,
  };
}
