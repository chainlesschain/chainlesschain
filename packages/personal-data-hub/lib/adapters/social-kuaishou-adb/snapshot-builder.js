"use strict";

/**
 * Phase 6d (Kuaishou C 路径 — 2026-05-25): API responses → snapshot JSON.
 *
 * Matches the existing `social-kuaishou` adapter's snapshot mode schema
 * (schemaVersion=1). Kinds: profile / watch / collect / search.
 *
 * Kuaishou uid is numeric string. account.uid set verbatim.
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

  // profile (1 event — adapter normalize() upserts the person record)
  if (input.profile && typeof input.profile === "object") {
    const p = input.profile;
    events.push({
      kind: "profile",
      id: `profile-${uid}`,
      capturedAt: snapshottedAt,
      uid,
      nickname: p.nickname || account.displayName,
      kuaishouId: p.kuaishouId || null,
      avatarUrl: p.avatarUrl || null,
      sex: p.sex || null,
      city: p.city || null,
      constellation: p.constellation || null,
      description: p.description || null,
    });
  }

  // watch history (recommended-feed dwell items)
  const watch = Array.isArray(input.watch) ? input.watch : [];
  watch.forEach((w, idx) => {
    if (!w || typeof w !== "object" || !w.photoId) return;
    events.push({
      kind: "watch",
      id: `photo-${w.photoId}`,
      capturedAt:
        typeof w.viewedAt === "number" && w.viewedAt > 0
          ? w.viewedAt
          : snapshottedAt,
      photoId: w.photoId,
      caption: w.caption || null,
      duration: typeof w.duration === "number" ? w.duration : 0,
      authorId: w.authorId || null,
      authorName: w.authorName || null,
    });
  });

  // collect — own posted photos (KIND_COLLECT semantically: "videos I'm
  // associated with on Kuaishou"). adapter v0.2.1 mapping intentional.
  const collect = Array.isArray(input.collect) ? input.collect : [];
  collect.forEach((c, idx) => {
    if (!c || typeof c !== "object" || !c.photoId) return;
    events.push({
      kind: "collect",
      id: `collect-${c.photoId}`,
      capturedAt:
        typeof c.postedAt === "number" && c.postedAt > 0
          ? c.postedAt
          : snapshottedAt,
      photoId: c.photoId,
      caption: c.caption || null,
      authorId: uid, // self-posted
      authorName: account.displayName || null,
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
    opts.fileName || `cc-kuaishou-snapshot-${crypto.randomUUID()}.json`;
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
