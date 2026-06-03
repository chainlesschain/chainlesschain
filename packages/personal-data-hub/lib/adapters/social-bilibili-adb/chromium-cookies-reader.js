"use strict";

/**
 * Phase 1a (Bilibili C 路径 — 2026-05-25): Chromium WebView Cookies sqlite
 * reader.
 *
 * Android Bilibili App uses an internal Chromium WebView for the login/web
 * surface, which persists cookies to:
 *   /data/data/tv.danmaku.bili/app_webview/Default/Cookies
 *
 * The schema is the standard Chromium `cookies` table (verbatim across
 * desktop Chrome / Android System WebView / Android WebView component
 * since Chromium 80+). Schema reference:
 *   https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/extras/sqlite/sqlite_persistent_cookie_store.cc
 *
 *   CREATE TABLE cookies (
 *     creation_utc      INTEGER,     -- WebKit µs since 1601
 *     host_key          TEXT,        -- e.g. ".bilibili.com" or ".api.bilibili.com"
 *     top_frame_site_key TEXT,
 *     name              TEXT,        -- "SESSDATA" / "bili_jct" / ...
 *     value             TEXT,        -- plaintext on Android in most cases
 *     encrypted_value   BLOB,        -- AES-GCM-encrypted under OS Keychain
 *                                       on desktop; on Android typically empty
 *                                       (Android Keystore wrap is opt-in only
 *                                       in newer Chromium; field stays empty
 *                                       for the unwrapped App-WebView case)
 *     path              TEXT,
 *     expires_utc       INTEGER,
 *     is_secure         INTEGER,
 *     is_httponly       INTEGER,
 *     last_access_utc   INTEGER,
 *     has_expires       INTEGER,
 *     is_persistent     INTEGER,
 *     priority          INTEGER,
 *     samesite          INTEGER,
 *     source_scheme     INTEGER,
 *     source_port       INTEGER,
 *     is_same_party     INTEGER,
 *     last_update_utc   INTEGER
 *   );
 *
 * What this reader does NOT do (intentionally — gated to Phase 1b+):
 *  - Decrypt Android-Keystore-wrapped `encrypted_value` (rare in the
 *    App-WebView case, but possible on newer Android 14+ builds with
 *    aggressive Chromium upgrades). We log a warning + skip rows where
 *    `value` is empty and `encrypted_value` is non-empty.
 *  - Schema-version sniffing for ancient Chromium (<80) — old App WebViews
 *    used a `meta` table version <13; we treat unknown schemas as a hard
 *    error so the caller can surface "App too old, please update Bilibili"
 *    rather than producing garbage cookies.
 *
 * Test seam: callers can inject a synthetic `_databaseClass` to bypass the
 * dual-load probe — the unit test builds a real sqlite db on disk with
 * the chromium schema + a few rows.
 */

const path = require("node:path");

// Dual-load: bs3mc tracks Electron's ABI 140 (runtime path), plain
// better-sqlite3 tracks Node's ABI 127 (test path). Mirrors the pattern in
// chrome-db-reader.js — see memory bs3mc_bs3_abi_dual_load_adapter.md.
function loadDatabaseClass() {
  for (const mod of ["better-sqlite3-multiple-ciphers", "better-sqlite3"]) {
    let cls;
    try {
      // eslint-disable-next-line global-require
      cls = require(mod);
    } catch (_e) {
      continue;
    }
    try {
      const probe = new cls(":memory:");
      probe.close();
      return cls;
    } catch (_e) {
      // ABI mismatch — try next candidate
    }
  }
  throw new Error(
    "chromium-cookies-reader: neither better-sqlite3-multiple-ciphers nor better-sqlite3 loaded — both ABI-mismatched",
  );
}

// WebKit timestamps are microseconds since 1601-01-01 UTC. Convert to
// epoch-ms by shifting the epoch (11644473600 seconds × 1e6 µs/s).
// Mirrors chrome-db-reader.js.
const WEBKIT_EPOCH_DELTA_US = 11_644_473_600_000_000n;
function webkitUsToEpochMs(wkUs) {
  if (wkUs == null) return null;
  const bn = typeof wkUs === "bigint" ? wkUs : BigInt(wkUs);
  return Number((bn - WEBKIT_EPOCH_DELTA_US) / 1000n);
}

/**
 * Match a chromium `host_key` value against a domain like "bilibili.com".
 *
 * host_key formats in the wild:
 *   ".bilibili.com"        — domain cookie (most common)
 *   "bilibili.com"         — without leading dot (older Chromium)
 *   ".api.bilibili.com"    — subdomain pinned
 *   "api.bilibili.com"     — host-only
 *
 * We accept all four for a `domain` of "bilibili.com" — same semantics
 * Chromium itself uses when matching cookies to requests.
 */
function hostKeyMatches(hostKey, domain) {
  if (!hostKey || !domain) return false;
  // Normalize: strip leading dot from both
  const h = hostKey.startsWith(".") ? hostKey.substring(1) : hostKey;
  const d = domain.startsWith(".") ? domain.substring(1) : domain;
  // Exact or subdomain match
  return h === d || h.endsWith("." + d);
}

/**
 * Read cookies matching `domain` from a Chromium-shape sqlite at `dbPath`.
 *
 * Returns an array of `{name, value, hostKey, expiresMs, isSecure,
 * isHttponly, isPersistent}` objects. The caller is responsible for
 * filtering by cookie name (e.g. "SESSDATA" / "bili_jct" / ...) and
 * assembling them into a Cookie header.
 *
 * Note: this opens the DB read-only and closes after the synchronous read.
 * Even though we read from a temp copy (ADB pulled to a host-side temp
 * dir), opening read-only is good hygiene.
 *
 * @param {string} dbPath  absolute path to a chromium Cookies sqlite file
 * @param {string} domain  cookie host to filter, e.g. "bilibili.com"
 * @param {{_databaseClass?: any, _now?: number}} [opts]  test seams
 * @returns {Array<{name: string, value: string, hostKey: string,
 *   expiresMs: number|null, isSecure: boolean, isHttponly: boolean,
 *   isPersistent: boolean, hasEncryptedValue: boolean}>}
 */
function readChromiumCookies(dbPath, domain, opts = {}) {
  if (typeof dbPath !== "string" || dbPath.length === 0) {
    throw new TypeError("readChromiumCookies: dbPath must be a non-empty string");
  }
  if (typeof domain !== "string" || domain.length === 0) {
    throw new TypeError("readChromiumCookies: domain must be a non-empty string");
  }
  const Database = opts._databaseClass || loadDatabaseClass();
  const db = new Database(dbPath, { readonly: true });
  try {
    // Detect schema before relying on column names — old WebViews drop
    // columns (no top_frame_site_key) and new ones add columns (no
    // is_same_party in some 110+ builds). We only need name / value /
    // host_key / expires_utc / encrypted_value / is_secure / is_httponly /
    // is_persistent — verify each is present.
    let tableInfo;
    try {
      tableInfo = db.prepare("PRAGMA table_info(cookies)").all();
    } catch (_e) {
      throw new Error(
        "chromium-cookies-reader: `cookies` table not found — DB is not a Chromium Cookies sqlite",
      );
    }
    if (!Array.isArray(tableInfo) || tableInfo.length === 0) {
      throw new Error(
        "chromium-cookies-reader: `cookies` table empty / unreadable",
      );
    }
    const columns = new Set(tableInfo.map((c) => c.name));
    const required = ["name", "value", "host_key", "expires_utc"];
    for (const col of required) {
      if (!columns.has(col)) {
        throw new Error(
          `chromium-cookies-reader: required column "${col}" missing from cookies schema (App version too old?)`,
        );
      }
    }
    const hasEncrypted = columns.has("encrypted_value");
    const hasSecure = columns.has("is_secure");
    const hasHttpOnly = columns.has("is_httponly");
    const hasPersistent = columns.has("is_persistent");

    // Build a defensive SELECT picking only the columns we know exist.
    const cols = [
      "name",
      "value",
      "host_key",
      "expires_utc",
      hasEncrypted ? "encrypted_value" : "NULL AS encrypted_value",
      hasSecure ? "is_secure" : "0 AS is_secure",
      hasHttpOnly ? "is_httponly" : "0 AS is_httponly",
      hasPersistent ? "is_persistent" : "0 AS is_persistent",
    ].join(", ");
    const rows = db.prepare(`SELECT ${cols} FROM cookies`).all();

    const out = [];
    let skippedEncrypted = 0;
    for (const r of rows) {
      if (!hostKeyMatches(r.host_key, domain)) continue;
      const enc = r.encrypted_value;
      const hasEnc = enc != null && enc.length > 0;
      const value = typeof r.value === "string" ? r.value : "";
      if (value.length === 0 && hasEnc) {
        // Android-Keystore-wrapped — we don't decrypt these yet (Phase 1b+).
        // Skip but report so the caller can warn the user / collect telemetry.
        skippedEncrypted += 1;
        continue;
      }
      out.push({
        name: r.name,
        value,
        hostKey: r.host_key,
        expiresMs: webkitUsToEpochMs(r.expires_utc),
        isSecure: !!r.is_secure,
        isHttponly: !!r.is_httponly,
        isPersistent: !!r.is_persistent,
        hasEncryptedValue: hasEnc,
      });
    }
    if (skippedEncrypted > 0) {
      // Attach as a non-enumerable diagnostic so it doesn't show up in
      // JSON.stringify but tests can read it. Phase 1b will turn this into
      // a hard error if we land Keystore unwrap.
      Object.defineProperty(out, "_skippedEncryptedCount", {
        value: skippedEncrypted,
        enumerable: false,
      });
    }
    return out;
  } finally {
    db.close();
  }
}

/**
 * The Bilibili-relevant cookie names. These are what api.bilibili.com
 * endpoints check (per BilibiliApiClient.kt + BilibiliCredentialsStore.kt
 * Android implementation). buvid3 is required for anti-spam; bili_jct is
 * the CSRF token; SESSDATA is the session cookie; DedeUserID is the
 * numeric UID; DedeUserID__ckMd5 is its integrity hash.
 *
 * Frozen so callers can't accidentally mutate the list.
 */
const BILIBILI_COOKIE_NAMES = Object.freeze([
  "SESSDATA",
  "bili_jct",
  "DedeUserID",
  "DedeUserID__ckMd5",
  "buvid3",
]);

/**
 * Assemble a Bilibili-suitable Cookie header value from a cookies array
 * (as returned by [readChromiumCookies]).
 *
 * Returns `{header, present, missing}`:
 *   - header: the assembled `name=value; name=value; ...` string, or null
 *     if any required cookie is missing
 *   - present: Set of cookie names found
 *   - missing: Array of required cookie names not found (empty when OK)
 *
 * "Required" = all 5 names in [BILIBILI_COOKIE_NAMES]. Bilibili will
 * partially work with just SESSDATA + bili_jct, but our anti-spam history
 * showed silent `{code:0,data:[]}` returns when buvid3 is absent
 * ([[bilibili-post-onload-cookie-race]]), so we treat any missing as a
 * hard fail and let UI prompt the user to relog on the phone.
 */
function assembleBilibiliCookieHeader(cookies) {
  if (!Array.isArray(cookies)) {
    throw new TypeError("assembleBilibiliCookieHeader: cookies must be an array");
  }
  const byName = new Map();
  for (const c of cookies) {
    // Most-recently-set wins if duplicate names exist across host_keys.
    // ".bilibili.com" + "api.bilibili.com" sometimes both have SESSDATA;
    // prefer the longer host (more specific) — though in practice
    // Bilibili sets all on ".bilibili.com" so this rarely matters.
    if (!byName.has(c.name) || c.hostKey.length > (byName.get(c.name).hostKey || "").length) {
      byName.set(c.name, c);
    }
  }
  const missing = BILIBILI_COOKIE_NAMES.filter((n) => !byName.has(n));
  const present = new Set(byName.keys());
  if (missing.length > 0) {
    return { header: null, present, missing };
  }
  // Preserve the canonical order (matches what Bilibili's own web client
  // sends — not strictly required but reduces fingerprinting differences).
  const header = BILIBILI_COOKIE_NAMES.map((n) => `${n}=${byName.get(n).value}`).join("; ");
  return { header, present, missing: [] };
}

module.exports = {
  readChromiumCookies,
  assembleBilibiliCookieHeader,
  BILIBILI_COOKIE_NAMES,
  // Exposed for tests + future Weibo/Xhs/Douyin reuse
  _internals: {
    hostKeyMatches,
    webkitUsToEpochMs,
    loadDatabaseClass,
  },
};
