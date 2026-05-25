"use strict";

/**
 * Phase 1b (Bilibili C 路径 — 2026-05-25): convert 4 API response arrays
 * into a snapshot JSON file that the existing `social-bilibili` adapter
 * consumes in snapshot mode.
 *
 * Schema (mirrors `adapter.js`:SNAPSHOT_SCHEMA_VERSION = 1):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "uid": "<numeric uid as string>", "displayName": "" },
 *     "events": [
 *       { "kind": "history",   "id": "BV1...",      "capturedAt": <ms>, ...fields },
 *       { "kind": "favourite", "id": "fav-BV1...",  "capturedAt": <ms>, ...fields },
 *       { "kind": "dynamic",   "id": "dyn-<rid>",   "capturedAt": <ms>, ...fields },
 *       { "kind": "follow",    "id": "follow-<mid>", "capturedAt": <ms>, ...fields }
 *     ]
 *   }
 *
 * Field mapping (BilibiliApiClient.js return shapes → event fields):
 *   HistoryItem.viewAt        → capturedAt
 *   FavouriteItem.savedAt     → capturedAt
 *   DynamicItem.publishedAt   → capturedAt
 *   FollowItem.followedAt     → capturedAt
 *
 * All other fields pass through verbatim (the adapter stores the whole
 * event object as the payload via `{...ev, account}`).
 *
 * Stable `id` derivation matches the Android side
 * (BilibiliLocalCollector.kt does the same prefix-namespacing):
 *   history:   bvid  (fallback "history-<index>")
 *   favourite: "fav-" + bvid  (fallback "fav-<index>")
 *   dynamic:   "dyn-" + rid   (fallback "dyn-<index>")
 *   follow:    "follow-" + mid (fallback "follow-<index>")
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Build the in-memory snapshot object. Pure function — no disk I/O.
 *
 * @param {{
 *   uid: number,
 *   displayName?: string,
 *   history?: Array,
 *   favourites?: Array,
 *   dynamics?: Array,
 *   follows?: Array,
 *   snapshottedAt?: number,
 * }} input
 * @returns {{schemaVersion: number, snapshottedAt: number, account: object, events: Array}}
 */
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

  // history
  const history = Array.isArray(input.history) ? input.history : [];
  history.forEach((h, idx) => {
    if (!h || typeof h !== "object") return;
    events.push({
      kind: "history",
      id: h.bvid || `history-${idx}`,
      capturedAt: typeof h.viewAt === "number" ? h.viewAt : snapshottedAt,
      title: h.title || null,
      bvid: h.bvid || null,
      avid: typeof h.avid === "number" ? h.avid : null,
      duration: typeof h.duration === "number" ? h.duration : null,
      uploader: h.uploader || null,
      uploaderMid: typeof h.uploaderMid === "number" ? h.uploaderMid : null,
      part: h.part || null,
    });
  });

  // favourites
  const favs = Array.isArray(input.favourites) ? input.favourites : [];
  favs.forEach((f, idx) => {
    if (!f || typeof f !== "object") return;
    events.push({
      kind: "favourite",
      id: f.bvid ? `fav-${f.bvid}` : `fav-${idx}`,
      capturedAt: typeof f.savedAt === "number" ? f.savedAt : snapshottedAt,
      title: f.title || null,
      bvid: f.bvid || null,
      folderName: f.folderName || null,
      uploader: f.uploader || null,
    });
  });

  // dynamics
  const dyns = Array.isArray(input.dynamics) ? input.dynamics : [];
  dyns.forEach((d, idx) => {
    if (!d || typeof d !== "object") return;
    events.push({
      kind: "dynamic",
      id: d.rid ? `dyn-${d.rid}` : `dyn-${idx}`,
      capturedAt:
        typeof d.publishedAt === "number" ? d.publishedAt : snapshottedAt,
      summary: d.summary || null,
      dynamicType: d.dynamicType || "unknown",
      authorMid: typeof d.authorMid === "number" ? d.authorMid : null,
      authorName: d.authorName || null,
    });
  });

  // follows
  const fols = Array.isArray(input.follows) ? input.follows : [];
  fols.forEach((f, idx) => {
    if (!f || typeof f !== "object") return;
    const mid = typeof f.mid === "number" ? f.mid : null;
    events.push({
      kind: "follow",
      id: mid ? `follow-${mid}` : `follow-${idx}`,
      capturedAt:
        typeof f.followedAt === "number" ? f.followedAt : snapshottedAt,
      mid: mid != null ? String(mid) : null,
      uname: f.uname || null,
      face: f.face || null,
      sign: f.sign || null,
    });
  });

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshottedAt,
    account,
    events,
  };
}

/**
 * Write a snapshot object to disk as JSON. Default destination is
 * `<os.tmpdir()>/cc-bilibili-snapshot-<uuid>.json`. Returns the absolute
 * path written. Caller is responsible for cleanup (BilibiliAdbCollector
 * does this in a try/finally).
 *
 * @param {object} snapshot  output of buildSnapshot
 * @param {{dir?: string, fileName?: string}} [opts]
 * @returns {string}  absolute path
 */
function writeSnapshotJson(snapshot, opts = {}) {
  const dir = opts.dir || os.tmpdir();
  const fileName =
    opts.fileName || `cc-bilibili-snapshot-${crypto.randomUUID()}.json`;
  if (fileName.includes("/") || fileName.includes("\\")) {
    throw new Error(
      "writeSnapshotJson: opts.fileName must be a basename, not a path",
    );
  }
  const full = path.join(dir, fileName);
  fs.writeFileSync(full, JSON.stringify(snapshot), "utf-8");
  return full;
}

/**
 * Best-effort delete of a snapshot file. Used in finally blocks; never
 * throws.
 */
function cleanupSnapshotJson(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (_e) {
    // ignore — temp file cleanup is best-effort
  }
}

module.exports = {
  buildSnapshot,
  writeSnapshotJson,
  cleanupSnapshotJson,
  SNAPSHOT_SCHEMA_VERSION,
};
