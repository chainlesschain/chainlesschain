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

export const _deps = {
  // Node 22+ global fetch; injectable for tests.
  fetch: (...args) => globalThis.fetch(...args),
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
};

const DEFAULT_TIMEOUT_MS = 15_000;

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
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new Error(`invalid registry URL: ${url}`);
  }
  if (u.protocol === "https:") return;
  if (u.protocol !== "http:") {
    throw new Error(`registry URL must be http(s): ${url}`);
  }
  // WHATWG URL keeps the brackets on IPv6 hostnames — strip before comparing.
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback =
    host === "localhost" || host === "127.0.0.1" || host === "::1";
  const optIn =
    allowInsecure === true || process.env.CC_PLUGIN_REGISTRY_ALLOW_HTTP === "1";
  if (loopback || optIn) return;
  throw new Error(
    `plain-HTTP registry rejected: ${url} — a network MITM controls both the ` +
      `source and its sha256, so the integrity check verifies nothing. Use ` +
      `https, or opt in with --allow-insecure-registry / ` +
      `CC_PLUGIN_REGISTRY_ALLOW_HTTP=1 on a trusted network.`,
  );
}

/** Where a fetched registry is cached (content-addressed by its URL). */
export function registryCachePath(url, cacheDir) {
  const dir =
    cacheDir || path.join(getElectronUserDataDir(), "plugin-registry-cache");
  const hash = crypto
    .createHash("sha256")
    .update(String(url))
    .digest("hex")
    .slice(0, 32);
  return path.join(dir, `${hash}.json`);
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
 * GET a registry/manifest URL as JSON, with optional bearer auth. On success the
 * body is written to the offline cache; on a network/HTTP failure we fall back
 * to that cache (so a previously-seen registry still installs offline). Throws
 * only when neither the network NOR the cache can produce a valid document.
 *
 * @returns {Promise<{ registry: object, fromCache: boolean }>}
 */
export async function fetchRegistry(url, opts = {}) {
  const {
    token,
    cacheDir,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    allowCache = true,
  } = opts;
  assertRegistryUrlSafe(url, { allowInsecure: opts.allowInsecure });
  const cachePath = registryCachePath(url, cacheDir);
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let networkErr = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await _deps.fetch(url, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(
        `registry fetch failed: HTTP ${res.status} ${res.statusText || ""}`.trim(),
      );
    }
    const text = await res.text();
    const registry = validateRegistry(JSON.parse(text), url);
    if (allowCache) writeCache(cachePath, text);
    return { registry, fromCache: false };
  } catch (err) {
    networkErr = err;
  }

  // Network failed — try the offline cache.
  if (allowCache && _deps.existsSync(cachePath)) {
    try {
      const text = _deps.readFileSync(cachePath, "utf8");
      const registry = validateRegistry(JSON.parse(text), url);
      return { registry, fromCache: true };
    } catch {
      /* cache unreadable — fall through to throw the network error */
    }
  }
  throw new Error(
    `could not fetch registry ${url}: ${networkErr ? networkErr.message : "unknown error"}` +
      (allowCache ? " (no offline cache available)" : ""),
  );
}

function writeCache(cachePath, text) {
  try {
    _deps.mkdirSync(path.dirname(cachePath), { recursive: true });
    _deps.writeFileSync(cachePath, text, "utf8");
  } catch {
    /* caching is best-effort; a read-only cache dir must not break install */
  }
}

/** Validate + normalize a fetched document into a registry object. Throws on garbage. */
export function validateRegistry(doc, url = "") {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`registry at ${url} is not a JSON object`);
  }
  if (Array.isArray(doc.plugins)) {
    for (const p of doc.plugins) {
      if (!p || typeof p !== "object" || !p.name || !p.source) {
        throw new Error(
          `registry at ${url} has a plugin entry missing name/source`,
        );
      }
    }
    return doc;
  }
  // Single-plugin manifest.
  if (doc.source) {
    return { plugins: [doc] };
  }
  throw new Error(
    `registry at ${url} must have a "plugins" array or a top-level "source"`,
  );
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
  const token = resolveRegistryToken(url, opts);
  const { registry, fromCache } = await fetchRegistry(url, { ...opts, token });
  const entry = resolvePluginEntry(registry, opts.name);
  // Carry a `#ref` on the source string so installFromSource pins the checkout,
  // matching its existing `owner/repo#ref` / `url#ref` convention.
  const source = entry.ref ? `${entry.source}#${entry.ref}` : entry.source;
  return {
    source,
    ref: entry.ref || null,
    sha256: entry.sha256 || null,
    entry,
    fromCache,
  };
}

/** Best-effort local temp dir helper (kept here so tests can stub fs deps). */
export function _tmpRoot() {
  return os.tmpdir();
}
