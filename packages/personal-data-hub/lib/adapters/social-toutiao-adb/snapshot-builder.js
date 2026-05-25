"use strict";

/**
 * Phase 6c (Toutiao C 路径 — 2026-05-25): API responses → snapshot JSON.
 *
 * Matches the existing `social-toutiao` adapter's snapshot mode schema
 * (schemaVersion=1). Kinds: profile / read / collection / search.
 *
 * Toutiao uid is numeric string; account.uid is set verbatim.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const SNAPSHOT_SCHEMA_VERSION = 1;

function buildSnapshot(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("buildSnapshot: input must be an object");
  }
  const uid = input.uid;
  if (typeof uid !== "string" || uid.length === 0) {
    throw new TypeError("buildSnapshot: input.uid must be a non-empty string");
  }
  const snapshottedAt =
    Number.isFinite(input.snapshottedAt) && input.snapshottedAt > 0
      ? input.snapshottedAt
      : Date.now();
  const account = {
    uid,
    displayName: typeof input.displayName === "string" ? input.displayName : "",
  };
  const events = [];

  // profile (1 event — matches Android collector emitting one profile event
  // per snapshot — adapter normalize() upserts the person record).
  if (input.profile && typeof input.profile === "object") {
    const p = input.profile;
    events.push({
      kind: "profile",
      id: `profile-${uid}`,
      capturedAt: snapshottedAt,
      uid,
      nickname: p.nickname || account.displayName,
      avatarUrl: p.avatarUrl || null,
      mobile: p.mobile || null,
      description: p.description || null,
      followingCount:
        typeof p.followingCount === "number" ? p.followingCount : 0,
      followerCount:
        typeof p.followerCount === "number" ? p.followerCount : 0,
      mediaId: p.mediaId || null,
    });
  }

  // read history
  const feed = Array.isArray(input.feed) ? input.feed : [];
  feed.forEach((f, idx) => {
    if (!f || typeof f !== "object") return;
    events.push({
      kind: "read",
      id: f.itemId ? `read-${f.itemId}` : `read-${idx}`,
      capturedAt:
        typeof f.publishedAt === "number" && f.publishedAt > 0
          ? f.publishedAt
          : snapshottedAt,
      itemId: f.itemId || null,
      title: f.title || null,
      category: f.category || null,
      author: f.author || null,
      readDuration: typeof f.readDuration === "number" ? f.readDuration : 0,
      source: f.source || null,
    });
  });

  // collection
  const collection = Array.isArray(input.collection) ? input.collection : [];
  collection.forEach((c, idx) => {
    if (!c || typeof c !== "object") return;
    events.push({
      kind: "collection",
      id: c.itemId ? `collect-${c.itemId}` : `collect-${idx}`,
      capturedAt:
        typeof c.savedAt === "number" && c.savedAt > 0
          ? c.savedAt
          : snapshottedAt,
      itemId: c.itemId || null,
      title: c.title || null,
      category: c.category || null,
      author: c.author || null,
    });
  });

  // search history
  const search = Array.isArray(input.search) ? input.search : [];
  search.forEach((s, idx) => {
    if (!s || typeof s !== "object" || !s.keyword) return;
    events.push({
      kind: "search",
      id: `search-${s.keyword}:${s.searchedAt || idx}`,
      capturedAt:
        typeof s.searchedAt === "number" && s.searchedAt > 0
          ? s.searchedAt
          : snapshottedAt,
      keyword: s.keyword,
      searchAt: s.searchedAt || snapshottedAt,
    });
  });

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshottedAt,
    account,
    events,
  };
}

function writeSnapshotJson(snapshot, opts = {}) {
  const dir = opts.dir || os.tmpdir();
  const fileName =
    opts.fileName || `cc-toutiao-snapshot-${crypto.randomUUID()}.json`;
  if (fileName.includes("/") || fileName.includes("\\")) {
    throw new Error(
      "writeSnapshotJson: opts.fileName must be a basename, not a path",
    );
  }
  const full = path.join(dir, fileName);
  fs.writeFileSync(full, JSON.stringify(snapshot), "utf-8");
  return full;
}

function cleanupSnapshotJson(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (_e) {
    // ignore
  }
}

module.exports = {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
};
