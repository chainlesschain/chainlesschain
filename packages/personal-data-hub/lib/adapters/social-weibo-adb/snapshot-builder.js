"use strict";

/**
 * Phase 3a (Weibo C 路径 — 2026-05-25): API responses → snapshot JSON.
 *
 * Matches the existing `social-weibo` adapter's snapshot mode schema:
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <ms>,
 *     "account": { "uid": "<numeric uid as string>", "displayName": "" },
 *     "events": [
 *       { "kind": "post",      "id": "post-<mid>",   "capturedAt": <ms>,
 *         "text", "mid", "source", "repostsCount", "commentsCount",
 *         "likesCount", "picCount" },
 *       { "kind": "favourite", "id": "fav-<mid>",    "capturedAt": <ms>,
 *         "text", "mid", "authorScreenName" },
 *       { "kind": "follow",    "id": "follow-<uid>", "capturedAt": <ms>,
 *         "uid", "screenName", "description", "avatarUrl" }
 *     ]
 *   }
 *
 * Note: `follow` items don't have an authoritative timestamp from
 * m.weibo.cn's /api/friendships/friends — we use snapshottedAt as
 * fallback so the timestamp is at least monotonic per sync.
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
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new TypeError(
      "buildSnapshot: input.uid must be a positive integer (was " + uid + ")",
    );
  }
  const snapshottedAt =
    Number.isFinite(input.snapshottedAt) && input.snapshottedAt > 0
      ? input.snapshottedAt
      : Date.now();
  const account = {
    uid: String(uid),
    displayName:
      typeof input.displayName === "string" ? input.displayName : "",
  };
  const events = [];

  // posts
  const posts = Array.isArray(input.posts) ? input.posts : [];
  posts.forEach((p, idx) => {
    if (!p || typeof p !== "object") return;
    events.push({
      kind: "post",
      id: p.mid ? `post-${p.mid}` : `post-${idx}`,
      capturedAt: typeof p.createdAt === "number" && p.createdAt > 0 ? p.createdAt : snapshottedAt,
      text: p.text || null,
      mid: p.mid || null,
      source: p.source || null,
      repostsCount: typeof p.repostsCount === "number" ? p.repostsCount : 0,
      commentsCount:
        typeof p.commentsCount === "number" ? p.commentsCount : 0,
      likesCount: typeof p.likesCount === "number" ? p.likesCount : 0,
      picCount: typeof p.picCount === "number" ? p.picCount : 0,
    });
  });

  // favourites
  const favs = Array.isArray(input.favourites) ? input.favourites : [];
  favs.forEach((f, idx) => {
    if (!f || typeof f !== "object") return;
    events.push({
      kind: "favourite",
      id: f.mid ? `fav-${f.mid}` : `fav-${idx}`,
      capturedAt: typeof f.favAt === "number" && f.favAt > 0 ? f.favAt : snapshottedAt,
      text: f.text || null,
      mid: f.mid || null,
      authorScreenName: f.authorScreenName || null,
    });
  });

  // follows
  const fols = Array.isArray(input.follows) ? input.follows : [];
  fols.forEach((fol, idx) => {
    if (!fol || typeof fol !== "object") return;
    const followUid = typeof fol.uid === "number" ? fol.uid : null;
    events.push({
      kind: "follow",
      id: followUid != null ? `follow-${followUid}` : `follow-${idx}`,
      // /api/friendships/friends doesn't return follow time → fall back
      capturedAt:
        typeof fol.followedAt === "number" && fol.followedAt > 0
          ? fol.followedAt
          : snapshottedAt,
      uid: followUid != null ? followUid : null,
      screenName: fol.screenName || null,
      description: fol.description || null,
      avatarUrl: fol.avatarUrl || null,
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
    opts.fileName || `cc-weibo-snapshot-${crypto.randomUUID()}.json`;
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
