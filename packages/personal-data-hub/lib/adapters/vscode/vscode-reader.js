"use strict";

// vscode-reader — pulls workspace folders + terminal history out of VSCode's
// own state files. Two on-disk sources, both desktop-local:
//
//   1. `%APPDATA%\Code\User\workspaceStorage\<hash>\workspace.json`
//      Each `workspace.json` carries `{ folder: "file:///..." }` — the
//      decoded URI is the project root the user opened. Folder mtime gives
//      us a "last opened" timestamp (when VSCode last touched the storage).
//
//   2. `%APPDATA%\Code\User\globalStorage\state.vscdb` (plain SQLite)
//      ItemTable contains JSON blobs keyed by `terminal.history.entries.*`.
//      Single snapshot timestamp at `terminal.history.timestamp.*` — there
//      is no per-command timestamp, only the "last updated" of the whole
//      list. We anchor every command/dir to that timestamp.
//
// Like the Chromium readers, we copy the SQLite file first — VSCode keeps
// state.vscdb open while running, and a direct read would fight WAL.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
// Dual-load: bs3mc tracks Electron's ABI 140 (runtime path), plain
// better-sqlite3 tracks Node's ABI 127 (test path). Whichever loads
// wins. See chrome-db-reader.js for the same pattern + rationale.
//
// CRITICAL: must be lazy. Top-level invocation kills main process when
// both modules absent/ABI-mismatched (v5.0.3.87 startup crash).
let _cachedDatabaseClass = null;
function loadDatabase() {
  if (_cachedDatabaseClass) return _cachedDatabaseClass;
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
      _cachedDatabaseClass = cls;
      return cls;
    } catch (_e) {
      /* ABI mismatch, try next */
    }
  }
  throw new Error(
    "vscode-reader: neither better-sqlite3-multiple-ciphers nor better-sqlite3 loaded — both ABI-mismatched",
  );
}

function defaultVscodeRoot() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    return path.join(appData, "Code");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Code");
  }
  return path.join(os.homedir(), ".config", "Code");
}

// Decode a file:// URI into a Windows / Posix path. Returns null when the
// URI scheme isn't file:// (could be vscode-remote://, ssh://, etc — those
// stay as URIs for the caller).
function decodeFileUri(uri) {
  if (typeof uri !== "string" || !uri.startsWith("file://")) return null;
  // file:///c%3A/code/foo → /c:/code/foo → c:/code/foo on win32
  const raw = uri.slice("file://".length);
  // A corrupt/malformed percent-sequence must not throw URIError.
  let p;
  try {
    p = decodeURIComponent(raw);
  } catch {
    p = raw;
  }
  if (process.platform === "win32") {
    // Strip leading slash and normalise separators
    if (p.startsWith("/")) p = p.slice(1);
    return p.replace(/\//g, "\\");
  }
  return p;
}

function* readWorkspaces(vscodeRoot, opts = {}) {
  const fsMod = opts.fs || fs;
  const wsRoot = path.join(vscodeRoot, "User", "workspaceStorage");
  if (!fsMod.existsSync(wsRoot)) return;
  const sinceMs = Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  let hashes;
  try {
    hashes = fsMod.readdirSync(wsRoot);
  } catch {
    return;
  }
  for (const h of hashes) {
    const wsFile = path.join(wsRoot, h, "workspace.json");
    if (!fsMod.existsSync(wsFile)) continue;
    let stat;
    let body;
    try {
      stat = fsMod.statSync(wsFile);
      body = JSON.parse(fsMod.readFileSync(wsFile, "utf-8"));
    } catch {
      continue;
    }
    const lastOpenedMs = Math.floor(stat.mtimeMs);
    if (sinceMs > 0 && lastOpenedMs < sinceMs) continue;
    const folderUri = typeof body?.folder === "string" ? body.folder : null;
    const workspaceUri = typeof body?.workspace === "string" ? body.workspace : null;
    if (!folderUri && !workspaceUri) continue;
    yield {
      hash: h,
      folderUri,
      workspaceUri,
      folderPath: folderUri ? decodeFileUri(folderUri) : null,
      lastOpenedMs,
    };
  }
}

// Read terminal command + dir history from state.vscdb. Returns
// { commands: [...], dirs: [...], commandsTimestampMs, dirsTimestampMs }.
// Each entry is { value, shellType, sourceIndex } — the index lets us
// reconstruct order across syncs.
function readTerminalHistory(vscodeRoot, opts = {}) {
  const fsMod = opts.fs || fs;
  const src = path.join(vscodeRoot, "User", "globalStorage", "state.vscdb");
  if (!fsMod.existsSync(src)) {
    return { commands: [], dirs: [], commandsTimestampMs: null, dirsTimestampMs: null };
  }
  const tmp = path.join(
    os.tmpdir(),
    `pdh-vscode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`,
  );
  fsMod.copyFileSync(src, tmp);
  // VSCode uses plain SQLite (not WAL by default for state.vscdb), but copy
  // the WAL sidecar if it exists just in case.
  for (const ext of ["-wal", "-shm"]) {
    const w = src + ext;
    if (fsMod.existsSync(w)) {
      try {
        fsMod.copyFileSync(w, tmp + ext);
      } catch {}
    }
  }
  try {
    const Database = loadDatabase();
    const db = new Database(tmp, { readonly: true });
    const get = (k) => {
      try {
        const r = db.prepare("SELECT value FROM ItemTable WHERE key=?").get(k);
        return r ? r.value : null;
      } catch {
        return null;
      }
    };
    const parseEntries = (jsonStr) => {
      if (!jsonStr) return [];
      try {
        const parsed = JSON.parse(jsonStr);
        const arr = Array.isArray(parsed?.entries) ? parsed.entries : [];
        return arr
          .map((e, i) => ({
            value: typeof e?.key === "string" ? e.key : "",
            shellType: e?.value?.shellType || null,
            sourceIndex: i,
          }))
          .filter((e) => e.value.length > 0);
      } catch {
        return [];
      }
    };
    const parseTs = (raw) => {
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    };
    const out = {
      commands: parseEntries(get("terminal.history.entries.commands")),
      dirs: parseEntries(get("terminal.history.entries.dirs")),
      commandsTimestampMs: parseTs(get("terminal.history.timestamp.commands")),
      dirsTimestampMs: parseTs(get("terminal.history.timestamp.dirs")),
    };
    db.close();
    return out;
  } finally {
    for (const ext of ["", "-wal", "-shm"]) {
      try {
        fsMod.unlinkSync(tmp + ext);
      } catch {}
    }
  }
}

module.exports = {
  defaultVscodeRoot,
  decodeFileUri,
  readWorkspaces,
  readTerminalHistory,
};
