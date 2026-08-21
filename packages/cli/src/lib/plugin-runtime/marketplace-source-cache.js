import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getElectronUserDataDir } from "../paths.js";
import { parsePluginManifest, isWithin } from "./manifest.js";
import {
  PLUGIN_MARKETPLACE_STAGED_SOURCE_EXCLUSIONS,
  buildMarketplacePayloadSbom,
  isMarketplacePayloadSbomFormat,
} from "./marketplace-artifact-readback.js";

export const PLUGIN_MARKETPLACE_SOURCE_CACHE_SCHEMA =
  "cc-plugin-marketplace-source-cache/v1";
export const SOURCE_CACHE_AUTHORITY_FILENAME = "authority.json";
const SHA256_RE = /^[a-f0-9]{64}$/;
const MAX_SOURCE_CACHE_AUTHORITY_BYTES = 64 * 1024;

export function marketplaceSourceCacheRoot(value) {
  return path.resolve(
    value ||
      path.join(getElectronUserDataDir(), "plugin-marketplace-source-cache"),
  );
}

export function marketplaceSourceCacheSpec(
  sourceMetadata,
  { remoteSbomBytes = null } = {},
) {
  if (sourceMetadata?.type !== "registry") return null;
  const source = cleanString(sourceMetadata.resolvedSource, 4096);
  const ref = cleanString(sourceMetadata.ref, 256);
  const sourceDigest =
    normalizeSha256(sourceMetadata.resolvedSourceDigest) ||
    (source ? sha256Canonical({ source, ref }) : null);
  const expectations = sourceMetadata.catalogAuthority?.artifactExpectations;
  const manifestSha256 = normalizeSha256(expectations?.manifest?.sha256);
  let payloadSchemaVersion = cleanString(expectations?.sbom?.format, 128);
  let payloadSha256 = normalizeSha256(
    expectations?.sbom?.payloadSha256 ?? expectations?.sbom?.sha256,
  );
  const comparison =
    sourceMetadata.catalogAuthority?.remoteSbomPayloadComparison;
  if (!payloadSha256 && comparison?.status === "matched") {
    payloadSchemaVersion = cleanString(comparison.format, 128);
    payloadSha256 = normalizeSha256(comparison.remotePayload?.digest);
  }
  if (!payloadSha256 && Buffer.isBuffer(remoteSbomBytes)) {
    try {
      const remotePayload = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(remoteSbomBytes),
      );
      if (remotePayload?.schemaVersion === payloadSchemaVersion) {
        payloadSha256 = normalizeSha256(remotePayload.digest);
      }
    } catch {
      throw new Error(
        "Marketplace source cache remote payload SBOM is invalid",
      );
    }
  }
  if (
    !source ||
    !sourceDigest ||
    !manifestSha256 ||
    !payloadSha256 ||
    !isMarketplacePayloadSbomFormat(payloadSchemaVersion)
  ) {
    return null;
  }
  const keyAuthority = {
    schemaVersion: PLUGIN_MARKETPLACE_SOURCE_CACHE_SCHEMA,
    source,
    sourceDigest,
    ref,
    manifestSha256,
    payload: {
      schemaVersion: payloadSchemaVersion,
      sha256: payloadSha256,
    },
  };
  return {
    ...keyAuthority,
    cacheKey: sha256Canonical(keyAuthority),
  };
}

export function publishMarketplaceSourceCache(
  sourceDir,
  sourceMetadata,
  { cacheDir, remoteSbomBytes = null } = {},
) {
  const spec = marketplaceSourceCacheSpec(sourceMetadata, { remoteSbomBytes });
  if (!spec) return { status: "not-cacheable", cacheKey: null, dir: null };
  const root = marketplaceSourceCacheRoot(cacheDir);
  const target = path.join(root, spec.cacheKey);
  if (fs.existsSync(target)) {
    const cached = readMarketplaceSourceCache(sourceMetadata, {
      cacheDir,
      remoteSbomBytes,
    });
    return { status: "reused", cacheKey: spec.cacheKey, dir: cached.dir };
  }

  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  assertDirectory(root, "Marketplace source cache root");
  const stage = path.join(
    root,
    `.tmp-${process.pid}-${crypto.randomBytes(12).toString("hex")}`,
  );
  const payload = path.join(stage, "payload");
  try {
    fs.mkdirSync(payload, { recursive: true, mode: 0o700 });
    copySourcePayload(sourceDir, payload, payload, sourceDir);
    const authority = buildCacheAuthority(payload, spec);
    writeAuthority(
      path.join(stage, SOURCE_CACHE_AUTHORITY_FILENAME),
      authority,
    );
    fsyncDirectoryBestEffort(payload);
    fsyncDirectoryBestEffort(stage);
    try {
      fs.renameSync(stage, target);
      fsyncDirectoryBestEffort(root);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") throw error;
    }
    const cached = readMarketplaceSourceCache(sourceMetadata, {
      cacheDir,
      remoteSbomBytes,
    });
    return { status: "published", cacheKey: spec.cacheKey, dir: cached.dir };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

export function readMarketplaceSourceCache(
  sourceMetadata,
  { cacheDir, remoteSbomBytes = null } = {},
) {
  const spec = marketplaceSourceCacheSpec(sourceMetadata, { remoteSbomBytes });
  if (!spec) {
    throw new Error(
      "offline source cache requires registry manifest SHA-256 and a repository-defined payload SBOM digest",
    );
  }
  const target = path.join(marketplaceSourceCacheRoot(cacheDir), spec.cacheKey);
  const payload = path.join(target, "payload");
  if (!fs.existsSync(target)) {
    throw new Error(
      `OFFLINE_SOURCE_CACHE_MISS: verified source package ${spec.cacheKey} is unavailable`,
    );
  }
  assertDirectory(target, "Marketplace source cache entry");
  assertDirectory(payload, "Marketplace source cache payload");
  assertSafeCachePayload(payload);
  const stored = readAuthority(
    path.join(target, SOURCE_CACHE_AUTHORITY_FILENAME),
  );
  const actual = buildCacheAuthority(payload, spec);
  if (canonicalJson(stored) !== canonicalJson(actual)) {
    throw new Error("Marketplace source cache authority or payload changed");
  }
  return { dir: payload, cacheKey: spec.cacheKey, authority: actual };
}

function buildCacheAuthority(payload, spec) {
  const manifest = parsePluginManifest(payload);
  if (!manifest.ok) {
    throw new Error(
      `Marketplace source cache manifest is invalid: ${manifest.errors.join("; ")}`,
    );
  }
  const manifestSha256 = sha256(fs.readFileSync(manifest.manifestPath));
  if (manifestSha256 !== spec.manifestSha256) {
    throw new Error("Marketplace source cache manifest digest mismatch");
  }
  const payloadSbom = buildMarketplacePayloadSbom(payload, {
    schemaVersion: spec.payload.schemaVersion,
  });
  if (payloadSbom.digest !== spec.payload.sha256) {
    throw new Error("Marketplace source cache payload digest mismatch");
  }
  const withoutDigest = {
    schemaVersion: PLUGIN_MARKETPLACE_SOURCE_CACHE_SCHEMA,
    cacheKey: spec.cacheKey,
    source: spec.source,
    sourceDigest: spec.sourceDigest,
    ref: spec.ref,
    manifestSha256,
    payload: {
      schemaVersion: payloadSbom.schemaVersion,
      sha256: payloadSbom.digest,
      fileCount: payloadSbom.fileCount,
      totalBytes: payloadSbom.totalBytes,
    },
  };
  return {
    ...withoutDigest,
    authorityDigest: sha256Canonical(withoutDigest),
  };
}

function copySourcePayload(source, destination, root, sourceRoot) {
  assertDirectory(source, "Marketplace source material");
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const relative = path.relative(sourceRoot, from).replace(/\\/g, "/");
    if (
      PLUGIN_MARKETPLACE_STAGED_SOURCE_EXCLUSIONS.some(
        (excluded) =>
          relative === excluded || relative.startsWith(`${excluded}/`),
      )
    ) {
      continue;
    }
    const to = path.join(destination, entry.name);
    if (!isWithin(root, to)) {
      throw new Error("Marketplace source cache copy escaped its payload root");
    }
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: false, mode: 0o700 });
      copySourcePayload(from, to, root, sourceRoot);
    } else if (stat.isFile()) {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    } else {
      throw new Error("Marketplace source material contains a special file");
    }
  }
}

function writeAuthority(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (bytes.length > MAX_SOURCE_CACHE_AUTHORITY_BYTES) {
    throw new Error(
      "Marketplace source cache authority exceeds its size limit",
    );
  }
  const descriptor = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readAuthority(file) {
  let descriptor = null;
  try {
    const linkStat = fs.lstatSync(file);
    if (
      !linkStat.isFile() ||
      linkStat.isSymbolicLink() ||
      linkStat.nlink !== 1 ||
      linkStat.size <= 0 ||
      linkStat.size > MAX_SOURCE_CACHE_AUTHORITY_BYTES
    ) {
      throw new Error(
        "Marketplace source cache authority is not a bounded single-link regular file",
      );
    }
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const fileStat = fs.fstatSync(descriptor);
    if (
      !fileStat.isFile() ||
      fileStat.nlink !== 1 ||
      fileStat.size !== linkStat.size ||
      fileStat.size <= 0 ||
      fileStat.size > MAX_SOURCE_CACHE_AUTHORITY_BYTES
    ) {
      throw new Error(
        "Marketplace source cache authority changed during inspection",
      );
    }
    const bytes = fs.readFileSync(descriptor);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Marketplace source cache authority is not valid UTF-8");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Marketplace source cache authority is invalid JSON");
    }
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
  }
}

function assertSafeCachePayload(root, current = root) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (!isWithin(root, absolute)) {
      throw new Error("Marketplace source cache payload escaped its root");
    }
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(
        "Marketplace source cache payload contains a symbolic link",
      );
    }
    if (stat.isDirectory()) {
      assertSafeCachePayload(root, absolute);
      continue;
    }
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error(
        "Marketplace source cache payload contains a non-regular or hard-linked file",
      );
    }
  }
}

function assertDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} is not a directory`);
  }
}

function fsyncDirectoryBestEffort(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch {
    // Windows and some filesystems do not support directory fsync.
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
  }
}

function cleanString(value, max) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\p{Cc}/gu, "").trim();
  return clean ? clean.slice(0, max) : null;
}

function normalizeSha256(value) {
  const digest = cleanString(value, 64)?.toLowerCase() || null;
  return digest && SHA256_RE.test(digest) ? digest : null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256Canonical(value) {
  return sha256(canonicalJson(value));
}

function canonicalJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}
