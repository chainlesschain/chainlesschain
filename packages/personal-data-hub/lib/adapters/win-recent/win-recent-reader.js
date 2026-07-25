"use strict";

// win-recent-reader — lists .lnk shortcuts in %APPDATA%\Microsoft\Windows\
// \Recent\. Windows writes one .lnk per file/folder the user opens from
// any app (Explorer, Word, etc), so this is effectively a cross-application
// "what did I touch and when" timeline.
//
// v0.1 yields name + mtime only. Resolving the .lnk's actual target path
// requires parsing the Shell Link binary format (MS-SHLLINK) or shelling
// out to PowerShell COM — both deferred until we know users want it.
//
// AutomaticDestinations / CustomDestinations subdirectories hold Jump List
// data in opaque .automaticDestinations-ms / .customDestinations-ms binary
// blobs. Skipped for v0.1.

const fs = require("node:fs");
const path = require("node:path");

const RECENT_REL_PATH = ["Microsoft", "Windows", "Recent"];
const SKIP_SUBDIRS = new Set(["AutomaticDestinations", "CustomDestinations"]);

function scanError(phase, error) {
  const sourceCode =
    typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : "UNKNOWN";
  const wrapped = new Error(
    `win-recent reader: ${phase} failed (${sourceCode})`,
    { cause: error },
  );
  wrapped.code = "WIN_RECENT_SCAN_INCOMPLETE";
  wrapped.retryable = false;
  return wrapped;
}

function recordPath(record) {
  return path.basename(record.lnkPath);
}

// Compare exact JavaScript strings instead of localeCompare(). The latter is
// locale-sensitive and may treat distinct shortcut names as equivalent.
function comparePath(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareRecentRecords(left, right) {
  if (left.mtimeMs !== right.mtimeMs) {
    return left.mtimeMs < right.mtimeMs ? -1 : 1;
  }
  return comparePath(recordPath(left), recordPath(right));
}

function defaultRecentDir() {
  if (process.platform !== "win32") return null;
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(appData, ...RECENT_REL_PATH);
}

// Yield one record per .lnk in the Recent dir. Records are sorted ascending
// by the strict (mtimeMs, relative shortcut path) cursor order. `strict`
// guarantees that a failed directory scan cannot be mistaken for a complete
// empty scan by an adapter that is about to advance a durable cursor.
function* readRecent(recentDir, opts = {}) {
  const fsMod = opts.fs || fs;
  const strict = opts.strict === true;
  if (!fsMod.existsSync(recentDir)) {
    if (strict) {
      const error = new Error("Recent directory no longer exists");
      error.code = "ENOENT";
      throw scanError("directory lookup", error);
    }
    return;
  }
  const sinceMs =
    Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  let entries;
  try {
    entries = fsMod.readdirSync(recentDir);
  } catch (error) {
    if (strict) throw scanError("directory enumeration", error);
    return;
  }
  const recs = [];
  for (const e of entries) {
    if (SKIP_SUBDIRS.has(e)) continue;
    if (!e.toLowerCase().endsWith(".lnk")) continue;
    const full = path.join(recentDir, e);
    let stat;
    try {
      stat = fsMod.statSync(full);
    } catch (error) {
      // A shortcut may disappear after readdirSync while Windows updates the
      // Recent directory. It is no longer part of the observed source; all
      // other failures make the scan incomplete and must block the cursor.
      if (strict && error?.code !== "ENOENT") {
        throw scanError("shortcut metadata read", error);
      }
      continue;
    }
    if (!stat.isFile()) continue;
    const mtimeMs = Math.floor(stat.mtimeMs);
    if (!Number.isSafeInteger(mtimeMs) || mtimeMs <= 0) {
      if (strict) {
        throw scanError(
          "shortcut timestamp validation",
          new TypeError("invalid mtimeMs"),
        );
      }
      continue;
    }
    if (sinceMs > 0 && mtimeMs < sinceMs) continue;
    const name = e.slice(0, e.length - 4); // strip .lnk
    recs.push({
      name,
      mtimeMs,
      size: stat.size,
      lnkPath: full,
    });
  }
  recs.sort(compareRecentRecords);
  for (const r of recs) yield r;
}

module.exports = {
  defaultRecentDir,
  readRecent,
  compareRecentRecords,
  RECENT_REL_PATH,
  SKIP_SUBDIRS,
};
