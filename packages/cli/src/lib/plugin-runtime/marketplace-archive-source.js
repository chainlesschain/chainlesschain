import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { getElectronUserDataDir } from "../paths.js";
import {
  assertSafeInstalledPluginStructure,
  buildMarketplacePayloadSbom,
} from "./marketplace-artifact-readback.js";
import { createSameOriginMarketplaceHeaderFetch } from "./marketplace-command-source.js";
import { createMarketplaceNetworkTransport } from "./marketplace-network.js";
import { fetchMarketplaceRemoteArtifact } from "./marketplace-remote-artifacts.js";

export const MARKETPLACE_ARCHIVE_SOURCE_SCHEMA =
  "cc-plugin-marketplace-archive-source/v1";
export const MARKETPLACE_ARCHIVE_LIMITS = Object.freeze({
  compressedBytes: 64 * 1024 * 1024,
  expandedBytes: 256 * 1024 * 1024,
  entries: 10_000,
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function octal(header, offset, length) {
  const text = header
    .subarray(offset, offset + length)
    .toString("ascii")
    .replace(/\0.*$/u, "")
    .trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function cString(header, offset, length) {
  const bytes = header.subarray(offset, offset + length);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString("utf8");
}

function checksumValid(header) {
  const expected = octal(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < 512; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  return expected === actual;
}

function safeArchivePath(raw) {
  const value = String(raw || "");
  if (
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[a-z]:/iu.test(value)
  ) {
    throw new Error("archive contains an unsafe path");
  }
  const segments = value.split("/").filter((part) => part && part !== ".");
  const unsafePortableSegment = (part) =>
    part === ".." ||
    Buffer.byteLength(part, "utf8") > 255 ||
    /[\u0000-\u001f:]/u.test(part) ||
    /[ .]$/u.test(part) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part);
  if (
    value.length > 4096 ||
    segments.some(unsafePortableSegment) ||
    segments[0] !== "package"
  ) {
    throw new Error("archive must contain only a package/ root");
  }
  return segments.slice(1);
}

function parsePax(data) {
  const values = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) throw new Error("archive PAX header is malformed");
    const length = Number.parseInt(data.toString("ascii", offset, space), 10);
    if (
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      offset + length > data.length
    ) {
      throw new Error("archive PAX record length is invalid");
    }
    const record = data.toString("utf8", space + 1, offset + length - 1);
    const equals = record.indexOf("=");
    if (equals > 0) values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

function extractionLimits(limits = MARKETPLACE_ARCHIVE_LIMITS) {
  const expandedBytes = Number(limits?.expandedBytes);
  const entries = Number(limits?.entries);
  if (
    !Number.isSafeInteger(expandedBytes) ||
    expandedBytes <= 0 ||
    expandedBytes > MARKETPLACE_ARCHIVE_LIMITS.expandedBytes ||
    !Number.isSafeInteger(entries) ||
    entries <= 0 ||
    entries > MARKETPLACE_ARCHIVE_LIMITS.entries
  ) {
    throw new Error("Marketplace archive extraction limits are invalid");
  }
  return { expandedBytes, entries };
}

function extractVerifiedTgz(bytes, destination, limits = MARKETPLACE_ARCHIVE_LIMITS) {
  const bounded = extractionLimits(limits);
  let tar;
  try {
    tar = gunzipSync(bytes, {
      maxOutputLength: bounded.expandedBytes,
    });
  } catch {
    throw new Error("Marketplace archive is not a bounded valid gzip stream");
  }
  const seen = new Set();
  let offset = 0;
  let records = 0;
  let extractedEntries = 0;
  let extractedBytes = 0;
  let pendingLongName = null;
  let pendingPax = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    if (!checksumValid(header))
      throw new Error("archive tar checksum mismatch");
    const size = octal(header, 124, 12);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("archive tar entry size is invalid");
    }
    const typeByte = header[156];
    const type = typeByte === 0 ? "0" : String.fromCharCode(typeByte);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error("archive tar entry is truncated");
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / 512) * 512;
    records += 1;
    if (records > bounded.entries) {
      throw new Error("archive contains too many entries");
    }

    if (type === "L") {
      pendingLongName = data.toString("utf8").replace(/\0+$/u, "");
      continue;
    }
    if (type === "x" || type === "X") {
      pendingPax = parsePax(data);
      continue;
    }
    if (type === "g") continue;
    if (!new Set(["0", "5"]).has(type)) {
      throw new Error(
        "archive links, devices, and special entries are rejected",
      );
    }

    const name = cString(header, 0, 100);
    const prefix = cString(header, 345, 155);
    let archivePath = prefix ? `${prefix}/${name}` : name;
    if (pendingLongName != null) archivePath = pendingLongName;
    if (typeof pendingPax?.path === "string" && pendingPax.path) {
      archivePath = pendingPax.path;
    }
    pendingLongName = null;
    pendingPax = null;
    const parts = safeArchivePath(archivePath);
    if (parts.length === 0) continue;
    const relativePath = parts.join("/");
    const collisionKey = relativePath.normalize("NFC").toLowerCase();
    if (seen.has(collisionKey)) {
      throw new Error("archive contains duplicate or case-colliding paths");
    }
    seen.add(collisionKey);
    extractedEntries += 1;
    const target = path.join(destination, ...parts);
    const relative = path.relative(destination, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("archive extraction escaped its package root");
    }
    if (type === "5") {
      fs.mkdirSync(target, { recursive: true, mode: 0o755 });
      continue;
    }
    extractedBytes += data.length;
    if (extractedBytes > bounded.expandedBytes) {
      throw new Error("archive expanded payload exceeds its byte limit");
    }
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    const mode = octal(header, 100, 8) & 0o111 ? 0o755 : 0o644;
    fs.writeFileSync(target, data, { flag: "wx", mode });
  }
  if (extractedEntries === 0) throw new Error("archive package is empty");
  assertSafeInstalledPluginStructure(destination);
  return buildMarketplacePayloadSbom(destination);
}

// Kept deliberately private-by-convention: production callers always use the
// immutable limits above, while focused security tests can exercise the same
// parser with a tiny bounded fixture instead of allocating a 256 MiB bomb.
export const _marketplaceArchiveTest = Object.freeze({
  extractVerifiedTgz: (bytes, destination, limits) =>
    extractVerifiedTgz(bytes, destination, limits),
});

function cacheRoot(configured) {
  return (
    configured || path.join(getElectronUserDataDir(), "plugin-archive-sources")
  );
}

function readAuthority(root, expected) {
  const authorityPath = path.join(root, "authority.json");
  const packagePath = path.join(root, "package");
  const rootStat = fs.lstatSync(root);
  const authorityStat = fs.lstatSync(authorityPath);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !authorityStat.isFile() ||
    authorityStat.isSymbolicLink() ||
    authorityStat.nlink !== 1 ||
    authorityStat.size <= 0 ||
    authorityStat.size > 64 * 1024
  ) {
    throw new Error("Marketplace archive source cache structure is unsafe");
  }
  const authority = JSON.parse(fs.readFileSync(authorityPath, "utf8"));
  if (
    authority.schemaVersion !== MARKETPLACE_ARCHIVE_SOURCE_SCHEMA ||
    authority.status !== "digest-verified-and-extracted" ||
    authority.url !== expected.url ||
    authority.registryOrigin !== expected.registryOrigin ||
    authority.archiveSha256 !== expected.archiveSha256 ||
    authority.compressedBytes !== expected.compressedBytes
  ) {
    throw new Error("Marketplace archive source cache authority mismatch");
  }
  assertSafeInstalledPluginStructure(packagePath);
  const payload = buildMarketplacePayloadSbom(packagePath);
  if (
    payload.digest !== authority.payloadSha256 ||
    payload.fileCount !== authority.fileCount ||
    payload.totalBytes !== authority.totalBytes
  ) {
    throw new Error("Marketplace archive extracted payload digest mismatch");
  }
  return { authority, packagePath };
}

export async function fetchAndMaterializeMarketplaceArchive(options = {}) {
  const networkTransport =
    options.offline !== true &&
    typeof options.fetchImpl !== "function" &&
    (options.proxyUrl || options.pacFile || options.caFile)
      ? createMarketplaceNetworkTransport(options)
      : null;
  const transportFetch =
    options.fetchImpl || networkTransport?.fetch || globalThis.fetch?.bind(globalThis);
  const fetchImpl = options.requestHeaders
    ? createSameOriginMarketplaceHeaderFetch(
        transportFetch,
        new URL(options.registryUrl).origin,
        options.requestHeaders,
      )
    : transportFetch;
  let artifact;
  try {
    artifact = await fetchMarketplaceRemoteArtifact({
      kind: "archive",
      url: options.url,
      expectedSha256: options.sha256,
      registryOrigin: new URL(options.registryUrl).origin,
      authorizationOrigin: new URL(options.registryUrl).origin,
      token: options.token,
      allowInsecure: options.allowInsecure === true,
      offline: options.offline === true,
      cacheDir: options.artifactCacheDir,
      timeoutMs: options.timeoutMs,
      fetchImpl,
      resolveHostname: options.resolveHostname,
    });
  } finally {
    await networkTransport?.close();
  }
  if (artifact.bytes.length > MARKETPLACE_ARCHIVE_LIMITS.compressedBytes) {
    throw new Error("Marketplace archive exceeds its compressed byte limit");
  }

  const root = cacheRoot(options.sourceCacheDir);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Marketplace archive source cache root is unsafe");
  }
  const key = sha256(`${artifact.url}\0${artifact.sha256}`);
  const finalRoot = path.join(root, key);
  const expected = {
    url: artifact.url,
    registryOrigin: new URL(options.registryUrl).origin,
    archiveSha256: artifact.sha256,
    compressedBytes: artifact.bytes.length,
  };
  if (fs.existsSync(finalRoot)) {
    try {
      const cached = readAuthority(finalRoot, expected);
      return {
        dir: cached.packagePath,
        authority: { ...cached.authority, fromCache: artifact.fromCache },
      };
    } catch (error) {
      const stat = fs.lstatSync(finalRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw error;
      fs.rmSync(finalRoot, { recursive: true, force: true });
    }
  }

  const temporary = fs.mkdtempSync(path.join(root, `.tmp-${key}-`));
  try {
    const packagePath = path.join(temporary, "package");
    fs.mkdirSync(packagePath, { mode: 0o755 });
    const payload = extractVerifiedTgz(artifact.bytes, packagePath);
    const authority = {
      schemaVersion: MARKETPLACE_ARCHIVE_SOURCE_SCHEMA,
      status: "digest-verified-and-extracted",
      url: artifact.url,
      registryOrigin: new URL(options.registryUrl).origin,
      archiveSha256: artifact.sha256,
      compressedBytes: artifact.bytes.length,
      payloadSha256: payload.digest,
      fileCount: payload.fileCount,
      totalBytes: payload.totalBytes,
      fromCache: artifact.fromCache,
    };
    fs.writeFileSync(
      path.join(temporary, "authority.json"),
      `${JSON.stringify(authority)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    try {
      fs.renameSync(temporary, finalRoot);
    } catch (error) {
      if (!fs.existsSync(finalRoot)) throw error;
    }
    const cached = readAuthority(finalRoot, expected);
    return {
      dir: cached.packagePath,
      authority: { ...cached.authority, fromCache: artifact.fromCache },
    };
  } finally {
    if (fs.existsSync(temporary)) {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}
