"use strict";

// chrome-db-reader — opens a copy of Chrome's History SQLite and yields
// rows. We MUST copy first; Chrome holds an exclusive lock on the live
// file while running, and even when closed the WAL files (`-wal`, `-shm`)
// need to come along or we'd see a stale snapshot.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
// Dual-load: bs3mc tracks Electron's ABI 140 (runtime path), plain
// better-sqlite3 tracks Node's ABI 127 (test path). Whichever loads
// without NODE_MODULE_VERSION mismatch wins. Both expose the same
// Database class for unencrypted DBs.
//
// CRITICAL: must be lazy. Calling at module-load time means any require()
// of this file (e.g. via PDH wiring's eager `require("@chainlesschain/
// personal-data-hub/adapters/browser-history-chrome")`) throws synchronously
// when both modules are absent/ABI-mismatched, killing the entire main
// process before the BrowserHistoryChromeAdapter try/catch in wiring.js
// can swallow it. See v5.0.3.87 crash + handbook trap #23.
let _cachedDatabaseClass = null;
function loadDatabase() {
  if (_cachedDatabaseClass) return _cachedDatabaseClass;
  for (const mod of ["better-sqlite3-multiple-ciphers", "better-sqlite3"]) {
    let cls;
    try {
      cls = require(mod);
    } catch {
      continue; // require failed, try next
    }
    // require() returns the JS class even when the native binding is
    // ABI-mismatched; instantiation is what actually loads the .node
    // and throws. Smoke-test with an in-memory DB.
    try {
      const probe = new cls(":memory:");
      probe.close();
      _cachedDatabaseClass = cls;
      return cls;
    } catch {
      // ABI mismatch — try next candidate
    }
  }
  throw new Error(
    "chrome-db-reader: neither better-sqlite3-multiple-ciphers nor better-sqlite3 loaded — both ABI-mismatched",
  );
}

// WebKit timestamps are microseconds since 1601-01-01 UTC. Convert to
// epoch-ms by shifting the epoch (11644473600 seconds × 1e6 µs/s).
const WEBKIT_EPOCH_DELTA_US = 11_644_473_600_000_000n;
function webkitUsToEpochMs(wkUs) {
  if (wkUs == null) return null;
  // wkUs may arrive as Number (up to 2^53) or BigInt — handle both.
  const bn = typeof wkUs === "bigint" ? wkUs : BigInt(wkUs);
  return Number((bn - WEBKIT_EPOCH_DELTA_US) / 1000n);
}
function epochMsToWebkitUs(ms) {
  return BigInt(ms) * 1000n + WEBKIT_EPOCH_DELTA_US;
}

// Chrome transition flags (lower 8 bits of `transition`). See
// chromium/src/components/history/core/browser/history_types.h.
const CORE_TRANSITION_NAMES = {
  0: "link",
  1: "typed",
  2: "auto_bookmark",
  3: "auto_subframe",
  4: "manual_subframe",
  5: "generated",
  6: "auto_toplevel",
  7: "form_submit",
  8: "reload",
  9: "keyword",
  10: "keyword_generated",
};
function decodeTransition(raw) {
  if (!Number.isFinite(raw)) return null;
  const core = raw & 0xff;
  return CORE_TRANSITION_NAMES[core] || `unknown(${core})`;
}

// These integer values are persisted in Chromium's History database and are
// therefore intentionally independent from the current in-memory enum.
// Source:
// components/history/core/browser/download_constants.h
const DOWNLOAD_STATE_NAMES = Object.freeze({
  0: "in-progress",
  1: "complete",
  2: "cancelled",
  3: "legacy-bug-140687",
  4: "interrupted",
});

const DOWNLOAD_DANGER_NAMES = Object.freeze({
  0: "not-dangerous",
  1: "dangerous-file",
  2: "dangerous-url",
  3: "dangerous-content",
  4: "maybe-dangerous-content",
  5: "uncommon-content",
  6: "user-validated",
  7: "dangerous-host",
  8: "potentially-unwanted",
  9: "allowlisted-by-policy",
  10: "async-scanning",
  11: "blocked-password-protected",
  12: "blocked-too-large",
  13: "sensitive-content-warning",
  14: "sensitive-content-block",
  15: "deep-scanned-safe",
  16: "deep-scanned-opened-dangerous",
  17: "prompt-for-scanning",
  18: "blocked-unsupported-filetype",
  19: "dangerous-account-compromise",
  20: "deep-scanned-failed",
  21: "prompt-for-local-password-scanning",
  22: "async-local-password-scanning",
  23: "blocked-scan-failed",
  24: "forced-save-to-gdrive",
  25: "forced-save-to-onedrive",
});

function decodeDownloadEnum(raw, names) {
  const numeric = Number(raw);
  if (!Number.isInteger(numeric)) return null;
  return names[numeric] || `unknown(${numeric})`;
}

function decodeDownloadState(raw) {
  return decodeDownloadEnum(raw, DOWNLOAD_STATE_NAMES);
}

function decodeDownloadDanger(raw) {
  return decodeDownloadEnum(raw, DOWNLOAD_DANGER_NAMES);
}

function boundedString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.split("\0").join("").trim().slice(0, maxLength);
}

function nonNegativeSafeInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function optionalWebkitUsToEpochMs(value) {
  if (value == null || value === "") return null;
  try {
    const numeric = typeof value === "bigint" ? value : BigInt(value);
    if (numeric <= WEBKIT_EPOCH_DELTA_US) return null;
    const result = Number((numeric - WEBKIT_EPOCH_DELTA_US) / 1000n);
    return Number.isSafeInteger(result) && result >= 0 ? result : null;
  } catch {
    return null;
  }
}

// Download URLs frequently contain short-lived signatures or access tokens.
// Keep the useful origin/path while removing credentials, query values and
// fragments before the raw record reaches archival.
function sanitizeDownloadUrl(value) {
  const raw = boundedString(value, 32_768);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:", "ftp:"].includes(parsed.protocol)) return null;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return boundedString(parsed.toString(), 20_000) || null;
  } catch {
    return null;
  }
}

function portableBasename(value) {
  const candidates = [
    path.win32.basename(value),
    path.posix.basename(value),
  ].filter(
    (candidate) => candidate && candidate !== "." && candidate !== path.sep,
  );
  if (candidates.length === 0) return "";
  candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return boundedString(candidates[0], 512);
}

function fileNameFromUrl(value) {
  if (!value) return "";
  try {
    const pathname = new URL(value).pathname;
    const encodedName = portableBasename(pathname);
    if (!encodedName) return "";
    try {
      return boundedString(decodeURIComponent(encodedName), 512);
    } catch {
      return encodedName;
    }
  } catch {
    return "";
  }
}

function sanitizeDownloadPath(value) {
  const raw = boundedString(value, 32_768);
  if (!raw) {
    return { fileName: "", fileExtension: "", targetPathHash: null };
  }
  const fileName = portableBasename(raw);
  const extension = boundedString(
    path.extname(fileName).slice(1).toLowerCase(),
    64,
  );
  return {
    fileName,
    fileExtension: extension,
    targetPathHash: crypto
      .createHash("sha256")
      .update(raw, "utf8")
      .digest("hex"),
  };
}

function contentHashHex(value) {
  return Buffer.isBuffer(value) && value.length === 32
    ? value.toString("hex")
    : null;
}

function findChromiumProfiles(userDataDirs, opts = {}) {
  const fsMod = opts.fs || fs;
  const platform = opts.platform || process.platform;
  const roots = Array.isArray(userDataDirs) ? userDataDirs : [userDataDirs];
  const profiles = [];
  const seen = new Set();
  const add = (candidate) => {
    if (typeof candidate !== "string" || candidate.length === 0) return;
    const resolved = path.resolve(candidate);
    const key = platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key) || !fsMod.existsSync(path.join(resolved, "History"))) {
      return;
    }
    seen.add(key);
    profiles.push(resolved);
  };

  for (const configuredRoot of roots) {
    if (typeof configuredRoot !== "string" || configuredRoot.length === 0) {
      continue;
    }
    const root = path.resolve(configuredRoot);
    try {
      const localState = JSON.parse(
        fsMod.readFileSync(path.join(root, "Local State"), "utf8"),
      );
      const lastUsed = localState?.profile?.last_used;
      if (typeof lastUsed === "string") add(path.join(root, lastUsed));
      const infoCache = localState?.profile?.info_cache;
      if (infoCache && typeof infoCache === "object") {
        for (const profileName of Object.keys(infoCache)) {
          add(path.join(root, profileName));
        }
      }
    } catch {
      // Local State can be absent in a copied profile root.
    }
    // Opera commonly stores History/Bookmarks directly in its product
    // profile root instead of a nested Default directory.
    add(root);
    add(path.join(root, "Default"));
    try {
      const entries = fsMod
        .readdirSync(root, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            (entry.name === "Default" || /^Profile \d+$/u.test(entry.name)),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) add(path.join(root, entry.name));
    } catch {
      // A browser that has never been launched has no user-data root yet.
    }
  }
  return profiles;
}

function resolveDefaultProfile(userDataDirs, opts = {}) {
  const roots = Array.isArray(userDataDirs) ? userDataDirs : [userDataDirs];
  return (
    findChromiumProfiles(roots, opts)[0] ||
    (typeof roots[0] === "string" ? path.join(roots[0], "Default") : null)
  );
}

function defaultChromeProfileDir(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const home = typeof opts.homedir === "string" ? opts.homedir : os.homedir();
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (!localAppData) return null;
    return resolveDefaultProfile(
      [path.join(localAppData, "Google", "Chrome", "User Data")],
      opts,
    );
  }
  if (platform === "darwin") {
    return resolveDefaultProfile(
      [path.join(home, "Library", "Application Support", "Google", "Chrome")],
      opts,
    );
  }
  return resolveDefaultProfile(
    [path.join(home, ".config", "google-chrome")],
    opts,
  );
}

// Edge is Chromium under the hood — identical History/Bookmarks schema,
// just a different on-disk profile root. Same reader code works.
function defaultEdgeProfileDir(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const home = typeof opts.homedir === "string" ? opts.homedir : os.homedir();
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (!localAppData) return null;
    return resolveDefaultProfile(
      [path.join(localAppData, "Microsoft", "Edge", "User Data")],
      opts,
    );
  }
  if (platform === "darwin") {
    return resolveDefaultProfile(
      [path.join(home, "Library", "Application Support", "Microsoft Edge")],
      opts,
    );
  }
  return resolveDefaultProfile(
    [path.join(home, ".config", "microsoft-edge")],
    opts,
  );
}

// Brave: another Chromium fork; same schema again. Not auto-registered unless
// the user has Brave installed, since the wiring layer calls authenticate()
// at the adapter level rather than the registry filtering ahead of time.
function defaultBraveProfileDir(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const home = typeof opts.homedir === "string" ? opts.homedir : os.homedir();
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (!localAppData) return null;
    return resolveDefaultProfile(
      [path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data")],
      opts,
    );
  }
  if (platform === "darwin") {
    return resolveDefaultProfile(
      [
        path.join(
          home,
          "Library",
          "Application Support",
          "BraveSoftware",
          "Brave-Browser",
        ),
      ],
      opts,
    );
  }
  return resolveDefaultProfile(
    [
      path.join(home, ".config", "BraveSoftware", "Brave-Browser"),
      path.join(home, ".config", "Brave-browser"),
      path.join(
        home,
        ".var",
        "app",
        "com.brave.Browser",
        "config",
        "BraveSoftware",
        "Brave-Browser",
      ),
    ],
    opts,
  );
}

// Opera's regular and GX products use a direct Chromium profile root on
// Windows/macOS/Linux. Some recent builds also create a nested Default
// directory, so findChromiumProfiles() probes both shapes.
function defaultOperaProfileDir(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const home = typeof opts.homedir === "string" ? opts.homedir : os.homedir();
  let roots;
  if (platform === "win32") {
    const appData = env.APPDATA;
    if (!appData) return null;
    roots = [
      path.join(appData, "Opera Software", "Opera Stable"),
      path.join(appData, "Opera Software", "Opera GX Stable"),
    ];
  } else if (platform === "darwin") {
    roots = [
      path.join(
        home,
        "Library",
        "Application Support",
        "com.operasoftware.Opera",
      ),
      path.join(
        home,
        "Library",
        "Application Support",
        "com.operasoftware.OperaGX",
      ),
    ];
  } else {
    roots = [
      path.join(home, ".config", "opera"),
      path.join(home, ".config", "opera-gx"),
      path.join(home, ".config", "opera-beta"),
      path.join(home, ".config", "opera-developer"),
    ];
  }
  return findChromiumProfiles(roots, opts)[0] || roots[0] || null;
}

function defaultVivaldiProfileDir(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const home = typeof opts.homedir === "string" ? opts.homedir : os.homedir();
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (!localAppData) return null;
    return resolveDefaultProfile(
      [path.join(localAppData, "Vivaldi", "User Data")],
      opts,
    );
  }
  if (platform === "darwin") {
    return resolveDefaultProfile(
      [path.join(home, "Library", "Application Support", "Vivaldi")],
      opts,
    );
  }
  return resolveDefaultProfile(
    [
      path.join(home, ".config", "vivaldi"),
      path.join(home, ".config", "vivaldi-snapshot"),
    ],
    opts,
  );
}

// Copy the History file + any sidecar journal/WAL/SHM next to it. Returns
// the temp path that the caller is responsible for cleaning up.
function copyHistorySnapshot(profileDir, opts = {}) {
  const fsMod = opts.fs || fs;
  const src = path.join(profileDir, "History");
  if (!fsMod.existsSync(src)) {
    const err = new Error(`Chrome History not found at ${src}`);
    err.code = "CHROME_HISTORY_NOT_FOUND";
    throw err;
  }
  const tmp = path.join(
    os.tmpdir(),
    `pdh-chrome-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`,
  );
  fsMod.copyFileSync(src, tmp);
  for (const ext of ["-journal", "-wal", "-shm"]) {
    const w = src + ext;
    if (fsMod.existsSync(w)) {
      try {
        fsMod.copyFileSync(w, tmp + ext);
      } catch {
        // Sidecar copy failures are non-fatal — better-sqlite3 will just
        // see the pre-WAL state, which is what we want anyway.
      }
    }
  }
  return tmp;
}

function cleanupHistorySnapshot(tmpPath, opts = {}) {
  const fsMod = opts.fs || fs;
  for (const ext of ["", "-journal", "-wal", "-shm"]) {
    try {
      fsMod.unlinkSync(tmpPath + ext);
    } catch {
      // best-effort
    }
  }
}

// Reads one bounded visit page in occurredAt-ascending order. Fetch one row
// beyond the caller's limit so the adapter can distinguish "exactly full"
// from "truncated" and only advance its durable watermark after source end.
function readVisitsPage(tmpPath, opts = {}) {
  const sinceMs =
    Number.isFinite(Number(opts.since)) && Number(opts.since) > 0
      ? Math.floor(Number(opts.since))
      : 0;
  const sinceWk = epochMsToWebkitUs(sinceMs);
  const limit =
    Number.isSafeInteger(opts.limit) && opts.limit > 0 ? opts.limit : 200_000;
  const includeHidden = opts.includeHidden === true;
  const Database = loadDatabase();
  const db = new Database(tmpPath, { readonly: true, fileMustExist: true });
  try {
    // Bind sinceWk as a string — better-sqlite3 accepts BigInt only when
    // safeIntegers is on, which we don't enable. SQLite compares numerically
    // so passing the decimal string is safe (and avoids 2^53 truncation).
    const stmt = db.prepare(
      `SELECT v.id AS visit_id, v.url AS url_id, v.visit_time AS visit_time,
              v.transition AS transition, v.visit_duration AS visit_duration,
              v.from_visit AS from_visit, u.url AS url, u.title AS title,
              u.visit_count AS visit_count, u.typed_count AS typed_count,
              u.hidden AS hidden
       FROM visits v
       JOIN urls u ON v.url = u.id
       WHERE v.visit_time >= ?
         ${includeHidden ? "" : "AND u.hidden = 0"}
       ORDER BY v.visit_time ASC, v.id ASC
       LIMIT ?`,
    );
    const probeLimit =
      limit < Number.MAX_SAFE_INTEGER ? limit + 1 : Number.MAX_SAFE_INTEGER;
    const rows = stmt.all(sinceWk.toString(), probeLimit);
    const complete = rows.length <= limit;
    if (!complete) rows.length = limit;
    return {
      visits: rows.map((r) => ({
        visitId: r.visit_id,
        urlId: r.url_id,
        url: r.url,
        title: r.title || "",
        visitTimeMs: webkitUsToEpochMs(r.visit_time),
        visitDurationMs: Number.isInteger(r.visit_duration)
          ? Math.floor(r.visit_duration / 1000)
          : 0,
        transition: decodeTransition(r.transition),
        rawTransition: r.transition,
        fromVisit: r.from_visit || 0,
        visitCount: r.visit_count || 0,
        typedCount: r.typed_count || 0,
        hidden: r.hidden === 1,
      })),
      complete,
    };
  } finally {
    db.close();
  }
}

// Read one bounded page of Chromium downloads. Optional columns are selected
// only when present so copied/older History databases remain importable.
// Absolute current/target paths are reduced to basename + SHA-256 before this
// function returns; callers never receive the source path.
function readDownloadsPage(tmpPath, opts = {}) {
  const sinceMs =
    Number.isFinite(Number(opts.since)) && Number(opts.since) > 0
      ? Math.floor(Number(opts.since))
      : 0;
  const sinceWk = epochMsToWebkitUs(sinceMs);
  const limit =
    Number.isSafeInteger(opts.limit) && opts.limit > 0 ? opts.limit : 200_000;
  const Database = loadDatabase();
  const db = new Database(tmpPath, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    if (!tables.has("downloads")) {
      return { downloads: [], complete: true };
    }

    const columns = new Set(
      db
        .prepare("PRAGMA table_info('downloads')")
        .all()
        .map((row) => row.name),
    );
    for (const required of ["id", "start_time"]) {
      if (!columns.has(required)) {
        const error = new Error(
          `chrome-db-reader: downloads.${required} is missing`,
        );
        error.code = "CHROMIUM_DOWNLOAD_SCHEMA_MISMATCH";
        throw error;
      }
    }

    const value = (name, fallback = "NULL") =>
      columns.has(name) ? `d.${name}` : fallback;
    const targetPathExpression = columns.has("target_path")
      ? "d.target_path"
      : columns.has("current_path")
        ? "d.current_path"
        : columns.has("full_path")
          ? "d.full_path"
          : "''";
    const currentPathExpression = columns.has("current_path")
      ? "d.current_path"
      : targetPathExpression;
    const capturedTimeParts = ["d.start_time"];
    if (columns.has("end_time")) capturedTimeParts.push("d.end_time");
    if (columns.has("last_access_time")) {
      capturedTimeParts.push("d.last_access_time");
    }
    const capturedTimeExpression =
      capturedTimeParts.length === 1
        ? capturedTimeParts[0]
        : `MAX(${capturedTimeParts.join(", ")})`;

    let initialUrlExpression = columns.has("url") ? "d.url" : "''";
    let finalUrlExpression = initialUrlExpression;
    if (tables.has("downloads_url_chains")) {
      const chainColumns = new Set(
        db
          .prepare("PRAGMA table_info('downloads_url_chains')")
          .all()
          .map((row) => row.name),
      );
      if (
        chainColumns.has("id") &&
        chainColumns.has("chain_index") &&
        chainColumns.has("url")
      ) {
        initialUrlExpression =
          "(SELECT c.url FROM downloads_url_chains c WHERE c.id = d.id ORDER BY c.chain_index ASC LIMIT 1)";
        finalUrlExpression =
          "(SELECT c.url FROM downloads_url_chains c WHERE c.id = d.id ORDER BY c.chain_index DESC LIMIT 1)";
      }
    }

    const statement = db.prepare(
      `SELECT d.id AS download_id,
              ${value("guid", "''")} AS guid,
              ${currentPathExpression} AS current_path,
              ${targetPathExpression} AS target_path,
              d.start_time AS start_time,
              ${value("end_time", "0")} AS end_time,
              ${value("last_access_time", "0")} AS last_access_time,
              ${capturedTimeExpression} AS captured_time,
              ${value("received_bytes", "0")} AS received_bytes,
              ${value("total_bytes", "0")} AS total_bytes,
              ${value("state", "-1")} AS state,
              ${value("danger_type", "-1")} AS danger_type,
              ${value("interrupt_reason", "0")} AS interrupt_reason,
              ${value("opened", "0")} AS opened,
              ${value("transient", "0")} AS transient,
              ${value("mime_type", "''")} AS mime_type,
              ${value("original_mime_type", "''")} AS original_mime_type,
              ${value("http_method", "''")} AS http_method,
              ${value("referrer", "''")} AS referrer,
              ${value("site_url", "''")} AS site_url,
              ${value("tab_url", "''")} AS tab_url,
              ${value("tab_referrer_url", "''")} AS tab_referrer_url,
              ${value("by_ext_name", "''")} AS by_ext_name,
              ${value("hash", "NULL")} AS content_hash,
              ${initialUrlExpression} AS initial_url,
              ${finalUrlExpression} AS final_url
       FROM downloads d
       WHERE ${capturedTimeExpression} >= CAST(? AS INTEGER)
       ORDER BY captured_time ASC, d.id ASC
       LIMIT ?`,
    );
    const probeLimit =
      limit < Number.MAX_SAFE_INTEGER ? limit + 1 : Number.MAX_SAFE_INTEGER;
    const rows = statement.all(sinceWk.toString(), probeLimit);
    const complete = rows.length <= limit;
    if (!complete) rows.length = limit;

    const downloads = [];
    for (const row of rows) {
      const capturedAtMs = optionalWebkitUsToEpochMs(row.captured_time);
      const startTimeMs = optionalWebkitUsToEpochMs(row.start_time);
      if (capturedAtMs == null || startTimeMs == null) continue;

      const initialUrl = sanitizeDownloadUrl(row.initial_url);
      const finalUrl = sanitizeDownloadUrl(row.final_url);
      const referrerUrl = sanitizeDownloadUrl(row.referrer);
      const siteUrl = sanitizeDownloadUrl(row.site_url);
      const tabUrl = sanitizeDownloadUrl(row.tab_url);
      const tabReferrerUrl = sanitizeDownloadUrl(row.tab_referrer_url);
      const sourceUrl =
        finalUrl || initialUrl || tabUrl || siteUrl || referrerUrl || null;
      const pathInfo = sanitizeDownloadPath(
        boundedString(row.target_path, 32_768) ||
          boundedString(row.current_path, 32_768),
      );
      const fileName =
        pathInfo.fileName || fileNameFromUrl(sourceUrl) || "(unnamed download)";
      const endTimeMs = optionalWebkitUsToEpochMs(row.end_time);
      const lastAccessTimeMs = optionalWebkitUsToEpochMs(row.last_access_time);
      const numericState = Number(row.state);
      const numericDanger = Number(row.danger_type);

      downloads.push({
        downloadId: row.download_id,
        guid: boundedString(row.guid, 128) || null,
        fileName,
        fileExtension:
          pathInfo.fileExtension ||
          boundedString(path.extname(fileName).slice(1).toLowerCase(), 64),
        targetPathHash: pathInfo.targetPathHash,
        sourceUrl,
        initialUrl,
        finalUrl,
        referrerUrl,
        siteUrl,
        tabUrl,
        tabReferrerUrl,
        startTimeMs,
        endTimeMs,
        lastAccessTimeMs,
        capturedAtMs,
        receivedBytes: nonNegativeSafeInteger(row.received_bytes),
        totalBytes: nonNegativeSafeInteger(row.total_bytes),
        state: decodeDownloadState(numericState),
        rawState: Number.isInteger(numericState) ? numericState : null,
        danger: decodeDownloadDanger(numericDanger),
        rawDanger: Number.isInteger(numericDanger) ? numericDanger : null,
        interruptReason: nonNegativeSafeInteger(row.interrupt_reason),
        opened: Number(row.opened) === 1,
        transient: Number(row.transient) === 1,
        mimeType: boundedString(row.mime_type, 512) || null,
        originalMimeType: boundedString(row.original_mime_type, 512) || null,
        httpMethod: boundedString(row.http_method, 32).toUpperCase() || null,
        extensionName: boundedString(row.by_ext_name, 512) || null,
        contentHashSha256: contentHashHex(row.content_hash),
      });
    }
    return { downloads, complete };
  } finally {
    db.close();
  }
}

// Compatibility iterator retained for callers that imported readVisits()
// directly before the bounded completion handshake was added.
function* readVisits(tmpPath, opts = {}) {
  yield* readVisitsPage(tmpPath, opts).visits;
}

module.exports = {
  defaultChromeProfileDir,
  defaultEdgeProfileDir,
  defaultBraveProfileDir,
  defaultOperaProfileDir,
  defaultVivaldiProfileDir,
  findChromiumProfiles,
  copyHistorySnapshot,
  cleanupHistorySnapshot,
  readVisits,
  readVisitsPage,
  readDownloadsPage,
  webkitUsToEpochMs,
  epochMsToWebkitUs,
  decodeTransition,
  decodeDownloadState,
  decodeDownloadDanger,
  sanitizeDownloadUrl,
};
