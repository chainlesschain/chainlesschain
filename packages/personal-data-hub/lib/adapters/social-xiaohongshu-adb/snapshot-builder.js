"use strict";

/**
 * Phase 3c (Xhs C 路径 — 2026-05-25): API responses → snapshot JSON.
 *
 * Matches the existing `social-xiaohongshu` adapter's snapshot mode
 * schema (schemaVersion=1). Kinds: note / liked / follow.
 *
 * Note: xhs userId is a Base64-ish string (e.g. "5e8c8f7e..."), not a
 * numeric Long. The account.uid in the snapshot is set to userId
 * verbatim (string passthrough); consumers shouldn't expect numeric uid.
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
  const userId = input.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new TypeError("buildSnapshot: input.userId must be a non-empty string");
  }
  const snapshottedAt =
    Number.isFinite(input.snapshottedAt) && input.snapshottedAt > 0
      ? input.snapshottedAt
      : Date.now();
  const account = {
    userId, // xhs userId is a string, not numeric
    nickname: typeof input.nickname === "string" ? input.nickname : "",
  };
  const events = [];

  // notes
  const notes = Array.isArray(input.notes) ? input.notes : [];
  notes.forEach((n, idx) => {
    if (!n || typeof n !== "object") return;
    events.push({
      kind: "note",
      id: n.noteId ? `note-${n.noteId}` : `note-${idx}`,
      capturedAt:
        typeof n.createdAt === "number" && n.createdAt > 0
          ? n.createdAt
          : snapshottedAt,
      noteId: n.noteId || null,
      title: n.title || null,
      desc: n.desc || null,
      type: n.type || "normal",
      likedCount: typeof n.likedCount === "number" ? n.likedCount : 0,
      collectedCount:
        typeof n.collectedCount === "number" ? n.collectedCount : 0,
      commentCount: typeof n.commentCount === "number" ? n.commentCount : 0,
    });
  });

  // liked
  const liked = Array.isArray(input.liked) ? input.liked : [];
  liked.forEach((l, idx) => {
    if (!l || typeof l !== "object") return;
    events.push({
      kind: "liked",
      id: l.noteId ? `liked-${l.noteId}` : `liked-${idx}`,
      // xhs doesn't return liked_at — use snapshottedAt
      capturedAt: snapshottedAt,
      noteId: l.noteId || null,
      title: l.title || null,
      authorNickname: l.authorNickname || null,
    });
  });

  // follows
  const follows = Array.isArray(input.follows) ? input.follows : [];
  follows.forEach((f, idx) => {
    if (!f || typeof f !== "object") return;
    events.push({
      kind: "follow",
      id: f.userId ? `follow-${f.userId}` : `follow-${idx}`,
      capturedAt: snapshottedAt,
      userId: f.userId || null,
      nickname: f.nickname || null,
      image: f.image || null,
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
    opts.fileName || `cc-xhs-snapshot-${crypto.randomUUID()}.json`;
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
