/**
 * Managed CLI runtime — pure core (twin-contract with the JetBrains plugin).
 *
 * When no usable global `cc` exists, the extension can download, verify,
 * cache and use its own copy of the `chainlesschain` npm package. This module
 * holds ALL of the decision logic — registry-metadata planning, integrity
 * verification, .tgz extraction (minimal pure tar reader with PaxHeader /
 * GNU @LongLink / ustar-prefix support and a zip-slip guard), install-state
 * bookkeeping with one-step rollback, launcher-shim generation, and the
 * candidate-ordering rules — with every side effect injected so the JB twin
 * can assert byte-identical decisions on the shared fixtures in
 * `src/__fixtures__/managed-cli/`.
 *
 * Iron rule honored by deriveCliCandidates: an explicitly configured
 * `chainlesschain.cli.path` is NEVER silently replaced. If it is broken we
 * keep using it, surface a diagnostic, and at most OFFER the managed copy.
 *
 * Determinism notes:
 *  - node:crypto (verifyTarball's default hasher) and node:zlib
 *    (extractPackage's default gunzip) are the only built-ins used, both on
 *    in-memory Buffers — deterministic, no filesystem / network / clock.
 *  - All clock reads (`now`) and filesystem probes are injected.
 *
 * On-disk layout (rootDir = <globalStorage>/managed-cli, created by glue):
 *   <rootDir>/current.json                     — state {version, installedAt, previousVersion}
 *   <rootDir>/<version>/package/…              — the extracted npm package
 *   <rootDir>/cc-managed.cmd | cc-managed      — launcher shims (regenerated per install)
 *
 * The managed copy is launched as `node <pkgDir>/<binRel>` via the shim; the
 * extension host's own Node (Electron) is NOT usable for spawning cc, so the
 * shim resolves `node` from PATH at run time. No `node` on PATH ⇒ managed
 * runtime impossible ⇒ managedNodeDiagnostic says exactly that.
 *
 * Pure CommonJS, no `vscode`.
 */

"use strict";

const PACKAGE_NAME = "chainlesschain";
const REGISTRY_BASE = "https://registry.npmjs.org";
const MANAGED_DIR_NAME = "managed-cli";
const STATE_FILE = "current.json";
/** Launcher shim base name — distinctive so it never shadows a global cc. */
const SHIM_BASE = "cc-managed";

/** Extraction safety caps (the packed CLI is ~2 MB / ~1.5k files). */
const MAX_ENTRY_COUNT = 20000;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

/** Registry URL for the metadata of a version (or the `latest` dist-tag). */
function registryMetaUrl(requestedVersion = "latest", opts = {}) {
  const base = (opts.registryBase || REGISTRY_BASE).replace(/\/+$/, "");
  const pkg = opts.packageName || PACKAGE_NAME;
  const v = requestedVersion || "latest";
  return `${base}/${pkg}/${encodeURIComponent(v)}`;
}

/** Local x.y.z compare (prerelease ignored) — mirrors version-check.js, kept
 *  inline so this module stays a single-file twin contract. */
function compareVersions(a, b) {
  const pa = String(a).split("-")[0].split(".");
  const pb = String(b).split("-")[0].split(".");
  for (let i = 0; i < 3; i++) {
    const da = parseInt(pa[i], 10) || 0;
    const db = parseInt(pb[i], 10) || 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/**
 * Resolve target version + tarball URL + expected integrity from npm registry
 * metadata. `registryMeta` may be either:
 *  - a VERSION MANIFEST (what `GET /chainlesschain/latest` returns):
 *    {name, version, dist:{tarball, integrity?, shasum?}}
 *  - a PACKUMENT: {name, "dist-tags":{latest}, versions:{v:{…manifest}}}
 * Fail-closed: no dist / http tarball / missing integrity+shasum / below the
 * floor all return {ok:false, error} instead of a best-effort plan.
 *
 * @returns {{ok:true, version:string, tarballUrl:string,
 *            integrity:{algorithm:"sha512"|"sha1", value:string}}
 *          |{ok:false, error:string, version?:string, floorVersion?:string}}
 *          sha512 value is base64 (npm `dist.integrity` payload);
 *          sha1 value is lowercase hex (npm `dist.shasum`).
 */
function planManagedInstall({
  requestedVersion = "latest",
  registryMeta,
  floorVersion = null,
  packageName = PACKAGE_NAME,
} = {}) {
  if (!registryMeta || typeof registryMeta !== "object") {
    return { ok: false, error: "no-registry-meta" };
  }
  let manifest = registryMeta;
  if (registryMeta.versions && typeof registryMeta.versions === "object") {
    // Packument form: resolve the requested version through dist-tags.
    const v =
      requestedVersion === "latest" || !requestedVersion
        ? registryMeta["dist-tags"] && registryMeta["dist-tags"].latest
        : requestedVersion;
    manifest = v ? registryMeta.versions[v] : null;
    if (!manifest) {
      return { ok: false, error: "version-not-found", version: v || null };
    }
  }
  if (manifest.name && manifest.name !== packageName) {
    return { ok: false, error: "wrong-package", name: manifest.name };
  }
  const version = manifest.version;
  if (!version || typeof version !== "string") {
    return { ok: false, error: "no-version" };
  }
  const dist = manifest.dist;
  if (!dist || typeof dist.tarball !== "string" || !dist.tarball) {
    return { ok: false, error: "no-tarball", version };
  }
  if (!/^https:\/\//i.test(dist.tarball)) {
    return { ok: false, error: "insecure-tarball-url", version };
  }
  if (floorVersion && compareVersions(version, floorVersion) < 0) {
    return { ok: false, error: "below-floor", version, floorVersion };
  }
  // Prefer the sha512 SRI entry; fall back to the legacy sha1 shasum.
  let integrity = null;
  if (typeof dist.integrity === "string" && dist.integrity) {
    for (const part of dist.integrity.trim().split(/\s+/)) {
      const m = /^sha512-([A-Za-z0-9+/=]+)$/.exec(part);
      if (m) {
        integrity = { algorithm: "sha512", value: m[1] };
        break;
      }
    }
  }
  if (
    !integrity &&
    typeof dist.shasum === "string" &&
    /^[0-9a-fA-F]{40}$/.test(dist.shasum)
  ) {
    integrity = { algorithm: "sha1", value: dist.shasum.toLowerCase() };
  }
  if (!integrity) return { ok: false, error: "no-integrity", version };
  return { ok: true, version, tarballUrl: dist.tarball, integrity };
}

/**
 * Verify a downloaded tarball Buffer against the plan's expected integrity.
 * Hashing is injected for the twin contract; the default uses node:crypto on
 * the in-memory Buffer (deterministic — no IO).
 * @param {Buffer} buffer
 * @param {{algorithm:"sha512"|"sha1", value:string}} expected  (from planManagedInstall)
 * @returns {{ok:boolean, algorithm:string, expected:string, actual:string}}
 */
function verifyTarball(buffer, expected, deps = {}) {
  const createHash =
    deps.createHash || ((algo) => require("node:crypto").createHash(algo));
  if (!expected || !expected.algorithm || !expected.value) {
    return { ok: false, algorithm: "none", expected: "", actual: "" };
  }
  const encoding = expected.algorithm === "sha512" ? "base64" : "hex";
  const actual = createHash(expected.algorithm).update(buffer).digest(encoding);
  const want =
    encoding === "hex" ? String(expected.value).toLowerCase() : expected.value;
  return {
    ok: actual === want,
    algorithm: expected.algorithm,
    expected: want,
    actual,
  };
}

// ---------------------------------------------------------------------------
// Minimal pure tar reader (npm .tgz payloads).
// Handles: ustar name+prefix fields, PaxHeader (`x`) `path=` overrides, GNU
// @LongLink (`L`) long names, header checksum validation, base-256 sizes.
// (This repo was burned by GNU tar @LongLink before — trap #22 — so long-path
// support is REQUIRED, not optional.)
// ---------------------------------------------------------------------------

function _cString(buf, start, len) {
  let end = start;
  const max = start + len;
  while (end < max && buf[end] !== 0) end++;
  return buf.toString("utf-8", start, end);
}

function _octal(buf, start, len) {
  // GNU base-256: high bit of the first byte set → big-endian binary number.
  if (buf[start] & 0x80) {
    let n = buf[start] & 0x7f;
    for (let i = start + 1; i < start + len; i++) n = n * 256 + buf[i];
    return n;
  }
  const s = buf.toString("latin1", start, start + len).replace(/[^0-7]/g, " ");
  const t = s.trim();
  return t ? parseInt(t, 8) : 0;
}

function _checksumOk(header) {
  const stored = _octal(header, 148, 8);
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < 512; i++) {
    const b = i >= 148 && i < 156 ? 0x20 : header[i];
    unsigned += b;
    signed += i >= 148 && i < 156 ? 0x20 : (b << 24) >> 24; // int8 view
  }
  return stored === unsigned || stored === signed;
}

/** Parse `LEN key=value\n` pax records; returns {path?:string, …}. */
function _parsePax(data) {
  const out = {};
  let off = 0;
  while (off < data.length) {
    let sp = data.indexOf(0x20, off);
    if (sp < 0) break;
    const len = parseInt(data.toString("latin1", off, sp), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const rec = data.toString("utf-8", sp + 1, off + len - 1); // drop trailing \n
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    off += len;
  }
  return out;
}

/**
 * Parse a (already gunzipped) tar Buffer into entries.
 * @returns {{entries:Array<{path:string,type:"file"|"dir"|"other",mode:number,data:Buffer}>}
 *          |{error:string}}
 */
function parseTarEntries(tarBuf) {
  const entries = [];
  let off = 0;
  let pendingLongName = null;
  let pendingPax = null;
  while (off + 512 <= tarBuf.length) {
    const header = tarBuf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive block
    if (!_checksumOk(header)) return { error: "tar-checksum-mismatch" };
    const size = _octal(header, 124, 12);
    if (!Number.isFinite(size) || size < 0) return { error: "tar-bad-size" };
    const typeByte = header[156];
    const type = typeByte === 0 ? "0" : String.fromCharCode(typeByte);
    const dataStart = off + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tarBuf.length) return { error: "tar-truncated" };
    const data = tarBuf.subarray(dataStart, dataEnd);
    off = dataStart + Math.ceil(size / 512) * 512;

    if (type === "L") {
      // GNU @LongLink: the DATA of this pseudo-entry is the next entry's name.
      pendingLongName = data.toString("utf-8").replace(/\0+$/, "");
      continue;
    }
    if (type === "x" || type === "X") {
      pendingPax = _parsePax(data); // extended header for the NEXT entry
      continue;
    }
    if (type === "g") continue; // global pax header — ignored

    const name = _cString(header, 0, 100);
    const magic = header.toString("latin1", 257, 262);
    const prefix = magic.startsWith("ustar") ? _cString(header, 345, 155) : "";
    let path = name;
    if (prefix) path = prefix + "/" + name;
    if (pendingLongName != null) path = pendingLongName; // GNU long name wins
    if (pendingPax && typeof pendingPax.path === "string" && pendingPax.path) {
      path = pendingPax.path; // pax `path=` outranks everything
    }
    pendingLongName = null;
    pendingPax = null;
    entries.push({
      path,
      type: type === "0" ? "file" : type === "5" ? "dir" : "other",
      mode: _octal(header, 100, 8) || 0o644,
      data,
    });
  }
  return { entries };
}

/**
 * Filter parsed tar entries into a safe extraction plan.
 *  - Only entries under the npm `package/` root are accepted (anything else
 *    ⇒ {error:"unexpected-layout"} — fail-closed, never guess).
 *  - Zip-slip guard: absolute paths, drive letters, backslashes, `..` and
 *    empty segments are rejected with {error:"unsafe-path", path}.
 *  - Caps: maxFiles entries / maxTotalBytes payload.
 * Returned file paths keep the `package/` prefix (relative to the version
 * dir), with `.` segments dropped.
 * @returns {{files:Array<{path:string,data:Buffer,mode:number}>,
 *            dirs:string[], totalBytes:number}|{error:string, path?:string}}
 */
function planExtraction(entries, opts = {}) {
  const maxFiles = opts.maxFiles || MAX_ENTRY_COUNT;
  const maxTotalBytes = opts.maxTotalBytes || MAX_TOTAL_BYTES;
  const files = [];
  const dirs = new Set();
  let totalBytes = 0;
  for (const e of entries) {
    if (e.type === "other") continue; // links / devices / fifos — never extract
    const raw = String(e.path || "");
    if (!raw) return { error: "unsafe-path", path: raw };
    if (raw.includes("\\") || raw.includes("\0")) {
      return { error: "unsafe-path", path: raw };
    }
    if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
      return { error: "unsafe-path", path: raw };
    }
    const segs = raw.split("/").filter((s) => s !== "" && s !== ".");
    if (segs.some((s) => s === ".."))
      return { error: "unsafe-path", path: raw };
    if (segs.length === 0) continue;
    if (segs[0] !== "package") return { error: "unexpected-layout", path: raw };
    const norm = segs.join("/");
    if (e.type === "dir") {
      dirs.add(norm);
      continue;
    }
    if (segs.length < 2) return { error: "unexpected-layout", path: raw };
    files.push({ path: norm, data: e.data, mode: e.mode });
    dirs.add(segs.slice(0, -1).join("/"));
    totalBytes += e.data.length;
    if (files.length > maxFiles) return { error: "too-many-files" };
    if (totalBytes > maxTotalBytes) return { error: "too-large" };
  }
  if (files.length === 0) return { error: "empty-package" };
  return { files, dirs: [...dirs].sort(), totalBytes };
}

/**
 * Gunzip + parse + plan in one step. `gunzip` injectable for the twin
 * contract; default node:zlib on the in-memory Buffer (no IO).
 */
function extractPackage(tgzBuffer, opts = {}) {
  const gunzip = opts.gunzip || ((b) => require("node:zlib").gunzipSync(b));
  let tarBuf;
  try {
    tarBuf = gunzip(tgzBuffer);
  } catch {
    return { error: "gunzip-failed" };
  }
  const parsed = parseTarEntries(tarBuf);
  if (parsed.error) return { error: parsed.error };
  return planExtraction(parsed.entries, opts);
}

// ---------------------------------------------------------------------------
// Install state + rollback
// ---------------------------------------------------------------------------

/** Parse current.json text; null on any corruption (never throws). */
function parseStateJson(text) {
  try {
    const s = JSON.parse(String(text));
    if (!s || typeof s !== "object" || typeof s.version !== "string") {
      return null;
    }
    return {
      version: s.version,
      installedAt: typeof s.installedAt === "number" ? s.installedAt : 0,
      previousVersion:
        typeof s.previousVersion === "string" ? s.previousVersion : null,
    };
  } catch {
    return null;
  }
}

/**
 * The state after installing `version` over `previousState`.
 * Reinstalling the SAME version keeps the old previousVersion (a repair must
 * not destroy the rollback target).
 */
function nextState({ version, previousState = null, now = 0 } = {}) {
  const prev =
    previousState && previousState.version && previousState.version !== version
      ? previousState.version
      : (previousState && previousState.previousVersion) || null;
  return { version, installedAt: now, previousVersion: prev };
}

/**
 * One-step rollback plan.
 * @param {object|null} state           parsed current.json
 * @param {(version:string)=>boolean} hasVersionDir  injected disk probe
 * @returns {{ok:true, version:string, newState:object}
 *          |{ok:false, reason:"no-state"|"no-previous"|"previous-missing"}}
 */
function rollbackPlan(state, hasVersionDir, { now = 0 } = {}) {
  if (!state || !state.version) return { ok: false, reason: "no-state" };
  const prev = state.previousVersion;
  if (!prev) return { ok: false, reason: "no-previous" };
  if (typeof hasVersionDir === "function" && !hasVersionDir(prev)) {
    return { ok: false, reason: "previous-missing" };
  }
  return {
    ok: true,
    version: prev,
    // Rolling back consumes the slot — no ping-pong chain is kept.
    newState: { version: prev, installedAt: now, previousVersion: null },
  };
}

// ---------------------------------------------------------------------------
// Binary resolution + launcher shims
// ---------------------------------------------------------------------------

/**
 * The bin entry (relative path) of an extracted package.json. The real
 * chainlesschain package declares {bin:{chainlesschain,cc,clc,clchain}} all
 * pointing at "./bin/chainlesschain.js"; prefer `cc`, then the package name,
 * then any entry. A string `bin` is used as-is. Null when absent.
 */
function packageBinEntry(pkgJson, packageName = PACKAGE_NAME) {
  if (!pkgJson || typeof pkgJson !== "object") return null;
  const bin = pkgJson.bin;
  if (typeof bin === "string" && bin) return bin;
  if (bin && typeof bin === "object") {
    const rel = bin.cc || bin[packageName] || Object.values(bin)[0];
    return typeof rel === "string" && rel ? rel : null;
  }
  return null;
}

/**
 * Resolve the managed install to a spawnable `node <entry>` invocation.
 * All filesystem access injected: {exists(path):bool, readJson(path):object|null,
 * joinPath?:(…parts)=>string} (joinPath defaults to node:path.join).
 * @returns {{version:string, entry:string, nodeArgs:string[]}|null}
 */
function resolveManagedBinary(rootDir, state, deps = {}) {
  if (!rootDir || !state || !state.version) return null;
  const join = deps.joinPath || ((...p) => require("node:path").join(...p));
  const exists = deps.exists || (() => false);
  const pkgDir = join(rootDir, state.version, "package");
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!exists(pkgJsonPath)) return null;
  const pkg = deps.readJson ? deps.readJson(pkgJsonPath) : null;
  const binRel = packageBinEntry(pkg);
  if (!binRel) return null;
  const entry = join(
    pkgDir,
    ...binRel.split("/").filter((s) => s && s !== "."),
  );
  if (!exists(entry)) return null;
  return { version: state.version, entry, nodeArgs: [entry] };
}

/**
 * Launcher shim scripts wrapping `node "<entry>" <args…>`. `node` is resolved
 * from PATH at RUN time (the extension host's Electron is not a usable node).
 * Paths containing a double quote / CR / LF cannot be quoted safely into
 * either script ⇒ {error:"unquotable-entry-path"} (fail-closed).
 */
function buildLauncherScripts({ entryPath } = {}) {
  if (!entryPath || /["\r\n]/.test(entryPath)) {
    return { error: "unquotable-entry-path" };
  }
  return {
    windows: {
      name: SHIM_BASE + ".cmd",
      content: `@ECHO OFF\r\nnode "${entryPath}" %*\r\n`,
    },
    posix: {
      name: SHIM_BASE,
      content: `#!/bin/sh\nexec node "${entryPath}" "$@"\n`,
      mode: 0o755,
    },
  };
}

/** Shim file name for a platform. */
function shimName(platform) {
  return platform === "win32" ? SHIM_BASE + ".cmd" : SHIM_BASE;
}

/**
 * The command string spawn sites can use. Every cc spawn in this extension
 * uses `shell: platform==="win32"`, so on Windows a path with whitespace must
 * be pre-quoted for cmd.exe; on POSIX (no shell) the raw path is correct.
 */
function commandForSpawn(shimPath, platform) {
  if (platform === "win32" && /\s/.test(shimPath)) return `"${shimPath}"`;
  return shimPath;
}

/**
 * Explicit diagnostic for whether a managed runtime is even possible.
 * @param {{nodeVersionOutput:string|null, minNodeVersion:string}} p
 * @returns {{ok:true, version:string}
 *          |{ok:false, reason:"no-node"|"node-too-old", version?:string}}
 */
function managedNodeDiagnostic({ nodeVersionOutput, minNodeVersion } = {}) {
  const m = /v?(\d+\.\d+\.\d+)/.exec(String(nodeVersionOutput || ""));
  if (!m) return { ok: false, reason: "no-node" };
  const version = m[1];
  if (minNodeVersion && compareVersions(version, minNodeVersion) < 0) {
    return { ok: false, reason: "node-too-old", version };
  }
  return { ok: true, version };
}

// ---------------------------------------------------------------------------
// Candidate ordering (the decision core — fixture-locked, twin-asserted)
// ---------------------------------------------------------------------------

/**
 * Ordered CLI-source decision. Order: explicit setting > usable global
 * (≥ floor) > managed (enabled + node on PATH) > outdated global > none.
 *
 * A broken explicit path is STILL used (never silently replaced — iron rule);
 * we emit "explicit-path-broken" and may OFFER the managed copy.
 *
 * @param {{
 *   configured: {path:string, usable:boolean}|null,  // null when setting is default ("cc"/empty)
 *   global: {binary:string, version:string}|null,     // first PATH probe that answered as chainlesschain
 *   managed: {command:string, version:string}|null,   // resolveManagedBinary result (via its shim)
 *   managedEnabled: boolean,
 *   nodeOnPath: boolean,
 *   floorVersion: string|null
 * }} input
 * @returns {{use:"explicit"|"global"|"managed"|"none", command:string|null,
 *            offerManaged:boolean, diagnostics:string[]}}
 */
function deriveCliCandidates(input = {}) {
  const {
    configured = null,
    global: globalProbe = null,
    managed = null,
    managedEnabled = true,
    nodeOnPath = false,
    floorVersion = null,
  } = input;
  const diagnostics = [];
  const push = (d) => {
    if (!diagnostics.includes(d)) diagnostics.push(d);
  };

  // 1. Explicit setting always wins — broken or not.
  if (configured && configured.path) {
    let offerManaged = false;
    if (configured.usable === false) {
      push("explicit-path-broken");
      if (!managedEnabled) push("managed-disabled");
      else if (!nodeOnPath) push("no-node-on-path");
      else offerManaged = true; // OFFER only — the setting stays authoritative
    }
    return {
      use: "explicit",
      command: configured.path,
      offerManaged,
      diagnostics,
    };
  }

  // 2. A global cc at (or above) the floor.
  const globalMeetsFloor =
    globalProbe &&
    (!floorVersion || compareVersions(globalProbe.version, floorVersion) >= 0);
  if (globalMeetsFloor) {
    return {
      use: "global",
      command: globalProbe.binary,
      offerManaged: false,
      diagnostics,
    };
  }

  // 3. An installed managed copy (needs the feature enabled + node on PATH).
  if (managed) {
    if (!managedEnabled) push("managed-disabled");
    else if (!nodeOnPath) push("no-node-on-path");
    else {
      if (globalProbe) push("global-below-floor");
      return {
        use: "managed",
        command: managed.command,
        offerManaged: false,
        diagnostics,
      };
    }
  }

  // 4. A below-floor global still beats nothing (version-check nudges it).
  if (globalProbe) {
    push("global-below-floor");
    return {
      use: "global",
      command: globalProbe.binary,
      offerManaged: !managed && managedEnabled && nodeOnPath,
      diagnostics,
    };
  }

  // 5. Nothing usable. Offer a managed download when it is actually possible;
  //    otherwise say exactly why it is not (明确诊断).
  let offerManaged = false;
  if (!managedEnabled) push("managed-disabled");
  else if (!nodeOnPath) push("no-node-on-path");
  else offerManaged = true;
  return { use: "none", command: null, offerManaged, diagnostics };
}

module.exports = {
  PACKAGE_NAME,
  REGISTRY_BASE,
  MANAGED_DIR_NAME,
  STATE_FILE,
  SHIM_BASE,
  MAX_ENTRY_COUNT,
  MAX_TOTAL_BYTES,
  registryMetaUrl,
  planManagedInstall,
  verifyTarball,
  parseTarEntries,
  planExtraction,
  extractPackage,
  parseStateJson,
  nextState,
  rollbackPlan,
  packageBinEntry,
  resolveManagedBinary,
  buildLauncherScripts,
  shimName,
  commandForSpawn,
  managedNodeDiagnostic,
  deriveCliCandidates,
};
