"use strict";

// file-walker — recursive directory walker for user-data roots
// (Documents / Desktop / Downloads / Pictures / Videos / Music).
//
// Emits one row per file with absolute path + mtime + size. Skips:
//   - any path component matching a default exclude (xwechat_files,
//     WXWork, node_modules, .git) — these are noisy app caches that
//     would flood the vault without user value
//   - hidden files / dirs (leading '.')
//   - symlinks (avoid loops + permission errors)
//
// max depth + max files per root are bounded to keep first-time sync
// from walking a Downloads dir with 500k files.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const DEFAULT_EXCLUDES = Object.freeze([
  "xwechat_files",
  "WXWork",
  "node_modules",
  ".git",
]);

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_FILES_PER_ROOT = 5000;

function defaultRoots() {
  const home = os.homedir();
  if (!home) return [];
  const candidates = [
    path.join(home, "Documents"),
    path.join(home, "Desktop"),
    path.join(home, "Downloads"),
    path.join(home, "Pictures"),
    path.join(home, "Videos"),
    path.join(home, "Music"),
  ];
  return candidates;
}

function shouldSkip(name, excludes) {
  if (!name) return true;
  if (name.startsWith(".")) return true;
  for (const ex of excludes) {
    if (name === ex) return true;
  }
  return false;
}

// Walks one root; yields { path, name, ext, size, mtimeMs, root } per file.
// Uses iterative DFS to bound stack depth and skip whole subtrees on
// permission errors without aborting the whole walk.
function* walkRoot(root, opts = {}) {
  const fsMod = opts.fs || fs;
  const excludes = Array.isArray(opts.excludes) ? opts.excludes : DEFAULT_EXCLUDES;
  const maxDepth = Number.isInteger(opts.maxDepth) && opts.maxDepth > 0 ? opts.maxDepth : DEFAULT_MAX_DEPTH;
  const maxFiles = Number.isInteger(opts.maxFilesPerRoot) && opts.maxFilesPerRoot > 0
    ? opts.maxFilesPerRoot
    : DEFAULT_MAX_FILES_PER_ROOT;
  if (!fsMod.existsSync(root)) return;
  let count = 0;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fsMod.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (shouldSkip(entry.name, excludes)) continue;
      const full = path.join(dir, entry.name);
      // dirent does not always carry symlink info reliably; skip symlinks
      // explicitly via lstat to avoid following them.
      let st;
      try {
        st = fsMod.lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!st.isFile()) continue;
      if (count >= maxFiles) return;
      count += 1;
      yield {
        path: full,
        name: entry.name,
        ext: path.extname(entry.name).toLowerCase().replace(/^\./, ""),
        size: Number.isFinite(st.size) ? st.size : 0,
        mtimeMs: Math.floor(st.mtimeMs),
        root,
      };
    }
  }
}

// Yields across every configured root in stable order. `since` filters
// by file mtime so re-syncs only surface recently changed files.
function* walkRoots(roots, opts = {}) {
  const sinceMs = Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  for (const root of roots) {
    for (const row of walkRoot(root, opts)) {
      if (sinceMs > 0 && row.mtimeMs < sinceMs) continue;
      yield row;
    }
  }
}

module.exports = {
  DEFAULT_EXCLUDES,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILES_PER_ROOT,
  defaultRoots,
  walkRoot,
  walkRoots,
};
