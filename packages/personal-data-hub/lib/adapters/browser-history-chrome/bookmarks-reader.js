"use strict";

// Chromium writes its Bookmarks tree as JSON next to the History database.
// The file is replaced atomically, so a bounded read does not need the
// SQLite copy-first path used for History.

const fs = require("node:fs");
const path = require("node:path");
const MAX_BOOKMARKS_BYTES = 64 * 1024 * 1024;

const ROOT_LABELS = {
  bookmark_bar: "\u4e66\u7b7e\u680f",
  other: "\u5176\u4ed6\u4e66\u7b7e",
  synced: "\u79fb\u52a8\u8bbe\u5907\u4e66\u7b7e",
};

function webkitUsStrToEpochMs(value) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).length === 0
  ) {
    return null;
  }
  try {
    const microseconds = BigInt(value);
    return Number((microseconds - 11_644_473_600_000_000n) / 1000n);
  } catch {
    return null;
  }
}

function* walkNode(node, folderTrail) {
  if (!node || typeof node !== "object") return;
  if (node.type === "url" && typeof node.url === "string") {
    yield {
      id: node.id,
      guid: node.guid,
      name: typeof node.name === "string" ? node.name : node.url,
      url: node.url,
      dateAddedMs: webkitUsStrToEpochMs(node.date_added),
      dateLastUsedMs: webkitUsStrToEpochMs(node.date_last_used),
      folderPath: folderTrail.join(" / "),
    };
    return;
  }
  if (node.type !== "folder" || !Array.isArray(node.children)) return;
  const nextTrail =
    typeof node.name === "string" && node.name.length > 0
      ? folderTrail.concat(node.name)
      : folderTrail;
  for (const child of node.children) {
    yield* walkNode(child, nextTrail);
  }
}

function bookmarkCapturedAt(bookmark) {
  const candidates = [bookmark?.dateLastUsedMs, bookmark?.dateAddedMs].filter(
    (value) => Number.isInteger(value) && value > 0,
  );
  return candidates.length > 0 ? Math.max(...candidates) : 1;
}

function readBookmarkNodes(profileDir, opts = {}) {
  const fsMod = opts.fs || fs;
  const file = path.join(profileDir, "Bookmarks");
  if (!fsMod.existsSync(file)) return [];
  const size = fsMod.statSync(file).size;
  if (!Number.isSafeInteger(size) || size > MAX_BOOKMARKS_BYTES) {
    const error = new Error(
      `Chromium Bookmarks exceeds ${MAX_BOOKMARKS_BYTES} bytes`,
    );
    error.code = "CHROMIUM_BOOKMARKS_TOO_LARGE";
    throw error;
  }
  const data = JSON.parse(fsMod.readFileSync(file, "utf-8"));
  const roots = (data && data.roots) || {};
  const bookmarks = [];
  for (const [rootKey, rootNode] of Object.entries(roots)) {
    if (!rootNode || typeof rootNode !== "object") continue;
    const rootLabel = ROOT_LABELS[rootKey] || rootKey;
    // Walk root children directly so the localized root label does not gain
    // an extra browser-language "Bookmarks bar" segment.
    if (Array.isArray(rootNode.children)) {
      for (const child of rootNode.children) {
        bookmarks.push(...walkNode(child, [rootLabel]));
      }
    }
  }
  return bookmarks;
}

function readBookmarksPage(profileDir, opts = {}) {
  const since =
    Number.isFinite(Number(opts.since)) && Number(opts.since) > 0
      ? Math.floor(Number(opts.since))
      : 0;
  const limit =
    Number.isSafeInteger(opts.limit) && opts.limit > 0 ? opts.limit : 200_000;
  const bookmarks = readBookmarkNodes(profileDir, opts)
    .filter((bookmark) => bookmarkCapturedAt(bookmark) >= since)
    .sort(
      (a, b) =>
        bookmarkCapturedAt(a) - bookmarkCapturedAt(b) ||
        String(a.guid || a.id || a.url).localeCompare(
          String(b.guid || b.id || b.url),
        ),
    );
  const complete = bookmarks.length <= limit;
  if (!complete) bookmarks.length = limit;
  return { bookmarks, complete };
}

// Compatibility iterator retained for direct callers.
function* readBookmarks(profileDir, opts = {}) {
  yield* readBookmarkNodes(profileDir, opts);
}

module.exports = {
  MAX_BOOKMARKS_BYTES,
  ROOT_LABELS,
  bookmarkCapturedAt,
  readBookmarks,
  readBookmarksPage,
  webkitUsStrToEpochMs,
};
