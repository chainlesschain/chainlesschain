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

function defaultRecentDir() {
  if (process.platform !== "win32") return null;
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(appData, ...RECENT_REL_PATH);
}

// Yield one record per .lnk in the Recent dir. Records are sorted ascending
// by mtime so the registry watermark advances monotonically across syncs.
function* readRecent(recentDir, opts = {}) {
  const fsMod = opts.fs || fs;
  if (!fsMod.existsSync(recentDir)) return;
  const sinceMs = Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  let entries;
  try {
    entries = fsMod.readdirSync(recentDir);
  } catch {
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
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const mtimeMs = Math.floor(stat.mtimeMs);
    if (sinceMs > 0 && mtimeMs < sinceMs) continue;
    const name = e.slice(0, e.length - 4); // strip .lnk
    recs.push({
      name,
      mtimeMs,
      size: stat.size,
      lnkPath: full,
    });
  }
  recs.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const r of recs) yield r;
}

module.exports = {
  defaultRecentDir,
  readRecent,
  RECENT_REL_PATH,
  SKIP_SUBDIRS,
};
