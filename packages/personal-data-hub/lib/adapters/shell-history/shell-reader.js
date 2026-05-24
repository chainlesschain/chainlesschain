"use strict";

// shell-reader — reads PowerShell + bash command history files. Both
// formats are dead simple: one command per line. Neither carries
// per-command timestamps, so we anchor every command to the file mtime
// and use sourceIndex for stable ordering (same pattern as the VSCode
// terminal adapter).

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function defaultHistorySources() {
  const home = os.homedir();
  const sources = [];
  if (process.platform === "win32" && process.env.APPDATA) {
    sources.push({
      shell: "pwsh",
      file: path.join(
        process.env.APPDATA,
        "Microsoft",
        "Windows",
        "PowerShell",
        "PSReadLine",
        "ConsoleHost_history.txt",
      ),
    });
  }
  // bash history exists on Win (Git Bash / WSL) AND Unix.
  sources.push({ shell: "bash", file: path.join(home, ".bash_history") });
  // zsh on macOS / Linux defaults.
  if (process.platform !== "win32") {
    sources.push({ shell: "zsh", file: path.join(home, ".zsh_history") });
  }
  return sources;
}

// Reads one history file into rows. Skips blank/whitespace-only lines and
// preserves the original index so we can re-order across syncs.
function readHistoryFile(source, opts = {}) {
  const fsMod = opts.fs || fs;
  if (!fsMod.existsSync(source.file)) return null;
  let stat;
  try {
    stat = fsMod.statSync(source.file);
  } catch {
    return null;
  }
  let text;
  try {
    text = fsMod.readFileSync(source.file, "utf-8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    let value = lines[i];
    // zsh extended history stores ": <ts>:<dur>;<cmd>" — strip the prefix.
    if (source.shell === "zsh") {
      const m = value.match(/^: \d+:\d+;(.*)$/);
      if (m) value = m[1];
    }
    value = value.replace(/[\r\n]+$/, "").trim();
    if (!value) continue;
    rows.push({
      shell: source.shell,
      file: source.file,
      value,
      sourceIndex: i,
    });
  }
  return {
    shell: source.shell,
    file: source.file,
    mtimeMs: Math.floor(stat.mtimeMs),
    rows,
  };
}

// Yields rows across every configured source in (shell, sourceIndex)
// ascending order. since filter uses file mtime — there's no per-row
// timestamp in either format.
function* readAllHistory(sources, opts = {}) {
  const sinceMs = Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  for (const src of sources) {
    const parsed = readHistoryFile(src, opts);
    if (!parsed) continue;
    if (sinceMs > 0 && parsed.mtimeMs < sinceMs) continue;
    for (const row of parsed.rows) {
      yield { ...row, snapshotTs: parsed.mtimeMs };
    }
  }
}

module.exports = {
  defaultHistorySources,
  readHistoryFile,
  readAllHistory,
};
