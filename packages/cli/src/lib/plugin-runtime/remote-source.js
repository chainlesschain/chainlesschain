/**
 * Remote plugin sources — install from a hosted registry / manifest URL, not
 * just a local dir or git URL (Phase 3 "远程 manifest" + "私有仓认证" + "离线
 * seed cache" work items).
 *
 * A remote source is an `https?://…/*.json` document, in one of two shapes:
 *
 *   1. Registry index — many plugins, selected by name:
 *      { "name": "acme-registry",
 *        "plugins": [
 *          { "name": "toml-tools", "source": "https://github.com/x/toml.git",
 *            "ref": "v1.0.0", "version": "1.0.0", "description": "…", "sha256": "…" },
 *          { "name": "py-helpers", "source": "owner/py-helpers" }
 *        ] }
 *
 *   2. Single-plugin manifest — one plugin, no selection needed:
 *      { "name": "toml-tools", "source": "https://github.com/x/toml.git", "ref": "v1.0.0" }
 *
 * The remote layer is an INDIRECTION: it resolves a name → a git source string
 * that the existing installer (`installFromSource`) already knows how to clone.
 * This keeps the sync install core untouched and avoids bundling a tarball
 * extractor. Downloaded registry JSON is cached content-addressed so browsing /
 * installing works OFFLINE, and a bearer token can gate a PRIVATE registry.
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { getElectronUserDataDir } from "../paths.js";
import {
  enforcePluginSourcePolicy,
  resolvePluginManagedPolicy,
} from "../plugin-security.js";
import {
  assertPluginGitTransportSafe,
  parsePluginGitSource,
  redactPluginSourceForDisplay,
} from "../plugin-source-identity.js";
import { createMarketplaceNetworkTransport } from "./marketplace-network.js";

export const _deps = {
  // Node 22+ global fetch; injectable for tests.
  fetch: (...args) => globalThis.fetch(...args),
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  lstatSync: fs.lstatSync,
  readdirSync: fs.readdirSync,
  openSync: fs.openSync,
  fstatSync: fs.fstatSync,
  readSync: fs.readSync,
  closeSync: fs.closeSync,
  fsyncSync: fs.fsyncSync,
  linkSync: fs.linkSync,
  unlinkSync: fs.unlinkSync,
};

const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_REGISTRY_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const MAX_REGISTRY_CACHE_CANDIDATES = 64;
const SHA256_RE = /^[a-f0-9]{64}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const MAX_REGISTRY_SOURCE_CHARS = 4096;
const MAX_REGISTRY_REF_CHARS = 256;
const fetchedRegistryAuthorities = new WeakMap();
const registryResolutionAuthorities = new WeakMap();

/** True when `raw` looks like a remote registry/manifest URL (http(s) + .json). */
export function isRemoteSource(raw) {
  const s = String(raw || "").trim();
  return /^https?:\/\//i.test(s) && /\.json(\?.*)?(#.*)?$/i.test(s);
}

/**
 * Enforce HTTPS for registry URLs. The registry supplies BOTH the git source
 * and its claimed sha256 — over plain HTTP a network MITM controls the two
 * together, so the integrity check verifies nothing. Loopback is exempt (a
 * local dev registry isn't MITM-able off-host); anything else needs the
 * explicit opt-in (opts.allowInsecure / CC_PLUGIN_REGISTRY_ALLOW_HTTP=1).
 */
export function assertRegistryUrlSafe(url, { allowInsecure = false } = {}) {
  const displayUrl = redactPluginSourceForDisplay(url);
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new Error(`invalid registry URL: ${displayUrl}`);
  }
  if (u.username || u.password) {
    throw new Error("registry URL credentials are not supported");
  }
  if (u.protocol === "https:") return;
  if (u.protocol !== "http:") {
    throw new Error(`registry URL must be http(s): ${displayUrl}`);
  }
  // WHATWG URL keeps the brackets on IPv6 hostnames — strip before comparing.
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback =
    host === "localhost" || host === "127.0.0.1" || host === "::1";
  const optIn =
    allowInsecure === true || process.env.CC_PLUGIN_REGISTRY_ALLOW_HTTP === "1";
  if (loopback || optIn) return;
  throw new Error(
    `plain-HTTP registry rejected: ${displayUrl} — a network MITM controls both the ` +
      `source and its sha256, so the integrity check verifies nothing. Use ` +
      `https, or opt in with --allow-insecure-registry / ` +
      `CC_PLUGIN_REGISTRY_ALLOW_HTTP=1 on a trusted network.`,
  );
}

/** Directory for immutable registry documents, addressed by the complete URL. */
export function registryCacheDirectory(url, cacheDir) {
  const dir =
    cacheDir || path.join(getElectronUserDataDir(), "plugin-registry-cache");
  const hash = crypto
    .createHash("sha256")
    .update(String(url))
    .digest("hex")
    .slice(0, 32);
  return path.join(dir, hash);
}

/** Path for one immutable registry document bound to its SHA-256 digest. */
export function registryCachePath(url, cacheDir, documentSha256) {
  const digest = normalizeRegistrySha256(
    documentSha256,
    "registry document SHA-256",
  );
  return path.join(registryCacheDirectory(url, cacheDir), `${digest}.json`);
}

/**
 * Resolve the bearer token for a registry host from (in order): explicit
 * `opts.token`, `CC_PLUGIN_REGISTRY_TOKEN` env, or a per-host map in config
 * (`config.plugins.registryTokens[host]`). Returns null if none — a public
 * registry needs no token.
 */
export function resolveRegistryToken(url, { token, config } = {}) {
  if (token) return token;
  if (process.env.CC_PLUGIN_REGISTRY_TOKEN)
    return process.env.CC_PLUGIN_REGISTRY_TOKEN;
  try {
    const host = new URL(url).host;
    const map = config?.plugins?.registryTokens;
    if (map && map[host]) return map[host];
  } catch {
    /* bad URL — handled by fetch */
  }
  return null;
}

/**
 * GET a registry/manifest URL as bounded JSON, with optional bearer auth. On
 * success the body is written to an immutable content-addressed cache. Explicit
 * offline mode never attempts network access. An unpinned cache read is allowed
 * only when exactly one valid historical document exists for the URL.
 *
 * @returns {Promise<{ registry: object, fromCache: boolean,
 *   documentSha256: string }>}
 */
export async function fetchRegistry(url, opts = {}) {
  const displayUrl = redactPluginSourceForDisplay(url);
  assertRegistryUrlSafe(url, { allowInsecure: opts.allowInsecure });
  const managedPolicy = resolveManagedPolicy(opts);
  // This gate intentionally runs before transport construction. A blocked or
  // non-allowlisted marketplace must not reach proxy helpers, DNS, or fetch.
  enforcePluginSourcePolicy(url, managedPolicy, {
    action: opts.policyAction || "registry-fetch",
    cwd: opts.cwd,
    kindHint: "registry",
  });
  const {
    token,
    cacheDir,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    allowCache = true,
    offline = false,
  } = opts;
  const expectedSha256 = normalizeRegistrySha256(
    opts.expectedSha256,
    "expected registry document SHA-256",
    { optional: true },
  );
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  if (offline === true) {
    if (!allowCache) {
      throw new Error("offline registry mode requires immutable cache access");
    }
    let cached;
    try {
      cached = readCachedRegistry({
        url,
        cacheDir,
        expectedSha256,
      });
    } catch (error) {
      throw new Error(
        `registry ${displayUrl} verified immutable cache rejected: ${publicRegistryCacheErrorMessage(error)}`,
      );
    }
    if (cached) return bindFetchedRegistry(cached, url, managedPolicy);
    throw new Error(
      `registry ${displayUrl} is unavailable in the verified immutable cache` +
        (expectedSha256 ? ` at SHA-256 ${expectedSha256}` : ""),
    );
  }

  const networkTransport = createMarketplaceNetworkTransport({
    proxyUrl: opts.proxyUrl,
    pacFile: opts.pacFile,
    caFile: opts.caFile,
  });
  const fetchImpl = networkTransport?.fetch || _deps.fetch;
  let networkErr = null;
  let cacheFallbackAllowed = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, {
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (
      res?.redirected === true ||
      (Number(res?.status) >= 300 && Number(res?.status) < 400) ||
      responseUrlChanged(url, res?.url)
    ) {
      throw publicRegistryFailure(
        "registry redirects are disabled because each hop cannot be policy-validated",
      );
    }
    if (!res.ok) {
      const status = Number(res.status);
      throw publicRegistryFailure(
        `registry fetch failed: HTTP ${Number.isInteger(status) ? status : "unknown"}`,
        { cacheFallbackAllowed: status >= 500 },
      );
    }
    let bytes;
    try {
      bytes = await readBoundedRegistryResponse(res);
    } catch {
      throw publicRegistryFailure("registry response body is invalid");
    }
    const documentSha256 = sha256(bytes);
    if (expectedSha256 && documentSha256 !== expectedSha256) {
      throw publicRegistryFailure(
        `registry document SHA-256 mismatch: expected ${expectedSha256}, got ${documentSha256}`,
      );
    }
    let registry;
    try {
      const text = decodeRegistryUtf8(bytes);
      registry = validateRegistry(JSON.parse(text), url);
    } catch {
      throw publicRegistryFailure("registry document is invalid");
    }
    if (allowCache) writeImmutableCache(url, cacheDir, bytes, documentSha256);
    return bindFetchedRegistry(
      {
        registry,
        fromCache: false,
        documentSha256,
        ...(networkTransport?.authority
          ? { networkAuthority: networkTransport.authority }
          : {}),
      },
      url,
      managedPolicy,
    );
  } catch (err) {
    networkErr = err;
    cacheFallbackAllowed =
      err?.cacheFallbackAllowed === true ||
      err?.name === "AbortError" ||
      err instanceof TypeError;
  } finally {
    try {
      await networkTransport?.close();
    } catch {
      // Transport teardown is best-effort and must not override a verified
      // response or surface an implementation error that echoed request URLs.
    }
  }

  // Only transport failures and server-side outages may fall back. Authentication,
  // authorization, malformed content, and digest mismatches remain authoritative.
  if (allowCache && cacheFallbackAllowed) {
    try {
      const cached = readCachedRegistry({
        url,
        cacheDir,
        expectedSha256,
      });
      if (cached) return bindFetchedRegistry(cached, url, managedPolicy);
    } catch (cacheError) {
      throw new Error(
        `could not fetch registry ${displayUrl}: ${publicRegistryErrorMessage(networkErr)}; verified immutable cache rejected: ${publicRegistryCacheErrorMessage(cacheError)}`,
      );
    }
  }
  throw new Error(
    `could not fetch registry ${displayUrl}: ${publicRegistryErrorMessage(networkErr)}` +
      (allowCache && cacheFallbackAllowed
        ? " (no verified immutable cache available)"
        : ""),
  );
}

async function readBoundedRegistryResponse(response) {
  const contentLength = Number(response?.headers?.get?.("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REGISTRY_DOCUMENT_BYTES
  ) {
    throw new Error(
      `registry document exceeds ${MAX_REGISTRY_DOCUMENT_BYTES} bytes`,
    );
  }
  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > MAX_REGISTRY_DOCUMENT_BYTES) {
          await reader.cancel();
          throw new Error(
            `registry document exceeds ${MAX_REGISTRY_DOCUMENT_BYTES} bytes`,
          );
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, total);
    } finally {
      reader.releaseLock?.();
    }
  }
  const text = await response.text();
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > MAX_REGISTRY_DOCUMENT_BYTES) {
    throw new Error(
      `registry document exceeds ${MAX_REGISTRY_DOCUMENT_BYTES} bytes`,
    );
  }
  return bytes;
}

function writeImmutableCache(url, cacheDir, bytes, digest) {
  const cachePath = registryCachePath(url, cacheDir, digest);
  const directory = path.dirname(cachePath);
  let tempPath = null;
  let descriptor = null;
  try {
    _deps.mkdirSync(directory, { recursive: true, mode: 0o700 });
    assertCacheDirectorySafe(directory);
    tempPath = path.join(
      directory,
      `.tmp-${process.pid}-${crypto.randomBytes(12).toString("hex")}`,
    );
    descriptor = _deps.openSync(tempPath, "wx", 0o600);
    _deps.writeFileSync(descriptor, bytes);
    _deps.fsyncSync(descriptor);
    _deps.closeSync(descriptor);
    descriptor = null;
    try {
      _deps.linkSync(tempPath, cachePath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readBoundedRegularFile(cachePath);
      if (sha256(existing) !== digest || !existing.equals(bytes)) throw error;
    }
  } catch {
    /* caching remains best-effort; verification never trusts a partial write */
  } finally {
    if (descriptor != null) {
      try {
        _deps.closeSync(descriptor);
      } catch {
        /* best-effort cleanup */
      }
    }
    if (tempPath) {
      try {
        _deps.unlinkSync(tempPath);
      } catch {
        /* hidden temporary files are never cache candidates */
      }
    }
  }
}

function readCachedRegistry({ url, cacheDir, expectedSha256 }) {
  const directory = registryCacheDirectory(url, cacheDir);
  if (!_deps.existsSync(directory)) return null;
  assertCacheDirectorySafe(directory);
  const names = expectedSha256
    ? [`${expectedSha256}.json`]
    : _deps
        .readdirSync(directory, { withFileTypes: true })
        .filter(
          (entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name),
        )
        .map((entry) => entry.name)
        .sort();
  if (names.length > MAX_REGISTRY_CACHE_CANDIDATES) {
    throw new Error(
      `registry immutable cache has more than ${MAX_REGISTRY_CACHE_CANDIDATES} candidates`,
    );
  }
  const matches = [];
  for (const name of names) {
    const digest = name.slice(0, 64);
    const cachePath = path.join(directory, name);
    if (!_deps.existsSync(cachePath)) continue;
    try {
      const bytes = readBoundedRegularFile(cachePath);
      if (sha256(bytes) !== digest) {
        throw new Error("registry immutable cache digest mismatch");
      }
      const registry = validateRegistry(
        JSON.parse(decodeRegistryUtf8(bytes)),
        url,
      );
      matches.push({
        registry,
        fromCache: true,
        documentSha256: digest,
      });
    } catch (error) {
      if (expectedSha256) throw error;
    }
  }
  if (matches.length > 1) {
    throw new Error(
      "registry immutable cache is ambiguous; pin the expected registry document SHA-256",
    );
  }
  return matches[0] || null;
}

function assertCacheDirectorySafe(directory) {
  const stat = _deps.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("registry immutable cache path is not a directory");
  }
}

function readBoundedRegularFile(file) {
  let descriptor = null;
  try {
    const linkStat = _deps.lstatSync(file);
    if (
      !linkStat.isFile() ||
      linkStat.isSymbolicLink() ||
      linkStat.nlink !== 1 ||
      linkStat.size <= 0 ||
      linkStat.size > MAX_REGISTRY_DOCUMENT_BYTES
    ) {
      throw new Error(
        "registry immutable cache entry is not a bounded single-link regular file",
      );
    }
    descriptor = _deps.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const fileStat = _deps.fstatSync(descriptor);
    if (
      !fileStat.isFile() ||
      fileStat.nlink !== 1 ||
      fileStat.size <= 0 ||
      fileStat.size > MAX_REGISTRY_DOCUMENT_BYTES
    ) {
      throw new Error(
        "registry immutable cache entry changed during inspection",
      );
    }
    const chunks = [];
    let total = 0;
    while (total <= MAX_REGISTRY_DOCUMENT_BYTES) {
      const chunk = Buffer.allocUnsafe(
        Math.min(64 * 1024, MAX_REGISTRY_DOCUMENT_BYTES + 1 - total),
      );
      const count = _deps.readSync(descriptor, chunk, 0, chunk.length, null);
      if (count === 0) break;
      chunks.push(chunk.subarray(0, count));
      total += count;
    }
    if (total > MAX_REGISTRY_DOCUMENT_BYTES) {
      throw new Error(
        `registry immutable cache entry exceeds ${MAX_REGISTRY_DOCUMENT_BYTES} bytes`,
      );
    }
    return Buffer.concat(chunks, total);
  } finally {
    if (descriptor != null) _deps.closeSync(descriptor);
  }
}

function decodeRegistryUtf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("registry document is not valid UTF-8");
  }
}

function normalizeRegistrySha256(value, label, { optional = false } = {}) {
  if ((value == null || value === "") && optional) return null;
  const digest = String(value || "")
    .trim()
    .toLowerCase();
  if (!SHA256_RE.test(digest)) {
    throw new Error(`${label} must be 64 lowercase hexadecimal characters`);
  }
  return digest;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Validate + normalize a fetched document into a registry object. Throws on garbage. */
export function validateRegistry(doc, url = "") {
  const displayUrl = redactPluginSourceForDisplay(url);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`registry at ${displayUrl} is not a JSON object`);
  }
  if (Array.isArray(doc.plugins)) {
    for (const p of doc.plugins) {
      if (
        !p ||
        typeof p !== "object" ||
        typeof p.name !== "string" ||
        !p.name.trim() ||
        typeof p.source !== "string" ||
        p.source !== p.source.trim() ||
        !p.source ||
        p.source.length > MAX_REGISTRY_SOURCE_CHARS ||
        CONTROL_RE.test(p.source)
      ) {
        throw new Error(
          `registry at ${displayUrl} has a plugin entry missing name/source`,
        );
      }
      normalizeRegistryPluginSource(p);
    }
    return doc;
  }
  // Single-plugin manifest.
  if (typeof doc.source === "string" && doc.source) {
    normalizeRegistryPluginSource(doc);
    return { plugins: [doc] };
  }
  throw new Error(
    `registry at ${displayUrl} must have a "plugins" array or a top-level "source"`,
  );
}

function freezeRegistryValue(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freezeRegistryValue(child);
  return Object.freeze(value);
}

function bindFetchedRegistry(result, registryUrl, managedPolicy) {
  const registry = freezeRegistryValue(result.registry);
  fetchedRegistryAuthorities.set(
    registry,
    Object.freeze({
      registryUrl: String(registryUrl),
      documentSha256: result.documentSha256 || null,
      managedPolicy,
    }),
  );
  return { ...result, registry };
}

/** Validate one catalog entry as a bounded, remote Git source. */
export function normalizeRegistryPluginSource(entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error("registry plugin entry is invalid");
  }
  if (
    typeof entry.source !== "string" ||
    entry.source !== entry.source.trim() ||
    !entry.source ||
    entry.source.length > MAX_REGISTRY_SOURCE_CHARS ||
    CONTROL_RE.test(entry.source) ||
    entry.source.includes("#")
  ) {
    throw new Error("registry plugin source must be a bounded string");
  }
  let ref = null;
  if (entry.ref != null && entry.ref !== "") {
    if (
      typeof entry.ref !== "string" ||
      entry.ref !== entry.ref.trim() ||
      !entry.ref ||
      entry.ref.length > MAX_REGISTRY_REF_CHARS ||
      CONTROL_RE.test(entry.ref) ||
      entry.ref.includes("#") ||
      entry.source.includes("#")
    ) {
      throw new Error("registry plugin ref must be a bounded exact string");
    }
    ref = entry.ref;
  }
  const source = ref ? `${entry.source}#${ref}` : entry.source;
  let git;
  try {
    git = parsePluginGitSource(source);
    assertPluginGitTransportSafe(git, {
      allowFile: false,
      requireRemote: true,
    });
  } catch {
    throw new Error("registry plugin source must be a safe remote Git locator");
  }
  return { source, ref, git };
}

/**
 * Issue an unforgeable in-process capability for a selected entry. The entry
 * must be an exact member of a registry object returned by fetchRegistry;
 * callers cannot manufacture registry metadata to downgrade source policy.
 */
export function authorizeRegistryPluginEntry(
  registry,
  entry,
  { registryUrl, cwd } = {},
) {
  const fetched = fetchedRegistryAuthorities.get(registry);
  if (!fetched || fetched.registryUrl !== String(registryUrl)) {
    throw new Error("registry source authority is missing or mismatched");
  }
  if (!registry.plugins?.some((candidate) => candidate === entry)) {
    throw new Error("registry entry is not bound to the fetched catalog");
  }
  const normalized = normalizeRegistryPluginSource(entry);
  enforcePluginSourcePolicy(normalized.source, fetched.managedPolicy, {
    action: "registry-resolved-source",
    blockedOnly: true,
    cwd,
    kindHint: "git",
  });
  const authority = Object.freeze({});
  registryResolutionAuthorities.set(
    authority,
    Object.freeze({
      registryUrl: fetched.registryUrl,
      source: normalized.source,
      ref: normalized.ref,
      documentSha256: fetched.documentSha256,
    }),
  );
  return {
    ...normalized,
    registryResolutionAuthority: authority,
  };
}

/** Consume-only validation used by the installer before any target I/O. */
export function assertRegistryResolutionAuthority(
  authority,
  { registryUrl, source, ref } = {},
) {
  const issued = registryResolutionAuthorities.get(authority);
  if (
    !issued ||
    issued.registryUrl !== String(registryUrl) ||
    issued.source !== String(source) ||
    (issued.ref || null) !== (ref || null)
  ) {
    throw new Error("registry source authority is missing or mismatched");
  }
  return issued;
}

/** List installable entries from a registry (for `cc plugin search`). */
export function listRegistryPlugins(registry) {
  return (registry.plugins || []).map((p) => ({
    name: p.name,
    version: p.version || null,
    source: p.source,
    ref: p.ref || null,
    description: p.description || "",
  }));
}

/**
 * Pick one plugin entry from a registry. When the registry has exactly one
 * plugin, `name` is optional; otherwise it must match. Returns the entry, or
 * throws with a helpful list.
 */
export function resolvePluginEntry(registry, name) {
  const plugins = registry.plugins || [];
  if (plugins.length === 0) throw new Error("registry has no plugins");
  if (!name) {
    if (plugins.length === 1) return plugins[0];
    throw new Error(
      `registry has ${plugins.length} plugins — pick one with --name <plugin>:\n  ` +
        plugins.map((p) => p.name).join(", "),
    );
  }
  const entry = plugins.find((p) => p.name === name);
  if (!entry) {
    throw new Error(
      `plugin "${name}" not found in registry. Available:\n  ` +
        plugins.map((p) => p.name).join(", "),
    );
  }
  return entry;
}

/**
 * Full resolution: fetch the registry (with auth + offline cache), select the
 * entry, and return the git source string the existing installer consumes plus
 * carry-through metadata (ref pins the checkout; sha256 becomes an install
 * integrity check).
 *
 * @returns {Promise<{ source: string, ref: string|null, sha256: string|null,
 *   entry: object, fromCache: boolean }>}
 */
export async function resolveRemoteSource(url, opts = {}) {
  assertRegistryUrlSafe(url, { allowInsecure: opts.allowInsecure });
  const managedPolicy = resolveManagedPolicy(opts);
  const token = resolveRegistryToken(url, opts);
  const { registry, fromCache, documentSha256, networkAuthority } =
    await fetchRegistry(url, {
      ...opts,
      token,
      managedPolicy,
    });
  const entry = resolvePluginEntry(registry, opts.name);
  const authorized = authorizeRegistryPluginEntry(registry, entry, {
    registryUrl: url,
    cwd: opts.cwd,
  });
  return {
    source: authorized.source,
    ref: authorized.ref,
    sha256: entry.sha256 || null,
    entry,
    registryResolutionAuthority: authorized.registryResolutionAuthority,
    fromCache,
    documentSha256,
    ...(networkAuthority ? { networkAuthority } : {}),
  };
}

function resolveManagedPolicy(opts) {
  return resolvePluginManagedPolicy(opts);
}

function responseUrlChanged(requested, effective) {
  if (!effective) return false;
  try {
    const left = new URL(String(requested));
    const right = new URL(String(effective));
    for (const value of [left, right]) {
      value.username = "";
      value.password = "";
      value.hash = "";
    }
    return left.href !== right.href;
  } catch {
    return true;
  }
}

function publicRegistryErrorMessage(error) {
  if (!error) return "unknown error";
  if (typeof error.publicMessage === "string") return error.publicMessage;
  if (error.name === "AbortError") return "registry request timed out";
  if (error instanceof TypeError) return "registry transport failed";
  return "registry request failed";
}

function publicRegistryCacheErrorMessage(error) {
  const message = String(error?.message || "");
  if (message.includes("digest mismatch")) {
    return "registry immutable cache digest mismatch";
  }
  if (message.includes("ambiguous")) {
    return "registry immutable cache is ambiguous";
  }
  if (message.includes("more than")) {
    return "registry immutable cache has too many candidates";
  }
  if (message.includes("single-link regular file")) {
    return "registry immutable cache entry is invalid";
  }
  return "registry immutable cache document is invalid";
}

function publicRegistryFailure(message, { cacheFallbackAllowed = false } = {}) {
  const error = new Error(message);
  error.publicMessage = message;
  error.cacheFallbackAllowed = cacheFallbackAllowed;
  return error;
}

/** Best-effort local temp dir helper (kept here so tests can stub fs deps). */
export function _tmpRoot() {
  return os.tmpdir();
}
