"use strict";

// bookmarks-reader — Chrome's Bookmarks file is plain JSON next to the
// History DB. No copy-first needed; Chrome writes atomically. We walk
// the tree depth-first so each url node carries its folder path.

const fs = require("node:fs");
const path = require("node:path");

const ROOT_LABELS = {
  bookmark_bar: "书签栏",
  other: "其他书签",
  synced: "移动设备书签",
};

function webkitUsStrToEpochMs(s) {
  if (typeof s !== "string" || s.length === 0) return null;
  // Chrome stores date_added as a decimal string of WebKit microseconds.
  // Parse to BigInt to keep precision.
  try {
    const us = BigInt(s);
    return Number((us - 11_644_473_600_000_000n) / 1000n);
  } catch (_e) {
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
  } else if (node.type === "folder" && Array.isArray(node.children)) {
    const nextTrail =
      typeof node.name === "string" && node.name.length > 0
        ? folderTrail.concat(node.name)
        : folderTrail;
    for (const c of node.children) {
      yield* walkNode(c, nextTrail);
    }
  }
}

// Read + iterate every bookmark url node across all three roots
// (bookmark_bar / other / synced). Returns a generator so a callsite that
// only wants a count can short-circuit.
function* readBookmarks(profileDir, opts = {}) {
  const fsMod = opts.fs || fs;
  const file = path.join(profileDir, "Bookmarks");
  if (!fsMod.existsSync(file)) return;
  const text = fsMod.readFileSync(file, "utf-8");
  const data = JSON.parse(text);
  const roots = (data && data.roots) || {};
  for (const [rootKey, rootNode] of Object.entries(roots)) {
    if (!rootNode || typeof rootNode !== "object") continue;
    const rootLabel = ROOT_LABELS[rootKey] || rootKey;
    // Walk the root's CHILDREN directly with the localised root label as the
    // trail; the root folder's own `name` ("Bookmarks bar" / "Other bookmarks"
    // — Chrome's English defaults) would otherwise tack on a redundant
    // English segment after our Chinese label.
    if (Array.isArray(rootNode.children)) {
      for (const c of rootNode.children) {
        yield* walkNode(c, [rootLabel]);
      }
    }
  }
}

module.exports = {
  readBookmarks,
  ROOT_LABELS,
};
